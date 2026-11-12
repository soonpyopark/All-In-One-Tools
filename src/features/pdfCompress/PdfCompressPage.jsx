import { useEffect, useState } from 'react';
import InputDropZone from '../../components/common/InputDropZone.jsx';
import {
  Field,
  Section,
  ToggleRow,
  btnClass,
  btnPrimaryClass,
  codeClass,
  inputClass,
} from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { openExternalUrl } from '../../lib/openExternal.js';
import { TINY_PDF_EDITOR_URL } from '../../../shared/constants.js';

function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

function formatBytes(n) {
  const value = Number(n) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

const TITLE = 'PDF 용량 줄이기';

/** Tiny PDF Editor 와 같은 옵션으로 임베드 이미지를 재압축합니다. */
export default function PdfCompressPage() {
  const dialog = useDialog();
  const native = getNative();
  const [paths, setPaths] = useState(/** @type {string[]} */ ([]));
  const [outputDir, setOutputDir] = useState('');
  const [includeSub, setIncludeSub] = useState(false);
  const [dpiChoices, setDpiChoices] = useState(/** @type {number[]} */ ([150]));
  const [imageDpi, setImageDpi] = useState(150);
  const [imageQualityPercent, setImageQualityPercent] = useState(100);
  const [imageSizePercent, setImageSizePercent] = useState(100);
  const [busy, setBusy] = useState(false);
  /** @type {[{ results: any[], errors: any[] } | null, Function]} */
  const [last, setLast] = useState(/** @type {{ results: any[], errors: any[] } | null} */ (null));

  useEffect(() => {
    let alive = true;
    api('pdf.compress.options')
      .then((res) => {
        if (!alive) return;
        if (Array.isArray(res?.dpiChoices) && res.dpiChoices.length) setDpiChoices(res.dpiChoices);
        if (res?.defaults) {
          setImageDpi(Number(res.defaults.imageDpi) || 150);
          setImageQualityPercent(Number(res.defaults.imageQualityPercent) || 100);
          setImageSizePercent(Number(res.defaults.imageSizePercent) || 100);
        }
      })
      .catch(() => undefined);
    api('folders.get', { key: 'pdfCompressOutput' })
      .then((res) => {
        if (alive && res?.path) setOutputDir(res.path);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void api('folders.set', { key: 'pdfCompressOutput', path: outputDir.trim() }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [outputDir]);

  const mergePdfPaths = (nextPaths) => {
    const list = (Array.isArray(nextPaths) ? nextPaths : [])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    if (list.length === 0) return;
    setPaths((current) => {
      const seen = new Set(current.map((item) => item.toLowerCase()));
      const merged = [...current];
      for (const item of list) {
        const key = item.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
      return merged;
    });
  };

  const addPaths = async (rawPaths) => {
    const input = (Array.isArray(rawPaths) ? rawPaths : [])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
    if (input.length === 0) return;
    try {
      const { files, skipped, truncated } = await api('files.inspect', {
        paths: input,
        recursive: includeSub,
        exts: ['.pdf'],
      });
      const found = Array.isArray(files) ? files.map((file) => String(file.path || '')).filter(Boolean) : [];
      mergePdfPaths(found);
      const notes = [];
      if (found.length === 0) notes.push('추가할 PDF 가 없습니다.');
      if (skipped > 0) notes.push(`지원하지 않는 항목 ${skipped}개는 제외했습니다.`);
      if (truncated) notes.push('파일이 너무 많아 일부만 가져왔습니다. (최대 20,000개)');
      if (notes.length > 0) void dialog.alert({ title: TITLE, body: notes.join('\n') });
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '파일을 읽지 못했습니다.',
      });
    }
  };

  const pickFiles = async () => {
    if (!native?.pickOpenFiles) return;
    const result = await native.pickOpenFiles({
      memoryKey: 'pdfCompressInput',
      title: '용량을 줄일 PDF 선택',
      multi: true,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result?.canceled || !result?.paths?.length) return;
    await addPaths(result.paths);
  };

  const addFolder = async () => {
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({
      memoryKey: 'pdfCompressInput',
      title: 'PDF 가 있는 폴더 선택',
    });
    if (picked?.canceled || !picked?.path) return;
    await addPaths([picked.path]);
  };

  const pickOutputDir = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory({
      memoryKey: 'pdfCompressOutput',
      title: '결과 저장 폴더',
    });
    if (result?.canceled || !result?.path) return;
    setOutputDir(result.path);
  };

  const run = async () => {
    if (paths.length === 0) {
      void dialog.alert({ title: TITLE, body: 'PDF 파일을 먼저 추가하세요.' });
      return;
    }
    setBusy(true);
    setLast(null);
    try {
      const res = await api('pdf.compress.run', {
        inputPaths: paths,
        outputDir: outputDir.trim(),
        options: { imageDpi, imageQualityPercent, imageSizePercent },
      });
      setLast({ results: res?.results ?? [], errors: res?.errors ?? [] });
      if (res?.errors?.length && !res?.results?.length) {
        void dialog.alert({
          title: TITLE,
          body: res.errors.map((item) => `${fileName(item.inputPath)}: ${item.error}`).join('\n'),
        });
      }
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '용량 줄이기에 실패했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Tiny PDF Editor 와 같이 텍스트·검색은 유지하고 이미지 위주로 압축합니다. 결과는{' '}
            <code className={codeClass}>원본이름_optimize.pdf</code> 로 저장됩니다.
          </p>
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
        </section>

        <Section title="파일">
          <InputDropZone
            disabled={busy}
            emptyHint="놓으면 PDF 목록에 추가됩니다"
            onPaths={(next) => void addPaths(next)}
            onUnsupported={() =>
              void dialog.alert({
                title: TITLE,
                body: '파일 끌어놓기를 쓰려면 앱을 다시 시작해 주세요.',
              })
            }
          >
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnClass} disabled={busy} onClick={() => void pickFiles()}>
                PDF 추가
              </button>
              <button type="button" className={btnClass} disabled={busy} onClick={() => void addFolder()}>
                폴더 추가
              </button>
              <button type="button" className={btnClass} disabled={busy || paths.length === 0} onClick={() => setPaths([])}>
                목록 비우기
              </button>
            </div>
            <div className="mt-3">
              <ToggleRow
                label="하위 폴더 포함"
                hint="폴더 추가·끌어다 놓기 시 하위 폴더의 PDF 도 함께 모읍니다."
                checked={includeSub}
                disabled={busy}
                onChange={setIncludeSub}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {paths.length}개 PDF · 폴더 추가 시 하위 폴더 {includeSub ? '포함' : '제외'}
            </p>
            {paths.length > 0 ? (
              <ul className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                {paths.map((item) => (
                  <li key={item} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-slate-700" title={item}>
                      {fileName(item)}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-red-500 hover:underline"
                      disabled={busy}
                      onClick={() => setPaths((current) => current.filter((path) => path !== item))}
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">파일이나 폴더를 끌어다 놓으세요.</p>
            )}
          </InputDropZone>
        </Section>

        <Section title="이미지 설정" description="해상도·품질·사이즈를 낮출수록 용량이 더 줄어듭니다.">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="압축 해상도">
              <select className={inputClass} value={imageDpi} disabled={busy} onChange={(e) => setImageDpi(Number(e.target.value))}>
                {dpiChoices.map((dpi) => (
                  <option key={dpi} value={dpi}>
                    {dpi} dpi
                  </option>
                ))}
              </select>
            </Field>
            <Field label="이미지 품질">
              <input
                type="number"
                min={1}
                max={100}
                className={inputClass}
                value={imageQualityPercent}
                disabled={busy}
                onChange={(e) => setImageQualityPercent(Number(e.target.value) || 1)}
              />
            </Field>
            <Field label="이미지 사이즈">
              <input
                type="number"
                min={1}
                max={100}
                className={inputClass}
                value={imageSizePercent}
                disabled={busy}
                onChange={(e) => setImageSizePercent(Number(e.target.value) || 1)}
              />
            </Field>
          </div>
          <div className="mt-5">
            <Field
              label="저장 폴더"
              hint="비워 두면 각 PDF가 있는 폴더에 저장합니다. 파일 이름은 원본이름_optimize.pdf 입니다."
            >
              <div className="flex flex-nowrap items-stretch gap-2">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  value={outputDir}
                  disabled={busy}
                  placeholder="각 PDF가 있는 폴더"
                  onChange={(e) => setOutputDir(e.target.value)}
                />
                <button
                  type="button"
                  className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void pickOutputDir()}
                >
                  찾기
                </button>
              </div>
            </Field>
          </div>
          <div className="mt-4">
            <button type="button" className={btnPrimaryClass} disabled={busy || paths.length === 0} onClick={() => void run()}>
              {busy ? '처리 중…' : '용량 줄이기'}
            </button>
          </div>
        </Section>

        {last ? (
          <Section title="결과">
            {last.results.length === 0 && last.errors.length === 0 ? (
              <p className="m-0 text-sm text-slate-500">결과가 없습니다.</p>
            ) : null}
            <ul className="space-y-2">
              {last.results.map((item) => {
                const ratio =
                  item.beforeBytes > 0 ? Math.round((1 - item.afterBytes / item.beforeBytes) * 100) : 0;
                return (
                  <li key={item.outputPath} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <p className="m-0 font-medium text-slate-800">{fileName(item.outputPath)}</p>
                    <p className="m-0 mt-1 text-slate-500">
                      {formatBytes(item.beforeBytes)} → {formatBytes(item.afterBytes)}
                      {ratio > 0 ? ` (−${ratio}%)` : ratio < 0 ? ` (+${Math.abs(ratio)}%)` : ''}
                      {' · '}이미지 {item.imagesChanged}/{item.imagesTotal}개 재압축
                    </p>
                    <button
                      type="button"
                      className="mt-1 text-xs text-app-accent hover:underline"
                      onClick={() => void native?.showItemInFolder?.(item.outputPath)}
                    >
                      폴더에서 보기
                    </button>
                  </li>
                );
              })}
              {last.errors.map((item) => (
                <li key={`${item.inputPath}-err`} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {fileName(item.inputPath)}: {item.error}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
