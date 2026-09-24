$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Security
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -eq 'encrypt') {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($request.value)
        $result = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Console]::Write([Convert]::ToBase64String($result))
    } elseif ($request.action -eq 'decrypt') {
        $bytes = [Convert]::FromBase64String($request.value)
        $result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
        [Console]::Write([System.Text.Encoding]::UTF8.GetString($result))
    } else { throw 'Unsupported operation' }
} catch { [Console]::Error.Write('Windows credential protection failed'); exit 1 }
