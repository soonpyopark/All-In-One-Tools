/**
 * Windows 시스템 관리 — 제어판·컴퓨터관리·서비스·작업 스케줄러,
 * 화면보호기, 비밀번호 변경, BitLocker 잠금·해제, 관리자 권한으로 재실행.
 * win32 에서만 API 를 등록합니다.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { ApiError, defineApi } from '../api/registry.js';
import { markQuitting } from '../trayService.js';
import {
  readWindowsSystemState,
  saveWindowsSystemOrder,
} from '../windowsSystem/store.js';
import {
  WINDOWS_SYSTEM_SHORTCUT_IDS,
  orderWindowsSystemShortcuts,
} from '../../shared/windowsSystem.js';

/** @type {Record<string, string>} — `cmd /c start "" <target>` 로 연다. */
const LAUNCH_TARGETS = {
  'control-panel': 'control.exe',
  'computer-management': 'compmgmt.msc',
  services: 'services.msc',
  schedule: 'taskschd.msc',
};

/** 64비트 System32 PowerShell (WOW64 회피) */
const POWERSHELL_EXE = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

/**
 * @param {string} command
 * @param {string[]} [args]
 * @param {{ timeoutMs?: number, windowsHide?: boolean }} [options]
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
function runCommand(command, args = [], options = {}) {
  const { timeoutMs = 20_000, windowsHide = true } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new ApiError('명령 실행 시간이 초과되었습니다.'));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * PowerShell -EncodedCommand (UTF-16LE) 로 스크립트 실행.
 * @param {string} script
 * @param {{ timeoutMs?: number }} [options]
 */
async function runPowerShell(script, options = {}) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = await runCommand(
    POWERSHELL_EXE,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeoutMs: options.timeoutMs ?? 30_000, windowsHide: true },
  );
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new ApiError(detail || `PowerShell 실행에 실패했습니다. (code ${result.code})`);
  }
  return result.stdout.trim();
}

/**
 * 분리 프로세스로 시스템 도구 실행 (`start` 가 .msc 연결을 처리).
 * @param {string} target
 */
