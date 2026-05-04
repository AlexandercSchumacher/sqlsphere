#!/usr/bin/env python3
"""
Configuration persistence for the SQLSphere Local Database Agent.
Handles saving/loading agent config to a JSON file in the platform app-data directory.
Also handles auto-start registration for all platforms.
"""

import json
import sys
import os
import platform
import base64
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def get_config_dir() -> Path:
    """Get platform-aware config directory, creating it if needed."""
    system = platform.system()
    if system == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
        config_dir = Path(base) / "SQLSphere"
    else:
        # macOS and Linux
        config_dir = Path.home() / ".sqlsphere"

    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir


def _config_path() -> Path:
    return get_config_dir() / "config.json"


def load_config() -> dict | None:
    """Load config from JSON file. Returns None if no config exists."""
    path = _config_path()
    if not path.exists():
        return None

    try:
        with open(path, "r") as f:
            config = json.load(f)

        # Decode obfuscated password
        if config.get("password"):
            try:
                config["password"] = base64.b64decode(config["password"]).decode("utf-8")
            except Exception:
                # If decoding fails, treat as plaintext (legacy or manually edited)
                pass

        return config
    except Exception as e:
        logger.error(f"Failed to load config: {e}")
        return None


def save_config(config: dict):
    """Save config to JSON file. Password is base64-obfuscated."""
    path = _config_path()

    # Make a copy so we don't mutate the caller's dict
    to_save = dict(config)

    # Obfuscate password
    if to_save.get("password"):
        to_save["password"] = base64.b64encode(
            to_save["password"].encode("utf-8")
        ).decode("utf-8")

    try:
        with open(path, "w") as f:
            json.dump(to_save, f, indent=2)
        logger.info(f"Config saved to {path}")
    except Exception as e:
        logger.error(f"Failed to save config: {e}")


def get_executable_path() -> str:
    """Return path to the running executable (handles PyInstaller frozen builds)."""
    if getattr(sys, "frozen", False):
        # Running as PyInstaller bundle
        return sys.executable
    else:
        # Running as script
        return os.path.abspath(sys.argv[0])


# ---------------------------------------------------------------------------
# Auto-start registration
# ---------------------------------------------------------------------------

_LAUNCHAGENT_LABEL = "com.sqlsphere.agent"
_LAUNCHAGENT_DIR = Path.home() / "Library" / "LaunchAgents"
_LAUNCHAGENT_PLIST = _LAUNCHAGENT_DIR / f"{_LAUNCHAGENT_LABEL}.plist"

_LINUX_AUTOSTART_DIR = Path.home() / ".config" / "autostart"
_LINUX_DESKTOP_FILE = _LINUX_AUTOSTART_DIR / "sqlsphere-agent.desktop"

_WIN_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_WIN_VALUE_NAME = "SQLSphere-Agent"


def register_autostart():
    """Register the app to start on system boot."""
    exe = get_executable_path()
    system = platform.system()

    try:
        if system == "Darwin":
            _register_macos(exe)
        elif system == "Linux":
            _register_linux(exe)
        elif system == "Windows":
            _register_windows(exe)
        logger.info(f"Auto-start registered ({system})")
    except Exception as e:
        logger.error(f"Failed to register auto-start: {e}")


def unregister_autostart():
    """Remove auto-start registration."""
    system = platform.system()

    try:
        if system == "Darwin":
            _unregister_macos()
        elif system == "Linux":
            _unregister_linux()
        elif system == "Windows":
            _unregister_windows()
        logger.info(f"Auto-start unregistered ({system})")
    except Exception as e:
        logger.error(f"Failed to unregister auto-start: {e}")


def is_autostart_registered() -> bool:
    """Check whether auto-start is currently registered."""
    system = platform.system()

    try:
        if system == "Darwin":
            return _LAUNCHAGENT_PLIST.exists()
        elif system == "Linux":
            return _LINUX_DESKTOP_FILE.exists()
        elif system == "Windows":
            return _check_windows_autostart()
    except Exception:
        pass
    return False


# -- macOS ------------------------------------------------------------------

def _register_macos(exe: str):
    _LAUNCHAGENT_DIR.mkdir(parents=True, exist_ok=True)
    plist = f"""\
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{_LAUNCHAGENT_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>{exe}</string>
        <string>--minimized</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
"""
    _LAUNCHAGENT_PLIST.write_text(plist)


def _unregister_macos():
    if _LAUNCHAGENT_PLIST.exists():
        _LAUNCHAGENT_PLIST.unlink()


# -- Linux ------------------------------------------------------------------

def _register_linux(exe: str):
    _LINUX_AUTOSTART_DIR.mkdir(parents=True, exist_ok=True)
    desktop = f"""\
[Desktop Entry]
Type=Application
Name=SQLSphere Agent
Exec={exe} --minimized
Hidden=false
X-GNOME-Autostart-enabled=true
"""
    _LINUX_DESKTOP_FILE.write_text(desktop)


def _unregister_linux():
    if _LINUX_DESKTOP_FILE.exists():
        _LINUX_DESKTOP_FILE.unlink()


# -- Windows ----------------------------------------------------------------

def _register_windows(exe: str):
    import winreg
    key = winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, _WIN_RUN_KEY, 0, winreg.KEY_SET_VALUE
    )
    winreg.SetValueEx(key, _WIN_VALUE_NAME, 0, winreg.REG_SZ, f'"{exe}" --minimized')
    winreg.CloseKey(key)


def _unregister_windows():
    import winreg
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _WIN_RUN_KEY, 0, winreg.KEY_SET_VALUE
        )
        winreg.DeleteValue(key, _WIN_VALUE_NAME)
        winreg.CloseKey(key)
    except FileNotFoundError:
        pass  # Already removed


def _check_windows_autostart() -> bool:
    import winreg
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, _WIN_RUN_KEY, 0, winreg.KEY_READ
        )
        winreg.QueryValueEx(key, _WIN_VALUE_NAME)
        winreg.CloseKey(key)
        return True
    except FileNotFoundError:
        return False
