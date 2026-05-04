#!/usr/bin/env python3
"""
Build script for creating standalone executable of the local database agent.
Uses PyInstaller to create a single-file executable.
"""

import subprocess
import sys
import os
import platform

def build_agent():
    """Build the agent as a standalone executable."""
    
    # Check if PyInstaller is installed
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
    
    # Determine the correct separator for --add-data based on OS
    # Windows uses semicolon (;), Unix (Mac/Linux) uses colon (:)
    if platform.system() == "Windows":
        data_separator = ";"
    else:
        data_separator = ":"
    
    # Check which optional files exist
    gui_file = "agent_gui.py"
    add_gui_data = os.path.exists(gui_file)
    add_config_manager = os.path.exists("config_manager.py")
    add_tray_icon = os.path.exists("tray_icon.py")
    
    # Check if all required packages are installed
    print("Checking required packages...")
    required_packages = {
        "pyodbc": "pyodbc",
        "mysql.connector": "mysql-connector-python",
        "psycopg2": "psycopg2-binary",
        "websockets": "websockets",
        "pystray": "pystray",
        "PIL": "Pillow",
        "customtkinter": "customtkinter",
        "darkdetect": "darkdetect",
    }
    
    missing_packages = []
    for module, package in required_packages.items():
        try:
            __import__(module)
            print(f"✅ {package} is installed")
        except ImportError:
            print(f"❌ {package} is missing")
            missing_packages.append(package)
    
    if missing_packages:
        print(f"\n⚠️  Missing packages: {', '.join(missing_packages)}")
        print("Installing missing packages...")
        for package in missing_packages:
            subprocess.check_call([sys.executable, "-m", "pip", "install", package])
        print("✅ All packages installed")
    
    # Use the spec file for the full build (preferred path)
    spec_file = "SQLSphere-Agent.spec"
    if os.path.exists(spec_file):
        print(f"Using spec file: {spec_file}")
        cmd = ["pyinstaller", "--clean", spec_file]
        subprocess.check_call(cmd)
        print("\n✅ Build successful!")
        print("Executable location: dist/SQLSphere-Agent")
        return

    # Fallback: build from CLI flags (no spec file available)
    cmd = [
        "pyinstaller",
        "--onefile",
        "--name", "SQLSphere-Agent",
        "--windowed",           # Always windowed (CustomTkinter app)
        "--hidden-import", "websockets",
        "--hidden-import", "pyodbc",
        "--hidden-import", "mysql.connector",
        "--collect-all", "mysql",
        "--hidden-import", "psycopg2",
        "--hidden-import", "json",
        "--hidden-import", "asyncio",
        "--hidden-import", "logging",
        "--hidden-import", "pystray",
        "--hidden-import", "PIL",
        "--hidden-import", "PIL.Image",
        "--hidden-import", "PIL.ImageDraw",
        "--collect-all", "customtkinter",
        "--hidden-import", "darkdetect",
    ]

    # Platform-specific pystray backends
    if platform.system() == "Darwin":
        cmd.extend(["--hidden-import", "pystray._darwin"])
    elif platform.system() == "Windows":
        cmd.extend(["--hidden-import", "pystray._win32"])
    else:
        cmd.extend([
            "--hidden-import", "pystray._xorg",
            "--hidden-import", "pystray._appindicator",
        ])

    # Add GUI file if it exists
    if add_gui_data:
        cmd.extend(["--add-data", f"{gui_file}{data_separator}."])

    # Add config_manager and tray_icon modules
    if add_config_manager:
        cmd.extend(["--add-data", f"config_manager.py{data_separator}."])
    if add_tray_icon:
        cmd.extend(["--add-data", f"tray_icon.py{data_separator}."])
    
    # Add the main script
    cmd.append("local_db_agent.py")
    
    print("Building agent executable...")
    print(f"Command: {' '.join(cmd)}")
    
    try:
        subprocess.check_call(cmd)
        print("\n✅ Build successful!")
        print(f"Executable location: dist/SQLSphere-Agent.exe (Windows) or dist/SQLSphere-Agent (Mac/Linux)")
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Build failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    build_agent()

