# Legacy Excel(.xls/.xlt/.xlsb) → .xlsx (서식 유지용, Excel COM)
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$excel = $null
$wb = $null

try {
  if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "INPUT_NOT_FOUND:$InputPath"
  }

  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.ScreenUpdating = $false

  $wb = $excel.Workbooks.Open($InputPath, 0, $true)
  # 51 = xlOpenXMLWorkbook (.xlsx)
  $outDir = Split-Path -Parent $OutputPath
  if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  }
  if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
  }
  $wb.SaveAs($OutputPath, 51)
  Write-Output "OK:$OutputPath"
}
catch {
  $msg = $_.Exception.Message
  if ($msg -match 'Excel\.Application|80040154|REGDB_E_CLASSNOTREG') {
    Write-Error "EXCEL_NOT_INSTALLED:$msg"
  }
  else {
    Write-Error "CONVERT_FAILED:$msg"
  }
  exit 1
}
finally {
  if ($wb -ne $null) {
    try { $wb.Close($false) } catch {}
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb) } catch {}
  }
  if ($excel -ne $null) {
    try { $excel.Quit() } catch {}
    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) } catch {}
  }
  [gc]::Collect()
  [gc]::WaitForPendingFinalizers()
}
