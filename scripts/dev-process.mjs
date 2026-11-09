#!/usr/bin/env node
/**
 * npm run dev:stop     — stop the dev app and release everything it holds
 * npm run dev:restart  — stop, then start `npm run dev` again
 *
 * "Everything" = every Electron process started from this project (main, GPU,
 * renderer, utility). The app has no server and opens no port.
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const command = process.argv[2] ?? 'restart';
const isWin = process.platform === 'win32';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Electron processes whose binary / args live under this project. @returns {number[]} */
function getProjectElectronPids() {
  const marker = projectRoot.toLowerCase();
  try {
    if (isWin) {
      const script =
        "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | " +
        'Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress';
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed) ? parsed : [parsed])
        .filter((p) => `${p.CommandLine ?? ''} ${p.ExecutablePath ?? ''}`.toLowerCase().includes(marker))
        .map((p) => Number(p.ProcessId));
    }
    const output = execSync(`pgrep -f "${path.join(projectRoot, 'node_modules', 'electron')}"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

/** @param {number} pid */
function killPidTree(pid) {
  if (pid === process.pid) return;
  try {
    if (isWin) execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

async function stopDev() {
  const targets = getProjectElectronPids();

  if (targets.length === 0) {
    console.log('[dev:stop] Nothing is running.');
  } else {
    console.log(`[dev:stop] Stopping PID(s): ${targets.join(', ')}`);
    for (const pid of targets) killPidTree(pid);
  }

  // Wait until no project Electron process is left.
  const deadline = Date.now() + 10_000;
  while (getProjectElectronPids().length > 0 && Date.now() < deadline) {
    for (const pid of getProjectElectronPids()) killPidTree(pid);
    await sleep(300);
  }
  if (getProjectElectronPids().length > 0) {
    console.error('[dev:stop] Some Electron processes are still running. Close them manually and retry.');
    process.exit(1);
  }

  // Chromium leaves stale single-instance locks behind on macOS / Linux.
  if (!isWin) {
    for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      fs.rmSync(path.join(projectRoot, '.dev-userdata', name), { force: true });
    }
  }

  console.log('[dev:stop] Done — no Electron process left.');
}

async function restartDev() {
  await stopDev();
  console.log('[dev:restart] Starting npm run dev …');
  const child = spawn('npm run dev', {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

if (command === 'stop') {
  await stopDev();
} else if (command === 'restart') {
  await restartDev();
} else {
  console.error('Usage: node scripts/dev-process.mjs [stop|restart]');
  process.exit(1);
}
