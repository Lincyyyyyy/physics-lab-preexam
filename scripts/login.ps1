param(
    [string]$BaseUrl = "http://172.31.80.14:7101",
    [string]$Username,
    [string]$Password,
    [string]$CheckCode,
    [string]$WorkDir = (Get-Location).Path,
    [string]$PendingCookieFile = "pending_login_cookies.json",
    [string]$SessionCookieFile = "session_cookies.json",
    [string]$CaptchaOut = "pending_captcha.png"
)

$ErrorActionPreference = "Stop"
$pendingPath = Join-Path $WorkDir $PendingCookieFile
$sessionPath = Join-Path $WorkDir $SessionCookieFile
$captchaPath = Join-Path $WorkDir $CaptchaOut

function Save-CookiesToFile($session, [string]$path, [string]$token) {
    $cookieList = $session.Cookies.GetCookies($BaseUrl) | ForEach-Object {
        [ordered]@{ Name = $_.Name; Value = $_.Value; Path = $_.Path; Domain = $_.Domain }
    }
    $payload = [ordered]@{
        Cookies = @($cookieList)
        Token = $token
    }
    $payload | ConvertTo-Json | Set-Content -Path $path -Encoding UTF8
}

if (-not $CheckCode) {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $null = Invoke-WebRequest -Uri "$BaseUrl/Student/ReadyForExam/ReadyForExam" -WebSession $s -TimeoutSec 20 -UseBasicParsing
    $null = Invoke-WebRequest -Uri "$BaseUrl/CheckCode.ashx?Flag=DengLu" -WebSession $s -TimeoutSec 20 -OutFile $captchaPath
    Save-CookiesToFile $s $pendingPath ""
    Write-Output "Captcha saved to $captchaPath"
    Write-Output "Pending session saved to $pendingPath"
    Write-Output "Ask the user to read the 4-character captcha, then rerun with -CheckCode '<code>'."
    return
}

if (-not (Test-Path -LiteralPath $pendingPath)) {
    throw "Missing $pendingPath. Run without -CheckCode first."
}

$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$pending = Get-Content $pendingPath | ConvertFrom-Json
foreach ($c in @($pending.Cookies)) {
    $s.Cookies.Add((New-Object System.Net.Cookie($c.Name, $c.Value, $c.Path, $c.Domain)))
}

if (-not $Username) { throw "Username is required when CheckCode is provided." }
if (-not $Password) { throw "Password is required when CheckCode is provided." }

$uid = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Username))
$upass = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Password))
$loginBody = @{ userId = $uid; userPass = $upass; checkcode = $CheckCode }
$resp = Invoke-WebRequest -Uri "$BaseUrl/Login/UserLogin" -Method Post -Body $loginBody -WebSession $s -TimeoutSec 20 -UseBasicParsing
$json = $resp.Content | ConvertFrom-Json
if (-not $json.IsSuccess) {
    throw "Login failed: $($json.ErrorInfo)"
}

Save-CookiesToFile $s $sessionPath ([string]$json.Data.GUID)
Write-Output "Login succeeded. Session saved to $sessionPath"
