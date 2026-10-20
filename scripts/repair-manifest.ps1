# Repairs the PE manifest of a resource-mangled exe (TuneDrop.exe) by copying
# the RT_MANIFEST resource out of a pristine source exe (node.exe) and injecting
# it back. Without the manifest, Windows reports < Win10 and Node's platform
# guard kills the app at boot.
# usage: powershell -NoProfile -File scripts\repair-manifest.ps1 -Target app\TuneDrop.exe -Source 'C:\Program Files\nodejs\node.exe'
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Source
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PeRes {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr LoadLibraryExW([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr reserved, uint flags);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool FreeLibrary(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr FindResourceExW(IntPtr h, IntPtr type, IntPtr name, ushort lang);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LoadResource(IntPtr h, IntPtr res);
  [DllImport("kernel32.dll")]
  public static extern uint SizeofResource(IntPtr h, IntPtr res);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LockResource(IntPtr res);

  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern IntPtr BeginUpdateResourceW(string p, bool del);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool UpdateResource(IntPtr h, IntPtr type, IntPtr name, ushort lang, byte[] data, uint cb);
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool EndUpdateResource(IntPtr h, bool discard);
}
'@

function Get-Manifest([string]$path) {
  $h = [PeRes]::LoadLibraryExW((Resolve-Path $path), [IntPtr]::Zero, 0x00000002) # LOAD_LIBRARY_AS_DATAFILE
  if ($h -eq [IntPtr]::Zero) { throw "LoadLibraryEx failed for $path" }
  try {
    $res = [PeRes]::FindResourceExW($h, [IntPtr]24, [IntPtr]1, [uint16]0)  # RT_MANIFEST, id 1
    if ($res -eq [IntPtr]::Zero) { throw "no RT_MANIFEST#1 in $path" }
    $size = [PeRes]::SizeofResource($h, $res)
    $ptr = [PeRes]::LockResource([PeRes]::LoadResource($h, $res))
    if ($ptr -eq [IntPtr]::Zero -or $size -eq 0) { throw "cannot read manifest of $path" }
    $buf = New-Object byte[] $size
    [Runtime.InteropServices.Marshal]::Copy($ptr, $buf, 0, $size)
    return $buf
  } finally {
    [void][PeRes]::FreeLibrary($h)
  }
}

$manifest = Get-Manifest $Source
"manifest bytes from ${Source}: $($manifest.Length)"

$hu = [PeRes]::BeginUpdateResourceW((Resolve-Path $Target), $false) # keep everything else
if ($hu -eq [IntPtr]::Zero) { throw "BeginUpdateResource failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
try {
  if (-not [PeRes]::UpdateResource($hu, [IntPtr]24, [IntPtr]1, [uint16]1033, $manifest, [uint32]$manifest.Length)) {
    throw "UpdateResource manifest failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  }
} finally {
  if (-not [PeRes]::EndUpdateResource($hu, $false)) {
    throw "EndUpdateResource failed (err $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  }
}
"manifest restored into $Target"
