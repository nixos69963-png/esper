#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
sudo apt-get update
sudo apt-get install -y python3-dev python3-venv portaudio19-dev xclip xdotool libxcb-xinerama0
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
cat <<'EOF'

Installed. Start with:
  . .venv/bin/activate
  python whisper_flow.py

Default model: base.en (good quality / low latency on CPU)
Fastest model: WHISPER_FLOW_MODEL=tiny.en python whisper_flow.py
Higher quality: WHISPER_FLOW_MODEL=small.en python whisper_flow.py
EOF
