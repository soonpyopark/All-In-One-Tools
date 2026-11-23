import { useEffect, useState } from 'react';
import InputDropZone from '../../components/common/InputDropZone.jsx';
import {
  Field,
  Section,
  ToggleRow,
  btnClass,
  btnPrimaryClass,
  inputClass,
} from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { openLocalFile } from '../../lib/openLocalFile.js';
import { showExportDone } from '../../lib/exportDone.jsx';

const TITLE = '한글 문서 병합';
const HWP_EXTS = ['.hwp', '.hwpx'];

function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * HWP/HWPX 를 한컴 한글 COM 으로 하나의 문서로 합칩니다.
 * 각 문서의 용지 방향(세로/가로) 등 구역 설정을 유지합니다. (Windows)
 */
export default function HwpMergePage() {
  const dialog = useDialog();
  const native = getNative();
  const [paths, setPaths] = useState(/** @type {string[]} */ ([]));
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [outputName, setOutputName] = useState('병합');
  const [outputDir, setOutputDir] = useState('');
  const [includeSub, setIncludeSub] = useState(false);
  const [available, setAvailable] = useState(
    /** @type {{ windows: boolean, installed: boolean } | null} */ (null),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(
    /** @type {{ percent: number, message: string } | null} */ (null),
  );

  useEffect(() => {
    let alive = true;
    api('hwpMerge.available')
      .then((res) => {
        if (alive) setAvailable({ windows: Boolean(res?.windows), installed: Boolean(res?.installed) });
      })
      .catch(() => {
        if (alive) setAvailable({ windows: false, installed: false });
      });
    api('folders.get', { key: 'hwpMergeOutput' })
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
      void api('folders.set', { key: 'hwpMergeOutput', path: outputDir.trim() }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [outputDir]);

  const mergePaths = (nextPaths) => {
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
        exts: HWP_EXTS,
      });
      const found = Array.isArray(files) ? files.map((file) => String(file.path || '')).filter(Boolean) : [];
      mergePaths(found);
      const notes = [];
      if (found.length === 0) notes.push('추가할 HWP/HWPX 가 없습니다.');
      if (skipped > 0) notes.push(`지원하지 않는 항목 ${skipped}개는 제외했습니다.`);
      if (truncated) notes.push('파일이 너무 많아 일부만 가져왔습니다.');
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
      memoryKey: 'hwpMergeInput',
      title: '병합할 한글 문서 선택',
      multi: true,
      filters: [{ name: '한글 문서', extensions: ['hwp', 'hwpx'] }],
    });
    if (result?.canceled || !result?.paths?.length) return;
    await addPaths(result.paths);
  };

  const addFolder = async () => {
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({
      memoryKey: 'hwpMergeInput',
      title: '한글 문서가 있는 폴더 선택',
    });
    if (picked?.canceled || !picked?.path) return;
    await addPaths([picked.path]);
  };

  const pickOutputDir = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory({
      memoryKey: 'hwpMergeOutput',
      title: '결과 저장 폴더',
    });
    if (result?.canceled || !result?.path) return;
    setOutputDir(result.path);
  };

  const moveSelected = (delta) => {
    if (!selected) return;
    setPaths((current) => {
      const index = current.indexOf(selected);
      if (index < 0) return current;
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  };

  const removeSelected = () => {
    if (!selected) return;
    setPaths((current) => current.filter((item) => item !== selected));
    setSelected(null);
  };

  const waitJob = async (jobId) => {
    for (;;) {
      const job = await api('hwpMerge.job', { id: jobId });
      setProgress({
        percent: Number(job?.progress) || 0,
        message: String(job?.message || '처리 중…'),
      });
      if (job?.state === 'done') return job;
      if (job?.state === 'error') {
        throw new Error(job?.error || '병합에 실패했습니다.');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
  };

  const run = async () => {
    if (paths.length < 2) {
      void dialog.alert({ title: TITLE, body: '병합하려면 한글 문서를 2개 이상 추가하세요.' });
      return;
    }
    if (available && !available.installed) {
      void dialog.alert({
        title: TITLE,
        body: '한컴 한글(한컴오피스)이 설치되어 있지 않습니다.\n\nHWP/HWPX를 병합하려면 한컴 한글이 필요합니다.',
      });
      return;
    }

    let overwrite = false;
    try {
      const resolved = await api('hwpMerge.resolveOutput', {
        paths,
        outputName,
        outputDir: outputDir.trim(),
      });
      if (resolved?.exists) {
        const ok = await dialog.confirm({
          title: TITLE,
          body: `같은 이름의 파일이 이미 있습니다.\n\n${fileName(resolved.outputPath)}\n\n덮어쓸까요?`,
          confirmLabel: '덮어쓰기',
          confirmVariant: 'danger',
        });
        if (!ok) return;
        overwrite = true;
      }
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '저장 경로를 확인하지 못했습니다.',
      });
      return;
    }

    setBusy(true);
    setProgress({ percent: 0, message: '병합 시작…' });
    try {
      const started = await api('hwpMerge.run', {
        paths,
        outputName,
        outputDir: outputDir.trim(),
        overwrite,
      });
      const jobId = String(started?.jobId || '').trim();
      if (!jobId) throw new Error('병합 작업을 시작하지 못했습니다.');
      const job = await waitJob(jobId);
      const outputPath = String(job?.outputPath || '');
      await showExportDone({
        dialog,
        native,
        title: '병합 완료',
        summary: `${paths.length}개 문서를 하나로 합쳤습니다.`,
        filePath: outputPath,
      });
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '병합에 실패했습니다.',
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const hangulHint =
    available == null
      ? '한컴 한글 설치 여부를 확인하는 중…'
      : available.installed
        ? '한컴 한글이 설치되어 있습니다. 목록 순서대로 합치며, 각 문서의 용지 방향(세로/가로)은 그대로 유지됩니다.'
        : '한컴 한글(한컴오피스)이 필요합니다. 설치 후 다시 열어 주세요.';

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500">
            HWP·HWPX 파일을 순서대로 하나의 한글 문서로 합칩니다. (Windows · 한컴 한글 필요)
          </p>
          <p className="mt-1.5 text-sm text-slate-500">{hangulHint}</p>
        </section>

        <Section title="파일" description="위쪽이 앞쪽입니다. 순서를 바꾼 뒤 병합하세요.">
          <InputDropZone
            disabled={busy}
            emptyHint="놓으면 한글 문서 목록에 추가됩니다"
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
                파일 추가
              </button>
              <button type="button" className={btnClass} disabled={busy} onClick={() => void addFolder()}>
                폴더 추가
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={busy || !selected}
                onClick={() => moveSelected(-1)}
              >
                위로
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={busy || !selected}
                onClick={() => moveSelected(1)}
              >
                아래로
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={busy || !selected}
                onClick={removeSelected}
              >
                선택 제거
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={busy || paths.length === 0}
                onClick={() => {
                  setPaths([]);
                  setSelected(null);
                }}
              >
                목록 비우기
              </button>
            </div>
            <div className="mt-3">
              <ToggleRow
                label="하위 폴더 포함"
                hint="폴더 추가·끌어다 놓기 시 하위 폴더의 HWP/HWPX 도 함께 모읍니다."
                checked={includeSub}
                disabled={busy}
                onChange={setIncludeSub}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {paths.length}개 · 저장 형식은 목록 첫 파일과 같습니다 (.hwp / .hwpx) · 더블클릭하면 연결된 프로그램으로 엽니다
            </p>
            {paths.length > 0 ? (
              <ul className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
                {paths.map((item, index) => {
                  const active = selected === item;
                  return (
                    <li key={item}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                          active ? 'bg-app-accent/10 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        disabled={busy}
                        onClick={() => setSelected(item)}
                        onDoubleClick={() => {
                          void openLocalFile(item).catch((err) => {
                            void dialog.alert({
                              title: TITLE,
                              body: err instanceof Error ? err.message : '파일을 열지 못했습니다.',
                            });
                          });
                        }}
                      >
                        <span className="w-6 shrink-0 text-xs text-slate-400">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate" title={item}>
                          {fileName(item)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">파일이나 폴더를 끌어다 놓으세요.</p>
            )}
          </InputDropZone>
        </Section>

        <Section title="저장" description="결과는 한컴 한글에서 열 수 있는 하나의 문서입니다.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="파일 이름" hint="확장자는 첫 파일에 맞춰 붙습니다.">
              <input
                className={inputClass}
                value={outputName}
                disabled={busy}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder="병합"
              />
            </Field>
            <Field
              label="저장 폴더"
              hint="비워 두면 첫 번째 파일이 있는 폴더에 저장합니다."
            >
              <div className="flex flex-nowrap items-stretch gap-2">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  value={outputDir}
                  disabled={busy}
                  placeholder="첫 파일과 같은 폴더"
                  onChange={(event) => setOutputDir(event.target.value)}
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
          {progress ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                <span className="min-w-0 truncate">{progress.message}</span>
                <span className="shrink-0">{progress.percent}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-app-accent transition-[width]"
                  style={{ width: `${Math.max(2, progress.percent)}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="mt-4">
            <button
              type="button"
              className={btnPrimaryClass}
              disabled={busy || paths.length < 2 || available?.installed === false}
              onClick={() => void run()}
            >
              {busy ? '병합 중…' : '하나의 문서로 병합'}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
