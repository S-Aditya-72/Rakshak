#!/usr/bin/env bash
# RAKSHAK local inference service setup (macOS / Linux). Run from the rakshak/ folder:
#   bash scripts/setup-server.sh
# Needs: Python 3.12 (or uv). On Apple silicon the standard torch wheel includes MPS; RoBERTa runs on CPU by
# default (RAKSHAK_ROBERTA_DEVICE=mps to move it). Ollama is installed separately (see README).
set -euo pipefail
cd "$(dirname "$0")/../apps/server"
if command -v uv >/dev/null 2>&1; then
  uv venv --python 3.12 .venv
  if [[ "$(uname)" == "Darwin" ]]; then uv pip install --python .venv/bin/python torch
  else uv pip install --python .venv/bin/python --index-url "${RAKSHAK_TORCH_INDEX:-https://download.pytorch.org/whl/cpu}" torch; fi
  uv pip install --python .venv/bin/python -r requirements.txt
else
  python3.12 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  if [[ "$(uname)" == "Darwin" ]]; then .venv/bin/python -m pip install torch
  else .venv/bin/python -m pip install --index-url https://download.pytorch.org/whl/cpu torch; fi
  .venv/bin/python -m pip install -r requirements.txt
fi
echo "Downloading RoBERTa weights (nayan90k/roberta-finetuned-cyberbullying-detection)..."
.venv/bin/python -c "from huggingface_hub import snapshot_download; print(snapshot_download('nayan90k/roberta-finetuned-cyberbullying-detection', allow_patterns=['*.json','*.txt','*.safetensors']))"
echo "Done. Start with: npm run server"
