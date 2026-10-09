/**
 * Talks to the local Whisper Flow server.
 *
 * The server is the TypeScript port of the old Python backend, so it runs
 * Whisper locally via ONNX Runtime. Audio is captured in the browser and posted
 * as raw Float32 PCM; no audio leaves this machine.
 */

const PORT = import.meta.env.VITE_WHISPER_FLOW_PORT ?? "8765";

export const API = `http://127.0.0.1:${PORT}`;

export type Status = {
  recording: boolean;
  model: string;
  messages: string[];
};

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json() as Promise<T>;
}

export function getStatus(): Promise<Status> {
  return json<Status>("/api/status");
}

export function toggle(): Promise<{ recording: boolean }> {
  return json<{ recording: boolean }>("/api/toggle", { method: "POST" });
}

/** Post one block of 16 kHz mono Float32 samples. */
export async function sendAudio(samples: Float32Array): Promise<void> {
  await json<{ ok: boolean }>("/api/audio", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: samples.buffer as ArrayBuffer,
  });
}

/** Ask the server to transcribe everything buffered and return the text. */
export function transcribe(): Promise<{ ok: boolean; text: string }> {
  return json<{ ok: boolean; text: string }>("/api/transcribe", { method: "POST" });
}

export const isTauri = "__TAURI_INTERNALS__" in window;

export type Listener = (text: string, final: boolean) => void;
export type StatusListener = (status: SpeechStatus) => void;

export type SpeechStatus =
  | "idle"
  | "starting"
  | "listening"
  | "unsupported"
  | "denied"
  | "error";

/** Copies text to the clipboard so it can be pasted into the focused field. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const TARGET_SAMPLE_RATE = 16000;

/**
 * Captures microphone audio, downsamples it to 16 kHz mono, and posts each
 * block to the server.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private readonly blocks: Float32Array[] = [];

  constructor(
    private readonly onBlock: (samples: Float32Array) => Promise<void>,
  ) {}

  get active(): boolean {
    return this.context !== null;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const context = new AudioContext();
    await context.resume();
    this.context = context;

    const source = context.createMediaStreamSource(this.stream);
    this.source = source;

    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const mono = this.downsample(input, context.sampleRate, TARGET_SAMPLE_RATE);
      void this.onBlock(mono).catch(() => {});
    };

    source.connect(processor);
    // ScriptProcessor only runs when connected to the graph, so route to a
    // muted sink rather than the speakers.
    const sink = context.createGain();
    sink.gain.value = 0;
    processor.connect(sink);
    sink.connect(context.destination);
  }

  /** Linear resample; adequate for speech at these ratios. */
  private downsample(input: Float32Array, from: number, to: number): Float32Array {
    if (from === to) return new Float32Array(input);

    const ratio = from / to;
    const length = Math.floor(input.length / ratio);
    const output = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const start = i * ratio;
      const end = Math.min(input.length, start + ratio);
      let sum = 0;
      let count = 0;
      for (let j = Math.floor(start); j < end; j++) {
        sum += input[j];
        count++;
      }
      output[i] = count > 0 ? sum / count : 0;
    }
    return output;
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    void this.context?.close();

    this.processor = null;
    this.source = null;
    this.stream = null;
    this.context = null;
  }
}