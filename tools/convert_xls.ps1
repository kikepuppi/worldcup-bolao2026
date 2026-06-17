# Convert the old-format .xls boloes to .xlsx (into _conv/) via Excel COM,
# so the Python parser can read every file with openpyxl.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root "boloes"
$dst  = Join-Path $root "_conv"
if (-not (Test-Path $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }

$xls = Get-ChildItem -Path $src -Filter *.xls -File
if (-not $xls) { "No .xls files to convert."; return }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  foreach ($f in $xls) {
    $out = Join-Path $dst ($f.BaseName + ".xlsx")
    $wb = $excel.Workbooks.Open($f.FullName, 0, $true)   # read-only
    $wb.SaveAs($out, 51)                                  # 51 = xlOpenXMLWorkbook (.xlsx)
    $wb.Close($false)
    "converted $($f.Name) -> $($f.BaseName).xlsx"
  }
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
