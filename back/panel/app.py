import asyncio
import json
import time
import webbrowser
from threading import Thread
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .core.config import PANEL_DIR
from .schemas import RunConfig
from .services.task_runner import config_payload, start_task as start_panel_task, stop_task as stop_panel_task, task_state


app = FastAPI(title="Twitter Download Learning Panel")

if PANEL_DIR.exists():
    app.mount("/assets", StaticFiles(directory=PANEL_DIR), name="assets")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(PANEL_DIR / "index.html")


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return config_payload()


@app.get("/api/status")
def get_status() -> dict[str, Any]:
    return task_state.snapshot()


@app.post("/api/start")
def start_task(config: RunConfig) -> dict[str, Any]:
    return start_panel_task(config)


@app.post("/api/stop")
def stop_task() -> dict[str, Any]:
    return stop_panel_task()


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


def main() -> None:
    Thread(target=open_browser, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=7860, log_level="info")


if __name__ == "__main__":
    main()
