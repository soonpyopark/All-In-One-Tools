#!/usr/bin/env node
/**
 * npm run update:all — 의존성(npm)과 Electron 을 최신으로 올립니다. (NAS4USB 의 update-all 과 같은 방식)
 *
 * 순서: 개발 앱 중지 → git pull(변경 사항이 없을 때만) → npm install/update →
 *       직접 의존성 전부 @latest(메이저 포함) → Electron 실행 확인 → 아이콘 준비 → (옵션) 빌드
 *
 * 옵션: --skip-git  --skip-npm  --skip-majors  --build  --build-mac
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/** @param {string[]} argv */
function parseArgs(argv) {
  return {
    skipGit: argv.includes('--skip-git'),
    skipNpm: argv.includes('--skip-npm'),
    skipMajors: argv.includes('--skip-majors'),
    build: argv.includes('--build'),
    buildMac: argv.includes('--build-mac'),
  };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 */
function run(label, command, args) {
  console.log(`[update-all] ${label}…`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${label} 실패 (exit ${result.status ?? 1})`);
  }
}

/**
 * 방금 종료한 Electron 이 파일을 잠깐 더 잡고 있으면 npm 이 EBUSY 로 실패합니다.
 * 잠금이 풀릴 때까지 기다리며 몇 번 다시 시도합니다.
 *
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {number} [attempts]
 */
async function runWithRetry(label, command, args, attempts = 4) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(label, command, args);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`[update-all] ${label} 실패 — 파일 잠금이 풀리길 기다린 뒤 다시 시도합니다 (${attempt}/${attempts - 1}).`);
      await sleep(3000);
    }
  }
}

async function gitPull() {
  try {
    await fs.access(path.join(root, '.git'));
  } catch {
    console.log('[update-all] git 저장소가 아니라서 git pull 을 건너뜁니다.');
    return;
  }

  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  if (status.stdout?.trim()) {
    console.log('[update-all] 로컬 변경 사항이 있어 git pull 을 건너뜁니다.');
    return;
  }

  run('git pull', 'git', ['pull', '--ff-only']);
}

/** @param {string} pkg */
function queryNpmVersion(pkg) {
  const result = spawnSync('npm', ['view', pkg, 'version'], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const version = result.stdout?.trim();
  if (result.status !== 0 || !version) {
    throw new Error(`npm view ${pkg} version 실패`);
  }
  return version;
}

function electronBinaryPath() {
  const dist = path.join(root, 'node_modules', 'electron', 'dist');
  if (process.platform === 'win32') return path.join(dist, 'electron.exe');
  if (process.platform === 'darwin') {
    return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  }
  return path.join(dist, 'electron');
}

/**
 * 실행 중인 앱/개발용 Electron 은 node_modules 와 설치된 exe 를 잠급니다.
 * 켜 둔 채 업데이트하면 바이너리가 깨져 다음 실행이 실패하므로 먼저 종료합니다.
 */
function stopRunningApp() {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/IM', 'AllTools.exe', '/T', '/F'], { stdio: 'ignore' });
    const filter = JSON.stringify(`${root}\\*`);
    const ps = [
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |`,
      `Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like ${filter} } |`,
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
    ].join(' ');
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    return;
  }

  spawnSync('pkill', ['-f', path.join(root, 'node_modules', 'electron')], { stdio: 'ignore' });
}

/**
 * npm 이 설치 스크립트(allowScripts)를 막는 환경에서도 Electron 이 받아지도록
 * package.json 의 allowScripts 에 최신 Electron 버전을 기록합니다.
 * @param {string} version
 */
async function writeElectronAllowScripts(version) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  const allow = pkg.allowScripts && typeof pkg.allowScripts === 'object' ? pkg.allowScripts : {};
  for (const key of Object.keys(allow)) {
    if (key.startsWith('electron@')) delete allow[key];
  }
  allow[`electron@${version}`] = true;
  pkg.allowScripts = allow;
  await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`[update-all] allowScripts electron@${version}`);
}

/**
 * Electron 파일을 다른 프로세스가 잡고 있는지 확인합니다. (이름을 바꿔 보는 방식, Windows 용)
 * 잠겨 있으면 npm 이 Electron 을 교체하다가 EBUSY 로 실패합니다.
 * @returns {Promise<boolean>}
 */
async function isElectronLocked() {
  if (process.platform !== 'win32') return false;
  const probe = path.join(root, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar');
  const temp = `${probe}.lockcheck`;
  try {
    await fs.access(probe);
  } catch {
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await fs.rename(probe, temp);
      await fs.rename(temp, probe);
      return false;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') return false;
      await sleep(1500);
    }
  }
  return true;
}

/** @param {string} expectedVersion */
function assertElectronRuns(expectedVersion) {
  const result = spawnSync(electronBinaryPath(), ['--version'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
  });
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.status !== 0) {
    throw new Error(
      `Electron ${expectedVersion} 이(가) 업데이트 후 실행되지 않습니다 (${out || `exit ${result.status}`}). ` +
        '깨진 설치를 그대로 두지 않기 위해 중단합니다.',
    );
  }
  console.log(`[update-all] Electron 실행 확인: ${out}`);
}

/** @param {unknown} spec */
function isInstallableRegistrySpec(spec) {
  const value = String(spec || '').trim();
  if (!value) return false;
  if (/^(file|link|workspace|npm):/i.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/^git(\+|$)/i.test(value)) return false;
  return true;
}

