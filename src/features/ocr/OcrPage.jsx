import { useEffect, useMemo, useState } from 'react';
import InputDropZone from '../../components/common/InputDropZone.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { useReportJobRunning } from '../../context/JobActivityContext.jsx';
import { useJobProgressScroll } from '../../hooks/useJobProgressScroll.js';
import { collectPdfPasswords } from '../../lib/pdfPasswords.js';
import { OCR_IMAGE_EXTS, OCR_INPUT_EXTS } from '../../../shared/ocrInputs.js';
import {
  DEFAULT_OCR_LANGUAGE_IDS,
  OCR_LANGUAGE_OPTIONS,
} from '../../../shared/ocrLanguages.js';
import {
  Badge,
  Field,
  Section,
  ToggleRow,
  btnClass,
  btnDangerClass,
  btnPrimaryClass,
  inputClass,
} from '../../components/settings/ui.jsx';

const TITLE = 'OCR 변환(PDF & 이미지)';
const PICK_EXTS = OCR_INPUT_EXTS.map((ext) => ext.replace(/^\./, ''));
const IMAGE_LABEL = OCR_IMAGE_EXTS.map((ext) => ext.replace(/^\./, '')).join(', ');

function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function OcrPage({ featureId } = {}) {
  const dialog = useDialog();
  const native = getNative();
  const [info, setInfo] = useState(/** @type {any} */ (null));
  const [items, setItems] = useState(/** @type {{ key: string, path: string, name: string, dir: string, size: number }[]} */ ([]));
  const [includeSub, setIncludeSub] = useState(false);
  const [outputDir, setOutputDir] = useState('');
  const [languages, setLanguages] = useState(() => [...DEFAULT_OCR_LANGUAGE_IDS]);
  const [showMoreLangs, setShowMoreLangs] = useState(false);
  const [skipNativeText, setSkipNativeText] = useState(true);
  const [job, setJob] = useState(/** @type {any} */ (null));
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const running = job?.state === 'queued' || job?.state === 'running';
  useReportJobRunning(featureId, running, 'OCR 중');
  const progressFollowKey = job
    ? `${job.state}:${job.progress}:${Array.isArray(job.logs) ? job.logs.length : 0}:${Array.isArray(job.result?.items) ? job.result.items.length : 0}`
    : '';
  const { sectionRef: progressSectionRef, logRef: progressLogRef } = useJobProgressScroll({
    active: Boolean(job),
    followKey: progressFollowKey,
  });

  const languageOptions = info?.languages ?? OCR_LANGUAGE_OPTIONS;
  const defaultLangs = new Set(info?.defaultLanguages ?? DEFAULT_OCR_LANGUAGE_IDS);
  const primaryLangs = languageOptions.filter((l) => defaultLangs.has(l.id));
  const extraLangs = languageOptions.filter((l) => !defaultLangs.has(l.id));

  useEffect(() => {
    let alive = true;
    api('ocr.info')
      .then((res) => alive && setInfo(res))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!job || (job.state !== 'queued' && job.state !== 'running')) return undefined;
    const timer = window.setInterval(() => {
      void api('ocr.status', { jobId: job.id })
        .then((res) => setJob(res.job))
        .catch(() => undefined);
    }, 700);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.state]);

  const addFiles = (files) => {
    if (!files?.length) return;
    setItems((prev) => {
      const seen = new Set(prev.map((item) => item.path.toLowerCase()));
      const next = [...prev];
      for (const file of files) {
        const key = String(file.path).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({
          key: file.path,
          path: file.path,
          name: file.name || fileName(file.path),
          dir: file.dir || file.path.replace(/[/\\][^/\\]+$/, ''),
          size: Number(file.size) || 0,
        });
      }
      return next;
    });
  };

  const addPaths = async (paths) => {
    if (!paths?.length) return;
    try {
      const { files, skipped, truncated } = await api('ocr.inspect', { paths, recursive: includeSub });
      addFiles(files);
      const notes = [];
      if (files.length === 0) notes.push('추가할 PDF·이미지가 없습니다.');
      if (skipped > 0) notes.push(`지원하지 않는 항목 ${skipped}개는 제외했습니다.`);
      if (truncated) notes.push('파일이 너무 많아 일부만 가져왔습니다. (최대 20,000개)');
      if (notes.length > 0) void dialog.alert({ title: TITLE, body: notes.join('\n') });
    } catch (err) {
      void dialog.alert({ title: TITLE, body: err instanceof Error ? err.message : '파일을 읽지 못했습니다.' });
    }
  };

  const pickFiles = async () => {
    if (!native?.pickOpenFiles) return;
    const result = await native.pickOpenFiles({
      memoryKey: 'ocrInput',
      title: 'OCR 할 PDF·이미지 선택 (여러 개 가능)',
      multi: true,
      filters: [
        { name: 'PDF·이미지', extensions: PICK_EXTS },
        { name: 'PDF', extensions: ['pdf'] },
        { name: '이미지', extensions: OCR_IMAGE_EXTS.map((ext) => ext.replace(/^\./, '')) },
      ],
    });
    if (result?.canceled || !result?.paths?.length) return;
    await addPaths(result.paths);
  };

  const addFolder = async () => {
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({
      memoryKey: 'ocrInput',
      title: 'PDF·이미지가 있는 폴더 선택',
    });
    if (picked?.canceled || !picked?.path) return;
    await addPaths([picked.path]);
  };

  const pickOutputDir = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory({ memoryKey: 'ocrOutput', title: '결과 저장 폴더' });
    if (result?.canceled || !result?.path) return;
    setOutputDir(result.path);
  };

  const toggleLanguage = (id) => {
    setLanguages((prev) => {
      if (prev.includes(id)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  };

  const start = async () => {
    if (items.length === 0) {
      void dialog.alert({ title: TITLE, body: 'PDF·이미지 파일이나 폴더를 먼저 추가해 주세요.' });
      return;
    }
    if (languages.length === 0) {
      void dialog.alert({ title: TITLE, body: '인식할 언어를 하나 이상 선택해 주세요.' });
      return;
    }
    setBusy(true);
    try {
      const status = await api('ocr.modelsStatus', { languages });
      if (status.missing?.length) {
        const names = status.missing.map((m) => m.label).join(', ');
        const ok = await dialog.confirm({
          title: 'OCR 모델 받기',
          body: `선택한 언어에 필요한 모델이 없습니다.\n(${names})\n\n인터넷에서 받아 시작할까요? (처음 한 번만)`,
          confirmLabel: '받아서 시작',
        });
        if (!ok) return;
      }
      const unlocked = await collectPdfPasswords(
        items.map((item) => item.path),
        dialog,
      );
      if (unlocked.cancelled) return;
      if (unlocked.paths.length === 0) {
        void dialog.alert({ title: TITLE, body: '처리할 파일이 없습니다.' });
        return;
      }
      const res = await api('ocr.start', {
        inputPaths: unlocked.paths,
        outputDir: outputDir.trim(),
        options: { languages, skipNativeText, passwords: unlocked.passwords },
      });
      setJob(res.job);
    } catch (err) {
      void dialog.alert({ title: TITLE, body: err instanceof Error ? err.message : 'OCR 을 시작하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!job?.id) return;
    setStopping(true);
    try {
      const res = await api('ocr.cancel', { jobId: job.id });
      if (res?.job) setJob(res.job);
    } catch (err) {
      void dialog.alert({ title: TITLE, body: err instanceof Error ? err.message : '중지하지 못했습니다.' });
    } finally {
      setStopping(false);
    }
  };

  const resultItems = useMemo(() => {
    const list = job?.result?.items;
    return Array.isArray(list) ? list : [];
  }, [job]);

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500">
            스캔 PDF·이미지에 검색 가능한 글자 층을 붙입니다. 이미지는 PDF 로 변환한 뒤 OCR 하며, 결과는 PDF 로 저장됩니다.
            Tiny PDF Editor 와 같은 PP-OCRv5(한국어+영어) 엔진을 쓰고, 다른 언어는 아래에서 추가로 켤 수 있습니다.
          </p>
        </section>

        <Section title="작업 설정">
          <div className="space-y-4">
            <Field
              group
              label="입력 파일"
              hint={`${items.length}개 · PDF 또는 이미지(${IMAGE_LABEL}) · 폴더 추가 시 하위 폴더 ${includeSub ? '포함' : '제외'}`}
            >
              <InputDropZone
                disabled={busy || running}
                emptyHint="놓으면 목록에 추가됩니다"
                onUnsupported={() =>
                  void dialog.alert({
                    title: TITLE,
                    body: '파일 끌어놓기를 쓰려면 앱을 다시 시작해 주세요. (파일·폴더 추가 버튼은 바로 사용할 수 있습니다)',
                  })
                }
                onPaths={(paths) => void addPaths(paths)}
              >
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnClass} disabled={busy || running} onClick={() => void pickFiles()}>
                    파일 추가
                  </button>
                  <button type="button" className={btnClass} disabled={busy || running} onClick={() => void addFolder()}>
                    폴더 추가
                  </button>
                  {items.length > 0 ? (
                    <button type="button" className={btnClass} onClick={() => setItems([])}>
                      목록 비우기
                    </button>
                  ) : null}
                </div>
                <div className="mt-2">
                  <ToggleRow
                    label="폴더 추가 시 하위 폴더 포함"
                    hint="켜면 선택한 폴더 아래의 모든 하위 폴더에서 PDF·이미지를 모읍니다. 끌어다 놓기에도 적용됩니다."
                    checked={includeSub}
                    onChange={setIncludeSub}
                    disabled={busy || running}
                  />
                </div>
                {items.length > 0 ? (
                  <ul className="mt-3 max-h-56 space-y-1 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 text-sm">
                    {items.map((item) => (
                      <li key={item.key} className="flex items-center gap-2 rounded px-2 py-1 hover:bg-white">
                        <span className="min-w-0 flex-1 truncate" title={item.path}>
                          {item.name}
                          <span className="ml-2 text-xs text-slate-400">{formatSize(item.size)}</span>
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-slate-500 hover:text-red-600"
                          onClick={() => setItems((prev) => prev.filter((x) => x.key !== item.key))}
                        >
                          제거
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="m-0 mt-2 text-xs text-slate-400">
                    PDF·이미지를 추가하거나 파일·폴더를 끌어다 놓으세요. 이미지는 PDF 로 변환한 뒤 OCR 합니다.
                  </p>
                )}
              </InputDropZone>
            </Field>

            <Field label="저장 폴더" hint="비워 두면 각 파일이 있는 폴더에 `원본이름_ocr.pdf` 로 저장합니다.">
              <div className="flex flex-wrap gap-2">
                <input
                  className={`${inputClass} min-w-[16rem] flex-1`}
                  value={outputDir}
                  placeholder="각 PDF 가 있는 폴더"
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

            <Field group label="인식 언어" hint="기본은 한국어·영어입니다. 한국어 모델이 영문도 함께 인식합니다.">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {primaryLangs.map((lang) => (
                  <label key={lang.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={languages.includes(lang.id)}
                      onChange={() => toggleLanguage(lang.id)}
                      disabled={busy || running}
                    />
                    {lang.label}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className="text-sm text-app-accent hover:underline"
                  onClick={() => setShowMoreLangs((v) => !v)}
                >
                  {showMoreLangs ? '다른 언어 숨기기' : '다른 언어 추가…'}
                </button>
              </div>
              {showMoreLangs ? (
                <div className="mt-3 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                  {extraLangs.map((lang) => (
                    <label key={lang.id} className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={languages.includes(lang.id)}
                        onChange={() => toggleLanguage(lang.id)}
                        disabled={busy || running}
                      />
                      <span>
                        <span className="font-medium">{lang.label}</span>
                        {lang.hint ? <span className="mt-0.5 block text-xs text-slate-500">{lang.hint}</span> : null}
                      </span>
                    </label>
                  ))}
                  <p className="m-0 text-xs text-slate-500">
                    추가로 켠 언어는 처음 실행할 때 모델을 내려받습니다. (인터넷 필요)
                  </p>
                </div>
              ) : null}
            </Field>

            <ToggleRow
              label="이미 글자가 있는 페이지 건너뛰기"
              hint="텍스트 PDF 는 건드리지 않고, 스캔(이미지) 페이지만 OCR 합니다."
              checked={skipNativeText}
              onChange={setSkipNativeText}
              disabled={busy || running}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={busy || running || items.length === 0}
                onClick={() => void start()}
              >
                {running ? 'OCR 중…' : items.length > 1 ? `${items.length}개 OCR 시작` : 'OCR 시작'}
              </button>
              {running ? (
                <button type="button" className={btnDangerClass} disabled={stopping} onClick={() => void cancel()}>
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
                  <Badge
                    tone={
                      job.state === 'done'
                        ? 'green'
                        : job.state === 'error'
                          ? 'red'
                          : job.state === 'cancelled'
                            ? 'amber'
                            : 'default'
                    }
                  >
                    {job.state === 'done'
                      ? '완료'
                      : job.state === 'error'
                        ? '실패'
                        : job.state === 'cancelled'
                          ? '취소됨'
                          : `${Math.round((job.progress || 0) * 100)}%`}
                  </Badge>
                  {job.error ? <span className="text-red-600">{job.error}</span> : null}
                </div>

                {resultItems.length > 0 ? (
                  <ul className="m-0 space-y-2 p-0 list-none">
                    {resultItems.map((item) => (
                      <li key={item.inputPath} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                        <div className="font-medium text-slate-800">{fileName(item.inputPath)}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.applied}/{item.pageCount}쪽 OCR · 건너뜀 {item.skipped} · 줄 {item.lines}
                        </div>
                        {item.outputPath ? (
                          <button
                            type="button"
                            className="mt-1 text-xs text-app-accent hover:underline"
                            onClick={() => void native?.showItemInFolder?.(item.outputPath)}
                          >
                            결과 파일 위치 열기
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {Array.isArray(job.logs) && job.logs.length > 0 ? (
                  <pre
                    ref={progressLogRef}
                    className="m-0 max-h-48 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 whitespace-pre-wrap"
                  >
                    {job.logs.slice(-80).join('\n')}
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
