/**
 * Whisper Flow API server.
 *
 * Replaces backend/server.py. Exposes the same endpoints the React pill calls,
 * and does the transcription locally with ONNX Runtime instead of FastAPI plus
 * faster-whisper.
 */
import express, { type Request, type Response } from "express";

import { Transcriber } from "./transcribe.js";

const PORT = Number(process.env.WHISPER_FLOW_PORT ?? 8765);
const MAX_MESSAGES = 100;
const MAX_CHUNKS = 600; // ~12 minutes of 1.25s windows before we stop buffering.

export type Status = {
  recording: boolean;
  model: string;
  messages: string[];
};

class Flow {
  readonly transcriber: Transcriber;
  recording = false;
  loaded = false;

  private messages: string[] = [];
  private chunks: Float32Array[] = [];

  constructor() {
    this.transcriber = new Transcriber({
      onStatus: (message) => {
        this.log(message);
        if (message.startsWith("Ready.")) this.loaded = true;
      },
    });
  }

  log(message: string): void {
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    console.log(`[Whisper Flow] ${message}`);
  }

  status(): Status {
    // Messages are drained per poll so the client only sees new ones.
    const messages = this.messages;
    this.messages = [];
    return {
      recording: this.recording,
      model: this.transcriber.modelName,
      messages,
    };
  }

  addChunk(chunk: Float32Array): void {
    if (this.chunks.length >= MAX_CHUNKS) return;
    this.chunks.push(chunk);
  }

  async transcribeAndInsert(): Promise<string> {
    const chunks = this.chunks;
    this.chunks = [];
    const inserted: string[] = [];

    await this.transcriber.transcribeStream(chunks, (text) => {
      inserted.push(text);
      this.log(`→ ${text}`);
    });

    return inserted.join(" ");
  }

  toggle(): boolean {
    if (this.recording) {
      // Keep the buffered audio: the client transcribes it right after.
      this.recording = false;
      this.log("Stopped.");
    } else {
      this.recording = true;
      this.chunks = [];
      void this.transcriber.load();
      this.log("Recording… press Alt+P again to stop.");
    }
    return this.recording;
  }

  start(): boolean {
    if (this.recording) return this.recording;
    return this.toggle();
  }

  stop(): boolean {
    if (!this.recording) return this.recording;
    return this.toggle();
  }
}

const flow = new Flow();
const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));

app.get("/api/status", (_req: Request, res: Response) => {
  res.json(flow.status());
});

app.post("/api/toggle", (_req: Request, res: Response) => {
  res.json({ recording: flow.toggle() });
});

app.post("/api/start", (_req: Request, res: Response) => {
  res.json({ recording: flow.start() });
});

app.post("/api/stop", (_req: Request, res: Response) => {
  res.json({ recording: flow.stop() });
});

/** Receive raw Float32 PCM (16 kHz mono) from the browser. */
app.post("/api/audio", (req: Request, res: Response) => {
  const body = req.body as Buffer;
  if (!flow.recording) {
    res.json({ ok: false, reason: "not recording" });
    return;
  }
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.json({ ok: false, reason: "empty body" });
    return;
  }
  if (body.length % 4 !== 0) {
    res.status(400).json({ ok: false, reason: "body must be Float32 PCM" });
    return;
  }
  const floats = new Float32Array(body.length / 4);
  for (let i = 0; i < floats.length; i++) floats[i] = body.readFloatLE(i * 4);
  flow.addChunk(floats);
  res.json({ ok: true, samples: floats.length });
});

/** Transcribe everything buffered so far and hand back the text. */
app.post("/api/transcribe", (_req: Request, res: Response) => {
  void flow
    .transcribeAndInsert()
    .then((text) => res.json({ ok: true, text }))
    .catch((error: unknown) => {
      flow.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ ok: false, error: String(error) });
    });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "whisper-flow" });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[Whisper Flow] listening on http://127.0.0.1:${PORT}`);
  flow.log("Server ready. Alt+P toggles recording from any app.");
});