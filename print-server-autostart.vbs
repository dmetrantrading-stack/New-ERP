' Runs the thermal print server hidden at Windows logon (used by install-print-server-autostart.bat).
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
bat = scriptDir & "\run-print-server-silent.bat"
shell.Run """" & bat & """", 0, False
