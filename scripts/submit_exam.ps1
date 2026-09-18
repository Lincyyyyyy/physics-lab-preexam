param(
    [Parameter(Mandatory=$true)][int]$ExamID,
    [string]$BaseUrl = "http://172.31.80.14:7101",
    [string]$StudentID = "2025040058",
    [string]$WorkDir = (Get-Location).Path,
    [string]$CookieFile = "session_cookies.json",
    [switch]$Submit
)

$ErrorActionPreference = "Stop"
$cookiePath = Join-Path $WorkDir $CookieFile

function New-SessionFromFile([string]$path) {
    $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $data = Get-Content $path | ConvertFrom-Json
    $cookies = @($data.Cookies)
    if (-not $cookies -and $data.Name) {
        $cookies = @($data)
    }
    foreach ($c in $cookies) {
        if ($c.Name) {
            $s.Cookies.Add((New-Object System.Net.Cookie($c.Name, $c.Value, $c.Path, $c.Domain)))
        }
    }
    return $s
}

function Get-TokenFromFile([string]$path) {
    if (Test-Path -LiteralPath $path) {
        $data = Get-Content $path | ConvertFrom-Json
        return [string]$data.Token
    }
    return ""
}

function Save-Session($session, [string]$path, [string]$token) {
    $cookieList = $session.Cookies.GetCookies($BaseUrl) | ForEach-Object {
        [ordered]@{ Name = $_.Name; Value = $_.Value; Path = $_.Path; Domain = $_.Domain }
    }
    [ordered]@{
        Cookies = @($cookieList)
        Token = $token
    } | ConvertTo-Json | Set-Content -Path $path -Encoding UTF8
}

function Convert-MsDate([string]$str) {
    if ($str -match '/Date\((\d+)\)/') {
        return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$Matches[1]).ToOffset([TimeSpan]::FromHours(8)).ToString("yyyy-MM-dd HH:mm:ss")
    }
    return $str
}

$s = New-SessionFromFile $cookiePath
$token = Get-TokenFromFile $cookiePath
$headers = @{}
if ($token) { $headers.Authorization = $token }

$info = Invoke-WebRequest -Uri "$BaseUrl/Student/ReadyForExam/GetExamInfoByExamIDAndStudentID" -Method Post -Body @{ ExamID = $ExamID } -WebSession $s -Headers $headers -TimeoutSec 20 -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json
Save-Session $s $cookiePath $token

$judgeInfo = $info | ConvertTo-Json -Compress | ConvertFrom-Json
$judgeInfo.StartTime = ""
$judgeInfo.EndTime = ""
$judgeInfo.PublishTime = ""
$judgeJson = $judgeInfo | ConvertTo-Json -Compress

$find = Invoke-WebRequest -Uri "$BaseUrl/Student/ReadyForExam/FindOrInsertStudentInfo" -Method Post -Body @{ ExamInfo = $judgeJson } -WebSession $s -Headers $headers -TimeoutSec 20 -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json
Save-Session $s $cookiePath $token
Write-Output "FIND IsSuccess=$($find.IsSuccess) $($find.Data)"

$judge = Invoke-WebRequest -Uri "$BaseUrl/Student/ReadyForExam/JudgeEnterExam" -Method Post -Body @{ ExamInfo = $judgeJson } -WebSession $s -Headers $headers -TimeoutSec 20 -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json
Save-Session $s $cookiePath $token
Write-Output "EXAM $ExamID $($info.ExamName) JUDGE=$($judge.IsSuccess) $($judge.Data)"

if (-not $judge.IsSuccess) {
    Write-Output "Judge failed: $($judge.Data) $($judge.ErrorInfo)"
    return
}

$paperBody = @{
    ContentXml = $judge.OtherDate
    IP = ([uri]$BaseUrl).Host
    Port = ([uri]$BaseUrl).Port
    ExamID = $ExamID
    StudentID = $StudentID
}
$paper = Invoke-WebRequest -Uri "$BaseUrl/Student/ReadyForExam/GetPaperContent" -Method Post -Body $paperBody -WebSession $s -Headers $headers -TimeoutSec 20 -UseBasicParsing | Select-Object -ExpandProperty Content | ConvertFrom-Json
Save-Session $s $cookiePath $token

if (-not $paper.IsSuccess) {
    Write-Output "GetPaperContent failed: $($paper.Data)"
    return
}

