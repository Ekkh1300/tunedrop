' Tunedrop silent launcher — runs TuneDrop.bat with no console window.
' Put a shortcut to this file on the Desktop or pin to Start.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & fso.CombinePath(fso.GetParentFolderName(WScript.ScriptFullName), "TuneDrop.bat") & """", 0, False
