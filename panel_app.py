import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import time
import webbrowser
from collections import deque
from datetime import datetime, timedelta
from pathlib import Path
from threading import Lock, Thread
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from proxy_utils import normalize_proxy_url


BASE_DIR = Path(__file__).resolve().parent
PANEL_DIR = BASE_DIR / "panel"
RUNTIME_DIR = BASE_DIR / ".panel" / "runtime"
ACTIVE_SETTINGS = RUNTIME_DIR / "settings.active.json"
DEFAULT_SETTINGS = BASE_DIR / "settings.json"


def default_time_range(days: int = 365) -> str:
    end = datetime.now()
    start = end - timedelta(days=days - 1)
    return f"{start.strftime('%Y-%m-%d')}:{end.strftime('%Y-%m-%d')}"


class RunConfig(BaseModel):
    save_path: str = ""
    user_lst: str = Field(..., min_length=1)
    cookie: str = Field(..., min_length=1)
    time_range: str = Field(default_factory=default_time_range)
    has_retweet: bool = False
    high_lights: bool = False
    likes: bool = False
    down_log: bool = False
    autoSync: bool = False
    image_format: str = "orig"
    has_video: bool = True
    log_output: bool = True
    max_concurrent_requests: int = Field(2, ge=1, le=3)
    proxy: str = ""
    md_output: bool = False
    media_count_limit: int = Field(350, ge=0)


class TaskState:
    def __init__(self) -> None:
        self.lock = Lock()
        self.process: subprocess.Popen[str] | None = None
        self.status = "idle"
        self.started_at: float | None = None
        self.ended_at: float | None = None
        self.return_code: int | None = None
        self.logs: deque[str] = deque(maxlen=1000)
        self.log_version = 0
        self.summary: dict[str, Any] = {
            "elapsed": None,
            "api_calls": 0,
            "downloads": 0,
        }
        self.output_path = ""
        self.message = "等待启动"

    def reset_for_run(self, output_path: str) -> None:
        self.process = None
        self.status = "starting"
        self.started_at = time.time()
        self.ended_at = None
        self.return_code = None
        self.logs.clear()
        self.log_version = 0
        self.summary = {"elapsed": None, "api_calls": 0, "downloads": 0}
        self.output_path = output_path
        self.message = "正在启动下载任务"

    def append_log(self, line: str) -> None:
        line = line.rstrip()
        if not line:
            return
        with self.lock:
            self.logs.append(line)
            self.log_version += 1
            self._parse_summary(line)

    def _parse_summary(self, line: str) -> None:
        elapsed = re.search(r"共耗时:([0-9.]+)秒", line)
        api_calls = re.search(r"共调用(\d+)次API", line)
        downloads = re.search(r"共下载(\d+)份图片/视频", line)
        if elapsed:
            self.summary["elapsed"] = round(float(elapsed.group(1)), 2)
        if api_calls:
            self.summary["api_calls"] = int(api_calls.group(1))
        if downloads:
            self.summary["downloads"] = int(downloads.group(1))

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            running_for = None
            if self.started_at:
                end = self.ended_at or time.time()
                running_for = round(end - self.started_at, 2)
            return {
                "status": self.status,
                "started_at": self.started_at,
                "ended_at": self.ended_at,
                "running_for": running_for,
                "return_code": self.return_code,
                "summary": self.summary,
                "output_path": self.output_path,
                "message": self.message,
                "log_version": self.log_version,
                "logs": list(self.logs)[-250:],
            }


task_state = TaskState()
app = FastAPI(title="Twitter Download Learning Panel")

if PANEL_DIR.exists():
    app.mount("/assets", StaticFiles(directory=PANEL_DIR), name="assets")


def load_default_settings() -> dict[str, Any]:
    if not DEFAULT_SETTINGS.exists():
        return {}
    with DEFAULT_SETTINGS.open("r", encoding="utf-8") as f:
        return json.load(f)


def validate_config(config: RunConfig) -> None:
    if "auth_token=" not in config.cookie or "ct0=" not in config.cookie:
        raise HTTPException(status_code=400, detail="cookie 必须包含 auth_token 和 ct0。")
    if config.image_format not in {"orig", "jpg", "png"}:
        raise HTTPException(status_code=400, detail="image_format 只能是 orig、jpg 或 png。")
    if not re.match(r"^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$", config.time_range):
        raise HTTPException(status_code=400, detail="时间范围格式应为 YYYY-MM-DD:YYYY-MM-DD。")
    start, end = config.time_range.split(":", 1)
    today = datetime.now().strftime("%Y-%m-%d")
    if end < start:
        raise HTTPException(status_code=400, detail="结束日期不能早于开始日期。")
    if end > today:
        raise HTTPException(status_code=400, detail="结束日期不能晚于今天。")
    users = [user.strip().lstrip("@") for user in config.user_lst.split(",") if user.strip()]
    if not users:
        raise HTTPException(status_code=400, detail="至少填写一个用户名。")
    if config.proxy:
        try:
            normalize_proxy_url(config.proxy)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))


