import json
import os
from collections.abc import MutableMapping
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = PROJECT_ROOT / "config"
SETTINGS_PATH = CONFIG_DIR / "settings.json"
CALIBRATION_PATH = CONFIG_DIR / "calibration.json"
MODEL_PATH = PROJECT_ROOT / "models" / "gesture_recognizer.task"
# Private values such as GEMINI_API_KEY. Git ignores this file; .env.example shows the format.
ENV_PATH = PROJECT_ROOT / ".env"
# The value .env.example ships with; it counts as no value, so it is never sent anywhere.
ENV_PLACEHOLDERS = {"paste-your-key-here"}


def load_settings(path: Path = SETTINGS_PATH) -> dict:
    with open(path, encoding="utf-8") as settings_file:
        return json.load(settings_file)


def load_env(path: Path = ENV_PATH, environ: MutableMapping[str, str] | None = None) -> list[str]:
    """Copies NAME=value lines from .env into the environment and returns the names it set.

    Variables that are already set win, so a value set in the terminal or by start_tracker.ps1
    is kept. Blank lines, # comments, and placeholder values are skipped. A missing file is fine.
    """
    environ = os.environ if environ is None else environ
    if not path.is_file():
        return []
    loaded = []
    with open(path, encoding="utf-8-sig") as env_file:
        for line in env_file:
            text = line.strip()
            if not text or text.startswith("#") or "=" not in text:
                continue
            name, value = text.split("=", 1)
            name, value = name.strip(), value.strip().strip('"').strip("'")
            if not name or not value or value in ENV_PLACEHOLDERS or environ.get(name):
                continue
            environ[name] = value
            loaded.append(name)
    return loaded
