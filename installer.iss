[Setup]
AppName=SQLSphere Agent
AppVersion=1.2.0
AppPublisher=SQLSphere
DefaultDirName={autopf}\SQLSphere Agent
DefaultGroupName=SQLSphere Agent
OutputDir=dist
OutputBaseFilename=SQLSphere-Agent-Windows-Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=
UninstallDisplayIcon={app}\SQLSphere-Agent.exe
PrivilegesRequired=lowest

[Files]
Source: "dist\SQLSphere-Agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\SQLSphere Agent"; Filename: "{app}\SQLSphere-Agent.exe"
Name: "{group}\Uninstall SQLSphere Agent"; Filename: "{uninstallexe}"
Name: "{autodesktop}\SQLSphere Agent"; Filename: "{app}\SQLSphere-Agent.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\SQLSphere-Agent.exe"; Description: "Launch SQLSphere Agent"; Flags: nowait postinstall skipifsilent
