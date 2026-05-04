#!/usr/bin/env python3
"""
System tray icon for the SQLSphere Local Database Agent.
Uses pystray + Pillow for cross-platform tray icon with status colours and menu.
"""

import threading
import logging

try:
    import pystray
    from PIL import Image, ImageDraw
    TRAY_AVAILABLE = True
except ImportError:
    TRAY_AVAILABLE = False

logger = logging.getLogger(__name__)

# Status -> colour mapping
_STATUS_COLOURS = {
    "connected": "#4CAF50",     # green
    "disconnected": "#f44336",  # red
    "connecting": "#9E9E9E",    # grey
    "stopped": "#9E9E9E",       # grey
}


def _create_icon_image(colour: str, size: int = 64) -> "Image.Image":
    """Create a simple circle icon with the given colour."""
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    margin = 4
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=colour,
    )
    return image


class AgentTrayIcon:
    """System tray icon with status indicator and menu."""

    def __init__(self, on_open_settings, on_quit):
        """
        Args:
            on_open_settings: callback invoked when user clicks "Open Settings"
            on_quit: callback invoked when user clicks "Quit"
        """
        if not TRAY_AVAILABLE:
            raise RuntimeError("pystray and/or Pillow are not installed")

        self._on_open_settings = on_open_settings
        self._on_quit = on_quit
        self._status = "stopped"
        self._status_text = "Status: Stopped"
        self._icon: pystray.Icon | None = None
        self._thread: threading.Thread | None = None

    # -- public API ---------------------------------------------------------

    def run(self):
        """Start the tray icon in a daemon thread (non-blocking)."""
        self._icon = pystray.Icon(
            name="SQLSphere Agent",
            icon=_create_icon_image(_STATUS_COLOURS["stopped"]),
            title="SQLSphere Agent",
            menu=self._build_menu(),
        )
        self._thread = threading.Thread(target=self._icon.run, daemon=True)
        self._thread.start()
        logger.info("Tray icon started")

    def update_status(self, status: str):
        """Update icon colour and status menu text.

        Args:
            status: one of "connected", "disconnected", "connecting", "stopped"
        """
        self._status = status
        self._status_text = f"Status: {status.capitalize()}"
        colour = _STATUS_COLOURS.get(status, _STATUS_COLOURS["stopped"])

        if self._icon:
            self._icon.icon = _create_icon_image(colour)
            self._icon.title = f"SQLSphere Agent - {status.capitalize()}"
            # Rebuild menu so the status label updates
            self._icon.menu = self._build_menu()
            self._icon.update_menu()

    def stop(self):
        """Tear down the tray icon."""
        if self._icon:
            try:
                self._icon.stop()
            except Exception:
                pass
            self._icon = None
        logger.info("Tray icon stopped")

    # -- internals ----------------------------------------------------------

    def _build_menu(self) -> pystray.Menu:
        return pystray.Menu(
            pystray.MenuItem("Open Settings", self._on_open_settings_clicked),
            pystray.MenuItem(self._status_text, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self._on_quit_clicked),
        )

    def _on_open_settings_clicked(self, icon, item):
        self._on_open_settings()

    def _on_quit_clicked(self, icon, item):
        self._on_quit()
