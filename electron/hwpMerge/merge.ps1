# 한글 COM 으로 HWP/HWPX 를 순서대로 병합합니다.
# 각 파일의 구역(용지 방향·크기)은 InsertFile 로 유지합니다.
# 인자: -PayloadPath <utf8 json 파일>
# JSON: { "paths": ["..."], "outputPath": "..." }
# stdout: PROGRESS <index>/<total> <name> | DONE <path> | ERROR <message>
param(
  [Parameter(Mandatory = $true)]
  [string]$PayloadPath
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-ProgressLine([string]$line) {
  Write-Output $line
  [Console]::Out.Flush()
}

function Register-FilePathChecker {
  # 함수 안에서는 $MyInvocation.MyCommand.Path 가 null 이라 $PSScriptRoot 사용
  $scriptDir = $PSScriptRoot
  if ([string]::IsNullOrWhiteSpace($scriptDir)) {
    try { $scriptDir = Split-Path -Parent $PSCommandPath } catch { $scriptDir = '' }
  }
  if ([string]::IsNullOrWhiteSpace($scriptDir)) { return }
  $dll = Join-Path -Path $scriptDir -ChildPath 'FilePathCheckerModule.dll'
  if (-not (Test-Path -LiteralPath $dll)) { return }
  try {
    $keyPath = 'HKCU:\Software\HNC\HwpAutomation\Modules'
    if (-not (Test-Path -LiteralPath $keyPath)) {
      New-Item -Path $keyPath -Force | Out-Null
    }
    Set-ItemProperty -Path $keyPath -Name 'FilePathCheckerModule' -Value $dll
  } catch {}
}

function Open-HangulDocument($hwp, [string]$filePath) {
  $full = [System.IO.Path]::GetFullPath($filePath)
  $opts = 'lock:false;forceopen:true;suspendpassword:true;'

  # Tiny PDF helper 와 동일: Open(path, "", options)
  try {
    $r = $hwp.Open($full, '', $opts)
    if ($r -eq $true) { return $true }
  } catch {}

  try {
    $r = $hwp.Open($full, 'HWP', $opts)
    if ($r -eq $true) { return $true }
  } catch {}

  try {
    $r = $hwp.Open($full)
    if ($r -eq $true) { return $true }
  } catch {}

  try {
    $hwp.HAction.GetDefault('FileOpen', $hwp.HParameterSet.HFileOpenSave.HSet)
    $hwp.HParameterSet.HFileOpenSave.filename = $full
    $r = $hwp.HAction.Execute('FileOpen', $hwp.HParameterSet.HFileOpenSave.HSet)
    if ($r -eq $true) { return $true }
  } catch {}

  # 일부 버전은 반환값이 비어도 문서가 열려 있음
  try {
    if ($hwp.XHwpDocuments.Count -gt 0) { return $true }
  } catch {}

  return $false
}

try {
  if (-not (Test-Path -LiteralPath $PayloadPath)) {
    throw "페이로드 파일을 찾을 수 없습니다."
  }
  $raw = [System.IO.File]::ReadAllText($PayloadPath, [System.Text.Encoding]::UTF8)
  $payload = $raw | ConvertFrom-Json
  $paths = @($payload.paths)
  $outputPath = [string]$payload.outputPath

  if ($paths.Count -lt 1) { throw "병합할 파일이 없습니다." }
  if ([string]::IsNullOrWhiteSpace($outputPath)) { throw "저장 경로가 없습니다." }

  $resolvedPaths = @()
  foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p)) {
      throw "파일을 찾을 수 없습니다: $p"
    }
    $resolvedPaths += [System.IO.Path]::GetFullPath($p)
  }
  $paths = $resolvedPaths
  $outputPath = [System.IO.Path]::GetFullPath($outputPath)

  Register-FilePathChecker

  $hwp = $null
  try {
    $hwp = New-Object -ComObject HWPFrame.HwpObject
  } catch {
    throw "HANCOM_COM: 한글 자동화 객체를 만들지 못했습니다. 한컴 한글을 한 번 실행해 초기 설정을 완료했는지 확인해 주세요."
  }

  try {
    # 보안 모듈 — 파일 열기 확인 창 억제
    try { [void]$hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule') } catch {}

    try {
      if ($hwp.XHwpWindows.Count -gt 0) {
        $hwp.XHwpWindows.Item(0).Visible = $false
      }
    } catch {}

    $total = $paths.Count
    $first = [string]$paths[0]
    $firstName = [System.IO.Path]::GetFileName($first)
    Write-ProgressLine ("PROGRESS 1/" + $total + " " + $firstName)

    if (-not (Open-HangulDocument $hwp $first)) {
      throw "문서를 열지 못했습니다: $firstName (암호 보호·다른 프로그램에서 사용 중·한글 보안 모듈을 확인해 주세요.)"
    }

    for ($i = 1; $i -lt $total; $i++) {
      $next = [string]$paths[$i]
      $nextName = [System.IO.Path]::GetFileName($next)
      Write-ProgressLine ("PROGRESS " + ($i + 1) + "/" + $total + " " + $nextName)

      try {
        $hwp.HAction.GetDefault('MoveDocEnd', $hwp.HParameterSet.HSelectionOpt.HSet)
        [void]$hwp.HAction.Execute('MoveDocEnd', $hwp.HParameterSet.HSelectionOpt.HSet)
      } catch {}

      $hwp.HAction.GetDefault('InsertFile', $hwp.HParameterSet.HInsertFile.HSet)
      $hwp.HParameterSet.HInsertFile.filename = $next
      try {
        # 구역(용지 방향 등) 유지 — 지원 버전에서만
        $hwp.HParameterSet.HInsertFile.KeepSection = 1
      } catch {}
      try {
        $hwp.HParameterSet.HInsertFile.FileOpenDialog = 0
      } catch {}

      $ok = $false
      try {
        $ok = [bool]$hwp.HAction.Execute('InsertFile', $hwp.HParameterSet.HInsertFile.HSet)
      } catch {
        $ok = $false
      }
      if (-not $ok) {
        try {
          [void]$hwp.Insert($next)
          $ok = $true
        } catch {
          throw "삽입에 실패했습니다: $nextName"
        }
      }
    }

    Write-ProgressLine ("PROGRESS " + $total + "/" + $total + " 저장 중")

    # 다시 열 때 1페이지부터 보이도록 캐럿을 문서 앞으로 이동한 뒤 저장
    try {
      $hwp.HAction.GetDefault('MoveDocBegin', $hwp.HParameterSet.HSelectionOpt.HSet)
      [void]$hwp.HAction.Execute('MoveDocBegin', $hwp.HParameterSet.HSelectionOpt.HSet)
    } catch {
      try { [void]$hwp.Run('MoveDocBegin') } catch {}
    }

    $outDir = [System.IO.Path]::GetDirectoryName($outputPath)
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
      [void][System.IO.Directory]::CreateDirectory($outDir)
    }
    if (Test-Path -LiteralPath $outputPath) {
      Remove-Item -LiteralPath $outputPath -Force
    }

    $saved = $false
    try {
      # 확장자에 맞춰 형식 힌트
      $ext = [System.IO.Path]::GetExtension($outputPath).ToLowerInvariant()
      $fmt = if ($ext -eq '.hwp') { 'HWP' } else { 'HWPX' }
      try {
        $saved = [bool]$hwp.SaveAs($outputPath, $fmt, '')
      } catch {
        $saved = [bool]$hwp.SaveAs($outputPath)
      }
    } catch {
      throw "저장에 실패했습니다: $([System.IO.Path]::GetFileName($outputPath))"
    }
    if (-not $saved) {
      if (-not (Test-Path -LiteralPath $outputPath)) {
        throw "저장에 실패했습니다: $([System.IO.Path]::GetFileName($outputPath))"
      }
    }
    if (-not (Test-Path -LiteralPath $outputPath) -or ((Get-Item -LiteralPath $outputPath).Length -le 0)) {
      throw "저장 파일이 비어 있거나 만들어지지 않았습니다."
    }

    Write-ProgressLine ("DONE " + $outputPath)
  } finally {
    try { $hwp.Clear(1) } catch {}
    try { $hwp.Quit() } catch {}
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($hwp) } catch {}
  }
} catch {
  $msg = [string]$_.Exception.Message
  if ([string]::IsNullOrWhiteSpace($msg)) { $msg = [string]$_ }
  $msg = ($msg -replace "[\r\n]+", " ").Trim()
  Write-ProgressLine ("ERROR " + $msg)
  exit 1
}

exit 0
