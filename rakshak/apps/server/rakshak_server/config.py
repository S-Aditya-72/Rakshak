"""Runtime settings. Everything is overridable with RAKSHAK_* environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]  # .../rakshak


def _env(name: str, default: str) -> str:
    return os.environ.get(f"RAKSHAK_{name}", default)


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: _env("HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(_env("PORT", "8787")))
    data_dir: Path = field(default_factory=lambda: Path(_env("DATA_DIR", str(REPO_ROOT / "data"))))
    prompts_dir: Path = field(default_factory=lambda: REPO_ROOT / "prompts")
    scenarios_dir: Path = field(default_factory=lambda: REPO_ROOT / "scenarios")

    # RoBERTa (per-message binary classifier)
    roberta_model: str = field(default_factory=lambda: _env("ROBERTA_MODEL", "nayan90k/roberta-finetuned-cyberbullying-detection"))
    roberta_device: str = field(default_factory=lambda: _env("ROBERTA_DEVICE", "cpu"))  # cpu | cuda | mps | auto
    roberta_enabled: bool = field(default_factory=lambda: _env("ROBERTA_ENABLED", "1") == "1")
    roberta_threshold: float = field(default_factory=lambda: float(_env("ROBERTA_THRESHOLD", "0.5")))

    # Qwen3.5 via Ollama (contextual analyser)
    ollama_url: str = field(default_factory=lambda: _env("OLLAMA_URL", "http://127.0.0.1:11434"))
    qwen_model: str = field(default_factory=lambda: _env("QWEN_MODEL", "qwen3.5:4b"))
    qwen_num_ctx: int = field(default_factory=lambda: int(_env("QWEN_NUM_CTX", "16384")))
    qwen_num_predict: int = field(default_factory=lambda: int(_env("QWEN_NUM_PREDICT", "1200")))
    qwen_timeout_s: float = field(default_factory=lambda: float(_env("QWEN_TIMEOUT_S", "120")))
    qwen_keep_alive: str = field(default_factory=lambda: _env("QWEN_KEEP_ALIVE", "30m"))
    qwen_seed: int = field(default_factory=lambda: int(_env("QWEN_SEED", "7")))
    # Second, narrow Qwen pass that re-checks new uncorroborated findings before they become evidence.
    verify_findings: bool = field(default_factory=lambda: _env("VERIFY", "1") == "1")
    # With Ollama unreachable, analyse live chat with keyword rules instead of failing (labelled "rules fallback").
    rules_fallback: bool = field(default_factory=lambda: _env("RULES_FALLBACK", "1") == "1")
    warmup: bool = field(default_factory=lambda: _env("WARMUP", "1") == "1")

    # Sign in with ChatGPT companion (Node, holds the OAuth tokens)
    companion_url: str = field(default_factory=lambda: _env("COMPANION_URL", "http://127.0.0.1:8788"))
    chatgpt_enabled: bool = field(default_factory=lambda: _env("CHATGPT_ENABLED", "1") == "1")
    chatgpt_timeout_s: float = field(default_factory=lambda: float(_env("CHATGPT_TIMEOUT_S", "180")))

    # Context selection. The whole chat is sent; the budget only bites on very long chats (~30k characters).
    # num_ctx must cover system prompt (~2.2k tokens) + this budget + num_predict.
    context_token_budget: int = field(default_factory=lambda: int(_env("CONTEXT_TOKEN_BUDGET", "11000")))
    related_evidence_limit: int = field(default_factory=lambda: int(_env("RELATED_EVIDENCE_LIMIT", "12")))

    # Logging raw conversation text is off by default.
    log_text: bool = field(default_factory=lambda: _env("LOG_TEXT", "0") == "1")

    # Remote clients (phones on the LAN or through a tunnel). Requests that do not come straight from this machine
    # must send this token in X-Rakshak-Token; with no token set they are refused. `npm run server:lan` sets one.
    access_token: str = field(default_factory=lambda: _env("ACCESS_TOKEN", ""))
    # Origins allowed by CORS: the Android app (Capacitor) serves the UI from localhost.
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(o.strip() for o in _env("CORS_ORIGINS", "http://localhost,https://localhost,capacitor://localhost").split(",") if o.strip())
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "rakshak.sqlite3"


def load_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
