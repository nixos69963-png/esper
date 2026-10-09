import { useCallback, useEffect, useRef, useState } from "react";
import {
  Recorder,
  copyText,
  getStatus,
  isTauri,
  sendAudio,
  toggle,
  transcribe,
} from "./api";

const BAR_COUNT = 34;

type Phase = "offline" | "idle" | "listening" | "denied";

const LABEL: Record<Phase, string> = {
  offline: "Server offline",
  idle: "Ready",
  listening: "Listening",
  denied: "Mic blocked",
};

export default function App() {
  const [phase, setPhase] = useState<Phase>("offline");
  const [text, setText] = useState("");
  const recorder = useRef<Recorder | null>(null);
  const starting = useRef(false);

  const recording = phase === "listening";

  // Poll the server so Alt+P from anywhere is reflected in the pill.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const status = await getStatus();
        if (!alive) return;
        setPhase((current) =>
          current === "denied" ? current : status.recording ? "listening" : "idle",
        );
      } catch {
        if (alive) setPhase("offline");
      }
    };
    void tick();
    const id = window.setInterval(tick, 400);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const flip = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;

    try {
      const state = await toggle();
      if (state.recording) {
        if (!recorder.current) {
          recorder.current = new Recorder(async (samples) => {
            await sendAudio(samples);
          });
        }
        await recorder.current.start();
        setPhase("listening");
      } else {
        recorder.current?.stop();
        setPhase("idle");

        // Server holds the audio; ask it to transcribe and copy the result.
        const result = await transcribe();
        if (result.text) {
          setText(result.text);
          await copyText(result.text);
        }
      }
    } catch {
      setPhase("offline");
    } finally {
      starting.current = false;
    }
  }, []);

  // Alt+P toggles: globally under Tauri, in-window in a plain browser.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    if (isTauri) {
      import("@tauri-apps/api/event").then(({ listen }) =>
        listen("toggle", () => flip()).then((u) => (unlisten = u)),
      );
    } else {
      const onKey = (e: KeyboardEvent) => {
        if (e.altKey && e.key.toLowerCase() === "p") {
          e.preventDefault();
          void flip();
        }
      };
      window.addEventListener("keydown", onKey);
      unlisten = () => window.removeEventListener("keydown", onKey);
    }
    return () => unlisten?.();
  }, [flip]);

  useEffect(() => () => recorder.current?.stop(), []);

  const title = text
    ? `${text} — copied, paste with Ctrl+V`
    : phase === "offline"
      ? "Start the server: npm run server"
      : LABEL[phase];

  return (
    <div className="pill" data-tauri-drag-region>
      <button
        className="round close"
        onClick={() => window.close()}
        aria-label="Close"
        title="Close"
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <div
        className={`wave ${recording ? "live" : ""}`}
        data-tauri-drag-region
        onClick={() => void flip()}
        role="button"
        tabIndex={0}
        aria-label={recording ? "Stop dictation" : "Start dictation"}
        title={title}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void flip();
          }
        }}
      >
        {Array.from({ length: BAR_COUNT }, (_, i) => (
          <i key={i} className="bar" style={{ animationDelay: `${i * 45}ms` }} />
        ))}
      </div>

      <button
        className={`round record ${recording ? "on" : ""}`}
        onClick={() => void flip()}
        aria-label={recording ? "Stop" : "Start"}
        title={title}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 20V5M6 11l6-6 6 6"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}