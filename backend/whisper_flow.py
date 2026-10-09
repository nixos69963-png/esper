#!/usr/bin/env python3
"""Whisper Flow: local, push-to-talk speech-to-text for Linux.

Alt+P toggles recording. Finalized segments are pasted into the currently
focused text field. Everything runs locally after the model is downloaded.
"""
from __future__ import annotations

import os
import queue
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Optional

import numpy as np
import sounddevice as sd
from faster_whisper import WhisperModel
from pynput import keyboard

from word_overlap import RollingText

SAMPLE_RATE = int(os.getenv("WHISPER_FLOW_SAMPLE_RATE", "16000"))
CHANNELS = 1
CHUNK_SECONDS = float(os.getenv("WHISPER_FLOW_CHUNK_SECONDS", "1.25"))
# Audio repeated at the start of each chunk so a word cut by a chunk boundary
# is transcribed whole by the next chunk.
OVERLAP_SECONDS = float(os.getenv("WHISPER_FLOW_OVERLAP_SECONDS", "0.45"))
MODEL_NAME = os.getenv("WHISPER_FLOW_MODEL", "base.en")
LANGUAGE = os.getenv("WHISPER_FLOW_LANGUAGE", "en") or None
COMPUTE_TYPE = os.getenv("WHISPER_FLOW_COMPUTE", "int8")
DEVICE = os.getenv("WHISPER_FLOW_DEVICE", "cpu")
PASTE_DELAY = float(os.getenv("WHISPER_FLOW_PASTE_DELAY", "0.025"))
INSERT_MODE = os.getenv("WHISPER_FLOW_INSERT_MODE", "auto")

@dataclass
class Config:
    model: str = MODEL_NAME
    device: str = DEVICE
    compute_type: str = COMPUTE_TYPE