$newContentXml = $paper.OtherDate
$html = $paper.Data
$xml = [xml]$newContentXml

$answerItems = New-Object System.Collections.Generic.List[object]
foreach ($q in @($xml.Paper.Content.Question)) {
    $type = [string]$q.Type
    $qid = [string]$q.QuestionID
    $std = ([string]$q.StdAnswer).Trim()
    switch ($type) {
        "SS" {
            if ($std -match '^[A-G]$') {
                $answerItems.Add([pscustomobject]@{ Name = "ss$qid"; Value = $std })
            }
        }
        "MS" {
            foreach ($ch in $std.ToCharArray()) {
                if ($ch -match '^[A-G]$') {
                    $answerItems.Add([pscustomobject]@{ Name = "ms${qid}_$ch"; Value = [string]$ch })
                }
            }
        }
        "TF" {
            $value = if ($std -eq "正确") { "T" } else { "F" }
            $answerItems.Add([pscustomobject]@{ Name = "tf$qid"; Value = $value })
        }
        "BL" {
            $selectMatches = [regex]::Matches($html, "<select[^>]*id='([^']*)'[^>]*>", [System.Text.RegularExpressions.RegexOptions]::Singleline)
            $controls = @()
            foreach ($m in $selectMatches) {
                $candidate = $m.Groups[1].Value
                if ($candidate -match ('^bl' + [regex]::Escape($qid) + '(_\d+)?$')) {
                    $controls += $candidate
                }
            }
            $controls = @($controls | Sort-Object)
            $vals = @($std -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
            for ($i = 0; $i -lt $controls.Count; $i++) {
                $value = if ($i -lt $vals.Count) { $vals[$i] } else { "A" }
                $answerItems.Add([pscustomobject]@{ Name = $controls[$i]; Value = $value })
            }
        }
        "SK" {
            $m = [regex]::Match($html, "<textarea[^>]*id='([^']*)'")
            while ($m.Success) {
                $candidate = $m.Groups[1].Value
                if ($candidate -match [regex]::Escape($qid)) {
                    $answerItems.Add([pscustomobject]@{ Name = $candidate; Value = $std })
                    break
                }
                $m = $m.NextMatch()
            }
        }
        "OP" {
            Write-Output "WARN operation question Q$qid cannot be auto-answered"
        }
        default {
            Write-Output "WARN unknown type $type Q$qid"
        }
    }
}

$bgContent = $answerItems | ConvertTo-Json -Compress
$submitInfo = $info | ConvertTo-Json -Compress | ConvertFrom-Json
$submitInfo.PaperName = $judge.ErrorInfo
$submitInfo.StartTime = Convert-MsDate ([string]$submitInfo.StartTime)
$submitInfo.EndTime = Convert-MsDate ([string]$submitInfo.EndTime)
$submitInfo.PublishTime = Convert-MsDate ([string]$submitInfo.PublishTime)
$examInfoJson = $submitInfo | ConvertTo-Json -Compress
$originalTime = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

Write-Output "Questions=$(@($xml.Paper.Content.Question).Count) Answers=$($answerItems.Count)"

if (-not $Submit) {
    Write-Output "DRY-RUN; not submitted."
    return
}

$submitBody = @{
    PaperContentXml = $newContentXml
    BGContent = $bgContent
    OriginalTime = $originalTime
    ExamInfo = $examInfoJson
    LabResourceIDArr = "[]"
}
$submitResp = Invoke-WebRequest -Uri "$BaseUrl/Student/ReadyForExam/SubmitExam" -Method Post -Body $submitBody -WebSession $s -Headers $headers -TimeoutSec 30 -UseBasicParsing
Save-Session $s $cookiePath $token
$submitResult = $submitResp.Content | ConvertFrom-Json
Write-Output "SUBMIT IsSuccess=$($submitResult.IsSuccess) ErrorInfo=$($submitResult.ErrorInfo)"
if (-not $submitResult.IsSuccess) {
    $dataText = [string]$submitResult.Data
    if ($dataText.Length -gt 1000) { $dataText = $dataText.Substring(0,1000) }
    Write-Output "SUBMIT Data=$dataText"
} else {
    $scoreMatch = [regex]::Match([string]$submitResult.Data, "GainShowScore'[^>]*>([^<]+)</span>")
    if ($scoreMatch.Success) {
        Write-Output "SUBMIT Score=$($scoreMatch.Groups[1].Value)"
    }
}
