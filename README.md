# Whisper Flow

Push-to-talk speech-to-text as a single TypeScript stack: a React + Vite pill and a local Node server that runs Whisper through ONNX Runtime.

Press **Alt+P**, speak, press **Alt+P** again, then paste with **Ctrl+V**. No Python, no C++ toolchain, no cmake.

## Structure
- `src/App.tsx` — the pill UI: close ×, 34-bar row, record ↑
- `src/api.ts` — captures mic audio in the browser and posts Float32 PCM to the server
- `src/styles.css` — pill styling (`#242424` surface, `#3f3f3f` border)
- `server/index.ts` — Express API, the TypeScript port of `backend/server.py`
- `server/transcribe.ts` — Whisper via `@huggingface/transformers`, rolling windows
- `server/wordOverlap.ts` — removes words Whisper repeats at window boundaries
- `server/check.ts` — the ported test suite (`npm run check`)
- `src-tauri/` — optional Tauri desktop shell with the global **Alt+P** shortcut
- `backend/` — the old Python service, kept for reference. Not used.

## Run

Two terminals:

```bash
npm install

# terminal 1 — the API and local Whisper
npm run server

# terminal 2 — the pill
npm run dev        # http://localhost:1420
```

Desktop pill instead of the browser (needs Rust, <https://rustup.rs>):

```bash
npx tauri icon app-icon.png   # once
npm run tauri dev
```

The first run downloads the Whisper model (~40 MB for `tiny.en`) and caches it. Everything after that is offline.

## Settings
| Variable | Default | Meaning |
| --- | --- | --- |
| `WHISPER_FLOW_MODEL` | `tiny.en` | `tiny.en`, `base.en`, `small.en`, `tiny`, `base` |
| `WHISPER_FLOW_LANGUAGE` | auto | e.g. `fr`; ignored by `.en` models |
| `WHISPER_FLOW_PORT` | `8765` | API port |
| `WHISPER_FLOW_CHUNK_SECONDS` | `1.25` | rolling window size |
| `WHISPER_FLOW_OVERLAP_SECONDS` | `0.45` | audio repeated between windows |

## How the text reaches your app
The server transcribes and the browser copies the result to the clipboard, so **you press Ctrl+V**. Automatic insertion into the focused field needs OS-level integration, which is why it was not carried over from the Python version.

## Privacy
Transcription runs locally through ONNX Runtime. Audio is sent from the browser to `127.0.0.1` only and never leaves the machine. The earlier browser-native `SpeechRecognition` path was removed because it uploaded audio to Google.

## Notes
- `navigator.clipboard` needs a secure context. `localhost` counts, so `npm run dev` works; opening `dist/index.html` from disk will not copy text.
- Windows blocks clipboard writes from non-focused windows, so press Ctrl+V while your target field is focused.
- Single short words repeated at a window boundary are kept rather than dropped, since a genuine repetition and an echo look identical. See `server/wordOverlap.ts`.