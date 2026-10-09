/**
 * Local Whisper transcription via ONNX Runtime.
 *
 * A port of the Python pipeline: rolling audio windows are transcribed with a
 * small local model and the repeated boundary words are removed before the
 * text is handed back. Audio never leaves this machine.
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

import { RollingText } from "./wordOverlap.js";

export const SAMPLE_RATE = 16000;

/** Size of each rolling window in seconds. */
export const CHUNK_SECONDS = Number(process.env.WHISPER_FLOW_CHUNK_SECONDS ?? 1.25);
/**
 * Audio repeated at the start of each window so a word spanning a boundary is
 * transcribed whole by the next one.
 */
export const OVERLAP_SECONDS = Number(process.env.WHISPER_FLOW_OVERLAP_SECONDS ?? 0.45);

export type ModelName =
  | "onnx-community/whisper-tiny.en"
  | "onnx-community/whisper-base.en"
  | "onnx-community/whisper-small.en"
  | "onnx-community/whisper-tiny"
  | "onnx-community/whisper-base";

const MODELS: Record<string, ModelName> = {
  "tiny.en": "onnx-community/whisper-tiny.en",
  "base.en": "onnx-community/whisper-base.en",
  "small.en": "onnx-community/whisper-small.en",
  tiny: "onnx-community/whisper-tiny",
  base: "onnx-community/whisper-base",
};

export function resolveModel(name: string): ModelName {
  const model = MODELS[name];
  if (!model) throw new Error(`Unknown model "${name}". Use one of: ${Object.keys(MODELS).join(", ")}`);
  return model;
}

export type StatusListener = (message: string) => void;

export class Transcriber {
  private asr: AutomaticSpeechRecognitionPipeline | null = null;
  private loading: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
  private readonly text = new RollingText();

  readonly modelName: string;
  private readonly language: string | undefined;
  private readonly multilingual: boolean;

  constructor(options: {
    model?: string;
    language?: string;
    onStatus?: StatusListener;
  } = {}) {
    this.modelName = resolveModel(options.model ?? process.env.WHISPER_FLOW_MODEL ?? "tiny.en");
    const lang = options.language ?? process.env.WHISPER_FLOW_LANGUAGE ?? "";
    this.language = lang.trim() ? lang : undefined;
    this.multilingual = !this.modelName.endsWith(".en");
    this.onStatus = options.onStatus ?? (() => {});
  }

  private readonly onStatus: StatusListener;

  /** Load the model once and reuse it. Safe to call repeatedly. */
  async load(): Promise<AutomaticSpeechRecognitionPipeline> {
    if (this.asr) return this.asr;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      this.onStatus(`Loading ${this.modelName}…`);
      const asr = (await pipeline("automatic-speech-recognition", this.modelName, {
        dtype: "q8",
      })) as AutomaticSpeechRecognitionPipeline;
      this.asr = asr;
      this.onStatus(`Ready. Press Alt+P to start/stop.`);
      return asr;
    })();

    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  private async transcribe(audio: Float32Array): Promise<string> {
    const asr = await this.load();
    const result = (await asr(audio, {
      ...(this.multilingual
        ? { language: this.language ?? "en", task: "transcribe" as const }
        : {}),
      chunk_length_s: 30,
    })) as { text: string };
    return result.text.trim();
  }

  /**
   * Transcribe a complete recording held in memory and return the text with
   * boundary repeats removed.
   *
   * Recording arrives in pieces from the browser, so windows overlap by
   * OVERLAP_SECONDS and RollingText drops the words each window repeats.
   */
  async transcribeStream(
    chunks: Float32Array[],
    onInsert: (text: string) => void,
  ): Promise<void> {
    this.text.reset();

    const window_ = Math.max(1, Math.round(SAMPLE_RATE * CHUNK_SECONDS));
    const overlap = Math.round(SAMPLE_RATE * OVERLAP_SECONDS);
    const stride = Math.max(1, window_ - Math.min(overlap, window_ - 1));

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const all = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }

    for (let start = 0; start + window_ <= all.length; start += stride) {
      const text = await this.transcribe(all.subarray(start, start + window_));
      if (!text) continue;
      const fresh = this.text.add(text);
      if (fresh) onInsert(fresh);
    }

    // Anything past the last full window, plus the held trailing word.
    const tailStart = Math.max(0, all.length - window_);
    if (all.length > tailStart && all.length - tailStart < window_) {
      const text = await this.transcribe(all.subarray(tailStart));
      if (text) {
        const fresh = this.text.add(text);
        if (fresh) onInsert(fresh);
      }
    }

    const held = this.text.flush();
    if (held) onInsert(held);
  }
}