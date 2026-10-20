# Stamps an .ico into a PE file with the native UpdateResource API —
# the fast, reliable replacement for the rcedit shim (which thrashes on big exes).
# usage: powershell -NoProfile -File scripts\set-icon.ps1 -Exe app\TuneDrop.exe -Ico assets\tunedrop.ico
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Ico
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Res {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr BeginUpdateResource(string pFileName, bool bDeleteExistingResources);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool UpdateResource(IntPtr hUpdate, IntPtr lpType, IntPtr lpName, ushort wLanguage, byte[] lpData, uint cbData);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool EndUpdateResource(IntPtr hUpdate, bool fDiscard);
}
'@

if (-not (Test-Path $Exe)) { throw "exe not found: $Exe" }
if (-not (Test-Path $Ico)) { throw "ico not found: $Ico" }
$bytes = [IO.File]::ReadAllBytes($Ico)
if ($bytes.Length -lt 6) { throw 'ico too small' }

$sr = $bytes.Length
function GetU16([int]$at) { [BitConverter]::ToUInt16($bytes, $at) }
function GetU32([int]$at) { [BitConverter]::ToUInt32($bytes, $at) }
$count = GetU16 4
if ((GetU16 2) -ne 1) { throw 'not an .ico file' }

# RT_ICON = 3, RT_GROUP_ICON = 14
$entries = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $count; $i++) {
  $base = 6 + $i * 16
  $entries.Add([pscustomobject]@{
    Offset = ([int](GetU32 ($base + 12)))
    Bytes  = ([int](GetU32 ($base + 8)))
    Planes = (GetU16 ($base + 4))
    Depth  = (GetU16 ($base + 6))
  })
}

# group directory copy (16-byte entries → turns into 14-byte GRP entries: drop the u32 offset, add u16 id)
$group = [IO.MemoryStream]::new()
$w = New-Object IO.BinaryWriter($group)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$count)
for ($i = 0; $i -lt $count; $i++) {
  $base = 6 + $i * 16
  $w.Write($bytes, $base, 12)          # w,h,colors,res,planes,depth,size
  $w.Write([uint16]($i + 1))           # nID
}
$w.Flush()

$h = [Res]::BeginUpdateResource((Resolve-Path $Exe), $false) # $true would nuke the manifest!
if ($h -eq [IntPtr]::Zero) { throw "BeginUpdateResource failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
try {
  for ($i = 0; $i -lt $count; $i++) {
    $e = $entries[$i]
    $img = $bytes[$e.Offset..($e.Offset + $e.Bytes - 1)]
    if (-not [Res]::UpdateResource($h, [IntPtr]3, [IntPtr]($i + 1), [uint16]1033, $img, [uint32]$e.Bytes)) {
      throw "UpdateResource RT_ICON failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    }
  }
  $gd = $group.ToArray()
  if (-not [Res]::UpdateResource($h, [IntPtr]14, [IntPtr]1, [uint16]1033, $gd, [uint32]$gd.Length)) {
    throw "UpdateResource RT_GROUP_ICON failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  }
} finally {
  if (-not [Res]::EndUpdateResource($h, $false)) {
    throw "EndUpdateResource failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  }
}
"icon written: $count image(s) from $Ico into $Exe"
