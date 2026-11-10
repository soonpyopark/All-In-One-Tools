import { useEffect, useMemo, useState } from 'react';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { useLoad } from '../../hooks/useLoad.js';
import {
  DEFAULT_SIZE_PRESET_ID,
  estimateGifBytes,
  formatOriginalPercentLabel,
  matchSizePreset,
} from '../../../shared/sizePresets.js';
import {
  Badge,
  Field,
  LoadError,
  Loading,
  Section,
  btnClass,
  btnDangerClass,
  btnPrimaryClass,
  codeClass,
  inputClass,
} from '../../components/settings/ui.jsx';

function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function fileExt(filePath) {
  const base = fileName(filePath);
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx).toLowerCase() : '';
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

/**
 * 변환 화면. `mode` 로 어떤 변환을 보여 줄지 정합니다.
 *  - `gif`   : Movie2GIF 변환 (동영상 → GIF)
 *  - `merge` : GIF 이어붙이기 (여러 GIF → 하나의 GIF)
 *
 * @param {{ mode?: 'gif' | 'merge' }} props
 */
export default function ConvertPage({ mode = 'gif' }) {
  const dialog = useDialog();
  const native = getNative();
  const { data, loading, error, reload } = useLoad(() => api('convert.listConverters'));
  const {
    data: exportInfo,
    reload: reloadExportInfo,
  } = useLoad(() => api('convert.exportDir'));

  const converters = useMemo(
    () =>
      (data?.converters ?? []).filter((c) => {
        if (c.optionProfile === 'pitch-volume') return false;
        const isMerge = c.optionProfile === 'merge-gifs' || c.jobMode === 'merge';
        return mode === 'merge' ? isMerge : !isMerge;
      }),
    [data, mode],
  );
  const [converterId, setConverterId] = useState('');
  /** @type {[{ key: string, label: string, path: string }[], Function]} */
  const [inputItems, setInputItems] = useState(/** @type {{ key: string, label: string, path: string }[]} */ ([]));
  const [outputDir, setOutputDir] = useState('');
  const [outputDirTouched, setOutputDirTouched] = useState(false);
  const [presetId, setPresetId] = useState(DEFAULT_SIZE_PRESET_ID);
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(480);
  const [startSec, setStartSec] = useState(0);
  const [durationSec, setDurationSec] = useState('');
  const [mergeSpeed, setMergeSpeed] = useState(1);
  const [batch, setBatch] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sizeEstimate, setSizeEstimate] = useState(/** @type {any} */ (null));
  const [estimateLoading, setEstimateLoading] = useState(false);

  const inputPaths = useMemo(() => inputItems.map((item) => item.path), [inputItems]);

  const durationOpt = String(durationSec).trim() === '' ? null : Number(durationSec);

  // Prefill with saved custom folder; leave blank for "each video's folder" default.
  useEffect(() => {
    if (!exportInfo || outputDirTouched) return;
    setOutputDir(exportInfo.exportDir || '');
  }, [exportInfo, outputDirTouched]);

  useEffect(() => {
    if (!converterId && converters[0]) setConverterId(converters[0].id);
  }, [converters, converterId]);

  const selected = useMemo(
    () => converters.find((c) => c.id === converterId) ?? converters[0] ?? null,
    [converters, converterId],
  );

  const isMergeProfile = selected?.optionProfile === 'merge-gifs' || selected?.jobMode === 'merge';
  const isGifProfile = !isMergeProfile;
  const presets = selected?.sizePresets ?? [];
  const minInputs = Math.max(1, Number(selected?.minInputs) || 1);

  // Drop files that the newly selected converter cannot accept.
  useEffect(() => {
    if (!selected?.inputExts?.length) return;
    const allowed = new Set(selected.inputExts.map((ext) => String(ext).toLowerCase()));
    setInputItems((prev) => prev.filter((item) => allowed.has(fileExt(item.path))));
  }, [selected?.id]);

  // Sample-encode based size estimate (video→GIF only, debounced).
  useEffect(() => {
    if (!isGifProfile || inputPaths.length === 0) {
      setSizeEstimate(null);
      setEstimateLoading(false);
      return undefined;
    }
    let cancelled = false;
    setEstimateLoading(true);
    setSizeEstimate(null);
    const timer = window.setTimeout(() => {
      void api('convert.estimateSize', {
        paths: inputPaths,
        options: {
          fps,
          width,
          startSec,
          durationSec: durationOpt,
        },
      })
        .then((res) => {
          if (cancelled) return;
          setSizeEstimate(res?.ok ? res : null);
        })
        .catch(() => {
          if (!cancelled) setSizeEstimate(null);
        })
        .finally(() => {
          if (!cancelled) setEstimateLoading(false);
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isGifProfile, inputPaths.join('\0'), fps, width, startSec, durationOpt]);

  useEffect(() => {
    if (!selected) return;
    if (isMergeProfile) {
      setFps(Number(selected.defaultOptions?.fps ?? 10));
      setMergeSpeed(Number(selected.defaultOptions?.speed ?? 1));
      return;
    }
    const id = selected.defaultPresetId ?? DEFAULT_SIZE_PRESET_ID;
    const preset = presets.find((p) => p.id === id) ?? presets[0];
    if (preset) {
      setPresetId(preset.id);
      setFps(preset.fps);
      setWidth(preset.width);
    } else if (selected.defaultOptions) {
      setPresetId('custom');
      setFps(selected.defaultOptions.fps ?? 10);
      setWidth(selected.defaultOptions.width ?? 480);
    }
    setStartSec(selected.defaultOptions?.startSec ?? 0);
    setDurationSec(
      selected.defaultOptions?.durationSec == null ? '' : String(selected.defaultOptions.durationSec),
    );
  }, [selected?.id]);

  useEffect(() => {
    if (!batch || (batch.state !== 'queued' && batch.state !== 'running')) return undefined;
    const timer = window.setInterval(() => {
      void api('convert.status', { batchId: batch.batchId })
        .then((res) => setBatch(res.batch))
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [batch?.batchId, batch?.state]);

  const applyPreset = (id) => {
    if (id === 'custom') {
      setPresetId('custom');
      return;
    }
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setPresetId(preset.id);
    setFps(preset.fps);
    setWidth(preset.width);
  };

  const onFpsChange = (value) => {
    const next = Number(value);
    setFps(next);
    const matched = matchSizePreset(next, width);
    setPresetId(matched?.id ?? 'custom');
  };

  const onWidthChange = (value) => {
    const next = Number(value);
    setWidth(next);
    const matched = matchSizePreset(fps, next);
    setPresetId(matched?.id ?? 'custom');
  };

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

  const pickVideos = async () => {
    if (!native?.pickOpenFiles) return;
    const filters = selected
      ? [
          {
            name: isMergeProfile ? 'GIF' : 'Video',
            extensions: selected.inputExts.map((ext) => ext.replace(/^\./, '')),
          },
        ]
      : [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm'] }];
    const result = await native.pickOpenFiles({
      memoryKey: 'convertInput',
      title: isMergeProfile ? 'GIF 선택 (여러 개 가능)' : '동영상 선택 (여러 개 가능)',
      multi: true,
      filters,
    });
    if (result?.canceled || !result?.paths?.length) return;
    addPaths(result.paths.map((p) => ({ path: p, label: fileName(p) })));
  };

  const removePath = (target) => {
    setInputItems((prev) => prev.filter((item) => item.path !== target));
  };

  const clearPaths = () => setInputItems([]);

  const movePath = (target, direction) => {
    setInputItems((prev) => {
      const index = prev.findIndex((item) => item.path === target);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const pickOutputDir = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory({ memoryKey: 'convertOutput' });
    if (result?.canceled || !result?.path) return;
    setOutputDir(result.path);
    setOutputDirTouched(true);
    try {
      await api('convert.setExportDir', { exportDir: result.path });
      void reloadExportInfo();
    } catch {
      // still use the chosen path for this session even if save fails
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
        title: '변환',
        body: err instanceof Error ? err.message : '기본값으로 되돌리지 못했습니다.',
      });
    }
  };

  const start = async () => {
    if (!selected) return;
    if (inputPaths.length === 0) {
      void dialog.alert({
        title: '변환',
        body: isMergeProfile ? '합칠 GIF 파일을 선택해 주세요.' : '입력 동영상 파일을 선택해 주세요.',
      });
      return;
    }
    if (isMergeProfile && inputPaths.length < minInputs) {
      void dialog.alert({
        title: '변환',
        body: `이어붙이려면 GIF를 최소 ${minInputs}개 선택해 주세요.`,
      });
      return;
    }
    const folder = outputDir.trim();
    setBusy(true);
    try {
      // Empty = default (each video's folder). Non-empty = remember custom folder.
      await api('convert.setExportDir', { exportDir: folder });

      const durationValue = String(durationSec).trim();
      const options = isMergeProfile
        ? { fps, speed: mergeSpeed }
        : {
            fps,
            width,
            startSec,
            durationSec: durationValue === '' ? null : Number(durationValue),
          };
      const res = await api('convert.start', {
        converterId: selected.id,
        inputPaths,
        outputDir: folder,
        options,
      });
      setBatch(res.batch ?? { batchId: res.batchId, jobs: res.jobs, state: 'queued', progress: 0 });
      if (res.batchId) {
        const status = await api('convert.status', { batchId: res.batchId });
        setBatch(status.batch);
      }
      void reloadExportInfo();
    } catch (err) {
      void dialog.alert({
        title: '변환',
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
        title: '변환',
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

  const running = batch?.state === 'queued' || batch?.state === 'running';
  const selectedPreset = presets.find((p) => p.id === presetId);

  const presetPercentLabel = (presetFps, presetWidth) => {
    if (!sizeEstimate?.ok || !sizeEstimate.estimatedBytes || !sizeEstimate.originalBytes) return '';
    const currentScore = estimateGifBytes({
      fps,
      width,
      durationSec: 1,
      sourceWidth: width,
      sourceHeight: Math.round(width * 0.75),
    });
    const presetScore = estimateGifBytes({
      fps: presetFps,
      width: presetWidth,
      durationSec: 1,
      sourceWidth: width,
      sourceHeight: Math.round(width * 0.75),
    });
    if (currentScore <= 0 || presetScore <= 0) return '';
    const scaled = Math.round((sizeEstimate.estimatedBytes * presetScore) / currentScore);
    return formatOriginalPercentLabel({
      estimatedBytes: scaled,
      originalBytes: sizeEstimate.originalBytes,
    });
  };

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">
            {isMergeProfile ? 'GIF 이어붙이기' : 'Movie2GIF 변환'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isMergeProfile
              ? '여러 GIF를 순서대로 이어 붙여 하나의 GIF로 만듭니다.'
              : '여러 동영상을 한 번에 선택해 GIF로 변환할 수 있습니다.'}
            {isMergeProfile
              ? ' 목록 순서가 재생 순서입니다.'
              : ' 용량 프리셋으로 FPS·너비를 맞출 수 있습니다.'}
          </p>
        </section>

        <Section title="변환 설정">
          <div className="space-y-4">
            {/* 화면(모드)마다 변환 종류가 하나뿐이면 선택 상자 없이 설명만 보여 줍니다. */}
            {converters.length > 1 ? (
              <Field label="변환 종류">
                <select
                  className={inputClass}
                  value={selected?.id ?? ''}
                  onChange={(event) => setConverterId(event.target.value)}
                >
                  {converters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {selected?.description ? (
                  <p className="m-0 mt-1 text-xs text-slate-500">{selected.description}</p>
                ) : null}
              </Field>
            ) : selected?.description ? (
              <p className="m-0 text-xs text-slate-500">{selected.description}</p>
            ) : null}

            <Field
              group
              label="입력 파일"
              hint={
                selected
                  ? `지원: ${selected.inputExts.join(', ')} · ${inputItems.length}개`
                  : undefined
              }
            >
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnClass}
                  disabled={busy || running}
                  onClick={() => void pickVideos()}
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
                  {inputItems.map((item, index) => (
                    <li key={item.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white">
                      {isMergeProfile ? (
                        <span className="w-5 shrink-0 text-xs text-slate-400">{index + 1}</span>
                      ) : null}
                      <span className="min-w-0 flex-1 truncate" title={item.path}>
                        {item.label}
                      </span>
                      {isMergeProfile ? (
                        <>
                          <button
                            type="button"
                            className="shrink-0 text-xs text-slate-500 hover:text-slate-800"
                            disabled={index === 0}
                            onClick={() => movePath(item.path, -1)}
                          >
                            위로
                          </button>
                          <button
                            type="button"
                            className="shrink-0 text-xs text-slate-500 hover:text-slate-800"
                            disabled={index === inputItems.length - 1}
                            onClick={() => movePath(item.path, 1)}
                          >
                            아래로
                          </button>
                        </>
                      ) : null}
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
                  {isMergeProfile
                    ? `GIF를 ${minInputs}개 이상 추가해 주세요.`
                    : '동영상을 하나 이상 추가해 주세요.'}
                </p>
              )}
            </Field>

            <Field
              label="저장 폴더"
              hint={
                isMergeProfile
                  ? '비워 두면 첫 번째 GIF가 있는 폴더에 저장합니다. 폴더를 지정하면 그곳으로 갑니다.'
                  : '비워 두면 각 영상이 있는 폴더에 저장합니다. 폴더를 지정하면 모든 결과가 그곳으로 갑니다.'
              }
            >
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClass} min-w-[16rem] flex-1`}
                  value={outputDir}
                  placeholder={
                    isMergeProfile
                      ? '첫 번째 GIF가 있는 폴더'
                      : exportInfo?.defaultLabel || '각 영상이 있는 폴더'
                  }
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

            {isMergeProfile ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="FPS" hint="합친 GIF의 초당 프레임">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={60}
                    step={1}
                    value={fps}
                    onChange={(event) => setFps(Number(event.target.value))}
                  />
                </Field>
                <Field label="배속" hint="1=원속, 2=2배 빠름, 0.5=절반 속도">
                  <input
                    className={inputClass}
                    type="number"
                    min={0.1}
                    max={8}
                    step={0.1}
                    value={mergeSpeed}
                    onChange={(event) => setMergeSpeed(Number(event.target.value))}
                  />
                </Field>
              </div>
            ) : (
              <>
                <Field
                  label="용량 프리셋"
                  hint={
                    presetId === 'custom'
                      ? 'FPS·너비를 직접 수정한 사용자 지정 값입니다.'
                      : selectedPreset?.hint
                  }
                >
                  <select
                    className={inputClass}
                    value={presetId}
                    onChange={(event) => applyPreset(event.target.value)}
                  >
                    {presets.map((p) => {
                      const pctLabel = presetPercentLabel(p.fps, p.width);
                      return (
                        <option key={p.id} value={p.id}>
                          {p.label} (FPS {p.fps} · {p.width}px
                          {pctLabel ? ` · ${pctLabel}` : ''})
                        </option>
                      );
                    })}
                    <option value="custom">사용자 지정</option>
                  </select>
                  {estimateLoading ? (
                    <p className="m-0 mt-2 text-xs text-slate-500">
                      용량 추정 중… (15초 이하면 전체 인코딩으로 정확히 측정)
                    </p>
                  ) : sizeEstimate?.label ? (
                    <p className="m-0 mt-2 text-xs text-slate-600">
                      원본 대비 예상: <strong>{sizeEstimate.label}</strong>
                      <span className="text-slate-400">
                        {sizeEstimate.method === 'sample-exact'
                          ? ' — 전체 구간 실측'
                          : sizeEstimate.method === 'sample'
                            ? ' — 중간 구간 샘플 + 보정 환산'
                            : ' — 공식 추정(샘플 실패 시)'}
                        {sizeEstimate.method === 'sample-exact' ? '' : ', 실제와 다를 수 있음'}
                      </span>
                    </p>
                  ) : inputItems.length > 0 ? (
                    <p className="m-0 mt-2 text-xs text-slate-400">
                      용량 추정을 계산하지 못했습니다.
                    </p>
                  ) : (
                    <p className="m-0 mt-2 text-xs text-slate-400">
                      파일을 선택하면 짧은 샘플 변환으로 원본 대비 예상 용량을 표시합니다.
                    </p>
                  )}
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="FPS">
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={30}
                      value={fps}
                      onChange={(event) => onFpsChange(event.target.value)}
                    />
                  </Field>
                  <Field label="너비 (px)">
                    <input
                      className={inputClass}
                      type="number"
                      min={32}
                      max={1920}
                      value={width}
                      onChange={(event) => onWidthChange(event.target.value)}
                    />
                  </Field>
                  <Field label="시작 (초)">
                    <input
                      className={inputClass}
                      type="number"
                      min={0}
                      step={0.1}
                      value={startSec}
                      onChange={(event) => setStartSec(Number(event.target.value))}
                    />
                  </Field>
                  <Field label="길이 (초, 비우면 전체)">
                    <input
                      className={inputClass}
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={durationSec}
                      placeholder="전체"
                      onChange={(event) => setDurationSec(event.target.value)}
                    />
                  </Field>
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={
                  busy ||
                  running ||
                  inputItems.length === 0 ||
                  (isMergeProfile && inputItems.length < minInputs)
                }
                onClick={() => void start()}
              >
                {running
                  ? '변환 중…'
                  : isMergeProfile
                    ? `${inputItems.length}개 이어붙이기`
                    : inputItems.length > 1
                      ? `${inputItems.length}개 변환 시작`
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
                      <span
                        className="min-w-0 flex-1 truncate font-medium text-slate-800"
                        title={(job.inputPaths?.length ? job.inputPaths : [job.inputPath]).join('\n')}
                      >
                        {job.inputPaths?.length > 1
                          ? `${fileName(job.inputPath)} 외 ${job.inputPaths.length - 1}개`
                          : fileName(job.inputPath)}
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
