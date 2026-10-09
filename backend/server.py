#!/usr/bin/env python3
from __future__ import annotations

import asyncio
import os
import queue
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pynput import keyboard

from whisper_flow import WhisperFlow

ROOT = Path(__file__).parent
app = FastAPI(title="Whisper Flow", version="0.2.0")
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

flow = WhisperFlow()
status_lock = threading.Lock()
status_events: queue.Queue[str] = queue.Queue(maxsize=100)
original_log = flow.log


def log_and_publish(message: str) -> None:
    original_log(message)
    with status_lock:
        try:
            status_events.put_nowait(message)
        except queue.Full:
            try:
                status_events.get_nowait()
            except queue.Empty:
                pass
            status_events.put_nowait(message)


flow.log = log_and_publish  # type: ignore[method-assign]


def start_global_hotkey() -> None:
    hotkeys = keyboard.GlobalHotKeys({"<alt>+p": flow.toggle})
    hotkeys.start()


@app.on_event("startup")
def startup() -> None:
    if os.getenv("WHISPER_FLOW_PYNPUT_HOTKEY") == "1":
        threading.Thread(target=start_global_hotkey, daemon=True, name="global-hotkey").start()
    # Alt+P is registered by the Tauri app by default.
    flow.log("Floating UI ready. Alt+P toggles recording from any app.")


@app.on_event("shutdown")
def shutdown() -> None:
    flow.stop()


@app.get("/api/status")
def status() -> dict[str, Any]:
    messages: list[str] = []
    while True:
        try:
            messages.append(status_events.get_nowait())
        except queue.Empty:
            break
    return {
        "recording": flow.recording,
        "model": flow.config.model,
        "messages": messages,
    }


@app.post("/api/toggle")
def toggle() -> dict[str, bool]:
    flow.toggle()
    return {"recording": flow.recording}


@app.post("/api/start")
def start() -> dict[str, bool]:
    flow.start()
    return {"recording": flow.recording}


@app.post("/api/stop")
def stop() -> dict[str, bool]:
    flow.stop()
    return {"recording": flow.recording}


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "service": "whisper-flow"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("WHISPER_FLOW_PORT", "8765")))
