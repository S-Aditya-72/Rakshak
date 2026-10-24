# RAKSHAK local inference service setup (Windows). Run from the rakshak/ folder:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-server.ps1
# Needs: Python 3.12 (or uv), ~1.5 GB disk for torch + RoBERTa. Ollama is installed separately (see README).
$ErrorActionPreference = 'Stop'
$server = Join-Path $PSScriptRoot '..\apps\server'
Push-Location $server
try {
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if ($uv) {
    uv venv --python 3.12 .venv
    $py = Join-Path $server '.venv\Scripts\python.exe'
    # CPU torch keeps the 8 GB GPU free for Qwen. Set RAKSHAK_TORCH_INDEX to a CUDA index to put RoBERTa on the GPU.
    $index = if ($env:RAKSHAK_TORCH_INDEX) { $env:RAKSHAK_TORCH_INDEX } else { 'https://download.pytorch.org/whl/cpu' }
    uv pip install --python $py --index-url $index torch
    uv pip install --python $py -r requirements.txt
  } else {
    py -3.12 -m venv .venv
    $py = Join-Path $server '.venv\Scripts\python.exe'
    & $py -m pip install --upgrade pip
    & $py -m pip install --index-url https://download.pytorch.org/whl/cpu torch
    & $py -m pip install -r requirements.txt
  }
  Write-Host 'Downloading RoBERTa weights (nayan90k/roberta-finetuned-cyberbullying-detection)...'
  & $py -c "from huggingface_hub import snapshot_download; print(snapshot_download('nayan90k/roberta-finetuned-cyberbullying-detection', allow_patterns=['*.json','*.txt','*.safetensors']))"
  Write-Host 'Done. Start with: npm run server'
} finally {
  Pop-Location
}
