#!/usr/bin/env node
/**
 * npm run build:release  (Windows)
 *
 * One build, one stamp, two artifacts in release/:
 *   AllTools_<YYMMDD_HHMMSS>_<arch>.msi            per-user installer
 *   AllTools_portable_<YYMMDD_HHMMSS>_<arch>.zip   unzip-and-run (data beside the exe)
 *
 * Needs WiX CLI 4+ (winget install WiXToolset.WiXCLI; wix extension add -g WixToolset.UI.wixext).
 */
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_FILE_NAME,
  APP_NAME,
  APP_VERSION,
  RELEASE_DIR,
  STAGING_DIR,
  artifactSuffix,
  beginBuild,
  buildRenderer,
  ensureDir,
  findUnpacked,
  packageElectron,
  projectRoot,
} from './build-common.mjs';

const log = (message) => console.log(`[release] ${message}`);

function resolveWix() {
  const probe = (command) => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
  if (probe('wix')) return 'wix';

  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  for (const version of ['7.0', '6.0', '5.0', '4.0']) {
    const candidate = path.join(programFiles, `WiX Toolset v${version}`, 'bin', 'wix.exe');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'WiX CLI not found. Install it with:\n  winget install WiXToolset.WiXCLI\n  wix extension add -g WixToolset.UI.wixext',
  );
}

/** x.y.z → x.y.z.<minute counter>; the 4th part must change per build so MSI treats it as an upgrade. */
function toMsiVersion(version) {
  const parts = String(version).split('.').map((part) => Number.parseInt(part, 10) || 0);
  while (parts.length < 3) parts.push(0);
  const revision = Math.floor(Date.now() / 60_000) % 65535;
  return `${parts[0]}.${parts[1]}.${parts[2]}.${revision || 1}`;
}

/** Zips `<parent>/<folder>` into `zipPath` (bsdtar ships with Windows 10+). */
function zipFolder(parent, folder, zipPath) {
  fs.rmSync(zipPath, { force: true });
  const result = spawnSync('tar', ['-a', '-c', '-f', zipPath, '-C', parent, folder], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('zip failed (tar exit ' + result.status + ')');
}

function buildPortableZip(unpackedDir, suffix) {
  const folder = `${APP_FILE_NAME}_portable${suffix}`;
  const stage = path.join(STAGING_DIR, 'portable');
  const target = path.join(stage, folder);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(unpackedDir, target, { recursive: true });

  // The marker makes the app keep its data in ./data beside the exe.
  fs.writeFileSync(path.join(target, '.portable'), '1\n');
  fs.writeFileSync(
    path.join(target, 'README-USB.txt'),
    [
      `${APP_NAME} (portable)`,
      '='.repeat(24),
      '',
      `1. 이 폴더 전체를 원하는 위치(USB 등)에 복사합니다.`,
      `2. ${APP_FILE_NAME}.exe 를 실행합니다.`,
      `3. 설정은 이 폴더의 data/ 에 저장됩니다. (폴더를 통째로 옮기면 그대로 따라갑니다)`,
      `4. 로컬 전용 프로그램입니다. 로그인이 없고 네트워크 포트도 열지 않으며, 여러 개를 동시에 실행할 수 있습니다.`,
      '',
      `버전 v${APP_VERSION} / 빌드 ${suffix.slice(1)}`,
      '',
    ].join('\r\n'),
  );

  const zipPath = path.join(RELEASE_DIR, `${folder}.zip`);
  zipFolder(stage, folder, zipPath);
  fs.rmSync(stage, { recursive: true, force: true });
  return zipPath;
}

function buildMsi(unpackedDir, suffix) {
  const wix = resolveWix();
  const stage = path.join(STAGING_DIR, 'msi-stage');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(unpackedDir, stage, { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'build', 'icon.ico'), path.join(stage, 'app-icon.ico'));

  const exeName = fs
    .readdirSync(stage)
    .find((name) => name === `${APP_FILE_NAME}.exe`) ??
    fs.readdirSync(stage).find((name) => name.toLowerCase().endsWith('.exe') && !/uninstall|crashpad/i.test(name));
  if (!exeName) throw new Error(`Main executable not found in ${stage}`);

  const outPath = path.join(RELEASE_DIR, `${APP_FILE_NAME}${suffix}.msi`);
  fs.rmSync(outPath, { force: true });

  const productVersion = toMsiVersion(APP_VERSION);
  const args = [
    'build',
    path.join(projectRoot, 'installer', 'Product.wxs'),
    '-d', `AppName=${APP_NAME}`,
    '-d', `ExeName=${exeName}`,
    '-d', `ProductVersion=${productVersion}`,
    '-d', `ProductCode=${randomUUID().toUpperCase()}`,
    '-d', `StageDir=${stage}`,
    '-d', `InstallerDir=${path.join(projectRoot, 'installer')}`,
    '-ext', 'WixToolset.UI.wixext',
    '-o', outPath,
  ];
  log(`> wix ${args.join(' ')}`);
  const result = spawnSync(wix, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`wix build failed (exit ${result.status})`);

  fs.rmSync(outPath.replace(/\.msi$/i, '.wixpdb'), { force: true });
  fs.rmSync(stage, { recursive: true, force: true });
  return outPath;
}

function main() {
  if (process.platform !== 'win32') {
    throw new Error('build:release must run on Windows. (macOS: npm run build:release:mac)');
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const stamp = beginBuild();
  const suffix = artifactSuffix(stamp, arch);
  log(`build stamp ${stamp}, arch ${arch}`);

  ensureDir(RELEASE_DIR);
  buildRenderer();

  const unpackedRoot = path.join(STAGING_DIR, 'release');
  packageElectron('win', arch, unpackedRoot);
  const unpackedDir = findUnpacked(unpackedRoot, /^win(-arm64)?-unpacked$/);

  const zipPath = buildPortableZip(unpackedDir, suffix);
  const msiPath = buildMsi(unpackedDir, suffix);
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  const size = (file) => `${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`;
  log('done');
  log(`  ${path.relative(projectRoot, msiPath)}  (${size(msiPath)})`);
  log(`  ${path.relative(projectRoot, zipPath)}  (${size(zipPath)})`);
}

try {
  main();
} catch (error) {
  console.error('[release] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