def build_runtime_settings(config: RunConfig) -> dict[str, Any]:
    base = load_default_settings()
    data = dict(base)
    incoming = config.model_dump()
    incoming["user_lst"] = ",".join(
        user.strip().lstrip("@") for user in incoming["user_lst"].split(",") if user.strip()
    )
    data.update(incoming)
    if data.get("proxy"):
        data["proxy"] = normalize_proxy_url(data["proxy"])
    data["log_output"] = True
    return data


def monitor_process(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    for line in process.stdout:
        task_state.append_log(line)
    return_code = process.wait()
    with task_state.lock:
        task_state.return_code = return_code
        task_state.ended_at = time.time()
        if task_state.status == "stopping":
            task_state.status = "stopped"
            task_state.message = "任务已停止"
        elif return_code == 0:
            task_state.status = "finished"
            task_state.message = "任务已完成"
        else:
            task_state.status = "failed"
            task_state.message = f"任务异常退出，退出码 {return_code}"
        task_state.process = None


def force_stop_later(process: subprocess.Popen[str]) -> None:
    time.sleep(5)
    if process.poll() is None:
        process.terminate()


@app.get("/")
def index() -> FileResponse:
    return FileResponse(PANEL_DIR / "index.html")


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    settings = load_default_settings()
    return {
        "save_path": settings.get("save_path", ""),
        "user_lst": settings.get("user_lst", ""),
        "cookie": "",
        "time_range": settings.get("time_range") or default_time_range(),
        "has_retweet": bool(settings.get("has_retweet", False)),
        "high_lights": bool(settings.get("high_lights", False)),
        "likes": bool(settings.get("likes", False)),
        "down_log": bool(settings.get("down_log", False)),
        "autoSync": bool(settings.get("autoSync", False)),
        "image_format": settings.get("image_format", "orig"),
        "has_video": bool(settings.get("has_video", True)),
        "log_output": True,
        "max_concurrent_requests": int(settings.get("max_concurrent_requests", 2) or 2),
        "proxy": settings.get("proxy", ""),
        "md_output": bool(settings.get("md_output", False)),
        "media_count_limit": int(settings.get("media_count_limit", 350) or 0),
        "project_path": str(BASE_DIR),
    }


@app.get("/api/status")
def get_status() -> dict[str, Any]:
    return task_state.snapshot()


@app.post("/api/start")
def start_task(config: RunConfig) -> dict[str, Any]:
    validate_config(config)
    with task_state.lock:
        if task_state.process and task_state.process.poll() is None:
            raise HTTPException(status_code=409, detail="已有任务正在运行，请先停止或等待完成。")

        output_path = config.save_path.strip() or str(BASE_DIR)
        task_state.reset_for_run(output_path)

    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    runtime_settings = build_runtime_settings(config)
    with ACTIVE_SETTINGS.open("w", encoding="utf-8") as f:
        json.dump(runtime_settings, f, ensure_ascii=False, indent=4)

    python_exe = BASE_DIR / ".venv" / "Scripts" / "python.exe"
    if not python_exe.exists():
        python_exe = Path(sys.executable)

    env = os.environ.copy()
    env["TWITTER_DOWNLOAD_SETTINGS"] = str(ACTIVE_SETTINGS)
    env["PYTHONIOENCODING"] = "utf-8"

    process = subprocess.Popen(
        [str(python_exe), "main.py"],
        cwd=str(BASE_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
    )
    with task_state.lock:
        task_state.process = process
        task_state.status = "running"
        task_state.message = "任务运行中"

    Thread(target=monitor_process, args=(process,), daemon=True).start()
    return task_state.snapshot()


@app.post("/api/stop")
def stop_task() -> dict[str, Any]:
    with task_state.lock:
        process = task_state.process
        if not process or process.poll() is not None:
            task_state.status = "idle"
            task_state.message = "当前没有运行中的任务"
            return task_state.snapshot()
        task_state.status = "stopping"
        task_state.message = "正在停止任务"

    try:
        if os.name == "nt":
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            process.terminate()
    except Exception:
        process.terminate()

    Thread(target=force_stop_later, args=(process,), daemon=True).start()

    return task_state.snapshot()


@app.get("/api/logs/stream")
async def stream_logs() -> StreamingResponse:
    async def event_generator():
        last_version = -1
        while True:
            snapshot = task_state.snapshot()
            if snapshot["log_version"] != last_version:
                last_version = snapshot["log_version"]
                yield f"data: {json.dumps(snapshot, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0.8)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


def open_browser() -> None:
    time.sleep(1)
    webbrowser.open("http://127.0.0.1:7860")


if __name__ == "__main__":
    Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")
