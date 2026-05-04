#!/usr/bin/env python3
"""
SQLSphere Local Database Agent – Professional GUI
Built with CustomTkinter for a modern, cross-platform look.
"""

import customtkinter as ctk
import threading
import asyncio
import sys
import os
from datetime import datetime
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from local_db_agent import LocalDBAgent
except ImportError as exc:
    import tkinter.messagebox as _mb
    _mb.showerror("Import Error", f"Could not import local_db_agent.py.\n\n{exc}")
    sys.exit(1)

from config_manager import (
    load_config, save_config,
    register_autostart, unregister_autostart, is_autostart_registered,
)

# ── Brand palette ────────────────────────────────────────────────────────────
BRAND       = "#6366f1"   # indigo-500
BRAND_DARK  = "#4f46e5"   # indigo-600
SUCCESS     = "#10b981"   # emerald-500
SUCCESS_DRK = "#059669"   # emerald-600
DANGER      = "#ef4444"   # red-500
DANGER_DRK  = "#dc2626"   # red-600
WARNING     = "#f59e0b"   # amber-500
MUTED       = "#6b7280"   # gray-500

DB_DEFAULT_PORTS = {
    "PostgreSQL": "5432",
    "MySQL": "3306",
    "SQL Server": "1433",
}

ctk.set_appearance_mode("System")   # follows OS dark/light preference
ctk.set_default_color_theme("blue")


