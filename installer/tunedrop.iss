; TuneDrop — per-user installer (no admin required)
; Compiles with Inno Setup 6:  ISCC installer\tunedrop.iss

[Setup]
AppId={{7C2E9A45-2F63-4B11-9A55-8A1C9F42D7D0}}
AppName=TuneDrop
AppVersion=1.0.0
AppPublisher=Ariyan-2678
AppPublisherURL=https://github.com/Ariyan-2678
DefaultDirName={localappdata}\Programs\TuneDrop
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
SetupIconFile=..\assets\tunedrop.ico
LicenseFile=..\LICENSE
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
OutputDir=..\app
OutputBaseFilename=TuneDrop-Setup
UninstallDisplayName=TuneDrop
UninstallDisplayIcon={app}\TuneDrop.exe
ArchitecturesInstallIn64BitMode=x64
; the app keeps its library (data\) inside the install dir — declared here so
; users know uninstalling TuneDrop also removes the downloaded songs
Uninstallable=yes

[Files]
Source: "..\app\TuneDrop.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\app\README.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\TuneDrop"; Filename: "{app}\TuneDrop.exe"; Comment: "Music from your phone, on your PC"
Name: "{userdesktop}\TuneDrop"; Filename: "{app}\TuneDrop.exe"; Comment: "Music from your phone, on your PC"

[Run]
Filename: "{app}\TuneDrop.exe"; Description: "Launch TuneDrop"; Flags: postinstall skipifsilent nowait

[Messages]
WelcomeLabel2=This will install TuneDrop on your computer.%n%nInstall songs from your phone, play them on the PC — same Wi-Fi, no cloud.
SelectDirLabel3=Where should TuneDrop be installed?%n%nSongs and the library database live in a data folder inside this location.
FinishedLabelNoIcons=TuneDrop is installed.%n%nStart it anytime from the Desktop or Start menu.
FinishedLabel=TuneDrop is installed.%n%nIt will open right away — scan the QR with your phone and drop some music in.
