import { useEffect, useRef, useState } from 'react';
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
import {
  formatHeaderCells,
  formatHeaderSpan,
  formatKeyColumnCells,
  parseHeaderCells,
  parseKeyColumnRange,
} from '../../../shared/headerSpan.js';
import HeaderRangeInputs from '../../components/common/HeaderRangeInputs.jsx';
import { openLocalFile } from '../../lib/openLocalFile.js';
import { showExportDone } from '../../lib/exportDone.jsx';

const TITLE = '엑셀 문서 병합';
const EXCEL_EXTS = ['.xlsx', '.xlsm', '.xltx', '.xltm', '.xls', '.xlt', '.xlsb'];

const FALLBACK_MODES = [
  {
    id: 'sheets',
    label: '시트로 모으기',
    hint: '각 파일을 결과 .xlsx 의 별도 시트로 넣습니다. 행 데이터는 합치지 않고, 여러 시트를 한 파일에만 모읍니다.',
  },
  {
    id: 'append',
    label: '아래로 이어 붙이기',
    hint: '선택한 시트들의 데이터를 한 시트에 위→아래로 붙입니다. 헤더 이름으로 열을 맞추거나, 열 위치로 붙일 수 있습니다.',
  },
  {
    id: 'same_name',
    label: '같은 이름 시트끼리',
    hint: '여러 파일에서 시트 이름이 같은 것끼리 모아, 각각 결과 시트로 아래로 이어 붙입니다. (예: 모든 ‘매출’ → 결과 ‘매출’)',
  },
  {
    id: 'named',
    label: '지정 시트만',
    hint: '시트 이름·번호로 고른 시트만 가져옵니다. 처리 방식에서 시트로 모으기 또는 아래로 이어 붙이기를 고릅니다.',
  },
  {
    id: 'join',
    label: '키로 옆으로 이어 붙이기',
    hint: '키 열 범위(예: A1~A190)로 헤더·데이터를 정해, 같은 키 행의 열을 가로로 붙입니다. 각 파일의 첫 시트만 씁니다.',
  },
  {
    id: 'folder',
    label: '폴더 경로로 시트',
    hint: '시트로 모으기와 같되, 시트 이름 앞에 상대 폴더 경로를 붙입니다. 하위 폴더에 같은 파일 이름이 있어도 구분됩니다.',
  },
];

const FALLBACK_NAMED_ACTIONS = [
  { id: 'sheets', label: '시트로 모으기' },
  { id: 'append', label: '아래로 이어 붙이기' },
];

function fileName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

/**
 * @param {string} mode
 */
function optionsTitle(mode) {
  switch (mode) {
    case 'append':
      return '이어 붙이기 옵션';
    case 'same_name':
      return '같은 이름 시트 옵션';
    case 'named':
      return '지정 시트 옵션';
    case 'join':
      return '키 열 범위 옵션';
    case 'folder':
      return '폴더 경로 시트 옵션';
    default:
      return '시트 모으기 옵션';
  }
}

/**
 * 여러 Excel 파일을 다양한 방식으로 하나의 .xlsx 로 합칩니다.
 */
