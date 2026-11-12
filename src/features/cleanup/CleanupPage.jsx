import { useEffect, useMemo, useState } from 'react';
import InputDropZone from '../../components/common/InputDropZone.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { useReportJobRunning } from '../../context/JobActivityContext.jsx';
import { useJobProgressScroll } from '../../hooks/useJobProgressScroll.js';
import { useLoad } from '../../hooks/useLoad.js';
import { openExternalUrl } from '../../lib/openExternal.js';
import { collectPdfPasswords } from '../../lib/pdfPasswords.js';
import { TINY_PDF_EDITOR_URL } from '../../../shared/constants.js';
import RegionPreview from './RegionPreview.jsx';
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

function batchTone(state) {
  if (state === 'done') return 'green';
  if (state === 'error' || state === 'cancelled') return 'red';
  return 'amber';
}

/**
 * 정리 화면. `tool` 로 어떤 작업을 보여 줄지 정합니다.
 *  - `ebook-extract` : 이미지 자르기 & PDF 저장 (스크린샷에서 이북 영역 등을 추출)
 *  - `pdf-dedup`     : PDF 중복페이지 자동 정리
 *
 * @param {{ tool?: 'ebook-extract' | 'pdf-dedup', featureId?: string }} props
 */
export default function CleanupPage({ tool = 'ebook-extract', featureId } = {}) {
  const dialog = useDialog();
  const native = getNative();
  const { data, loading, error, reload } = useLoad(() => api('cleanup.tools'));

  const pageTitle = tool === 'pdf-dedup' ? 'PDF 중복페이지 자동 정리' : '이미지 자르기 & PDF 저장';
  // 저장 폴더는 화면(작업)마다 따로 기억합니다.
  const outputKey = tool === 'pdf-dedup' ? 'pdfDedupOutput' : 'cleanupOutput';
  const tools = data?.tools ?? [];
  /** @type {[{ key: string, label: string, path: string }[], Function]} */
  const [inputItems, setInputItems] = useState(/** @type {{ key: string, label: string, path: string }[]} */ ([]));
  const [outputDir, setOutputDir] = useState('');
  const [dedupMode, setDedupMode] = useState(/** @type {'consecutive' | 'global'} */ ('consecutive'));
  const [similarityPercent, setSimilarityPercent] = useState(99.9999);
  const [consecutiveImages, setConsecutiveImages] = useState(3);
  const [ebookSimilarity, setEbookSimilarity] = useState(99.9999);
  const [skipBlank, setSkipBlank] = useState(false);
  const [makePdf, setMakePdf] = useState(true);
  const [pdfName, setPdfName] = useState('');
  const [pdfQuality, setPdfQuality] = useState('jpeg90');
  /** @type {['auto' | 'manual', Function]} */
  const [cropMode, setCropMode] = useState(/** @type {'auto' | 'manual'} */ ('auto'));
  /** Manual region as ratios (0..1) of the image edges. */
  const [manualBox, setManualBox] = useState(/** @type {{ left: number, top: number, right: number, bottom: number } | null} */ (null));
  const [preview, setPreview] = useState(/** @type {any} */ (null));
  const [previewLoading, setPreviewLoading] = useState(false);
  const [job, setJob] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [includeSub, setIncludeSub] = useState(false);

  // Output folder: restored from the last run, and saved again whenever it changes.
  const [outputDirLoaded, setOutputDirLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    api('folders.get', { key: outputKey })
      .then((res) => {
        if (alive && res?.path) setOutputDir((current) => current || res.path);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setOutputDirLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!outputDirLoaded) return undefined;
    const timer = window.setTimeout(() => {
      void api('folders.set', { key: outputKey, path: outputDir.trim() }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [outputDir, outputDirLoaded]);

  const selected = useMemo(() => tools.find((t) => t.id === tool) ?? null, [tools, tool]);
  const isEbook = selected?.id === 'ebook-extract';
  const isPdf = selected?.id === 'pdf-dedup';
  const inputPaths = useMemo(() => inputItems.map((item) => item.path), [inputItems]);

  useEffect(() => {
    if (!selected?.inputExts?.length) return;
    const allowed = new Set(selected.inputExts.map((ext) => String(ext).toLowerCase()));
    setInputItems((prev) => prev.filter((item) => allowed.has(fileExt(item.path))));
  }, [selected?.id]);

  // 미리보기는 첫 이미지 기준이라 목록이 바뀌면 낡은 값이 됩니다.
  // 이미지 자르기 화면에서는 목록이 바뀔 때마다 영역 미리보기를 자동으로 다시 만듭니다.
  useEffect(() => {
    setPreview(null);
    if (!isEbook || inputPaths.length === 0) {
      setPreviewLoading(false);
      return undefined;
    }
    let alive = true;
    setPreviewLoading(true);
    api('cleanup.ebookPreview', { inputPaths })
      .then((res) => {
        if (alive) setPreview(res);
      })
      // 자동 불러오기 실패는 조용히 넘기고, "영역 미리보기" 버튼으로 다시 시도하게 둡니다.
      .catch(() => undefined)
      .finally(() => {
        if (alive) setPreviewLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isEbook, inputPaths.join('|')]);

  useEffect(() => {
    if (!job || (job.state !== 'queued' && job.state !== 'running')) return undefined;
    const timer = window.setInterval(() => {
      void api('cleanup.status', { jobId: job.id })
        .then((res) => setJob(res.job))
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.state]);

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

  const ingestPaths = async (paths) => {
    if (!paths?.length || !selected) return;
    try {
      const { files, skipped, truncated } = await api('files.inspect', {
        paths,
        recursive: includeSub,
        exts: selected.inputExts,
      });
      addPaths(files.map((file) => ({ path: file.path, label: file.name })));
      const notes = [];
      if (files.length === 0) {
        notes.push(`추가할 파일이 없습니다. (지원: ${selected.inputExts.join(', ')})`);
      }
      if (skipped > 0) notes.push(`지원하지 않는 항목 ${skipped}개는 제외했습니다.`);
      if (truncated) notes.push('파일이 너무 많아 일부만 가져왔습니다. (최대 20,000개)');
      if (notes.length > 0) void dialog.alert({ title: pageTitle, body: notes.join('\n') });
    } catch (err) {
      void dialog.alert({
        title: pageTitle,
        body: err instanceof Error ? err.message : '파일을 읽지 못했습니다.',
      });
    }
  };

  const pickFiles = async () => {
    if (!native?.pickOpenFiles || !selected) return;
    const result = await native.pickOpenFiles({
      memoryKey: isEbook ? 'ebookInput' : 'pdfInput',
      title: isEbook ? '이미지 선택 (여러 개 가능)' : 'PDF 선택 (여러 개 가능)',
      multi: true,
      filters: [
        {
          name: isEbook ? 'Images' : 'PDF',
          extensions: selected.inputExts.map((ext) => ext.replace(/^\./, '')),
        },
      ],
    });
    if (result?.canceled || !result?.paths?.length) return;
    addPaths(result.paths.map((p) => ({ path: p, label: fileName(p) })));
  };

  const addFolder = async () => {
    if (!native?.pickDirectory || !selected) return;
    const picked = await native.pickDirectory({
      memoryKey: isEbook ? 'ebookInput' : 'pdfInput',
      title: isEbook ? '이미지가 있는 폴더 선택' : 'PDF 가 있는 폴더 선택',
    });
    if (picked?.canceled || !picked?.path) return;
    await ingestPaths([picked.path]);
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
    const result = await native.pickDirectory({ memoryKey: outputKey });
    if (result?.canceled || !result?.path) return;
    setOutputDir(result.path);
  };

  const loadPreview = async () => {
    if (inputPaths.length === 0) return;
    setPreviewLoading(true);
    try {
      setPreview(await api('cleanup.ebookPreview', { inputPaths }));
    } catch (err) {
      void dialog.alert({
        title: pageTitle,
        body: err instanceof Error ? err.message : '미리보기를 만들지 못했습니다.',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const detectedEdges = preview
    ? {
        left: preview.detected.left,
        top: preview.detected.top,
        right: preview.detected.left + preview.detected.width,
        bottom: preview.detected.top + preview.detected.height,
      }
    : null;

  /** Edits one edge of the manual region (value in percent). */
  const setManualEdge = (edge, percent) => {
    const base = manualBox ?? detectedEdges ?? { left: 0.05, top: 0.1, right: 0.4, bottom: 0.9 };
    const value = Math.min(100, Math.max(0, Number(percent) || 0)) / 100;
    const next = { ...base, [edge]: value };
    const gap = 0.05;
    if (next.right - next.left < gap) {
      if (edge === 'left') next.left = next.right - gap;
      if (edge === 'right') next.right = next.left + gap;
    }
    if (next.bottom - next.top < gap) {
      if (edge === 'top') next.top = next.bottom - gap;
      if (edge === 'bottom') next.bottom = next.top + gap;
    }
    setManualBox({
      left: Math.max(0, next.left),
      top: Math.max(0, next.top),
      right: Math.min(1, next.right),
      bottom: Math.min(1, next.bottom),
    });
  };

  const chooseCropMode = (mode) => {
    setCropMode(mode);
    if (mode === 'manual' && !manualBox && detectedEdges) setManualBox(detectedEdges);
  };

  const start = async () => {
    if (!selected) return;
    if (inputPaths.length === 0) {
      void dialog.alert({ title: pageTitle, body: '입력 파일을 선택해 주세요.' });
      return;
    }
    if (isEbook && cropMode === 'manual' && !manualBox) {
      void dialog.alert({
        title: pageTitle,
        body: '수동 영역이 지정되지 않았습니다. "영역 미리보기"를 눌러 이미지에서 영역을 드래그하세요.',
      });
      return;
    }
    setBusy(true);
    try {
      let runPaths = inputPaths;
      /** @type {Record<string, string>} */
      let passwords = {};
      if (isPdf) {
        const unlocked = await collectPdfPasswords(inputPaths, dialog);
        if (unlocked.cancelled) return;
        if (unlocked.paths.length === 0) {
          void dialog.alert({ title: pageTitle, body: '처리할 PDF가 없습니다.' });
          return;
        }
        runPaths = unlocked.paths;
        passwords = unlocked.passwords;
      }

      const options = isEbook
        ? {
            consecutiveImages,
            similarityPercent: ebookSimilarity,
            skipBlank,
            makePdf,
            pdfName: pdfName.trim(),
            pdfQuality,
            manualCrop:
              cropMode === 'manual' && manualBox
                ? {
                    left: manualBox.left,
                    top: manualBox.top,
                    width: manualBox.right - manualBox.left,
                    height: manualBox.bottom - manualBox.top,
                  }
                : null,
          }
        : { mode: dedupMode, similarityPercent, passwords };
      const res = await api('cleanup.start', {
        kind: selected.id,
        inputPaths: runPaths,
        outputDir: outputDir.trim(),
        options,
      });
      setJob(res.job);
      if (res.job?.id) {
        const status = await api('cleanup.status', { jobId: res.job.id });
        setJob(status.job);
      }
    } catch (err) {
      void dialog.alert({
        title: pageTitle,
        body: err instanceof Error ? err.message : '작업을 시작하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job?.id) return;
    setStopping(true);
    try {
      const { job: next } = await api('cleanup.cancel', { jobId: job.id });
      setJob(next);
    } catch (err) {
      void dialog.alert({
        title: pageTitle,
        body: err instanceof Error ? err.message : '중지하지 못했습니다.',
      });
    } finally {
      setStopping(false);
    }
  };

  const running = job?.state === 'queued' || job?.state === 'running';
  useReportJobRunning(
    featureId,
    running,
    tool === 'pdf-dedup' ? 'PDF 정리 중' : '이미지 정리 중',
  );
  const progressFollowKey = job
    ? `${job.state}:${job.progress}:${Array.isArray(job.logs) ? job.logs.length : 0}:${Array.isArray(job.result?.items) ? job.result.items.length : 0}`
    : '';
  const { sectionRef: progressSectionRef, logRef: progressLogRef } = useJobProgressScroll({
    active: Boolean(job),
    followKey: progressFollowKey,
  });

  if (loading && !data) return <div className="p-6"><Loading /></div>;
  if (error) return <div className="p-6"><LoadError message={error} onRetry={reload} /></div>;

  const pdfItems = job?.result?.kind === 'pdf-dedup' ? job.result.items ?? [] : [];

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{pageTitle}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isPdf
              ? 'PDF 에서 비슷한 페이지를 찾아 제거합니다. 여러 PDF 를 한 번에 처리할 수 있습니다.'
              : '스크린샷 같은 이미지에서 특정 영역(예: 이북 화면)을 자동으로 잘라 내고, 연속된 유사 이미지는 제외합니다. 원하면 PDF 로 합칠 수 있습니다.'}
          </p>
          {isPdf ? (
            <p className="mt-1.5 text-sm text-slate-500">
              페이지 순서·합치기·서명 등 편집은{' '}
              <button
                type="button"
                className="font-medium text-app-accent hover:underline"
                onClick={() => void openExternalUrl(TINY_PDF_EDITOR_URL)}
              >
                Tiny PDF Editor
              </button>
              를 사용하세요.
            </p>
          ) : null}
        </section>

        <Section title="작업 설정">
          <div className="space-y-4">

            <Field
              group
              label="입력 파일"
              hint={
                selected
                  ? `지원: ${selected.inputExts.join(', ')} · 폴더 추가 시 하위 폴더 ${includeSub ? '포함' : '제외'} · ${inputItems.length}개`
                  : undefined
              }
            >
              <InputDropZone
                disabled={busy || running || !selected}
                emptyHint="놓으면 목록에 추가됩니다"
                onUnsupported={() =>
                  void dialog.alert({
                    title: pageTitle,
                    body: '파일 끌어놓기를 쓰려면 앱을 다시 시작해 주세요. (파일·폴더 추가 버튼은 바로 사용할 수 있습니다)',
                  })
                }
                onPaths={(paths) => void ingestPaths(paths)}
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
                  <button
                    type="button"
                    className={btnClass}
                    disabled={busy || running}
                    onClick={() => void addFolder()}
                  >
                    폴더 추가
                  </button>
                  {inputItems.length > 0 ? (
                    <button type="button" className={btnClass} onClick={clearPaths}>
                      목록 비우기
                    </button>
                  ) : null}
                </div>
                <div className="mt-2">
                  <ToggleRow
                    label="폴더 추가 시 하위 폴더 포함"
                    hint="켜면 선택한 폴더 아래의 모든 하위 폴더에서도 파일을 모읍니다. 끌어다 놓기에도 적용됩니다."
                    checked={includeSub}
                    onChange={setIncludeSub}
                    disabled={busy || running}
                  />
                </div>
                {inputItems.length > 0 ? (
                  <ul className="mt-3 max-h-48 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                    {inputItems.map((item, index) => (
                      <li key={item.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white">
                        {isEbook ? <span className="w-5 shrink-0 text-xs text-slate-400">{index + 1}</span> : null}
                        <span className="min-w-0 flex-1 truncate" title={item.path}>
                          {item.label}
                        </span>
                        {isEbook ? (
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
                    {isEbook
                      ? '스크린샷 이미지를 추가하거나, 파일·폴더를 끌어다 놓으세요.'
                      : 'PDF 파일을 추가하거나, 파일·폴더를 끌어다 놓으세요.'}
                  </p>
                )}
              </InputDropZone>
            </Field>

            <Field
              label="저장 폴더"
              hint={
                isEbook
                  ? '비워 두면 첫 이미지가 있는 폴더에 ebook_날짜 폴더를 만들고 output/(PNG 결과), duplicated/(중복)로 저장합니다. PDF 합치기를 켜면 PDF도 이 폴더에 만듭니다.'
                  : '비워 두면 각 PDF가 있는 폴더에 저장합니다.'
              }
            >
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClass} min-w-[16rem] flex-1`}
                  value={outputDir}
                  placeholder={isPdf ? '각 PDF가 있는 폴더' : '첫 이미지가 있는 폴더'}
                  onChange={(event) => setOutputDir(event.target.value)}
                />
                <button type="button" className={btnClass} onClick={() => void pickOutputDir()}>
                  폴더 선택
                </button>
                <button type="button" className={btnClass} onClick={() => setOutputDir('')}>
                  기본값
                </button>
              </div>
            </Field>

            {isEbook ? (
              <Field
                group
                label="자르기 영역"
                hint="여러 장에서 감지한 영역의 합의 결과를 모든 이미지에 같은 비율로 적용합니다. 자동 감지가 어긋나면 수동으로 지정하세요."
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="crop-mode"
                        checked={cropMode === 'auto'}
                        onChange={() => chooseCropMode('auto')}
                      />
                      자동 감지
                    </label>
                    <label className="inline-flex items-center gap-1.5">
                      <input
                        type="radio"
                        name="crop-mode"
                        checked={cropMode === 'manual'}
                        onChange={() => chooseCropMode('manual')}
                      />
                      수동 지정
                    </label>
                    <button
                      type="button"
                      className={btnClass}
                      disabled={inputItems.length === 0 || previewLoading || busy || running}
                      onClick={() => void loadPreview()}
                    >
                      {previewLoading ? '분석 중…' : '영역 미리보기'}
                    </button>
                  </div>

                  {preview ? (
                    <div className="space-y-2">
                      <RegionPreview
                        src={preview.previewDataUrl}
                        box={cropMode === 'manual' ? manualBox : detectedEdges}
                        editable
                        allowDraw={cropMode === 'manual'}
                        onChange={(next) => {
                          // Touching the outline in auto mode switches to manual, starting from the detected region.
                          setCropMode('manual');
                          setManualBox(next);
                        }}
                      />
                      <p className="m-0 text-xs text-slate-500">
                        {cropMode === 'manual'
                          ? (
                              <>
                                테두리·모서리를 끌어 크기를, 안쪽을 끌어 위치를 조절하고, 바깥을 끌면 새로 그립니다.
                                <br />
                                (첫 번째 이미지 기준, 모든 이미지에 같은 비율로 적용)
                              </>
                            )
                          : preview.method === 'fallback'
                            ? '자동 감지에 실패해 기본 비율 영역을 보여 줍니다. 수동 지정을 권장합니다.'
                            : `${preview.sampled}장 중 ${preview.detectedCount}장에서 감지, ${preview.agreed}장 일치${
                                preview.agreed < Math.ceil(preview.detectedCount / 2) ? ' — 일치도가 낮습니다. 수동 지정을 권장합니다.' : ''
                              } · 테두리를 끌면 수동으로 조절합니다.`}
                      </p>
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-slate-400">
                      {previewLoading
                        ? '첫 이미지와 감지된 영역을 분석하는 중입니다…'
                        : inputItems.length === 0
                          ? '이미지를 추가하면 첫 이미지와 감지된 영역이 자동으로 표시됩니다.'
                          : '"영역 미리보기"를 누르면 첫 이미지와 감지된 영역을 확인할 수 있습니다.'}
                    </p>
                  )}

                  {cropMode === 'manual' ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ['left', '왼쪽'],
                        ['top', '위'],
                        ['right', '오른쪽'],
                        ['bottom', '아래'],
                      ].map(([edge, label]) => (
                        <label key={edge} className="text-xs text-slate-500">
                          {label} (%)
                          <input
                            className={`${inputClass} mt-1 w-full`}
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={manualBox ? Math.round(manualBox[edge] * 1000) / 10 : ''}
                            placeholder="-"
                            onChange={(event) => setManualEdge(edge, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Field>
            ) : null}

            {isPdf ? (
              <>
                <Field label="중복 기준">
                  <select
                    className={inputClass}
                    value={dedupMode}
                    onChange={(event) =>
                      setDedupMode(event.target.value === 'global' ? 'global' : 'consecutive')
                    }
                  >
                    <option value="consecutive">연속된 페이지만</option>
                    <option value="global">문서 전체</option>
                  </select>
                </Field>
                <Field label="유사도 (%)" hint="기본 99.9999 — 이 값 이상이면 중복으로 봅니다.">
                  <input
                    className={inputClass}
                    type="number"
                    min={90}
                    max={100}
                    step={0.0001}
                    value={similarityPercent}
                    onChange={(event) => setSimilarityPercent(Number(event.target.value))}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="연속 비교 개수" hint="기본 3 — 최근 N개 crop 결과와만 비교합니다.">
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={50}
                    value={consecutiveImages}
                    onChange={(event) => setConsecutiveImages(Number(event.target.value))}
                  />
                </Field>
                <Field
                  label="유사도 (%)"
                  hint="기본 99.9999 — 변경된 픽셀이 (100 − 값)% 이하이고 한 곳에 몰린 변화가 없으면 중복으로 봅니다. 문장 하나만 달라도 구분하려면 값을 높이세요."
                >
                  <input
                    className={inputClass}
                    type="number"
                    min={90}
                    max={100}
                    step={0.0001}
                    value={ebookSimilarity}
                    onChange={(event) => setEbookSimilarity(Number(event.target.value))}
                  />
                </Field>
                <ToggleRow
                  label="빈 화면 제외"
                  hint="한 가지 색으로만 채워진 이미지(페이지 넘김 중 빈 프레임 등)를 결과에서 빼고 blank/ 폴더에 따로 둡니다."
                  checked={skipBlank}
                  onChange={setSkipBlank}
                />
                <ToggleRow
                  label="결과를 PDF로 합치기"
                  hint="추출된 페이지를 순서대로 한 PDF 파일로 만듭니다. PNG 파일(output/ 폴더)은 그대로 남습니다."
                  checked={makePdf}
                  onChange={setMakePdf}
                />
                {makePdf ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="PDF 파일 이름" hint="비워 두면 output.pdf">
                      <input
                        className={inputClass}
                        type="text"
                        placeholder="output.pdf"
                        value={pdfName}
                        onChange={(event) => setPdfName(event.target.value)}
                      />
                    </Field>
                    <Field
                      label="PDF 화질"
                      hint="JPEG 는 100% 여도 손실 압축이라 PNG 와 같지 않지만 용량이 훨씬 작습니다. PNG 는 무손실이라 용량이 가장 큽니다."
                    >
                      <select
                        className={inputClass}
                        value={pdfQuality}
                        onChange={(event) => setPdfQuality(event.target.value)}
                      >
                        <option value="jpeg100">JPEG 100% (최고 화질)</option>
                        <option value="jpeg90">JPEG 90% (권장)</option>
                        <option value="jpeg80">JPEG 80%</option>
                        <option value="jpeg70">JPEG 70% (용량 작음)</option>
                        <option value="png">PNG 원본 (무손실)</option>
                      </select>
                    </Field>
                  </div>
                ) : null}
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={busy || running || inputItems.length === 0}
                onClick={() => void start()}
              >
                {running ? '처리 중…' : '시작'}
              </button>
              {running ? (
                <button
                  type="button"
                  className={btnDangerClass}
                  disabled={stopping}
                  onClick={() => void cancel()}
                >
                  {stopping ? '중지 중…' : '중지'}
                </button>
              ) : null}
            </div>
          </div>
        </Section>

        {job ? (
          <div ref={progressSectionRef}>
            <Section title="진행 상태">
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={batchTone(job.state)}>
                    {job.state === 'done'
                      ? '완료'
                      : job.state === 'error'
                        ? '실패'
                        : job.state === 'cancelled'
                          ? '취소됨'
                          : `${Math.round((job.progress || 0) * 100)}%`}
                  </Badge>
                  <span className="text-slate-500">{job.label}</span>
                  {running ? (
                    <span className="ml-auto">
                      <button
                        type="button"
                        className={btnDangerClass}
                        disabled={stopping}
                        onClick={() => void cancel()}
                      >
                        {stopping ? '중지 중…' : '중지'}
                      </button>
                    </span>
                  ) : null}
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-app-accent transition-[width] duration-300"
                    style={{ width: `${Math.round((job.progress || 0) * 100)}%` }}
                  />
                </div>

                {job.error ? (
                  <p className="m-0 text-xs text-red-600 whitespace-pre-wrap">{job.error}</p>
                ) : null}

                {job.state === 'done' && job.result?.kind === 'ebook-extract' ? (
                  <div className="space-y-2">
                    <p className="m-0 text-xs text-slate-500">
                      출력 {job.result.outputCount}개
                      {job.result.duplicateCount ? ` · 중복 제외 ${job.result.duplicateCount}개` : ''}
                      {job.result.blankCount ? ` · 빈 화면 제외 ${job.result.blankCount}개` : ''}
                      {' · '}
                      <code className={codeClass}>{job.outputPath}</code>
                    </p>
                    {job.result.pdfPath ? (
                      <p className="m-0 text-xs text-slate-500">
                        PDF: <code className={codeClass}>{fileName(job.result.pdfPath)}</code>
                      </p>
                    ) : null}
                    {native?.showItemInFolder ? (
                      <div className="flex flex-wrap gap-2 pt-2">
                        {job.result.pdfPath ? (
                          <button
                            type="button"
                            className={btnClass}
                            onClick={() => void native.showItemInFolder(job.result.pdfPath)}
                          >
                            PDF 보기
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={btnClass}
                          onClick={() => void native.showItemInFolder(job.result.pagesDir || job.outputPath)}
                        >
                          폴더 보기
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {pdfItems.length > 0 ? (
                  <ul className="space-y-2">
                    {pdfItems.map((item) => (
                      <li key={item.inputPath} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={item.unchanged ? 'green' : item.outputPath ? 'green' : 'amber'}>
                            {item.unchanged ? '변경 없음' : item.outputPath ? '처리됨' : '결과 없음'}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate font-medium">{fileName(item.inputPath)}</span>
                          {item.outputPath ? (
                            <>
                              {native?.showItemInFolder ? (
                                <button
                                  type="button"
                                  className={btnClass}
                                  onClick={() => void native.showItemInFolder(item.outputPath)}
                                >
                                  보기
                                </button>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                        <p className="mt-1 m-0 text-xs text-slate-500">
                          {item.pagesBefore}→{item.pagesAfter}쪽
                          {item.removedCount ? ` · 제거 ${item.removedCount}` : ''}
                          {item.outputPath ? (
                            <>
                              {' · '}
                              <code className={codeClass}>{item.outputPath}</code>
                            </>
                          ) : null}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {job.logs?.length ? (
                  <pre
                    ref={progressLogRef}
                    className="max-h-56 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap"
                  >
                    {job.logs.join('\n')}
                  </pre>
                ) : null}
              </div>
            </Section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
