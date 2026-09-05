Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)
strHubDir = objFSO.GetParentFolderName(strScriptDir)
strServerJs = strHubDir & "\server.js"

bWakeOnly = False
If WScript.Arguments.Count > 0 Then
    strArg = LCase(WScript.Arguments(0))
    If InStr(strArg, "wake") > 0 Then
        bWakeOnly = True
    End If
End If

Function IsServerRunning()
    IsServerRunning = False
    On Error Resume Next
    Dim http
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.setTimeouts 200, 200, 200, 200
    http.open "GET", "http://localhost:3000/api/health", False
    http.send
    If Err.Number = 0 Then
        If http.status = 200 Then
            IsServerRunning = True
        End If
    End If
    Err.Clear
    On Error Goto 0
End Function

If Not IsServerRunning() Then
    objShell.CurrentDirectory = strHubDir
    objShell.Run "node server.js", 0, False
    
    For i = 1 To 24
        WScript.Sleep 250
        If IsServerRunning() Then Exit For
    Next
End If

If Not bWakeOnly Then
    objShell.Run "cmd.exe /c start chrome http://localhost:3000 || start http://localhost:3000", 0, False
End If
