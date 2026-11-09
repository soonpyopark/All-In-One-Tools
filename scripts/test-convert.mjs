/**
 * Headless smoke test: generate a short MP4, convert to GIF via the video-to-gif converter.
 * Usage: node scripts/test-convert.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setAppContext } from '../electron/context.js';
import { videoToGif } from '../electron/converters/videoToGif.js';
import { listConverters } from '../electron/converters/registry.js';
import { probeFfmpeg, resolveFfmpegBinary, runFfmpeg } from '../electron/ffmpegService.js';
import { startConvertJob, getConvertJob } from '../electron/convertJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vti-test-'));
const stateRoot = path.join(workDir, 'data');

setAppContext({
  isDev: true,
  projectRoot,
  distDir: path.join(projectRoot, 'dist'),
  stateRoot,
  portable: false,
});

// Minimal settings stub: convertJobs → resolveFfmpegBinary → getSettings()
fs.mkdirSync(stateRoot, { recursive: true });
fs.writeFileSync(
  path.join(stateRoot, 'settings.json'),
  JSON.stringify({ version: 1, ffmpegDir: '' }, null, 2),
);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function waitForJob(jobId, timeoutMs = 60_000) {
  const started = Date.now();
  for (;;) {
    const job = getConvertJob(jobId);
    assert(job, 'job missing');
    if (job.state === 'done' || job.state === 'error' || job.state === 'cancelled') return job;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for job ${jobId}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  console.log('[test] converters:', listConverters().map((c) => c.id).join(', '));

  const probe = await probeFfmpeg('');
  console.log('[test] ffmpeg probe:', probe.ok ? probe.version : probe.error);
  assert(probe.ok, `ffmpeg probe failed: ${probe.error}`);

  const { path: ffmpegPath } = resolveFfmpegBinary('');
  const sampleMp4 = path.join(workDir, 'sample.mp4');
  const directGif = path.join(workDir, 'direct.gif');

  console.log('[test] generating sample mp4…');
  const gen = await runFfmpeg(ffmpegPath, [
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=320x240:d=1',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:d=1',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-y',
    sampleMp4,
  ]);
  assert(gen.code === 0 && fs.existsSync(sampleMp4), `sample mp4 failed:\n${gen.stderr}`);

  console.log('[test] direct converter run…');
  let lastProgress = 0;
  await videoToGif.run({
    ffmpegPath,
    inputPath: sampleMp4,
    outputPath: directGif,
    options: { fps: 8, width: 160, startSec: 0, durationSec: 1 },
    onProgress: (p) => {
      lastProgress = p;
    },
  });
  assert(fs.existsSync(directGif), 'direct gif missing');
  assert(fs.statSync(directGif).size > 0, 'direct gif empty');
  console.log('[test] direct gif ok, size=', fs.statSync(directGif).size, 'progress=', lastProgress);

  console.log('[test] convertJobs pipeline…');
  const started = startConvertJob({
    converterId: 'video-to-gif',
    inputPath: sampleMp4,
    options: { fps: 8, width: 160, durationSec: 1 },
  });
  const finished = await waitForJob(started.id);
  console.log('[test] job state=', finished.state, 'progress=', finished.progress);
  if (finished.state !== 'done') {
    throw new Error(`job failed: ${finished.error}`);
  }
  assert(fs.existsSync(finished.outputPath), 'job output missing');
  console.log('[test] job output=', finished.outputPath, 'size=', fs.statSync(finished.outputPath).size);

  console.log('[test] PASS');
}

main()
  .catch((err) => {
    console.error('[test] FAIL', err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });
