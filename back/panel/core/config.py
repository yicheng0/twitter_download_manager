from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[3]
PANEL_DIR = BASE_DIR / "panel"
RUNTIME_DIR = BASE_DIR / ".panel" / "runtime"
ACTIVE_SETTINGS = RUNTIME_DIR / "settings.active.json"
DEFAULT_SETTINGS = BASE_DIR / "settings.json"
