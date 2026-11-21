Option Explicit

Dim fso, shell, appDir, serverScript, nodeExe, localAppData, wingetNode, objCmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverScript = appDir & "\src\server.js"

localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
wingetNode = localAppData & "\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64\node.exe"

If fso.FileExists(wingetNode) Then
  nodeExe = """" & wingetNode & """"
Else
  nodeExe = "node.exe"
End If

shell.CurrentDirectory = appDir
objCmd = nodeExe & " """ & serverScript & """"
shell.Run objCmd, 0, False