function spawnDetachedTarget(target) {
  const child = spawn('cmd.exe', ['/c', 'start', '', target], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

/**
 * 현재 프로세스가 UAC Elevated(High Integrity) 인지.
 * 관리자 그룹 소속(IsInRole)만으로는 부족 — 필터된 토큰에서도 true 가 나올 수 있음.
 */
async function isProcessElevated() {
  try {
    // S-1-16-12288 = Mandatory Label\High Mandatory Level
    const out = await runPowerShell(
      `
$high = $false
foreach ($g in [Security.Principal.WindowsIdentity]::GetCurrent().Groups) {
  if ($g.Value -eq 'S-1-16-12288') { $high = $true; break }
}
if ($high) { 'True' } else { 'False' }
`,
      { timeoutMs: 10_000 },
    );
    if (/^(True|true|1)$/.test(String(out).trim())) return true;
  } catch {
    // fall through
  }
  try {
    const result = await runCommand('net', ['session'], { timeoutMs: 8_000, windowsHide: true });
    return result.code === 0;
  } catch {
    return false;
  }
}

/**
 * UAC로 동일 앱을 관리자 권한으로 다시 띄운 뒤 현재 프로세스를 종료합니다.
 * UAC를 취소하면 현재 앱은 그대로 둡니다.
 */
async function relaunchElevated() {
  if (await isProcessElevated()) {
    return { ok: true, elevated: true, already: true };
  }

  const exe = process.execPath;
  const cwd = app.isPackaged ? path.dirname(exe) : process.cwd();
  const args = process.argv.slice(1).filter((arg) => arg && arg !== '--');
  // ProcessStartInfo.Arguments 는 하나의 문자열
  const argString = args
    .map((arg) => {
      const text = String(arg);
      if (!/[\s"]/u.test(text)) return text;
      return `"${text.replace(/"/g, '\\"')}"`;
    })
    .join(' ');

  // 트레이 단일 인스턴스 잠금을 먼저 풀어, 관리자 프로세스가 바로 뜰 수 있게 함
  markQuitting();
  try {
    app.releaseSingleInstanceLock();
  } catch {
    // ignore
  }

  try {
    // ProcessStartInfo + Verb=runas (경로 공백·중첩 -Command 이스케이프 문제 회피)
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = ${JSON.stringify(exe)}
$psi.WorkingDirectory = ${JSON.stringify(cwd)}
$psi.Arguments = ${JSON.stringify(argString)}
$psi.UseShellExecute = $true
$psi.Verb = 'runas'
$proc = [System.Diagnostics.Process]::Start($psi)
if (-not $proc) { throw 'UAC 실행이 시작되지 않았습니다.' }
`,
      { timeoutMs: 180_000 },
    );
  } catch (err) {
    try {
      app.requestSingleInstanceLock();
    } catch {
      // ignore
    }
    if (err instanceof ApiError) {
      const message = err.message;
      if (/cancel|취소|denied|거부|The operation was canceled|1223|0x80004005/i.test(message)) {
        throw new ApiError('관리자 권한 요청이 취소되었습니다.');
      }
      if (/ParserError|UnexpectedToken|#<\s*CLIXML/i.test(message)) {
        throw new ApiError('관리자 권한으로 다시 실행하지 못했습니다. UAC 창에서 허용해 주세요.');
      }
      throw new ApiError(
        /관리자 권한/.test(message)
          ? message
          : '관리자 권한으로 다시 실행하지 못했습니다. UAC 창에서 허용해 주세요.',
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    if (/cancel|취소|The operation was canceled/i.test(message)) {
      throw new ApiError('관리자 권한 요청이 취소되었습니다.');
    }
    throw new ApiError('관리자 권한으로 다시 실행하지 못했습니다. UAC 창에서 허용해 주세요.');
  }

  setImmediate(() => {
    app.quit();
  });
  return { ok: true, elevated: true, already: false };
}

/** 화면보호기 사용자 설정 */
const SCREENSAVER_USER_KEY = 'HKCU:\\Control Panel\\Desktop';
/** 그룹 정책이 덮어쓰는 화면보호기 키 */
const SCREENSAVER_POLICY_KEY =
  'HKCU:\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop';

const SCREENSAVER_POLICY_MSG =
  '화면보호기가 Windows 정책으로 강제되어 있습니다. 조직 정책이거나 로컬 보안 정책에서 허용한 뒤에 다시 시도해 주세요.';

/**
 * 실효 화면보호기 활성 여부 (true = 켜짐). 정책 키를 사용자 설정보다 우선.
 * @returns {Promise<boolean>}
 */
async function getScreensaverActive() {
  const out = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$policyPath = '${SCREENSAVER_POLICY_KEY}'
$userPath = '${SCREENSAVER_USER_KEY}'
$policyActive = $null
$policyScr = $null
if (Test-Path $policyPath) {
  $p = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue
  if ($null -ne $p) {
    $names = @($p.PSObject.Properties.Name)
    if ($names -contains 'ScreenSaveActive') { $policyActive = [string]$p.ScreenSaveActive }
    if ($names -contains 'SCRNSAVE.EXE') { $policyScr = [string]$p.'SCRNSAVE.EXE' }
  }
}
if ($null -ne $policyActive -and $policyActive.Trim() -eq '0') { '0'; exit 0 }
if ($null -ne $policyActive -and $policyActive.Trim() -eq '1') { '1'; exit 0 }
if ($null -ne $policyScr -and $policyScr.Trim().Length -gt 0) { '1'; exit 0 }
$v = (Get-ItemProperty -Path $userPath -Name ScreenSaveActive -ErrorAction SilentlyContinue).ScreenSaveActive
if ($null -eq $v) { '1' } else { [string]$v }
`);
  return String(out).trim() !== '0';
}

/**
 * @param {boolean} active
 */
async function setScreensaverActive(active) {
  const uiParam = active ? 1 : 0;
  const regValue = active ? '1' : '0';
  // 끄기: Control Panel 「없음」과 같이 ScreenSaveActive=0 + SCRNSAVE.EXE 제거
  // 켜기: SPI + ScreenSaveActive=1 (이전에 지운 .scr 은 복원하지 않음)
  await runPowerShell(`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AllToolsSpi {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
"@
# SPI_SETSCREENSAVEACTIVE = 0x0011, SPIF_UPDATEINIFILE|SPIF_SENDCHANGE = 3
if (-not [AllToolsSpi]::SystemParametersInfo(0x0011, ${uiParam}, [IntPtr]::Zero, 3)) {
  throw "SystemParametersInfo 실패 (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
}
$userPath = '${SCREENSAVER_USER_KEY}'
Set-ItemProperty -Path $userPath -Name ScreenSaveActive -Value '${regValue}' -Type String
if (${uiParam} -eq 0) {
  Remove-ItemProperty -Path $userPath -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue
}

$policyPath = '${SCREENSAVER_POLICY_KEY}'
if (Test-Path $policyPath) {
  $p = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue
  $policyActive = $null
  $policyScr = $null
  if ($null -ne $p) {
    $names = @($p.PSObject.Properties.Name)
    if ($names -contains 'ScreenSaveActive') { $policyActive = [string]$p.ScreenSaveActive }
    if ($names -contains 'SCRNSAVE.EXE') { $policyScr = [string]$p.'SCRNSAVE.EXE' }
  }
  $forced = $false
  if ($null -ne $policyActive -and $policyActive.Trim() -eq '1') { $forced = $true }
  elseif (($null -eq $policyActive -or $policyActive.Trim() -eq '') -and $null -ne $policyScr -and $policyScr.Trim().Length -gt 0) { $forced = $true }
  if ($forced -and ${uiParam} -eq 0) {
    try {
      Set-ItemProperty -Path $policyPath -Name ScreenSaveActive -Value '0' -Type String -ErrorAction Stop
      Remove-ItemProperty -Path $policyPath -Name 'SCRNSAVE.EXE' -ErrorAction SilentlyContinue
    } catch {
      throw 'SCREENSAVER_POLICY'
    }
    $p2 = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue
    $stillActive = $null
    $stillScr = $null
    if ($null -ne $p2) {
      $names2 = @($p2.PSObject.Properties.Name)
      if ($names2 -contains 'ScreenSaveActive') { $stillActive = [string]$p2.ScreenSaveActive }
      if ($names2 -contains 'SCRNSAVE.EXE') { $stillScr = [string]$p2.'SCRNSAVE.EXE' }
    }
    if (($null -ne $stillActive -and $stillActive.Trim() -eq '1') -or (($null -eq $stillActive -or $stillActive.Trim() -ne '0') -and $null -ne $stillScr -and $stillScr.Trim().Length -gt 0)) {
      throw 'SCREENSAVER_POLICY'
    }
  }
}
`);
}

/**
 * DOMAIN\user / user@domain → 로컬 SAM 사용자 이름만 남깁니다.
 * @param {string} raw
 */
function localSamUserName(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.includes('\\')) return value.split('\\').pop() || value;
  if (value.includes('@')) return value.split('@')[0] || value;
  return value;
}

/**
 * 현재 로그온 로컬 사용자 비밀번호 변경.
 * Set-LocalUser(관리자 필요) 대신 UserPrincipal.ChangePassword 로
 * 본인이 현재 비밀번호를 알고 있을 때 스스로 변경합니다.
 * @param {string} currentPassword
 * @param {string} newPassword
 */
async function changeLocalPassword(currentPassword, newPassword) {
  const current = String(currentPassword ?? '');
  const password = String(newPassword ?? '');
  if (!current) throw new ApiError('현재 비밀번호를 입력해 주세요.');
  if (!password) throw new ApiError('새 비밀번호를 입력해 주세요.');
  if (password.length > 127 || current.length > 127) {
    throw new ApiError('비밀번호가 너무 깁니다.');
  }
  if (current === password) {
    throw new ApiError('새 비밀번호는 현재 비밀번호와 달라야 합니다.');
  }

  const user = localSamUserName(os.userInfo().username || process.env.USERNAME || '');
  if (!user) throw new ApiError('현재 Windows 사용자 이름을 확인할 수 없습니다.');

  // JSON 문자열로 넣어 특수문자·따옴표 이스케이프
  const userLit = JSON.stringify(user);
  const currentLit = JSON.stringify(current);
  const passLit = JSON.stringify(password);

  try {
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
$userName = ${userLit}
$currentPlain = ${currentLit}
$newPlain = ${passLit}

Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$machine = [System.DirectoryServices.AccountManagement.ContextType]::Machine
$ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext($machine)
try {
  if (-not $ctx.ValidateCredentials($userName, $currentPlain)) {
    throw '현재 비밀번호가 올바르지 않습니다.'
  }

  $principal = [System.DirectoryServices.AccountManagement.UserPrincipal]::FindByIdentity($ctx, $userName)
  if ($null -eq $principal) {
    throw 'LOCAL_USER_NOT_FOUND'
  }
  try {
    # 본인 비밀번호 변경 — 관리자 권한(Set-LocalUser) 불필요
    $principal.ChangePassword($currentPlain, $newPlain)
  } finally {
    $principal.Dispose()
  }
} finally {
  $ctx.Dispose()
}
`,
      { timeoutMs: 45_000 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/현재 비밀번호가 올바르지 않습니다/.test(message)) {
      throw new ApiError('현재 비밀번호가 올바르지 않습니다.');
    }
    if (/LOCAL_USER_NOT_FOUND/i.test(message)) {
      throw new ApiError(
        '이 PC의 로컬 계정을 찾지 못했습니다. Microsoft 계정으로 로그인한 경우 Windows 설정 → 계정에서 변경해 주세요.',
      );
    }
    if (/password.*complex|complexity|암호.*복잡|최소.*길이|history|최근.*암호/i.test(message)) {
      throw new ApiError(
        '새 비밀번호가 Windows 암호 복잡도·기록 정책에 맞지 않습니다. 더 복잡하거나 다른 비밀번호로 다시 시도해 주세요.',
      );
    }
    if (/Access is denied|액세스가 거부|0x80070005|unauthorized|권한/i.test(message)) {
      throw new ApiError(
        '비밀번호 변경 권한이 없습니다. 관리자 계정으로 로그온했는지 확인하거나 Windows 설정 → 계정에서 변경해 주세요.',
      );
    }
    // PowerShell 긴 스택 대신 첫 줄·핵심만
    const short = message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^At |^CategoryInfo|^FullyQualifiedErrorId|^PowerShell/i.test(line));
    throw new ApiError(short || '비밀번호 변경에 실패했습니다.');
  }
}

/**
 * @param {string} raw
 * @returns {string} 예: `E:`
 */
function normalizeMountPoint(raw) {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\//g, '\\');
  const m = /^([A-Z]):\\?$/.exec(text);
  if (!m) throw new ApiError('드라이브 문자가 올바르지 않습니다. (예: E:)');
  return `${m[1]}:`;
}

const BITLOCKER_ADMIN_MSG =
  'BitLocker 작업에 관리자 권한이 필요합니다. 앱을 관리자로 다시 실행해 주세요.';

/** 실제 권한 거부인지 (네임스페이스 이름만 나온 경우는 제외) */
function isBitLockerPermissionDenied(message) {
  return /Access is denied|액세스가 거부|PermissionDenied|0x80070005|0x80041003|WBEM_E_ACCESS_DENIED|UnauthorizedAccess|Run as administrator/i.test(
    message,
  );
}

/** 이미 사용자용으로 다듬은 BitLocker ApiError 인지 */
function isMappedBitLockerError(err) {
  return (
    err instanceof ApiError &&
    (Boolean(err.extra?.code) ||
      err.message === BITLOCKER_ADMIN_MSG ||
      err.message.startsWith('BitLocker ') ||
      err.message.startsWith('드라이브가 사용 중') ||
      err.message.startsWith('이 PC에서 BitLocker'))
  );
}

/**
 * PowerShell/BitLocker 오류를 짧은 한글 메시지로 바꿉니다.
 * @param {unknown} err
 * @param {'list' | 'unlock' | 'lock'} kind
 * @param {{ elevated?: boolean }} [options]
 * @returns {never}
 */
function mapBitLockerError(err, kind, options = {}) {
  const message = err instanceof Error ? err.message : String(err);
  const elevated = Boolean(options.elevated);

  // 잠금: 사용 중 판별을 권한 오류보다 먼저 (Access denied 가 사용 중일 때도 자주 나옴)
  if (
    kind === 'lock' &&
    /in use|사용 중|cannot.*lock|잠글 수 없|ForceDismount|파일이 사용|being used|The device is not ready|장치가 준비되지|0x80070015|0x8031004E/i.test(
      message,
    )
  ) {
    throw new ApiError(
      '드라이브가 사용 중이라 잠글 수 없습니다. 파일을 닫거나 강제 잠금을 선택해 주세요.',
      409,
      { code: 'BITLOCKER_IN_USE' },
    );
  }
  if (kind === 'unlock' && /password|암호|incorrect|올바르지|0x803100A2|FVE_E_FAILED_AUTHENTICATION/i.test(message)) {
    throw new ApiError('BitLocker 암호가 올바르지 않습니다.');
  }
  if (isBitLockerPermissionDenied(message)) {
    // 이미 elevated 인데 잠금이 거부되면 → 사용 중으로 유도 (관리자 재실행 오안내 방지)
    if (elevated && kind === 'lock') {
      throw new ApiError(
        '드라이브가 사용 중이라 잠글 수 없습니다. 파일을 닫거나 강제 잠금을 선택해 주세요.',
        409,
        { code: 'BITLOCKER_IN_USE' },
      );
    }
    if (elevated) {
      throw new ApiError(
        kind === 'list' ? 'BitLocker 볼륨을 조회하지 못했습니다.' : 'BitLocker 작업에 실패했습니다.',
      );
    }
    throw new ApiError(BITLOCKER_ADMIN_MSG, 403, { code: 'BITLOCKER_ADMIN' });
  }
  if (
    /cmdlet.*not found|not recognized|모듈을 찾을 수 없|BitLocker.*not available|Get-BitLockerVolume.*not/i.test(
      message,
    )
  ) {
    throw new ApiError('이 PC에서 BitLocker 명령을 사용할 수 없습니다. (Pro 이상·BitLocker 기능 필요)');
  }
  // CLIXML·긴 원문은 사용자에게 그대로 보여 주지 않음
  if (/#<\s*CLIXML|<Objs |<S N=/.test(message)) {
    if (kind === 'lock') {
      throw new ApiError(
        '드라이브가 사용 중이라 잠글 수 없습니다. 파일을 닫거나 강제 잠금을 선택해 주세요.',
        409,
        { code: 'BITLOCKER_IN_USE' },
      );
    }
    throw new ApiError(
      kind === 'list' ? 'BitLocker 볼륨을 조회하지 못했습니다.' : 'BitLocker 작업에 실패했습니다.',
    );
  }
  const short = message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(
      (line) =>
        line &&
        !/^At |^CategoryInfo|^FullyQualifiedErrorId|^PowerShell|^#</i.test(line) &&
        line.length < 200,
    );
  throw new ApiError(
    short ||
      (kind === 'list'
        ? 'BitLocker 볼륨을 조회하지 못했습니다.'
        : kind === 'lock'
          ? '드라이브를 잠그지 못했습니다.'
          : 'BitLocker 작업에 실패했습니다.'),
  );
}

/**
 * BitLocker로 보호 중이거나 잠긴 볼륨만 반환합니다.
 * @returns {Promise<{ volumes: Array<{
 *   mountPoint: string,
 *   lockStatus: string,
 *   protectionStatus: string,
 *   volumeStatus: string,
 *   capacityGB: number,
 *   locked: boolean,
 * }> }>}
 */
async function listBitLockerVolumes() {
  const elevated = await isProcessElevated();
  // 비관리자면 CIM 호출 전에 바로 안내 (CLIXML 원문·오탐 방지)
  if (!elevated) {
    return { volumes: [], elevated: false, needsAdmin: true };
  }

  try {
    const out = await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
Import-Module BitLocker -ErrorAction Stop
$vols = @(Get-BitLockerVolume -ErrorAction Stop)
$items = @()
foreach ($v in $vols) {
  $lock = [string]$v.LockStatus
  $prot = [string]$v.ProtectionStatus
  $status = [string]$v.VolumeStatus
  $include = ($lock -eq 'Locked') -or ($prot -eq 'On') -or ($status -ne 'FullyDecrypted')
  if (-not $include) { continue }
  $cap = 0
  try { $cap = [math]::Round([double]$v.CapacityGB, 1) } catch { $cap = 0 }
  $items += [PSCustomObject]@{
    mountPoint = ([string]$v.MountPoint).TrimEnd('\\')
    lockStatus = $lock
    protectionStatus = $prot
    volumeStatus = $status
    capacityGB = $cap
  }
}
if ($items.Count -eq 0) { '[]' } else { ($items | ConvertTo-Json -Compress -Depth 3) }
`,
      { timeoutMs: 45_000 },
    );
    const text = String(out || '').trim() || '[]';
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = [];
    }
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    const volumes = rows
      .map((row) => {
        if (!row || typeof row !== 'object') return null;
        const src = /** @type {Record<string, unknown>} */ (row);
        let mountPoint;
        try {
          mountPoint = normalizeMountPoint(String(src.mountPoint ?? ''));
        } catch {
          return null;
        }
        const lockStatus = String(src.lockStatus ?? '');
        return {
          mountPoint,
          lockStatus,
          protectionStatus: String(src.protectionStatus ?? ''),
          volumeStatus: String(src.volumeStatus ?? ''),
          capacityGB: Number(src.capacityGB) || 0,
          locked: /^locked$/i.test(lockStatus),
        };
      })
      .filter(Boolean);
    volumes.sort((a, b) => a.mountPoint.localeCompare(b.mountPoint));
    return { volumes, elevated: true, needsAdmin: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // High IL 오탐·토큰 불일치 시: 예외 대신 관리자 재실행 안내
    if (isBitLockerPermissionDenied(message)) {
      return { volumes: [], elevated: false, needsAdmin: true };
    }
    if (isMappedBitLockerError(err)) throw err;
    mapBitLockerError(err, 'list', { elevated: true });
  }
}

/**
 * @param {string} mountPoint
 * @param {string} password
 */
async function unlockBitLockerVolume(mountPoint, password) {
  const mp = normalizeMountPoint(mountPoint);
  const pass = String(password ?? '');
  if (!pass) throw new ApiError('BitLocker 암호를 입력해 주세요.');
  if (pass.length > 256) throw new ApiError('암호가 너무 깁니다.');

  const elevated = await isProcessElevated();
  if (!elevated) throw new ApiError(BITLOCKER_ADMIN_MSG, 403, { code: 'BITLOCKER_ADMIN' });

  const mpLit = JSON.stringify(mp);
  const passLit = JSON.stringify(pass);
  try {
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
Import-Module BitLocker -ErrorAction Stop
$mp = ${mpLit}
$plain = ${passLit}
$secure = ConvertTo-SecureString -String $plain -AsPlainText -Force
Unlock-BitLocker -MountPoint $mp -Password $secure | Out-Null
`,
      { timeoutMs: 60_000 },
    );
    return { ok: true, mountPoint: mp };
  } catch (err) {
    if (isMappedBitLockerError(err)) throw err;
    mapBitLockerError(err, 'unlock', { elevated: true });
  }
}

/**
 * @param {string} mountPoint
 * @param {boolean} force
 */
async function lockBitLockerVolume(mountPoint, force) {
  const mp = normalizeMountPoint(mountPoint);
  const elevated = await isProcessElevated();
  if (!elevated) throw new ApiError(BITLOCKER_ADMIN_MSG, 403, { code: 'BITLOCKER_ADMIN' });

  const mpLit = JSON.stringify(mp);
  try {
    // 목록·해제와 동일하게 BitLocker 모듈 사용 (manage-bde PATH/WOW64 이슈 회피)
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
Import-Module BitLocker -ErrorAction Stop
$mp = ${mpLit}
$force = ${force ? '$true' : '$false'}
if ($force) {
  Lock-BitLocker -MountPoint $mp -ForceDismount | Out-Null
} else {
  Lock-BitLocker -MountPoint $mp | Out-Null
}
`,
      { timeoutMs: 60_000 },
    );
    return { ok: true, mountPoint: mp };
  } catch (err) {
    if (isMappedBitLockerError(err)) throw err;
    mapBitLockerError(err, 'lock', { elevated: true });
  }
}

export function register() {
  if (process.platform !== 'win32') return;

  defineApi('windowsSystem.state', async () => {
    const { order } = readWindowsSystemState();
    const screensaverActive = await getScreensaverActive();
    const elevated = await isProcessElevated();
    return {
      order,
      shortcuts: orderWindowsSystemShortcuts(order),
      screensaverActive,
      username: os.userInfo().username || process.env.USERNAME || '',
      elevated,
    };
  });

  defineApi('windowsSystem.relaunchElevated', async () => relaunchElevated());

  defineApi('windowsSystem.saveOrder', async (body) => {
    const saved = await saveWindowsSystemOrder(body?.order);
    return {
      order: saved.order,
      shortcuts: orderWindowsSystemShortcuts(saved.order),
    };
  });

  defineApi('windowsSystem.open', async (body) => {
    const id = String(body?.id ?? '');
    if (!WINDOWS_SYSTEM_SHORTCUT_IDS.includes(/** @type {any} */ (id))) {
      throw new ApiError('알 수 없는 바로가기입니다.');
    }
    const target = LAUNCH_TARGETS[id];
    if (!target) throw new ApiError('실행 대상을 찾을 수 없습니다.');
    try {
      spawnDetachedTarget(target);
      return { ok: true };
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : '실행에 실패했습니다.');
    }
  });

  defineApi('windowsSystem.setScreensaver', async (body) => {
    const active = Boolean(body?.active);
    try {
      await setScreensaverActive(active);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      if (/SCREENSAVER_POLICY/.test(message)) {
        throw new ApiError(SCREENSAVER_POLICY_MSG);
      }
      if (err instanceof ApiError) throw err;
      throw new ApiError(message || '화면보호기 설정에 실패했습니다.');
    }
    const effective = await getScreensaverActive();
    // 끄기 요청인데 실효 상태가 여전히 켜짐 → 정책 등으로 덮인 경우
    if (!active && effective) {
      throw new ApiError(SCREENSAVER_POLICY_MSG);
    }
    return { active: effective };
  });

  defineApi('windowsSystem.changePassword', async (body) => {
    const current = String(body?.current ?? '');
    const next = String(body?.password ?? '');
    const confirm = String(body?.confirm ?? '');
    if (!current) throw new ApiError('현재 비밀번호를 입력해 주세요.');
    if (!next) throw new ApiError('새 비밀번호를 입력해 주세요.');
    if (next !== confirm) throw new ApiError('비밀번호 확인이 일치하지 않습니다.');
    await changeLocalPassword(current, next);
    return { ok: true };
  });

  defineApi('windowsSystem.bitlocker.list', async () => listBitLockerVolumes());

  defineApi('windowsSystem.bitlocker.unlock', async (body) => {
    const mountPoint = String(body?.mountPoint ?? '');
    const password = String(body?.password ?? '');
    return unlockBitLockerVolume(mountPoint, password);
  });

  defineApi('windowsSystem.bitlocker.lock', async (body) => {
    const mountPoint = String(body?.mountPoint ?? '');
    const force = Boolean(body?.force);
    return lockBitLockerVolume(mountPoint, force);
  });
}
