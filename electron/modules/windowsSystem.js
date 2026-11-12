/**
 * Windows 시스템 관리 — 제어판·컴퓨터관리·서비스·작업 스케줄러, 화면보호기, 비밀번호 변경.
 * win32 에서만 API 를 등록합니다.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { ApiError, defineApi } from '../api/registry.js';
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
 * 현재 로그온 로컬 사용자 비밀번호 변경 (현재 비밀번호 검증 후).
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

  const user = os.userInfo().username || process.env.USERNAME || '';
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
$ctx = New-Object System.DirectoryServices.AccountManagement.PrincipalContext([System.DirectoryServices.AccountManagement.ContextType]::Machine)
if (-not $ctx.ValidateCredentials($userName, $currentPlain)) {
  throw '현재 비밀번호가 올바르지 않습니다.'
}

$secure = ConvertTo-SecureString -String $newPlain -AsPlainText -Force
try {
  Set-LocalUser -Name $userName -Password $secure
} catch {
  throw $_.Exception.Message
}
`,
      { timeoutMs: 45_000 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/현재 비밀번호가 올바르지 않습니다/.test(message)) {
      throw new ApiError('현재 비밀번호가 올바르지 않습니다.');
    }
    if (/Microsoft|AzureAD|domain|도메인|Access is denied|액세스가 거부|administrator|관리자/i.test(message)) {
      throw new ApiError(
        '로컬 계정 비밀번호만 변경할 수 있습니다. Microsoft 계정이거나 권한이 부족하면 Windows 설정 → 계정에서 변경해 주세요.',
      );
    }
    throw new ApiError(message || '비밀번호 변경에 실패했습니다.');
  }
}

export function register() {
  if (process.platform !== 'win32') return;

  defineApi('windowsSystem.state', async () => {
    const { order } = readWindowsSystemState();
    const screensaverActive = await getScreensaverActive();
    return {
      order,
      shortcuts: orderWindowsSystemShortcuts(order),
      screensaverActive,
      username: os.userInfo().username || process.env.USERNAME || '',
    };
  });

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

  defineApi('windowsSystem.getScreensaver', async () => ({
    active: await getScreensaverActive(),
  }));

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
}