# ─────────────────────────────────────────────────────────────────────────────
class AgentGUI(ctk.CTk):
    """Main application window."""

    def __init__(self, tray=None, start_minimized: bool = False, auto_start: bool = False):
        super().__init__()

        self.tray = tray
        self.agent: Optional[LocalDBAgent] = None
        self.agent_thread: Optional[threading.Thread] = None
        self.running = False
        self._blink_job = None
        self._blink_visible = True

        # Window
        self.title("SQLSphere Agent")
        self.geometry("540x780")
        self.minsize(480, 700)
        self.resizable(True, True)
        self._set_icon()
        self.protocol("WM_DELETE_WINDOW", self._on_close)

        self._build_ui()
        self._load_config()

        if start_minimized:
            self.withdraw()
        if auto_start and self._has_required_fields():
            self.after(600, self._start_agent)

    # ── Icon ─────────────────────────────────────────────────────────────────
    def _set_icon(self):
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            for name in ("icon.ico", "icon.png"):
                path = os.path.join(here, name)
                if os.path.exists(path):
                    self.iconbitmap(path)
                    return
        except Exception:
            pass

    # ── UI builder ───────────────────────────────────────────────────────────
    def _build_ui(self):
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)   # scrollable form expands
        self.grid_rowconfigure(2, weight=0)   # action bar fixed
        self.grid_rowconfigure(3, weight=0)   # log panel fixed

        # ── Header bar ───────────────────────────────────────────────────────
        header = ctk.CTkFrame(self, corner_radius=0, fg_color=BRAND, height=74)
        header.grid(row=0, column=0, sticky="ew")
        header.grid_columnconfigure(0, weight=1)
        header.grid_propagate(False)

        ctk.CTkLabel(
            header, text="SQLSphere Agent",
            font=ctk.CTkFont(size=20, weight="bold"),
            text_color="white", anchor="w",
        ).grid(row=0, column=0, padx=22, pady=(14, 0), sticky="w")

        ctk.CTkLabel(
            header, text="Local Database Bridge",
            font=ctk.CTkFont(size=12),
            text_color="#c7d2fe",   # indigo-200
            anchor="w",
        ).grid(row=1, column=0, padx=22, pady=(0, 14), sticky="w")

        # Status pill (top-right of header)
        pill = ctk.CTkFrame(header, fg_color="transparent")
        pill.grid(row=0, column=1, rowspan=2, padx=18, pady=14, sticky="e")

        self._status_dot = ctk.CTkLabel(
            pill, text="●", font=ctk.CTkFont(size=18), text_color=MUTED,
        )
        self._status_dot.pack(side="left", padx=(0, 5))

        self._status_lbl = ctk.CTkLabel(
            pill, text="Stopped", font=ctk.CTkFont(size=12, weight="bold"),
            text_color="white",
        )
        self._status_lbl.pack(side="left")

        # ── Scrollable form ───────────────────────────────────────────────────
        form = ctk.CTkScrollableFrame(self, corner_radius=0, fg_color="transparent")
        form.grid(row=1, column=0, sticky="nsew")
        form.grid_columnconfigure(0, weight=1)
        _p = dict(padx=18, pady=6)

        # Section: Connection Code
        self._section(form, "Connection Code", row=0)
        code_wrap = ctk.CTkFrame(form, fg_color="transparent")
        code_wrap.grid(row=1, column=0, sticky="ew", **_p)
        code_wrap.grid_columnconfigure(0, weight=1)

        ctk.CTkLabel(
            code_wrap,
            text="From SQLSphere → Connections → Local Agent setup",
            font=ctk.CTkFont(size=11), text_color=MUTED, anchor="w",
        ).grid(row=0, column=0, sticky="ew", pady=(0, 4))

        self.code_entry = ctk.CTkEntry(
            code_wrap, placeholder_text="e.g. abc123xyz",
            font=ctk.CTkFont(family="Courier New", size=14), height=42,
        )
        self.code_entry.grid(row=1, column=0, sticky="ew")

        # Section: Database
        self._section(form, "Database Settings", row=2)
        db_wrap = ctk.CTkFrame(form, fg_color="transparent")
        db_wrap.grid(row=3, column=0, sticky="ew", **_p)
        db_wrap.grid_columnconfigure(1, weight=1)

        rows = [
            ("Type", None),
            ("Host", "localhost"),
            ("Port", "5432"),
            ("Database", "my_database"),
            ("Username", "postgres"),
            ("Password", None),
        ]
        for i, (lbl, ph) in enumerate(rows):
            ctk.CTkLabel(
                db_wrap, text=lbl, font=ctk.CTkFont(size=13), anchor="e", width=82,
            ).grid(row=i, column=0, sticky="e", pady=3)

        self.db_type = ctk.CTkOptionMenu(
            db_wrap, values=["PostgreSQL", "MySQL", "SQL Server"],
            command=self._on_db_type_change, height=38,
        )
        self.db_type.grid(row=0, column=1, sticky="ew", padx=(8, 0), pady=3)

        self.host_entry = ctk.CTkEntry(db_wrap, placeholder_text="localhost", height=38)
        self.host_entry.grid(row=1, column=1, sticky="ew", padx=(8, 0), pady=3)

        self.port_entry = ctk.CTkEntry(db_wrap, placeholder_text="5432", height=38, width=100)
        self.port_entry.grid(row=2, column=1, sticky="w", padx=(8, 0), pady=3)

        self.database_entry = ctk.CTkEntry(db_wrap, placeholder_text="my_database", height=38)
        self.database_entry.grid(row=3, column=1, sticky="ew", padx=(8, 0), pady=3)

        self.username_entry = ctk.CTkEntry(db_wrap, placeholder_text="postgres", height=38)
        self.username_entry.grid(row=4, column=1, sticky="ew", padx=(8, 0), pady=3)

        self.password_entry = ctk.CTkEntry(db_wrap, placeholder_text="••••••••", show="*", height=38)
        self.password_entry.grid(row=5, column=1, sticky="ew", padx=(8, 0), pady=3)

        # Section: Settings
        self._section(form, "Settings", row=4)
        sett_wrap = ctk.CTkFrame(form, fg_color="transparent")
        sett_wrap.grid(row=5, column=0, sticky="ew", **_p)

        self.save_var         = ctk.BooleanVar(value=True)
        self.auto_start_var   = ctk.BooleanVar(value=False)
        self.start_min_var    = ctk.BooleanVar(value=False)
        self.boot_start_var   = ctk.BooleanVar(value=is_autostart_registered())

        for text, var, cmd in [
            ("Save settings on connect",      self.save_var,       None),
            ("Auto-connect on launch",         self.auto_start_var, None),
            ("Start minimized to system tray", self.start_min_var,  None),
            ("Launch at system startup",       self.boot_start_var, self._on_boot_toggled),
        ]:
            ctk.CTkCheckBox(sett_wrap, text=text, variable=var, command=cmd).pack(
                anchor="w", pady=3,
            )

        # ── Action bar (fixed height) ─────────────────────────────────────────
        bar = ctk.CTkFrame(self, corner_radius=0, height=76)
        bar.grid(row=2, column=0, sticky="ew")
        bar.grid_columnconfigure((0, 1, 2), weight=1)
        bar.grid_propagate(False)

        self.start_btn = ctk.CTkButton(
            bar, text="Connect",
            command=self._start_agent,
            fg_color=SUCCESS, hover_color=SUCCESS_DRK,
            height=44, font=ctk.CTkFont(size=14, weight="bold"),
        )
        self.start_btn.grid(row=0, column=0, padx=(16, 6), pady=16, sticky="ew")

        self.stop_btn = ctk.CTkButton(
            bar, text="Disconnect",
            command=self._stop_agent,
            fg_color=DANGER, hover_color=DANGER_DRK,
            height=44, font=ctk.CTkFont(size=14, weight="bold"),
            state="disabled",
        )
        self.stop_btn.grid(row=0, column=1, padx=6, pady=16, sticky="ew")

        self.test_btn = ctk.CTkButton(
            bar, text="Test DB",
            command=self._test_connection,
            fg_color="transparent", border_width=2, border_color=BRAND,
            text_color=BRAND,
            hover_color=("#e0e7ff", "#2d2f5c"),
            height=44,
        )
        self.test_btn.grid(row=0, column=2, padx=(6, 16), pady=16, sticky="ew")

        # ── Log panel (fixed height) ──────────────────────────────────────────
        log_panel = ctk.CTkFrame(self, corner_radius=0, height=164,
                                  fg_color=("gray93", "gray14"))
        log_panel.grid(row=3, column=0, sticky="sew")
        log_panel.grid_columnconfigure(0, weight=1)
        log_panel.grid_rowconfigure(1, weight=1)
        log_panel.grid_propagate(False)

        ctk.CTkLabel(
            log_panel, text="LOG",
            font=ctk.CTkFont(size=9, weight="bold"),
            text_color=MUTED, anchor="w",
        ).grid(row=0, column=0, padx=12, pady=(6, 0), sticky="w")

        self.log_box = ctk.CTkTextbox(
            log_panel,
            font=ctk.CTkFont(family="Courier New", size=11),
            wrap="word", state="disabled",
            fg_color="transparent", border_width=0,
        )
        self.log_box.grid(row=1, column=0, sticky="nsew", padx=6, pady=(0, 6))

        self._log("Ready. Enter your connection code and database settings.")

    def _section(self, parent, title: str, row: int):
        """Render a labelled section divider."""
        f = ctk.CTkFrame(parent, fg_color="transparent", height=30)
        f.grid(row=row, column=0, sticky="ew", padx=18, pady=(18, 2))
        f.grid_columnconfigure(1, weight=1)
        f.grid_propagate(False)

        ctk.CTkLabel(
            f, text=title.upper(),
            font=ctk.CTkFont(size=10, weight="bold"),
            text_color=BRAND, anchor="w",
        ).grid(row=0, column=0, sticky="w")

        ctk.CTkFrame(f, height=1, fg_color=BRAND).grid(
            row=0, column=1, sticky="ew", padx=(10, 0), pady=6,
        )

    # ── Config ───────────────────────────────────────────────────────────────
    def _load_config(self):
        cfg = load_config()
        if not cfg:
            return
        _map = {"postgresql": "PostgreSQL", "mysql": "MySQL", "sqlserver": "SQL Server"}

        if cfg.get("connection_code"):
            self.code_entry.insert(0, cfg["connection_code"])
        if cfg.get("db_type"):
            self.db_type.set(_map.get(cfg["db_type"], "PostgreSQL"))
        if cfg.get("host"):
            self.host_entry.insert(0, cfg["host"])
        if cfg.get("port"):
            self.port_entry.insert(0, str(cfg["port"]))
        if cfg.get("database"):
            self.database_entry.insert(0, cfg["database"])
        if cfg.get("username"):
            self.username_entry.insert(0, cfg["username"])
        if cfg.get("password"):
            self.password_entry.insert(0, cfg["password"])
        self.auto_start_var.set(cfg.get("auto_start", False))
        self.start_min_var.set(cfg.get("start_minimized", False))

    def _save_config(self):
        save_config({
            "connection_code": self.code_entry.get().strip(),
            "db_type": self.db_type.get().lower().replace(" ", ""),
            "host": self.host_entry.get().strip(),
            "port": self.port_entry.get().strip(),
            "database": self.database_entry.get().strip(),
            "username": self.username_entry.get().strip(),
            "password": self.password_entry.get().strip(),
            "auto_start": self.auto_start_var.get(),
            "start_minimized": self.start_min_var.get(),
        })

    def _has_required_fields(self) -> bool:
        return bool(
            self.code_entry.get().strip()
            and self.database_entry.get().strip()
            and self.username_entry.get().strip()
        )

    # ── Callbacks ─────────────────────────────────────────────────────────────
    def _on_db_type_change(self, value: str):
        port = DB_DEFAULT_PORTS.get(value, "")
        self.port_entry.delete(0, "end")
        self.port_entry.insert(0, port)

    def _on_boot_toggled(self):
        if self.boot_start_var.get():
            register_autostart()
        else:
            unregister_autostart()

    def _on_close(self):
        if self.tray:
            self.minimize_to_tray()
        else:
            self.quit_app()

    # ── Tray / window management ──────────────────────────────────────────────
    def minimize_to_tray(self):
        self.withdraw()

    def show_window(self):
        self.deiconify()
        self.lift()
        self.focus_force()

    def quit_app(self):
        self._stop_agent()
        if self.tray:
            self.tray.stop()
        self.destroy()

    # ── Status / blink ────────────────────────────────────────────────────────
    def _update_status(self, status: str):
        _colours = {
            "connected": SUCCESS,
            "disconnected": DANGER,
            "connecting": WARNING,
            "stopped": MUTED,
        }
        _labels = {
            "connected": "Connected",
            "disconnected": "Disconnected",
            "connecting": "Connecting…",
            "stopped": "Stopped",
        }
        colour = _colours.get(status, MUTED)
        label = _labels.get(status, status.capitalize())

        self._status_dot.configure(text_color=colour)
        self._status_lbl.configure(text=label)

        if self.tray:
            self.tray.update_status(status)

        if status == "connecting":
            self._start_blink()
        else:
            self._stop_blink(colour)

    def _start_blink(self):
        self._stop_blink(None)
        self._do_blink()

    def _stop_blink(self, final_colour):
        if self._blink_job:
            try:
                self.after_cancel(self._blink_job)
            except Exception:
                pass
            self._blink_job = None
        if final_colour:
            self._status_dot.configure(text_color=final_colour)

    def _do_blink(self):
        self._blink_visible = not self._blink_visible
        # CustomTkinter doesn't allow "transparent" for text_color;
        # use the header background colour to "hide" the dot instead.
        colour = WARNING if self._blink_visible else BRAND
        self._status_dot.configure(text_color=colour)
        self._blink_job = self.after(550, self._do_blink)

    # ── Log ───────────────────────────────────────────────────────────────────
    def _log(self, message: str):
        ts = datetime.now().strftime("%H:%M:%S")
        self.log_box.configure(state="normal")
        self.log_box.insert("end", f"[{ts}]  {message}\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    # ── Agent control ─────────────────────────────────────────────────────────
    def _start_agent(self):
        code = self.code_entry.get().strip()
        if not code:
            self._alert("Error", "Please enter a connection code.")
            return

        db_type  = self.db_type.get().lower().replace(" ", "")
        host     = self.host_entry.get().strip() or "localhost"
        port     = self.port_entry.get().strip() or DB_DEFAULT_PORTS.get(self.db_type.get(), "5432")
        database = self.database_entry.get().strip()
        username = self.username_entry.get().strip()
        password = self.password_entry.get().strip()

        if not database or not username:
            self._alert("Error", "Please enter database name and username.")
            return

        if self.save_var.get():
            self._save_config()

        backend = os.getenv("BACKEND_URL", "")
        backend = backend.replace("http://", "").replace("https://", "").replace("ws://", "").replace("wss://", "")
        proto   = "ws://" if ("localhost" in backend or "127.0.0.1" in backend) else "wss://"
        ws_url  = f"{proto}{backend}/ws/agent/{code}"

        self.agent = LocalDBAgent(
            connection_code=code,
            websocket_url=ws_url,
            db_type=db_type,
            status_callback=self._on_agent_status,
            host=host,
            port=int(port),
            database=database,
            username=username,
            password=password,
        )

        self.running = True
        self.agent_thread = threading.Thread(target=self._run_agent, daemon=True)
        self.agent_thread.start()

        self.start_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self.code_entry.configure(state="disabled")
        self._update_status("connecting")
        self._log(f"Connecting with code:  {code}")
        self._log(f"Backend WebSocket:     {ws_url}")
        self._log(f"Database:              {self.db_type.get()} @ {host}:{port}/{database}")

    def _run_agent(self):
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(self.agent.run())
            except Exception as exc:
                msg = str(exc)
                self.after(0, lambda: self._log(f"Error: {msg}"))
                self.after(0, lambda: self._alert("Agent Error", f"Agent stopped:\n\n{msg}"))
            finally:
                loop.close()
        except Exception as exc:
            msg = str(exc)
            self.after(0, lambda: self._log(f"Fatal: {msg}"))
        finally:
            self.running = False
            self.after(0, self._on_agent_stopped)

    def _stop_agent(self):
        if self.agent:
            self.running = False
            self.agent.running = False
            self._log("Disconnecting…")
            self._update_status("disconnected")

    def _on_agent_stopped(self):
        self.start_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")
        self.code_entry.configure(state="normal")
        self._update_status("stopped")
        self._log("Disconnected.")

    def _on_agent_status(self, status: str):
        messages = {
            "connected":    "Connected to SQLSphere backend.",
            "disconnected": "Disconnected from backend.",
            "connecting":   "Reconnecting to backend…",
        }
        self.after(0, lambda: self._update_status(status))
        if status in messages:
            self.after(0, lambda: self._log(messages[status]))

    # ── Test connection ───────────────────────────────────────────────────────
    def _test_connection(self):
        db_type  = self.db_type.get().lower().replace(" ", "")
        host     = self.host_entry.get().strip() or "localhost"
        port     = self.port_entry.get().strip() or DB_DEFAULT_PORTS.get(self.db_type.get(), "5432")
        database = self.database_entry.get().strip()
        username = self.username_entry.get().strip()
        password = self.password_entry.get().strip()

        if not database or not username:
            self._alert("Error", "Please enter database name and username.")
            return

        self._log(f"Testing {self.db_type.get()} @ {host}:{port}/{database}…")
        self.test_btn.configure(state="disabled", text="Testing…")

        probe = LocalDBAgent(
            connection_code="__probe__",
            websocket_url="ws://localhost/probe",
            db_type=db_type,
            host=host, port=int(port),
            database=database, username=username, password=password,
        )

        def _test():
            try:
                ok = probe.connect_to_database()
                if ok:
                    self.after(0, lambda: self._log("Database connection successful!"))
                    self.after(0, lambda: self._info("Connection OK", "Database is reachable and credentials are valid."))
                    if probe.connection:
                        probe.connection.close()
                else:
                    self.after(0, lambda: self._log("Connection failed (unknown reason)."))
                    self.after(0, lambda: self._alert("Connection Failed", "Could not connect to the database.\nCheck your settings and try again."))
            except Exception as exc:
                msg = str(exc)
                self.after(0, lambda: self._log(f"Test error: {msg}"))
                self.after(0, lambda: self._alert("Connection Failed", msg))
            finally:
                self.after(0, lambda: self.test_btn.configure(state="normal", text="Test DB"))

        threading.Thread(target=_test, daemon=True).start()

    # ── Dialogs ───────────────────────────────────────────────────────────────
    def _alert(self, title: str, message: str):
        dlg = ctk.CTkToplevel(self)
        dlg.title(title)
        dlg.geometry("380x180")
        dlg.resizable(False, False)
        dlg.grab_set()
        dlg.focus()
        dlg.lift()
        ctk.CTkLabel(dlg, text=message, wraplength=340, justify="center").pack(expand=True, padx=20, pady=20)
        ctk.CTkButton(dlg, text="OK", command=dlg.destroy, width=90).pack(pady=(0, 18))

    def _info(self, title: str, message: str):
        dlg = ctk.CTkToplevel(self)
        dlg.title(title)
        dlg.geometry("380x180")
        dlg.resizable(False, False)
        dlg.grab_set()
        dlg.focus()
        dlg.lift()
        ctk.CTkLabel(dlg, text=message, wraplength=340, justify="center").pack(expand=True, padx=20, pady=20)
        ctk.CTkButton(dlg, text="Great!", command=dlg.destroy, width=90,
                      fg_color=SUCCESS, hover_color=SUCCESS_DRK).pack(pady=(0, 18))


# ─────────────────────────────────────────────────────────────────────────────
def main():
    app = AgentGUI()
    app.mainloop()


if __name__ == "__main__":
    main()
