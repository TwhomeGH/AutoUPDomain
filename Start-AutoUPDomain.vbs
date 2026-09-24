Option Explicit
Dim shell, filesystem, directory, script, command
Set shell = CreateObject("WScript.Shell")
Set filesystem = CreateObject("Scripting.FileSystemObject")
directory = filesystem.GetParentFolderName(WScript.ScriptFullName)
script = filesystem.BuildPath(directory, "src\main.js")
command = "node """ & script & """"
shell.CurrentDirectory = directory
shell.Run command, 0, False
