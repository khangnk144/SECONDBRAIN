' Second Brain: starts the server at Windows sign-in without any window.
' The run-at-login shortcut runs: wscript.exe "<app>\launcher\start-hidden.vbs"
' The launcher's "login" action never opens a browser; problems go to
' <home>\.secondbrain\logs\launcher.log and one message box.
Option Explicit

Dim fso, shell, folder, script, command
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(folder, "start-second-brain.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ login"

Set shell = CreateObject("WScript.Shell")
' Window style 0 = hidden; False = do not wait for PowerShell to finish.
shell.Run command, 0, False
