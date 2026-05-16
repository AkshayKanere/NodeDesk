Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir
WshShell.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\tray.ps1""", 0, False
