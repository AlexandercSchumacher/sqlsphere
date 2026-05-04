# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all, collect_data_files

# Collect all customtkinter assets (themes, images)
ctk_datas, ctk_binaries, ctk_hiddenimports = collect_all('customtkinter')

datas = [
    ('agent_gui.py', '.'),
    ('config_manager.py', '.'),
    ('tray_icon.py', '.'),
] + ctk_datas

binaries = [] + ctk_binaries

hiddenimports = [
    'websockets',
    'pyodbc',
    'mysql.connector',
    'psycopg2',
    'json',
    'asyncio',
    'logging',
    'pystray',
    'PIL',
    'PIL.Image',
    'PIL.ImageDraw',
    'pystray._darwin',
    'customtkinter',
    'darkdetect',
] + ctk_hiddenimports

tmp_ret = collect_all('mysql')
datas    += tmp_ret[0]
binaries += tmp_ret[1]
hiddenimports += tmp_ret[2]


a = Analysis(
    ['local_db_agent.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='SQLSphere-Agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # Windowed — no terminal console visible
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # Windows: embed a version info / manifest
    version=None,
    icon=None,              # Set to 'icon.ico' when you have a branded icon
)
