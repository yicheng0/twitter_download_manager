import json
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from threading import Thread
from typing import Any

from fastapi import HTTPException

from proxy_utils import normalize_proxy_url

from ..core.config import ACTIVE_SETTINGS, BASE_DIR, DEFAULT_SETTINGS, RUNTIME_DIR
from ..schemas import RunConfig, TaskState, default_time_range


task_state = TaskState()


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
    data["max_concurrent_requests"] = max(1, min(int(data.get("max_concurrent_requests") or 2), 3))
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


def config_payload() -> dict[str, Any]:
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
