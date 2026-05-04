"""PyInstaller runtime hook: set TCL_LIBRARY / TK_LIBRARY on macOS.

Runtime hooks execute before PyInstaller's own bootstrap sets these
environment variables.  Without them, `import tkinter` fails with
"Can't find a usable init.tcl".
"""
import os
import sys

if sys.platform == "darwin":
    _meipass = getattr(sys, "_MEIPASS", None)
    if _meipass:
        # PyInstaller uses different directory names depending on version/platform:
        #   _tcl_data / _tk_data  (common on macOS with recent PyInstaller)
        #   tcl / tk              (generic)
        #   tcl8.6 / tk8.6       (versioned)
        for candidate in ("_tcl_data", "tcl", "tcl8.6"):
            p = os.path.join(_meipass, candidate)
            if os.path.isdir(p):
                os.environ["TCL_LIBRARY"] = p
                break
        for candidate in ("_tk_data", "tk", "tk8.6"):
            p = os.path.join(_meipass, candidate)
            if os.path.isdir(p):
                os.environ["TK_LIBRARY"] = p
                break
