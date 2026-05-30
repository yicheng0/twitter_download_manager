import subprocess
import time
from collections import deque
from datetime import datetime, timedelta
from threading import Lock
from typing import Any

from pydantic import BaseModel, Field


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
    max_concurrent_requests: int | None = Field(None, ge=1, le=3)
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
        import re

        line = line.rstrip()
        if not line:
            return
        with self.lock:
            self.logs.append(line)
            self.log_version += 1
            self._parse_summary(line)

    def _parse_summary(self, line: str) -> None:
        import re

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
