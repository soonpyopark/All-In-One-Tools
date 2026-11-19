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
    'powershell.exe',
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

/** 현재 프로세스가 관리자 권한인지 */
async function isProcessElevated() {
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

  const argListLiteral =
    args.length > 0 ? `@(${args.map((a) => JSON.stringify(a)).join(', ')})` : '@()';
  const innerCmd = [
    'Start-Sleep -Milliseconds 1200',
    `$exe = ${JSON.stringify(exe)}`,
    `$cwd = ${JSON.stringify(cwd)}`,
    `$argList = ${argListLiteral}`,
    'Set-Location -LiteralPath $cwd',
    'if ($argList.Count -gt 0) {',
    '  Start-Process -FilePath $exe -WorkingDirectory $cwd -ArgumentList $argList',
    '} else {',
    '  Start-Process -FilePath $exe -WorkingDirectory $cwd',
    '}',
  ].join('; ');

  try {
    // UAC 승인 후 잠시 대기 → 현재 인스턴스가 잠금·종료할 시간을 준 뒤 관리자 프로세스를 기동
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command', ${JSON.stringify(innerCmd)}
) | Out-Null
`,
      { timeoutMs: 180_000 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cancel|취소|denied|거부|The operation was canceled/i.test(message)) {
      throw new ApiError('관리자 권한 요청이 취소되었습니다.');
    }
    throw new ApiError('관리자 권한으로 다시 실행하지 못했습니다. UAC 창에서 허용해 주세요.');
  }

  markQuitting();
  try {
    app.releaseSingleInstanceLock();
  } catch {
    // 트레이 단일 인스턴스가 아닐 수 있음
  }
  setImmediate(() => {
    app.quit();
  });
  return { ok: true, elevated: true, already: false };
}

/**
 * 화면보호기 활성 여부 (true = 켜짐).
 * @returns {Promise<boolean>}
 */
async function getScreensaverActive() {
  const out = await runPowerShell(`
$ErrorActionPreference = 'Stop'
$v = (Get-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name ScreenSaveActive -ErrorAction SilentlyContinue).ScreenSaveActive
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
Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name ScreenSaveActive -Value '${regValue}' -Type String
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
 * @returns {never}
 */
function mapBitLockerError(err, kind) {
  const message = err instanceof Error ? err.message : String(err);
  // PermissionDenied / WBEM 0x80041003 / CLIXML 권한 오류 포함
  if (
    /Access is denied|액세스가 거부|PermissionDenied|0x80070005|0x80041003|WBEM_E_ACCESS_DENIED|Unauthorized|관리자|elevation|elevated|Run as administrator|MicrosoftVolumeEncryption/i.test(
      message,
    )
  ) {
    throw new ApiError(BITLOCKER_ADMIN_MSG, 403, { code: 'BITLOCKER_ADMIN' });
  }
  if (kind === 'unlock' && /password|암호|incorrect|올바르지|0x803100A2|FVE_E_FAILED_AUTHENTICATION/i.test(message)) {
    throw new ApiError('BitLocker 암호가 올바르지 않습니다.');
  }
  if (kind === 'lock' && /in use|사용 중|cannot.*lock|잠글 수 없|ForceDismount|파일이 사용|being used/i.test(message)) {
    throw new ApiError(
      '드라이브가 사용 중이라 잠글 수 없습니다. 파일을 닫거나 강제 잠금을 선택해 주세요.',
      409,
      { code: 'BITLOCKER_IN_USE' },
    );
  }
  if (/Get-BitLockerVolume|BitLocker.*not|cmdlet.*not found|모듈/i.test(message) && !/#<\s*CLIXML/i.test(message)) {
    throw new ApiError('이 PC에서 BitLocker 명령을 사용할 수 없습니다.');
  }
  // CLIXML·긴 원문은 사용자에게 그대로 보여 주지 않음
  if (/#<\s*CLIXML|<Objs |<S N=/.test(message)) {
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
  throw new ApiError(short || (kind === 'list' ? 'BitLocker 볼륨을 조회하지 못했습니다.' : 'BitLocker 작업에 실패했습니다.'));
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
  try {
    const out = await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
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
    return { volumes };
  } catch (err) {
    if (isMappedBitLockerError(err)) throw err;
    mapBitLockerError(err, 'list');
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

  const mpLit = JSON.stringify(mp);
  const passLit = JSON.stringify(pass);
  try {
    await runPowerShell(
      `
$ErrorActionPreference = 'Stop'
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
    mapBitLockerError(err, 'unlock');
  }
}

/**
 * @param {string} mountPoint
 * @param {boolean} force
 */
async function lockBitLockerVolume(mountPoint, force) {
  const mp = normalizeMountPoint(mountPoint);
  const args = ['-lock', mp];
  if (force) args.push('-ForceDismount');
  try {
    const result = await runCommand('manage-bde.exe', args, { timeoutMs: 60_000, windowsHide: true });
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (result.code !== 0) {
      mapBitLockerError(new ApiError(detail || '드라이브를 잠그지 못했습니다.'), 'lock');
    }
    return { ok: true, mountPoint: mp };
  } catch (err) {
    if (isMappedBitLockerError(err)) throw err;
    mapBitLockerError(err, 'lock');
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
    await setScreensaverActive(active);
    return { active: await getScreensaverActive() };
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
