import { useEffect, useMemo, useState } from 'react';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { useLoad } from '../../hooks/useLoad.js';
import {
  PITCH_ORIGINAL,
  PITCH_STAGES,
  VOLUME_MAX,
  VOLUME_MIN,
  VOLUME_ORIGINAL,
  VOLUME_STEP,
  pitchStageLabel,
  volumePercentLabel,
} from '../../../shared/pitchVolume.js';
import {
  Badge,
  Field,
  LoadError,
  Loading,
  Section,
  ToggleRow,
  btnClass,
  btnDangerClass,
  btnPrimaryClass,
  codeClass,
  inputClass,
} from '../../components/settings/ui.jsx';

const CONVERTER_ID = 'adjust-pitch-volume';

function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function progressLabel(job) {
  if (!job) return '';
  if (job.state === 'done') return '완료';
  if (job.state === 'error') return '실패';
  if (job.state === 'cancelled') return '취소됨';
  if (job.state === 'queued') return '대기';
  const pct = Math.round((job.progress || 0) * 100);
  return `${pct}%`;
}

function batchTone(state) {
  if (state === 'done') return 'green';
  if (state === 'error' || state === 'cancelled') return 'red';
  return 'amber';
}

export default function AdjustPage() {
  const dialog = useDialog();
  const native = getNative();
  const { data, loading, error, reload } = useLoad(() => api('convert.listConverters'));
  const {
    data: exportInfo,
    reload: reloadExportInfo,
  } = useLoad(() => api('convert.exportDir'));

  const converter = useMemo(
    () => (data?.converters ?? []).find((c) => c.id === CONVERTER_ID) ?? null,
    [data],
  );

  /** @type {[{ key: string, label: string, path: string }[], Function]} */
  const [inputItems, setInputItems] = useState(/** @type {{ key: string, label: string, path: string }[]} */ ([]));
  const [outputDir, setOutputDir] = useState('');
  const [outputDirTouched, setOutputDirTouched] = useState(false);
  const [pitchStage, setPitchStage] = useState(PITCH_ORIGINAL);
  const [volume, setVolume] = useState(VOLUME_ORIGINAL);
  const [normalizeLoudness, setNormalizeLoudness] = useState(false);
  const [outputFormat, setOutputFormat] = useState(/** @type {'same' | 'mp3'} */ ('same'));
  const [batch, setBatch] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);

  const inputPaths = useMemo(() => inputItems.map((item) => item.path), [inputItems]);
  const pitchStages = converter?.pitchStages?.length ? converter.pitchStages : PITCH_STAGES;
  const pitchMax = pitchStages.length ? pitchStages[pitchStages.length - 1].stage : 6;
  const inputExts = converter?.inputExts ?? ['.mp4', '.ts', '.mkv', '.mov', '.avi', '.webm', '.m4v', '.mp3'];

  useEffect(() => {
    if (!exportInfo || outputDirTouched) return;
    setOutputDir(exportInfo.exportDir || '');
  }, [exportInfo, outputDirTouched]);

  useEffect(() => {
    if (!converter) return;
    setPitchStage(Number(converter.defaultOptions?.pitchStage ?? PITCH_ORIGINAL));
    setVolume(Number(converter.defaultOptions?.volume ?? VOLUME_ORIGINAL));
    setNormalizeLoudness(Boolean(converter.defaultOptions?.normalizeLoudness));
    setOutputFormat(converter.defaultOptions?.outputFormat === 'mp3' ? 'mp3' : 'same');
  }, [converter?.id]);

  useEffect(() => {
    if (!batch || (batch.state !== 'queued' && batch.state !== 'running')) return undefined;
    const timer = window.setInterval(() => {
      void api('convert.status', { batchId: batch.batchId })
        .then((res) => setBatch(res.batch))
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [batch?.batchId, batch?.state]);

  const addPaths = (entries) => {
    setInputItems((prev) => {
      const seen = new Set(prev.map((item) => item.path));
      const next = [...prev];
      for (const entry of entries) {
        if (!entry?.path || seen.has(entry.path)) continue;
        seen.add(entry.path);
        next.push({
          key: entry.path,
          label: entry.label || fileName(entry.path),
          path: entry.path,
        });
      }
      return next;
    });
  };

  const pickFiles = async () => {
    if (!native?.pickOpenFiles) return;
    const result = await native.pickOpenFiles({
      memoryKey: 'adjustInput',
      title: '영상·음원 선택 (여러 개 가능)',
      multi: true,
      filters: [
        {
          name: 'Media',
          extensions: inputExts.map((ext) => ext.replace(/^\./, '')),
        },
      ],
    });
    if (result?.canceled || !result?.paths?.length) return;
    addPaths(result.paths.map((p) => ({ path: p, label: fileName(p) })));
  };

  const removePath = (target) => {
    setInputItems((prev) => prev.filter((item) => item.path !== target));
  };

  const clearPaths = () => setInputItems([]);

  const pickOutputDir = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory({ memoryKey: 'adjustOutput' });
    if (result?.canceled || !result?.path) return;
    setOutputDir(result.path);
    setOutputDirTouched(true);
    try {
      await api('convert.setExportDir', { exportDir: result.path });
      void reloadExportInfo();
    } catch {
      // keep session path even if save fails
    }
  };

  const resetOutputDir = async () => {
    setOutputDir('');
    setOutputDirTouched(true);
    try {
      await api('convert.setExportDir', { exportDir: '' });
      void reloadExportInfo();
    } catch (err) {
      void dialog.alert({
        title: '조절',
        body: err instanceof Error ? err.message : '기본값으로 되돌리지 못했습니다.',
      });
    }
  };

  const start = async () => {
    if (!converter) return;
    if (inputPaths.length === 0) {
      void dialog.alert({ title: '조절', body: '입력 영상·음원 파일을 선택해 주세요.' });
      return;
    }
    const folder = outputDir.trim();
    setBusy(true);
    try {
      await api('convert.setExportDir', { exportDir: folder });
      const res = await api('convert.start', {
        converterId: CONVERTER_ID,
        inputPaths,
        outputDir: folder,
        options: {
          pitchStage,
          volume,
          normalizeLoudness,
          outputFormat,
        },
      });
      setBatch(res.batch ?? { batchId: res.batchId, jobs: res.jobs, state: 'queued', progress: 0 });
      if (res.batchId) {
        const status = await api('convert.status', { batchId: res.batchId });
        setBatch(status.batch);
      }
      void reloadExportInfo();
    } catch (err) {
      void dialog.alert({
        title: '조절',
        body: err instanceof Error ? err.message : '변환을 시작하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Stops the whole batch, or just one job when `jobId` is given. */
  const stopJobs = async (jobId) => {
    if (!batch?.batchId) return;
    setStopping(true);
    try {
      const res = await api('convert.cancel', jobId ? { jobId } : { batchId: batch.batchId });
      if (res?.batch) setBatch(res.batch);
    } catch (err) {
      void dialog.alert({
        title: '조절',
        body: err instanceof Error ? err.message : '중지하지 못했습니다.',
      });
    } finally {
      setStopping(false);
    }
  };
  const cancel = () => stopJobs();

  const revealOutput = (outputPath) => {
    if (!outputPath || !native?.showItemInFolder) return;
    void native.showItemInFolder(outputPath);
  };

  if (loading && !data) return <div className="p-6"><Loading /></div>;
  if (error) return <div className="p-6"><LoadError message={error} onRetry={reload} /></div>;
  if (!converter) {
    return (
      <div className="p-6">
        <LoadError message="피치·볼륨 변환기를 찾을 수 없습니다." onRetry={reload} />
      </div>
    );
  }

  const running = batch?.state === 'queued' || batch?.state === 'running';

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">영상(음원) 피치 & 볼륨 조절</h1>
          <p className="mt-1 text-sm text-slate-500">
            영상·음원의 피치와 볼륨을 조절합니다. 여러 파일을 한 번에 처리할 수 있습니다.
            {' 영상은 비디오를 유지한 채 오디오만 변환합니다.'}
          </p>
        </section>

        <Section title="조절 설정">
          <div className="space-y-4">
            <Field
              group
              label="입력 파일"
              hint={`지원: ${inputExts.join(', ')} · ${inputItems.length}개`}
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnClass}
                  disabled={busy || running}
                  onClick={() => void pickFiles()}
                >
                  파일 추가
                </button>
                {inputItems.length > 0 ? (
                  <button type="button" className={btnClass} onClick={clearPaths}>
                    목록 비우기
                  </button>
                ) : null}
              </div>
              {inputItems.length > 0 ? (
                <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                  {inputItems.map((item) => (
                    <li key={item.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white">
                      <span className="min-w-0 flex-1 truncate" title={item.path}>
                        {item.label}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-slate-500 hover:text-red-600"
                        onClick={() => removePath(item.path)}
                      >
                        제거
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 m-0 text-xs text-slate-400">
                  영상 또는 음원을 하나 이상 추가해 주세요.
                </p>
              )}
            </Field>

            <Field
              label="저장 폴더"
              hint="비워 두면 각 파일이 있는 폴더에 저장합니다. 폴더를 지정하면 모든 결과가 그곳으로 갑니다."
            >
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClass} min-w-[16rem] flex-1`}
                  value={outputDir}
                  placeholder={exportInfo?.defaultLabel || '각 파일이 있는 폴더'}
                  onChange={(event) => {
                    setOutputDir(event.target.value);
                    setOutputDirTouched(true);
                  }}
                />
                <button type="button" className={btnClass} onClick={() => void pickOutputDir()}>
                  폴더 선택
                </button>
                <button type="button" className={btnClass} onClick={() => void resetOutputDir()}>
                  기본값
                </button>
              </div>
            </Field>

            <Field label="피치" hint={pitchStageLabel(pitchStage)}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={btnClass}
                  disabled={pitchStage <= 0}
                  onClick={() => setPitchStage((prev) => Math.max(0, prev - 1))}
                >
                  −
                </button>
                <input
                  className="min-w-0 flex-1 accent-app-accent"
                  type="range"
                  min={0}
                  max={pitchMax}
                  step={1}
                  value={pitchStage}
                  onChange={(event) => setPitchStage(Number(event.target.value))}
                />
                <button
                  type="button"
                  className={btnClass}
                  disabled={pitchStage >= pitchMax}
                  onClick={() => setPitchStage((prev) => Math.min(pitchMax, prev + 1))}
                >
                  +
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pitchStages.map((stage) => (
                  <button
                    key={stage.stage}
                    type="button"
                    className={`${btnClass} !px-2 !py-1 text-xs ${
                      pitchStage === stage.stage ? '!bg-app-accent !text-white' : ''
                    }`}
                    onClick={() => setPitchStage(stage.stage)}
                  >
                    {stage.label}
                  </button>
                ))}
              </div>
            </Field>

            <ToggleRow
              label="볼륨 맞추기"
              hint="여러 파일의 체감 음량을 비슷한 크기로 맞춥니다. (라우드니스 정규화)"
              checked={normalizeLoudness}
              onChange={setNormalizeLoudness}
            />

            <Field
              label="볼륨"
              hint={
                normalizeLoudness
                  ? `맞춘 뒤 추가 조절 · ${volumePercentLabel(volume)}`
                  : `원본 대비 · ${volumePercentLabel(volume)}`
              }
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={btnClass}
                  disabled={volume <= VOLUME_MIN}
                  onClick={() => setVolume((prev) => Math.max(VOLUME_MIN, prev - VOLUME_STEP))}
                >
                  −
                </button>
                <input
                  className="min-w-0 flex-1 accent-app-accent"
                  type="range"
                  min={VOLUME_MIN}
                  max={VOLUME_MAX}
                  step={VOLUME_STEP}
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                />
                <button
                  type="button"
                  className={btnClass}
                  disabled={volume >= VOLUME_MAX}
                  onClick={() => setVolume((prev) => Math.min(VOLUME_MAX, prev + VOLUME_STEP))}
                >
                  +
                </button>
              </div>
            </Field>

            <Field label="출력 형식" hint="MP3로 저장하면 영상에서도 음원만 추출합니다.">
              <select
                className={inputClass}
                value={outputFormat}
                onChange={(event) => setOutputFormat(event.target.value === 'mp3' ? 'mp3' : 'same')}
              >
                <option value="same">원본과 같은 형식</option>
                <option value="mp3">MP3 (음원만)</option>
              </select>
            </Field>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={busy || running || inputItems.length === 0}
                onClick={() => void start()}
              >
                {running
                  ? '처리 중…'
                  : inputItems.length > 1
                    ? `${inputItems.length}개 시작`
                    : '변환 시작'}
              </button>
              {running ? (
                <button
                  type="button"
                  className={btnDangerClass}
                  disabled={stopping}
                  onClick={() => void cancel()}
                >
                  {stopping ? '중지 중…' : '전체 중지'}
                </button>
              ) : null}
            </div>
          </div>
        </Section>

        {batch ? (
          <Section title="진행 상태">
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={batchTone(batch.state)}>
                  {batch.state === 'done'
                    ? '완료'
                    : batch.state === 'error'
                      ? '일부/전체 실패'
                      : batch.state === 'cancelled'
                        ? '취소됨'
                        : `${Math.round((batch.progress || 0) * 100)}%`}
                </Badge>
                <span className="text-slate-500">
                  {batch.done ?? 0}/{batch.total ?? batch.jobs?.length ?? 0} 완료
                  {(batch.failed ?? 0) > 0 ? ` · 실패 ${batch.failed}` : ''}
                  {(batch.cancelled ?? 0) > 0 ? ` · 취소 ${batch.cancelled}` : ''}
                </span>
                {running ? (
                  <span className="ml-auto">
                    <button
                      type="button"
                      className={btnDangerClass}
                      disabled={stopping}
                      onClick={() => void cancel()}
                    >
                      {stopping ? '중지 중…' : '전체 중지'}
                    </button>
                  </span>
                ) : null}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-app-accent transition-[width] duration-300"
                  style={{ width: `${Math.round((batch.progress || 0) * 100)}%` }}
                />
              </div>

              <ul className="space-y-2">
                {(batch.jobs ?? []).map((job) => (
                  <li
                    key={job.id}
                    className="rounded-md border border-slate-200 bg-white px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={batchTone(job.state)}>{progressLabel(job)}</Badge>
                      <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={job.inputPath}>
                        {fileName(job.inputPath)}
                      </span>
                      {job.state === 'queued' || job.state === 'running' ? (
                        <button
                          type="button"
                          className={btnDangerClass}
                          disabled={stopping}
                          onClick={() => void stopJobs(job.id)}
                        >
                          중지
                        </button>
                      ) : null}
                      {job.state === 'done' && native?.showItemInFolder ? (
                        <button
                          type="button"
                          className={btnClass}
                          onClick={() => revealOutput(job.outputPath)}
                        >
                          보기
                        </button>
                      ) : null}
                    </div>
                    {job.state === 'running' || job.state === 'queued' ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-app-accent/80 transition-[width] duration-300"
                          style={{ width: `${Math.round((job.progress || 0) * 100)}%` }}
                        />
                      </div>
                    ) : null}
                    {job.error ? (
                      <p className="mt-1 m-0 text-xs text-red-600 whitespace-pre-wrap">{job.error}</p>
                    ) : job.state === 'done' ? (
                      <p className="mt-1 m-0 break-all text-xs text-slate-500">
                        <code className={codeClass}>{job.outputPath}</code>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