/**
 * 최신 메이저가 앱을 깨뜨리는 패키지는 여기에 추가해 현재 버전을 유지합니다.
 * (NAS4USB 의 MAJOR_HOLD_PACKAGES 와 같은 용도)
 */
const MAJOR_HOLD_PACKAGES = new Set([]);

/** @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} pkg */
function collectDirectPackageNames(pkg) {
  /** @type {string[]} */
  const names = [];
  for (const field of ['dependencies', 'devDependencies']) {
    const block = pkg[field] && typeof pkg[field] === 'object' ? pkg[field] : {};
    for (const [name, spec] of Object.entries(block)) {
      if (isInstallableRegistrySpec(spec)) names.push(name);
    }
  }
  return [...new Set(names)].sort();
}

/**
 * `npm update` 는 package.json 범위(`^18`) 안에서만 올리므로 메이저가 바뀌지 않습니다.
 * 직접 의존성을 전부 `@latest` 로 다시 설치해 메이저까지 올립니다.
 */
async function updateDirectPackagesLatest({ excludeElectron = false } = {}) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const allNames = collectDirectPackageNames(pkg).filter((name) => !(excludeElectron && name === 'electron'));
  const names = allNames.filter((name) => !MAJOR_HOLD_PACKAGES.has(name));
  const held = allNames.filter((name) => MAJOR_HOLD_PACKAGES.has(name));
  if (held.length > 0) {
    console.log(`[update-all] 메이저 유지: ${held.join(', ')}`);
  }
  if (names.length === 0) {
    console.log('[update-all] 올릴 레지스트리 패키지가 없습니다.');
    return;
  }
  console.log(`[update-all] 직접 의존성 ${names.length}개 → @latest (메이저 포함)`);
  await runWithRetry('npm latest (majors)', 'npm', ['install', ...names.map((name) => `${name}@latest`)]);
}

/** @param {string} expectedVersion */
async function finalizeElectron(expectedVersion) {
  try {
    await fs.access(electronBinaryPath());
  } catch {
    console.log('[update-all] Electron 바이너리가 없어 install.js 를 실행합니다.');
    run('electron install.js', 'node', [path.join('node_modules', 'electron', 'install.js')]);
  }
  assertElectronRuns(expectedVersion);
}

/**
 * 범위 안 업데이트 후 전체 `@latest`(메이저 포함) 또는 Electron 계열만 최신으로 올립니다.
 * Electron 설치 전에 allowScripts 를 먼저 기록합니다.
 * @param {{ skipMajors?: boolean }} [options]
 */
async function updateNpmStack({ skipMajors = false } = {}) {
  await runWithRetry('npm install', 'npm', ['install']);

  // 다른 프로그램(예: 켜 둔 Cursor)이 Electron 파일을 잡고 있으면 npm 이 EBUSY 로 실패하므로,
  // 그런 경우에는 Electron 만 건너뛰고 나머지를 최신화합니다.
  const electronLocked = await isElectronLocked();
  if (electronLocked) {
    console.warn(
      '[update-all] 경고: Electron 파일이 다른 프로그램에 의해 잠겨 있어 Electron 은 업데이트하지 않습니다. ' +
        '(Cursor 등을 종료한 뒤 다시 실행하면 Electron 도 최신화됩니다.)',
    );
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    const rangeNames = collectDirectPackageNames(pkg).filter((name) => name !== 'electron');
    await runWithRetry('npm update (electron 제외)', 'npm', ['update', ...rangeNames]);

    if (skipMajors) {
      const builderVersion = queryNpmVersion('electron-builder');
      await runWithRetry('electron-builder latest', 'npm', ['install', `electron-builder@${builderVersion}`, '--save-dev']);
    } else {
      await updateDirectPackagesLatest({ excludeElectron: true });
    }

    assertElectronRuns('(현재 설치 버전)');
    return;
  }

  await runWithRetry('npm update', 'npm', ['update']);

  const electronVersion = queryNpmVersion('electron');
  await writeElectronAllowScripts(electronVersion);

  if (skipMajors) {
    const builderVersion = queryNpmVersion('electron-builder');
    await runWithRetry('electron latest', 'npm', ['install', `electron@${electronVersion}`, '--save-dev']);
    await runWithRetry('electron-builder latest', 'npm', ['install', `electron-builder@${builderVersion}`, '--save-dev']);
  } else {
    await updateDirectPackagesLatest();
  }

  await finalizeElectron(electronVersion);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  console.log('[update-all] ===== 시작 =====');
  console.log(`[update-all] 프로젝트 루트: ${root}`);

  console.log('[update-all] 실행 중인 All In One Tools / 개발용 Electron 을 종료합니다.');
  stopRunningApp();
  await sleep(3000);

  if (!opts.skipGit) {
    await gitPull();
  }

  if (!opts.skipNpm) {
    await updateNpmStack({ skipMajors: opts.skipMajors });
  }

  run('prepare icons', 'npm', ['run', 'prepare:icons']);

  if (opts.build) {
    run('build release', 'npm', ['run', 'build:release']);
  }
  if (opts.buildMac) {
    run('build release (mac)', 'npm', ['run', 'build:release:mac']);
  }

  console.log('[update-all] ===== 완료 =====');
}

main().catch((error) => {
  console.error('[update-all] 오류:', error instanceof Error ? error.message : error);
  process.exit(1);
});