export default function ExcelMergePage() {
  const dialog = useDialog();
  const native = getNative();
  const [paths, setPaths] = useState(/** @type {string[]} */ ([]));
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [outputName, setOutputName] = useState('병합');
  const [outputDir, setOutputDir] = useState('');
  const [includeSub, setIncludeSub] = useState(false);
  const [mode, setMode] = useState('sheets');
  const [sheetScope, setSheetScope] = useState(/** @type {'first' | 'all'} */ ('first'));
  const [sheetNameMode, setSheetNameMode] = useState(
    /** @type {'file' | 'sheet' | 'file_sheet'} */ ('file'),
  );
  const [keepFirstHeader, setKeepFirstHeader] = useState(true);
  const [addSourceColumn, setAddSourceColumn] = useState(false);
  const [alignByHeader, setAlignByHeader] = useState(true);
  const [headerStart, setHeaderStart] = useState(1);
  const [headerEnd, setHeaderEnd] = useState(1);
  const [headerColStart, setHeaderColStart] = useState(1);
  const [headerColEnd, setHeaderColEnd] = useState(1);
  const [headerFrom, setHeaderFrom] = useState('A1');
  const [headerTo, setHeaderTo] = useState('A1');
  const [headerAutoNote, setHeaderAutoNote] = useState('');
  const [sheetFilterText, setSheetFilterText] = useState('');
  const [namedAction, setNamedAction] = useState(/** @type {'sheets' | 'append'} */ ('sheets'));
  const [keyFrom, setKeyFrom] = useState('A1');
  const [keyTo, setKeyTo] = useState('A2');
  const [keyRangeNote, setKeyRangeNote] = useState('');
  const keyCommittedRef = useRef({ from: 'A1', to: 'A2' });
  const [meta, setMeta] = useState(
    /** @type {{
     *   modes?: any[],
     *   sheetScopes?: any[],
     *   sheetNameModes?: any[],
     *   namedActions?: any[],
     *   columnAligns?: any[],
     * } | null} */ (null),
  );
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(
    /** @type {{ percent: number, message: string } | null} */ (null),
  );

  useEffect(() => {
    let alive = true;
    api('excelMerge.meta')
      .then((res) => {
        if (alive) setMeta(res ?? {});
      })
      .catch(() => undefined);
    api('folders.get', { key: 'excelMergeOutput' })
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
      void api('folders.set', { key: 'excelMergeOutput', path: outputDir.trim() }).catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [outputDir]);

  const firstPath = paths[0] || '';
  useEffect(() => {
    if (!firstPath) {
      setHeaderStart(1);
      setHeaderEnd(1);
      setHeaderColStart(1);
      setHeaderColEnd(1);
      setHeaderFrom('A1');
      setHeaderTo('A1');
      setHeaderAutoNote('');
      setKeyFrom('A1');
      setKeyTo('A2');
      keyCommittedRef.current = { from: 'A1', to: 'A2' };
      setKeyRangeNote('');
      return undefined;
    }
    let alive = true;
    api('excelMerge.detectHeader', { path: firstPath })
      .then((res) => {
        if (!alive || !res) return;
        const start = Math.max(1, Number(res.start) || 1);
        const end = Math.max(start, Number(res.end) || start);
        const colStart = Math.max(1, Number(res.colStart) || 1);
        const colEnd = Math.max(colStart, Number(res.colEnd) || colStart);
        const cells = formatHeaderCells({ start, end, colStart, colEnd });
        const span = formatHeaderSpan({ start, end, colStart, colEnd });
        setHeaderStart(start);
        setHeaderEnd(end);
        setHeaderColStart(colStart);
        setHeaderColEnd(colEnd);
        setHeaderFrom(cells.from);
        setHeaderTo(cells.to);
        setHeaderAutoNote(`첫 파일에서 ${span}(으)로 인식했습니다.`);
      })
      .catch(() => {
        if (!alive) return;
        setHeaderAutoNote('');
      });
    api('excelMerge.detectKeyRange', { path: firstPath })
      .then((res) => {
        if (!alive || !res) return;
        const from = String(res.from || 'A1');
        const to = String(res.to || 'A2');
        setKeyFrom(from);
        setKeyTo(to);
        keyCommittedRef.current = { from, to };
        setKeyRangeNote(`첫 파일에서 ${from} ~ ${to}(으)로 제안했습니다.`);
      })
      .catch(() => {
        if (!alive) return;
        setKeyRangeNote('');
      });
    return () => {
      alive = false;
    };
  }, [firstPath]);

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
        exts: EXCEL_EXTS,
      });
      const found = Array.isArray(files) ? files.map((file) => String(file.path || '')).filter(Boolean) : [];
      mergePaths(found);
      const notes = [];
      if (found.length === 0) notes.push('추가할 Excel 파일이 없습니다.');
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
      memoryKey: 'excelMergeInput',
      title: '병합할 Excel 선택',
      multi: true,
      filters: [
        { name: 'Excel', extensions: ['xlsx', 'xlsm', 'xls', 'xlsb', 'xltx', 'xltm', 'xlt'] },
      ],
    });
    if (result?.canceled || !result?.paths?.length) return;
    await addPaths(result.paths);
  };

  const addFolder = async () => {
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({
      memoryKey: 'excelMergeInput',
      title: 'Excel 파일이 있는 폴더 선택',
    });
    if (picked?.canceled || !picked?.path) return;
    await addPaths([picked.path]);
  };

  const pickOutputDir = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory({
      memoryKey: 'excelMergeOutput',
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
      const job = await api('excelMerge.job', { id: jobId });
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
      void dialog.alert({ title: TITLE, body: '병합하려면 Excel 파일을 2개 이상 추가하세요.' });
      return;
    }
    if (mode === 'named' && !sheetFilterText.trim()) {
      void dialog.alert({
        title: TITLE,
        body: '지정할 시트 이름(또는 번호)을 입력해 주세요.\n예: 매출, Sheet1, 1',
      });
      return;
    }

    let overwrite = false;
    try {
      const resolved = await api('excelMerge.resolveOutput', {
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
      const started = await api('excelMerge.run', {
        paths,
        outputName,
        outputDir: outputDir.trim(),
        overwrite,
        mode,
        sheetScope,
        sheetNameMode,
        keepFirstHeader,
        addSourceColumn,
        columnAlign: alignByHeader ? 'header' : 'position',
        headerStart,
        headerEnd,
        sheetFilterText,
        namedAction,
        keyFrom,
        keyTo,
      });
      const jobId = String(started?.jobId || '').trim();
      if (!jobId) throw new Error('병합 작업을 시작하지 못했습니다.');
      const job = await waitJob(jobId);
      await showExportDone({
        dialog,
        native,
        title: '병합 완료',
        summary: `${paths.length}개 Excel 파일을 하나로 합쳤습니다.`,
        filePath: String(job?.outputPath || ''),
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

  const showSheetScope = mode === 'sheets' || mode === 'append' || mode === 'folder';
  const showSheetNameMode = mode === 'sheets' || mode === 'folder';
  const showAppendToggles = mode === 'append' || mode === 'same_name';
  const showNamedFields = mode === 'named';
  const showJoinFields = mode === 'join';

  const appendOptionControls = (
    <>
      <Field
        label="헤더 범위"
        hint={headerAutoNote || '시작 칸과 끝 칸을 각각 적습니다. 첫 파일에서 자동으로 찾으며, 틀리면 고치세요.'}
      >
        <HeaderRangeInputs
          from={headerFrom}
          to={headerTo}
          disabled={busy}
          inputClassName={inputClass}
          onFromChange={(value) => {
            setHeaderFrom(value);
            setHeaderAutoNote('');
          }}
          onToChange={(value) => {
            setHeaderTo(value);
            setHeaderAutoNote('');
          }}
          onCommit={(nextFrom, nextTo) => {
            const parsed = parseHeaderCells(nextFrom, nextTo);
            if (!parsed) {
              const cells = formatHeaderCells({
                start: headerStart,
                end: headerEnd,
                colStart: headerColStart,
                colEnd: headerColEnd,
              });
              setHeaderFrom(cells.from);
              setHeaderTo(cells.to);
              return;
            }
            const cells = formatHeaderCells(parsed);
            setHeaderStart(parsed.start);
            setHeaderEnd(parsed.end);
            setHeaderColStart(parsed.colStart);
            setHeaderColEnd(parsed.colEnd);
            setHeaderFrom(cells.from);
            setHeaderTo(cells.to);
          }}
        />
      </Field>
      <div className="sm:col-span-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white px-3">
        <ToggleRow
          label="헤더 이름으로 열 맞추기"
          hint="열 순서가 달라도 같은 헤더끼리 맞춥니다. 끄면 왼쪽부터 위치 기준입니다."
          checked={alignByHeader}
          disabled={busy}
          onChange={setAlignByHeader}
        />
        <ToggleRow
          label="첫 파일 헤더만 유지"
          hint="이후 파일의 헤더(펼친 헤더 포함)는 건너뜁니다."
          checked={keepFirstHeader}
          disabled={busy}
          onChange={setKeepFirstHeader}
        />
        <ToggleRow
          label="출처 열 추가"
          hint="맨 앞에 파일 이름(·시트 이름) 열을 붙입니다."
          checked={addSourceColumn}
          disabled={busy}
          onChange={setAddSourceColumn}
        />
      </div>
    </>
  );

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500">
            여러 Excel 파일을 시트 모음·이어 붙이기·키 결합 등 방식으로 하나의 .xlsx 로 저장합니다.
          </p>
        </section>

        <Section title="파일" description="위쪽이 앞쪽입니다. 순서를 바꾼 뒤 병합하세요.">
          <InputDropZone
            disabled={busy}
            emptyHint="놓으면 Excel 목록에 추가됩니다"
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
              <button type="button" className={btnClass} disabled={busy || !selected} onClick={() => moveSelected(-1)}>
                위로
              </button>
              <button type="button" className={btnClass} disabled={busy || !selected} onClick={() => moveSelected(1)}>
                아래로
              </button>
              <button type="button" className={btnClass} disabled={busy || !selected} onClick={removeSelected}>
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
                hint="폴더 추가·끌어다 놓기 시 하위 폴더의 Excel 도 함께 모읍니다."
                checked={includeSub}
                disabled={busy}
                onChange={setIncludeSub}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {paths.length}개 · 결과는 .xlsx 로 저장됩니다 · 더블클릭하면 연결된 프로그램으로 엽니다
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

        <Section title="병합 방식" description="방식을 고른 뒤, 아래에 보이는 세부 옵션만 맞추면 됩니다.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="병합 방식">
            {(meta?.modes ?? FALLBACK_MODES).map((item) => {
              const isOn = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={isOn}
                  disabled={busy}
                  onClick={() => setMode(item.id)}
                  className={`rounded-xl border-2 px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40 disabled:opacity-50 ${
                    isOn
                      ? 'border-app-accent bg-app-accentSoft/40 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        isOn ? 'border-app-accent' : 'border-slate-300'
                      }`}
                      aria-hidden="true"
                    >
                      <span className={`h-2 w-2 rounded-full ${isOn ? 'bg-app-accent' : 'bg-transparent'}`} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                      {item.hint ? (
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500">{item.hint}</span>
                      ) : null}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <p className="m-0 mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {optionsTitle(mode)}
            </p>

            {showNamedFields ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="가져올 시트">
                    <input
                      className={inputClass}
                      value={sheetFilterText}
                      disabled={busy}
                      placeholder="매출, Sheet1, 2"
                      onChange={(event) => setSheetFilterText(event.target.value)}
                    />
                  </Field>
                  <Field label="처리 방식">
                    <select
                      className={inputClass}
                      value={namedAction}
                      disabled={busy}
                      onChange={(event) =>
                        setNamedAction(/** @type {'sheets' | 'append'} */ (event.target.value))
                      }
                    >
                      {(meta?.namedActions?.length ? meta.namedActions : FALLBACK_NAMED_ACTIONS).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <p className="m-0 text-xs text-slate-500">쉼표로 구분합니다. 시트 이름 또는 번호(1부터)를 적을 수 있습니다.</p>
                {namedAction === 'append' ? (
                  <div className="grid gap-3 sm:grid-cols-2">{appendOptionControls}</div>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {showSheetScope ? (
                  <Field label="가져올 시트">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" role="radiogroup" aria-label="가져올 시트">
                      {(meta?.sheetScopes ?? [
                        { id: 'first', label: '각 파일의 첫 시트만' },
                        { id: 'all', label: '각 파일의 모든 시트' },
                      ]).map((item) => (
                        <label
                          key={item.id}
                          className={`inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700 ${
                            busy ? 'opacity-50' : ''
                          }`}
                        >
                          <input
                            type="radio"
                            name="excel-merge-sheet-scope"
                            checked={sheetScope === item.id}
                            disabled={busy}
                            onChange={() => setSheetScope(/** @type {'first' | 'all'} */ (item.id))}
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>
                  </Field>
                ) : null}

                {showSheetNameMode ? (
                  <Field
                    label="결과 시트 이름"
                    hint={mode === 'folder' ? '폴더 상대 경로가 이름 앞에 붙습니다.' : undefined}
                  >
                    <select
                      className={inputClass}
                      value={sheetNameMode}
                      disabled={busy}
                      onChange={(event) =>
                        setSheetNameMode(/** @type {'file' | 'sheet' | 'file_sheet'} */ (event.target.value))
                      }
                    >
                      {(meta?.sheetNameModes ?? [
                        { id: 'file', label: '파일 이름' },
                        { id: 'sheet', label: '원본 시트 이름' },
                        { id: 'file_sheet', label: '파일 이름_시트 이름' },
                      ]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}

                {showJoinFields ? (
                  <Field
                    label="키 열 범위"
                    hint={
                      keyRangeNote ||
                      '시작 칸이 헤더, 그 아래~끝 칸이 키 데이터입니다. 같은 열만 가능합니다. (예: A1 ~ A190)'
                    }
                  >
                    <HeaderRangeInputs
                      from={keyFrom}
                      to={keyTo}
                      disabled={busy}
                      fromPlaceholder="A1"
                      toPlaceholder="A190"
                      fromAriaLabel="키 열 시작 칸(헤더)"
                      toAriaLabel="키 열 끝 칸"
                      inputClassName={inputClass}
                      onFromChange={(value) => {
                        setKeyFrom(value);
                        setKeyRangeNote('');
                      }}
                      onToChange={(value) => {
                        setKeyTo(value);
                        setKeyRangeNote('');
                      }}
                      onCommit={(nextFrom, nextTo) => {
                        const parsed = parseKeyColumnRange(nextFrom, nextTo);
                        if (!parsed) {
                          setKeyFrom(keyCommittedRef.current.from);
                          setKeyTo(keyCommittedRef.current.to);
                          return;
                        }
                        const cells = formatKeyColumnCells(parsed);
                        keyCommittedRef.current = cells;
                        setKeyFrom(cells.from);
                        setKeyTo(cells.to);
                      }}
                    />
                  </Field>
                ) : null}

                {showAppendToggles ? appendOptionControls : null}

                {mode === 'same_name' ? (
                  <p className="sm:col-span-2 m-0 text-xs text-slate-500">
                    모든 파일에서 시트 이름이 같은 것끼리 아래로 이어 붙입니다. 이름이 없는 시트는 건너뜁니다.
                  </p>
                ) : null}
                {mode === 'join' ? (
                  <p className="sm:col-span-2 m-0 text-xs text-slate-500">
                    첫 파일을 기준으로, 키 열 범위의 같은 값 행에 이후 파일 열을 옆으로 이어 붙입니다.
                    시작 칸은 헤더, 그 다음 행부터 끝 칸까지가 데이터입니다.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </Section>

        <Section title="저장" description="결과는 항상 .xlsx 로 저장됩니다. (.xls 입력도 값 위주로 옮깁니다.)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="파일 이름" hint="확장자 .xlsx 가 붙습니다.">
              <input
                className={inputClass}
                value={outputName}
                disabled={busy}
                onChange={(event) => setOutputName(event.target.value)}
                placeholder="병합"
              />
            </Field>
            <Field label="저장 폴더" hint="비워 두면 첫 번째 파일이 있는 폴더에 저장합니다.">
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
              disabled={busy || paths.length < 2}
              onClick={() => void run()}
            >
              {busy ? '병합 중…' : '하나로 병합'}
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
