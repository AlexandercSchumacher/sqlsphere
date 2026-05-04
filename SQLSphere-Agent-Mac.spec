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
    runtime_hooks=['runtime_hook_macos_tk.py'],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='SQLSphere-Agent',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='SQLSphere-Agent',
)

app = BUNDLE(
    coll,
    name='SQLSphere-Agent.app',
    bundle_identifier='com.sqlsphere.agent',
    icon=None,  # Set to 'icon.icns' when you have a branded icon
    argv_emulation=False,
    info_plist={
        'CFBundleName': 'SQLSphere Agent',
        'CFBundleDisplayName': 'SQLSphere Agent',
        'CFBundleShortVersionString': '1.2.0',
        'NSHighResolutionCapable': True,
        'LSMinimumSystemVersion': '10.15',
        'NSRequiresAquaSystemAppearance': False,
    },
)