class WhisperFlow:
    def __init__(self) -> None:
        self.config = Config()
        self.audio_queue: queue.Queue[np.ndarray] = queue.Queue()
        self.stop_event = threading.Event()
        self.recording = False
        self.recording_lock = threading.Lock()
        self.model: Optional[WhisperModel] = None
        self.worker: Optional[threading.Thread] = None
        self.stream: Optional[sd.InputStream] = None
        self.last_paste = 0.0
        self.target_window: Optional[str] = None
        self.text = RollingText()

    def log(self, message: str) -> None:
        print(f"[Whisper Flow] {message}", flush=True)

    def load_model(self) -> None:
        if self.model is None:
            self.log(f"Loading {self.config.model} ({self.config.device}/{self.config.compute_type})…")
            self.model = WhisperModel(
                self.config.model,
                device=self.config.device,
                compute_type=self.config.compute_type,
                cpu_threads=max(1, (os.cpu_count() or 4) - 1),
            )
            self.log("Ready. Press Alt+P to start/stop.")

    def audio_callback(self, indata: np.ndarray, frames: int, time_info, status) -> None:
        if status:
            self.log(str(status))
        self.audio_queue.put(indata[:, 0].copy())

    def paste_at_cursor(self, text: str) -> None:
        text = " ".join(text.strip().split())
        if not text:
            return
        insert_text = text + " "
        if INSERT_MODE == "type":
            keyboard.Controller().type(insert_text)
            return
        # Keep xclip alive until the paste request is served. If xclip exits
        # immediately, the X11 clipboard owner disappears before Ctrl+V.
        try:
            if os.getenv("XDG_SESSION_TYPE", "x11").lower() == "wayland":
                subprocess.run(["wtype", "--", text + " "], check=True)
                return
            if self.target_window:
                subprocess.run(
                    ["xdotool", "windowactivate", "--sync", self.target_window],
                    check=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            clipboard = subprocess.Popen(
                ["xclip", "-selection", "clipboard", "-loops", "1"],
                stdin=subprocess.PIPE,
            )
            assert clipboard.stdin is not None
            clipboard.stdin.write(insert_text.encode())
            clipboard.stdin.close()
            time.sleep(PASTE_DELAY)
            subprocess.run(["xdotool", "key", "--clearmodifiers", "ctrl+v"], check=True)
            clipboard.wait(timeout=2)
        except FileNotFoundError:
            # Direct key events are a useful fallback on minimal desktops and
            # when the session is not X11/Wayland with clipboard utilities.
            keyboard.Controller().type(insert_text)
            self.log("Inserted using direct keyboard input.")
        except subprocess.CalledProcessError as exc:
            keyboard.Controller().type(insert_text)
            self.log(f"Clipboard paste failed; used direct keyboard input: {exc}")
        except subprocess.TimeoutExpired:
            keyboard.Controller().type(insert_text)
            self.log("Clipboard paste timed out; used direct keyboard input.")

    def emit_new_text(self, text: str) -> None:
        """Insert only the words that are new since the last chunk.

        Chunks overlap in audio and Whisper echoes their shared words, so
        RollingText removes the repeated words and holds back the trailing one
        until the next chunk shows whether it was heard whole.
        """
        new_text = self.text.add(text)
        if not new_text:
            return
        self.log(f"→ {new_text}")
        self.paste_at_cursor(new_text)

    def flush_text(self) -> None:
        """Release the word held back while waiting for the next chunk."""
        held = self.text.flush()
        if held:
            self.log(f"→ {held}")
            self.paste_at_cursor(held)

    def transcribe_chunk(self, audio: np.ndarray) -> str:
        if self.model is None:
            return ""
        # VAD removes silence and condition_on_previous_text=False prevents
        # repeated phrases when each rolling chunk is transcribed independently.
        segments, _ = self.model.transcribe(
            audio,
            language=LANGUAGE,
            beam_size=3,
            best_of=3,
            temperature=0.0,
            vad_filter=True,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()

    def worker_loop(self) -> None:
        buffer = np.empty(0, dtype=np.float32)
        target = int(SAMPLE_RATE * CHUNK_SECONDS)
        # Chunks overlap so a word spanning a boundary is heard whole by the
        # next chunk. RollingText then drops the repeated words, which repairs
        # mid-word cuts that no text-level rule can join reliably.
        overlap = int(SAMPLE_RATE * OVERLAP_SECONDS)
        stride = max(1, target - min(overlap, target - 1))
        while not self.stop_event.is_set() or not self.audio_queue.empty():
            try:
                part = self.audio_queue.get(timeout=0.1)
                buffer = np.concatenate((buffer, part))
            except queue.Empty:
                continue
            if len(buffer) < target and not self.stop_event.is_set():
                continue
            if len(buffer) == 0:
                continue
            chunk, buffer = buffer[:target], buffer[stride:]
            text = self.transcribe_chunk(chunk)
            if text:
                self.emit_new_text(text)
        # Flush a short final chunk when recording stops.
        if len(buffer) > int(SAMPLE_RATE * 0.35):
            text = self.transcribe_chunk(buffer)
            if text:
                self.emit_new_text(text)
        self.flush_text()

    def start(self) -> None:
        with self.recording_lock:
            if self.recording:
                return
            try:
                self.target_window = subprocess.check_output(
                    ["xdotool", "getactivewindow"], text=True
                ).strip()
            except (FileNotFoundError, subprocess.CalledProcessError):
                self.target_window = None
            self.load_model()
            self.audio_queue = queue.Queue()
            self.text.reset()
            self.stop_event.clear()
            self.recording = True
            self.worker = threading.Thread(target=self.worker_loop, daemon=True)
            self.worker.start()
            self.stream = sd.InputStream(
                samplerate=SAMPLE_RATE,
                channels=CHANNELS,
                dtype="float32",
                blocksize=int(SAMPLE_RATE * 0.1),
                callback=self.audio_callback,
            )
            self.stream.start()
            self.log("Recording… press Alt+P again to stop.")

    def stop(self) -> None:
        with self.recording_lock:
            if not self.recording:
                return
            self.recording = False
            if self.stream:
                self.stream.stop()
                self.stream.close()
                self.stream = None
            self.stop_event.set()
        if self.worker:
            self.worker.join(timeout=CHUNK_SECONDS + 8)
        self.log("Stopped.")

    def toggle(self) -> None:
        try:
            if self.recording:
                self.stop()
            else:
                self.start()
        except Exception as exc:
            self.log(f"Error: {exc}")
            self.stop_event.set()
            self.recording = False

    def run(self) -> None:
        self.log(f"Model: {self.config.model}. Local mode; no audio leaves this computer.")
        self.log("Press Alt+P to toggle recording. Press Ctrl+C to quit.")
        hotkey = keyboard.HotKey(
            keyboard.HotKey.parse("<alt>+p"),
            self.toggle,
        )
        def on_press(key):
            hotkey.press(key)
        def on_release(key):
            hotkey.release(key)
        with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
            try:
                listener.join()
            except KeyboardInterrupt:
                self.stop()

if __name__ == "__main__":
    WhisperFlow().run()
