# Deploy MOM Apps Script ด้วยคำสั่งเดียว
#
#   .\tools\deploy.ps1 "อธิบายสั้น ๆ ว่าแก้อะไร"
#
# ลำดับ: ตรวจ -> ประทับเวอร์ชัน -> push -> deploy ทับ deployment เดิม
#
# เหตุผลที่ต้องมีสคริปต์นี้: การ deploy ด้วยมือต้องพิมพ์ --deploymentId ยาว ๆ ทุกครั้ง
# ถ้าลืมใส่ clasp จะสร้าง deployment ใหม่ = URL เปลี่ยน = ผู้ใช้ต้องมาขอลิงก์ใหม่
# สคริปต์นี้จึงหา deploymentId เดิมให้เอง และไม่ยอม deploy ถ้าตรวจไม่ผ่าน

param(
  [string]$Description = "update"
)

$ErrorActionPreference = 'Stop'

# clasp เขียนความคืบหน้าลง stderr ซึ่ง PowerShell 5.1 จะแปลงเป็น error record
# ถ้าใครเรียกสคริปต์นี้ต่อท่อด้วย 2>&1 จะทำให้ล้มทั้งที่คำสั่งสำเร็จ
# จึงเช็คผลจาก $LASTEXITCODE เองแทนการพึ่ง ErrorActionPreference กับคำสั่ง native
$PSNativeCommandUseErrorActionPreference = $false

$AppsScript = Split-Path -Parent $PSScriptRoot
Set-Location $AppsScript

$Clasp = "@google/clasp@2.4.2"

Write-Host "== 1/4 ตรวจก่อน deploy ==" -ForegroundColor Cyan
& node tools/verify.js
if ($LASTEXITCODE -ne 0) {
  throw "verify ไม่ผ่าน — ยกเลิกการ deploy"
}

Write-Host "== 2/4 ประทับเวอร์ชันลง Build.gs ==" -ForegroundColor Cyan
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$buildFile = Join-Path $AppsScript "Build.gs"
@"
/**
 * Build.gs — ประทับเวลาที่ deploy ล่าสุด
 * ไฟล์นี้ถูกเขียนทับโดย tools/deploy.ps1 ทุกครั้ง อย่าแก้ด้วยมือ
 * หน้าเว็บเอาค่านี้ไปแสดงที่แถบล่าง เพื่อให้รู้ว่ากำลังใช้เวอร์ชันไหนอยู่
 */
var BUILD_STAMP = '$stamp';
"@ | Set-Content -Path $buildFile -Encoding utf8
Write-Host "   BUILD_STAMP = $stamp"

Write-Host "== 3/4 push ขึ้น Apps Script ==" -ForegroundColor Cyan
$ErrorActionPreference = 'Continue'
& npx.cmd --yes $Clasp push --force
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = 'Stop'; throw "clasp push ไม่สำเร็จ" }

Write-Host "== 4/4 deploy ทับ deployment เดิม ==" -ForegroundColor Cyan
$list = & npx.cmd --yes $Clasp deployments
# บรรทัดหน้าตาแบบ "- AKfycb... @11 - คำอธิบาย"  ส่วน @HEAD คือตัวสำหรับทดสอบ ไม่ใช่ตัวที่ผู้ใช้เปิด
$ids = @()
foreach ($line in $list) {
  if ($line -match '^\s*-\s+(\S+)\s+@(\d+)') { $ids += $Matches[1] }
}
$deploymentId = $ids | Select-Object -Last 1

if (-not $deploymentId) {
  Write-Host "   ยังไม่เคยมี deployment ที่เผยแพร่ — สร้างใหม่" -ForegroundColor Yellow
  & npx.cmd --yes $Clasp deploy --description $Description
} else {
  Write-Host "   ใช้ deployment เดิม: $deploymentId"
  & npx.cmd --yes $Clasp deploy --deploymentId $deploymentId --description $Description
}
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = 'Stop'; throw "clasp deploy ไม่สำเร็จ" }
$ErrorActionPreference = 'Stop'

if ($deploymentId) {
  Write-Host ""
  Write-Host "ลิงก์ (ไม่เปลี่ยน): https://script.google.com/macros/s/$deploymentId/exec" -ForegroundColor Green
}
Write-Host "เสร็จแล้ว — บอกผู้ใช้ให้ refresh หน้าเว็บ แล้วดูเวลาที่แถบล่างว่าเป็น $stamp" -ForegroundColor Green
