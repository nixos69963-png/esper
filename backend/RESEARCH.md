# Free STT research for Whisper Flow

## Recommendation

Use **faster-whisper** for the first implementation. It preserves Whisper model compatibility while using CTranslate2 for faster, lower-memory inference, supports CPU INT8, includes VAD, and can run without a paid API. Its project is MIT licensed. The app defaults to `base.en` for a useful quality/latency balance and allows `tiny.en` or `small.en` through an environment variable.

## Comparison

- **faster-whisper — recommended.** The official project describes it as up to 4× faster than `openai/whisper` at the same accuracy, with lower memory use. Its benchmark includes CPU INT8 and GPU modes. It has Python bindings, VAD integration, and automatically downloads compatible model files. [1]
- **whisper.cpp — strongest lightweight/native alternative.** It is a high-performance C/C++ implementation with CPU-only inference, quantization, Apple Silicon optimizations, broad platform support, VAD, and a real-time microphone example. It is MIT licensed. It is attractive for a later packaged native client, but faster-whisper is quicker to integrate into this Python prototype. [2]
- **Vosk — best for very small devices and strict streaming.** Vosk works offline, exposes a streaming API, supports 20+ languages, and offers portable per-language models around 50 MB. It is a good fallback when device resources are very limited, but Whisper-family models are the better default for general transcription quality. [3]
- **OpenAI Whisper — high quality reference implementation.** Whisper is multilingual and MIT licensed, with model sizes from tiny through large and a turbo model optimized for speed. The original Python implementation is heavier and less suitable for low-latency desktop insertion than faster-whisper or whisper.cpp. [4]

## Sources

[1] https://github.com/SYSTRAN/faster-whisper "Faster Whisper transcription with CTranslate2"
[2] https://github.com/ggml-org/whisper.cpp "whisper.cpp high-performance Whisper inference"
[3] https://alphacephei.com/vosk/ "Vosk offline speech recognition toolkit"
[4] https://github.com/openai/whisper "OpenAI Whisper repository and model information"
