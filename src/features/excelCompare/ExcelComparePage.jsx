import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getNative } from '../../lib/apiClient.js';
import { formatHeaderCells, formatHeaderSpan, parseHeaderCells } from '../../../shared/headerSpan.js';
import { pathsFromDropEvent } from '../../lib/dropPaths.js';
import { openLocalFile } from '../../lib/openLocalFile.js';
import { resetWindowSize } from '../../lib/resetWindowSize.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { useReportJobRunning } from '../../context/JobActivityContext.jsx';
import { useJobProgressScroll } from '../../hooks/useJobProgressScroll.js';
import HeaderRangeInputs from '../../components/common/HeaderRangeInputs.jsx';
import { Section, btnClass, btnPrimaryClass, codeClass } from '../../components/settings/ui.jsx';

const DROP_HINT = '클릭하거나 Excel 파일을 여기에 놓으세요';

/**
 * @param {{
 *   title: string,
 *   path: string,
 *   disabled?: boolean,
 *   onPick: () => void,
 *   onDropPath: (filePath: string) => void,
 *   onReject?: (message: string) => void,
 * }} props
 */
function FileDropCard({ title, path, disabled, onPick, onDropPath, onReject }) {
  const [over, setOver] = useState(false);
  const name = path ? path.split(/[/\\]/).pop() : '';
  const clickTimer = useRef(/** @type {number | null} */ (null));

  const takeDrop = (event) => {
    const paths = pathsFromDropEvent(event);
    const filePath = paths.find((item) => /\.(xlsx|xlsm|xlsb|xls|xltx|xltm|xlt)$/i.test(item));
    if (!filePath) {
      onReject?.(
        paths.length === 0
          ? '놓은 파일의 경로를 읽지 못했습니다. 앱을 다시 시작한 뒤 다시 놓아 주세요.'
          : 'Excel 파일만 놓을 수 있습니다. (.xlsx, .xlsm, .xls, .xlsb)',
      );
      return;
    }
    onDropPath(filePath);
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 text-xs font-semibold text-slate-700">{title}</div>
      <button
        type="button"
        disabled={disabled}
        className={`flex min-h-[7.5rem] w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
          over
            ? 'border-app-accent bg-app-accentSoft/40'
            : path
              ? 'border-slate-300 bg-white'
              : 'border-slate-200 bg-slate-50'
        } ${disabled ? 'opacity-50' : 'hover:border-slate-300 hover:bg-white'}`}
        title={path ? '더블클릭하면 연결된 프로그램으로 엽니다' : undefined}
        onClick={() => {
          if (clickTimer.current) window.clearTimeout(clickTimer.current);
          clickTimer.current = window.setTimeout(() => {
            clickTimer.current = null;
            onPick();
          }, 220);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          if (clickTimer.current) {
            window.clearTimeout(clickTimer.current);
            clickTimer.current = null;
          }
          if (!path) return;
          void openLocalFile(path).catch(() => undefined);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOver(false);
          // 드롭 후 버튼 포커스로 화면이 따라가지 않도록 포커스 해제
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
          takeDrop(event);
        }}
      >
        <span className={`text-sm ${path ? 'font-medium text-slate-800' : 'text-slate-400'}`}>
          {name || DROP_HINT}
        </span>
        {path ? <span className="mt-2 break-all text-[11px] leading-snug text-slate-400">{path}</span> : null}
      </button>
    </div>
  );
}

/**
 * @param {{
 *   label: string,
 *   columns: { label: string, index: number }[],
 *   selected: number[],
 *   disabled?: boolean,
 *   onChange: (next: number[]) => void,
 * }} props
 */
function ColumnMultiSelect({ label, columns, selected, disabled, onChange }) {
  const toggle = (index) => {
    if (selected.includes(index)) onChange(selected.filter((item) => item !== index));
    else onChange([...selected, index]);
  };

  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-semibold text-slate-600">{label}</div>
      <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-slate-200 bg-white p-2">
        {!columns.length ? (
          <p className="m-0 px-1 py-2 text-xs text-slate-400">파일·시트·헤더 행을 먼저 지정하세요.</p>
        ) : (
          columns.map((col) => {
            const checked = selected.includes(col.index);
            return (
              <label
                key={col.index}
                className={`flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm ${
                  checked ? 'bg-app-accentSoft/50 text-slate-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(col.index)}
                />
                <span className="min-w-0 truncate">{col.label}</span>
              </label>
            );
          })
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {selected.length
          ? `선택 ${selected.length}개 · 컬럼 번호 오름차순으로 이어 붙여 키를 만듭니다.`
          : '하나 이상 선택 (여러 개면 복합 키)'}
      </p>
    </div>
  );
}

/**
 * Excel 컬럼 비교 (개선: 시트/헤더/다중키/일치방식/빈칸/진행률).
 * @param {{ featureId?: string }} props
 */
export default function ExcelComparePage({ featureId }) {
  const dialog = useDialog();
  const [meta, setMeta] = useState(
    /** @type {{ modes: { id: string, label: string }[], matchKinds: { id: string, label: string }[], colors: { id: string, label: string, swatch: string }[] } | null} */ (
      null
    ),
  );

  const [originalPath, setOriginalPath] = useState('');
  const [comparePath, setComparePath] = useState('');
  const [originalSheets, setOriginalSheets] = useState(/** @type {{ index: number, name: string }[]} */ ([]));
  const [compareSheets, setCompareSheets] = useState(/** @type {{ index: number, name: string }[]} */ ([]));
  const [originalSheetIndex, setOriginalSheetIndex] = useState(0);
  const [compareSheetIndex, setCompareSheetIndex] = useState(0);
  const [headerStart, setHeaderStart] = useState(1);
  const [headerEnd, setHeaderEnd] = useState(1);
  const [headerColStart, setHeaderColStart] = useState(1);
  const [headerColEnd, setHeaderColEnd] = useState(1);
  const [headerFrom, setHeaderFrom] = useState('A1');
  const [headerTo, setHeaderTo] = useState('A1');
  const [compareHeaderStart, setCompareHeaderStart] = useState(1);
  const [compareHeaderEnd, setCompareHeaderEnd] = useState(1);
  const [compareHeaderColStart, setCompareHeaderColStart] = useState(1);
  const [compareHeaderColEnd, setCompareHeaderColEnd] = useState(1);
  const [compareHeaderFrom, setCompareHeaderFrom] = useState('A1');
  const [compareHeaderTo, setCompareHeaderTo] = useState('A1');
  const [originalCols, setOriginalCols] = useState(/** @type {{ label: string, index: number }[]} */ ([]));
  const [compareCols, setCompareCols] = useState(/** @type {{ label: string, index: number }[]} */ ([]));
  const [originalSelected, setOriginalSelected] = useState(/** @type {number[]} */ ([]));
  const [compareSelected, setCompareSelected] = useState(/** @type {number[]} */ ([]));
  const [originalLegacy, setOriginalLegacy] = useState(false);
  const [compareLegacy, setCompareLegacy] = useState(false);

  const [mode, setMode] = useState('in-original');
  const [matchKind, setMatchKind] = useState('exact');
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [color, setColor] = useState('yellow');

  /** 파일·시트·헤더 조회 등 UI 잠금 (스크롤 따라가기와 무관) */
  const [busy, setBusy] = useState(false);
  /** 비교 실행 중일 때만 true — 진행 구간 자동 스크롤·작업 표시에 사용 */
  const [jobRunning, setJobRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [logs, setLogs] = useState(/** @type {string[]} */ ([]));
  const [lastOutput, setLastOutput] = useState('');

  useReportJobRunning(featureId, jobRunning, '엑셀(Excel) 비교 중');

  const { sectionRef: logSectionRef, logRef } = useJobProgressScroll({
    active: jobRunning,
    followKey: `${logs.length}:${progress}:${progressMessage}`,
  });

  const canRun = useMemo(
    () =>
      Boolean(
        originalPath &&
          comparePath &&
          originalSelected.length > 0 &&
          compareSelected.length > 0 &&
          originalSelected.length === compareSelected.length &&
          !busy &&
          !jobRunning,
      ),
    [originalPath, comparePath, originalSelected, compareSelected, busy, jobRunning],
  );

  useEffect(() => {
    let alive = true;
    api('excelCompare.meta')
      .then((data) => {
        if (!alive) return;
        setMeta(data);
        if (data?.modes?.[0]?.id) setMode(data.modes[0].id);
        if (data?.matchKinds?.[0]?.id) setMatchKind(data.matchKinds[0].id);
        if (data?.colors?.[0]?.id) setColor(data.colors[0].id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const appendLog = (msg) => {
    const t = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${t}] ${msg}`]);
  };

  const inspect = async (filePath, which, overrides = {}) => {
    const sheetIndex =
      overrides.sheetIndex ?? (which === 'original' ? originalSheetIndex : compareSheetIndex);
    const autoHeader = overrides.autoHeader === true;
    /** @type {Record<string, unknown>} */
    const body = {
      path: filePath,
      sheetIndex,
      autoHeader,
    };
    if (!autoHeader) {
      body.headerStart =
        overrides.headerStart ?? (which === 'original' ? headerStart : compareHeaderStart);
      body.headerEnd = overrides.headerEnd ?? (which === 'original' ? headerEnd : compareHeaderEnd);
      body.headerColStart =
        overrides.headerColStart ?? (which === 'original' ? headerColStart : compareHeaderColStart);
      body.headerColEnd =
        overrides.headerColEnd ?? (which === 'original' ? headerColEnd : compareHeaderColEnd);
    }
    const info = await api('excelCompare.inspect', body);
    const sheets = Array.isArray(info.sheets) ? info.sheets : [];
    const columns = Array.isArray(info.columns) ? info.columns : [];
    const start = Math.max(1, Number(info.headerStart ?? info.headerRow) || 1);
    const end = Math.max(start, Number(info.headerEnd ?? info.headerRow) || start);
    const colStart = Math.max(1, Number(info.headerColStart) || 1);
    const colEnd = Math.max(colStart, Number(info.headerColEnd) || colStart);
    const cells = formatHeaderCells({ start, end, colStart, colEnd });
    const span = formatHeaderSpan({ start, end, colStart, colEnd });
    if (which === 'original') {
      setOriginalSheets(sheets);
      setOriginalSheetIndex(info.sheetIndex ?? 0);
      setHeaderStart(start);
      setHeaderEnd(end);
      setHeaderColStart(colStart);
      setHeaderColEnd(colEnd);
      setHeaderFrom(cells.from);
      setHeaderTo(cells.to);
      setOriginalCols(columns);
      setOriginalLegacy(Boolean(info.legacy));
      setOriginalSelected(columns[0] ? [columns[0].index] : []);
    } else {
      setCompareSheets(sheets);
      setCompareSheetIndex(info.sheetIndex ?? 0);
      setCompareHeaderStart(start);
      setCompareHeaderEnd(end);
      setCompareHeaderColStart(colStart);
      setCompareHeaderColEnd(colEnd);
      setCompareHeaderFrom(cells.from);
      setCompareHeaderTo(cells.to);
      setCompareCols(columns);
      setCompareLegacy(Boolean(info.legacy));
      setCompareSelected(columns[0] ? [columns[0].index] : []);
    }
    const label = which === 'original' ? '원본' : '비교';
    const headerNote = info.headerAutoDetected ? ` · 헤더 ${span}(자동)` : ` · 헤더 ${span}`;
    appendLog(
      `${label}: 시트 ${sheets.length}개 · 컬럼 ${columns.length}개 · 데이터 약 ${info.rowCount ?? 0}행${headerNote}`,
    );
    if (info.legacy) appendLog(`${label}이 .xls/.xlsb — 결과 시트는 값 위주로 저장됩니다.`);
    return { ...info, headerStart: start, headerEnd: end, headerColStart: colStart, headerColEnd: colEnd };
  };

  const applyOriginalHeaderToCompare = async (start, end, colStart, colEnd) => {
    if (!comparePath) return;
    await inspect(comparePath, 'compare', {
      sheetIndex: compareSheetIndex,
      headerStart: start,
      headerEnd: end,
      headerColStart: colStart,
      headerColEnd: colEnd,
    });
  };

  const assignFile = async (filePath, which) => {
    if (!filePath) return;
    try {
      setBusy(true);
      if (which === 'original') {
        setOriginalPath(filePath);
        const info = await inspect(filePath, 'original', { sheetIndex: 0, autoHeader: true });
        await applyOriginalHeaderToCompare(info.headerStart, info.headerEnd, info.headerColStart, info.headerColEnd);
      } else {
        setComparePath(filePath);
        if (originalPath) {
          await inspect(filePath, 'compare', {
            sheetIndex: 0,
            headerStart,
            headerEnd,
            headerColStart,
            headerColEnd,
          });
        } else {
          await inspect(filePath, 'compare', { sheetIndex: 0, autoHeader: true });
        }
      }
    } catch (err) {
      void dialog.alert({
        title: '파일 열기',
        body: err instanceof Error ? err.message : '파일을 읽지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (which) => {
    try {
      const result = await api('excelCompare.pickFile', { role: which });
      if (result?.cancelled || !result?.path) return;
      await assignFile(result.path, which);
    } catch (err) {
      void dialog.alert({
        title: '파일 선택',
        body: err instanceof Error ? err.message : '파일을 선택하지 못했습니다.',
      });
    }
  };

  const changeSheet = async (which, sheetIndex) => {
    const filePath = which === 'original' ? originalPath : comparePath;
    if (!filePath) return;
    try {
      setBusy(true);
      if (which === 'original') {
        const info = await inspect(filePath, 'original', { sheetIndex, autoHeader: true });
        await applyOriginalHeaderToCompare(info.headerStart, info.headerEnd, info.headerColStart, info.headerColEnd);
      } else {
        await inspect(filePath, 'compare', {
          sheetIndex,
          headerStart: compareHeaderStart,
          headerEnd: compareHeaderEnd,
          headerColStart: compareHeaderColStart,
          headerColEnd: compareHeaderColEnd,
        });
      }
    } catch (err) {
      void dialog.alert({
        title: '시트 변경',
        body: err instanceof Error ? err.message : '시트를 읽지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * @param {'original' | 'compare'} which
   * @param {string} [fromText]
   * @param {string} [toText]
   */
  const changeHeaderRange = async (which, fromText, toText) => {
    const filePath = which === 'original' ? originalPath : comparePath;
    if (!filePath) return;
    const nextFrom = fromText ?? (which === 'original' ? headerFrom : compareHeaderFrom);
    const nextTo = toText ?? (which === 'original' ? headerTo : compareHeaderTo);
    const parsed = parseHeaderCells(nextFrom, nextTo);
    if (!parsed) {
      if (which === 'original') {
        const cells = formatHeaderCells({
          start: headerStart,
          end: headerEnd,
          colStart: headerColStart,
          colEnd: headerColEnd,
        });
        setHeaderFrom(cells.from);
        setHeaderTo(cells.to);
      } else {
        const cells = formatHeaderCells({
          start: compareHeaderStart,
          end: compareHeaderEnd,
          colStart: compareHeaderColStart,
          colEnd: compareHeaderColEnd,
        });
        setCompareHeaderFrom(cells.from);
        setCompareHeaderTo(cells.to);
      }
      return;
    }
    try {
      setBusy(true);
      await inspect(filePath, which, {
        sheetIndex: which === 'original' ? originalSheetIndex : compareSheetIndex,
        headerStart: parsed.start,
        headerEnd: parsed.end,
        headerColStart: parsed.colStart,
        headerColEnd: parsed.colEnd,
      });
      if (which === 'original') {
        await applyOriginalHeaderToCompare(parsed.start, parsed.end, parsed.colStart, parsed.colEnd);
      }
    } catch (err) {
      void dialog.alert({
        title: '헤더 범위',
        body: err instanceof Error ? err.message : '헤더 범위를 적용하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  const autoDetectHeader = async () => {
    if (!originalPath) return;
    try {
      setBusy(true);
      const info = await inspect(originalPath, 'original', {
        sheetIndex: originalSheetIndex,
        autoHeader: true,
      });
      await applyOriginalHeaderToCompare(info.headerStart, info.headerEnd, info.headerColStart, info.headerColEnd);
    } catch (err) {
      void dialog.alert({
        title: '헤더 자동 찾기',
        body: err instanceof Error ? err.message : '헤더 행을 찾지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!canRun) return;
    if (originalSelected.length !== compareSelected.length) {
      void dialog.alert({
        title: '비교',
        body: '원본·비교에서 선택한 컬럼 개수가 같아야 합니다.',
      });
      return;
    }
    setBusy(true);
    setJobRunning(true);
    setProgress(0);
    setProgressMessage('시작…');
    try {
      appendLog('비교 작업 시작…');
      const started = await api('excelCompare.start', {
        originalPath,
        comparePath,
        originalSheetIndex,
        compareSheetIndex,
        headerRow: headerEnd,
        compareHeaderRow: compareHeaderEnd,
        originalCols: [...originalSelected].sort((a, b) => a - b),
        compareCols: [...compareSelected].sort((a, b) => a - b),
        mode,
        matchKind,
        skipEmpty,
        color,
      });
      if (started?.cancelled) {
        appendLog('저장이 취소되었습니다.');
        return;
      }
      const jobId = started.jobId;
      /** @type {any} */
      let job = null;
      let seenLogs = 0;
      while (true) {
        job = await api('excelCompare.job', { jobId });
        setProgress(job.progress ?? 0);
        setProgressMessage(job.message || '');
        if (Array.isArray(job.logs) && job.logs.length > seenLogs) {
          const fresh = job.logs.slice(seenLogs);
          seenLogs = job.logs.length;
          const stamp = new Date().toLocaleTimeString();
          setLogs((prev) => [...prev, ...fresh.map((line) => `[${stamp}] ${line}`)]);
        }
        if (job.state === 'done' || job.state === 'error') break;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (job.state === 'error') {
        appendLog(`실패: ${job.error || '알 수 없는 오류'}`);
        void dialog.alert({ title: '비교', body: job.error || '비교에 실패했습니다.' });
        return;
      }
      const result = job.result;
      setLastOutput(result?.outputPath || '');
      appendLog(
        `완료: 하이라이트 ${result.highlighted}/${result.total}행 · 빈칸 제외 ${result.skippedEmpty ?? 0} · 원본 키 ${result.originalValueCount}개 → ${result.outputPath}`,
      );
    } catch (err) {
      appendLog(`실패: ${err instanceof Error ? err.message : String(err)}`);
      void dialog.alert({
        title: '비교',
        body: err instanceof Error ? err.message : '비교에 실패했습니다.',
      });
    } finally {
      setBusy(false);
      setJobRunning(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  const clearAll = () => {
    setOriginalPath('');
    setComparePath('');
    setOriginalSheets([]);
    setCompareSheets([]);
    setOriginalSheetIndex(0);
    setCompareSheetIndex(0);
    setHeaderStart(1);
    setHeaderEnd(1);
    setHeaderColStart(1);
    setHeaderColEnd(1);
    setHeaderFrom('A1');
    setHeaderTo('A1');
    setCompareHeaderStart(1);
    setCompareHeaderEnd(1);
    setCompareHeaderColStart(1);
    setCompareHeaderColEnd(1);
    setCompareHeaderFrom('A1');
    setCompareHeaderTo('A1');
    setOriginalCols([]);
    setCompareCols([]);
    setOriginalSelected([]);
    setCompareSelected([]);
    setOriginalLegacy(false);
    setCompareLegacy(false);
    setLogs([]);
    setLastOutput('');
    setProgress(0);
    setProgressMessage('');
    void resetWindowSize();
  };

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header>
          <h1 className="m-0 text-xl font-semibold text-slate-900">엑셀(Excel) 비교</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            시트·헤더·다중 컬럼 키로 비교하고, 결과 시트에 배경색으로 표시합니다. 저장 파일은{' '}
            <code className={codeClass}>결과 / 원본 / 비교</code> 세 시트입니다.
          </p>
        </header>

        <Section title="1. 파일 선택">
          <div className="flex flex-col gap-3 sm:flex-row">
            <FileDropCard
              title="원본 파일"
              path={originalPath}
              disabled={busy}
              onPick={() => void pickFile('original')}
              onDropPath={(filePath) => void assignFile(filePath, 'original')}
              onReject={(message) => void dialog.alert({ title: '엑셀(Excel) 비교', body: message })}
            />
            <FileDropCard
              title="비교 파일"
              path={comparePath}
              disabled={busy}
              onPick={() => void pickFile('compare')}
              onDropPath={(filePath) => void assignFile(filePath, 'compare')}
              onReject={(message) => void dialog.alert({ title: '엑셀(Excel) 비교', body: message })}
            />
          </div>
          {(originalLegacy || compareLegacy) && (
            <p className="mt-3 m-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              .xls / .xlsb 는 PC에 Excel이 있으면 서식을 유지해 옮깁니다. Excel이 없으면 값 위주로만 옮겨질 수 있습니다.
            </p>
          )}
        </Section>

        <Section title="2. 시트 · 헤더">
          <p className="m-0 mb-3 text-xs leading-relaxed text-slate-500">
            원본에서 시작 칸·끝 칸을 찾고 비교 파일에도 같은 범위를 적용합니다. 틀리면 각 칸을 고치세요.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold text-slate-600">원본 시트</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-app-accent focus:ring-2 focus:ring-app-accent/15"
                value={originalSheetIndex}
                disabled={!originalSheets.length || busy}
                onChange={(event) => void changeSheet('original', Number(event.target.value))}
              >
                {!originalSheets.length ? <option value={0}>파일 선택 후 표시</option> : null}
                {originalSheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index}>
                    {sheet.index + 1}. {sheet.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold text-slate-600">비교 시트</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-app-accent focus:ring-2 focus:ring-app-accent/15"
                value={compareSheetIndex}
                disabled={!compareSheets.length || busy}
                onChange={(event) => void changeSheet('compare', Number(event.target.value))}
              >
                {!compareSheets.length ? <option value={0}>파일 선택 후 표시</option> : null}
                {compareSheets.map((sheet) => (
                  <option key={sheet.index} value={sheet.index}>
                    {sheet.index + 1}. {sheet.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold text-slate-600">원본 헤더 범위</span>
              <HeaderRangeInputs
                from={headerFrom}
                to={headerTo}
                disabled={!originalPath || busy}
                fromAriaLabel="원본 헤더 시작 칸"
                toAriaLabel="원본 헤더 끝 칸"
                onFromChange={setHeaderFrom}
                onToChange={setHeaderTo}
                onCommit={(nextFrom, nextTo) => void changeHeaderRange('original', nextFrom, nextTo)}
                trailing={
                  <button
                    type="button"
                    className={btnClass}
                    disabled={!originalPath || busy}
                    onClick={() => void autoDetectHeader()}
                  >
                    자동
                  </button>
                }
              />
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold text-slate-600">비교 헤더 범위</span>
              <HeaderRangeInputs
                from={compareHeaderFrom}
                to={compareHeaderTo}
                disabled={!comparePath || busy}
                fromAriaLabel="비교 헤더 시작 칸"
                toAriaLabel="비교 헤더 끝 칸"
                onFromChange={setCompareHeaderFrom}
                onToChange={setCompareHeaderTo}
                onCommit={(nextFrom, nextTo) => void changeHeaderRange('compare', nextFrom, nextTo)}
              />
            </div>
          </div>
        </Section>

        <Section title="3. 비교 컬럼 (복합 키)">
          <div className="grid gap-4 sm:grid-cols-2">
            <ColumnMultiSelect
              label="원본 컬럼"
              columns={originalCols}
              selected={originalSelected}
              disabled={busy}
              onChange={setOriginalSelected}
            />
            <ColumnMultiSelect
              label="비교 컬럼"
              columns={compareCols}
              selected={compareSelected}
              disabled={busy}
              onChange={setCompareSelected}
            />
          </div>
          {originalSelected.length !== compareSelected.length && originalSelected.length > 0 && compareSelected.length > 0 ? (
            <p className="mt-2 m-0 text-xs text-rose-600">원본·비교 선택 개수가 같아야 합니다.</p>
          ) : null}
        </Section>

        <Section title="4. 비교 방식">
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600">표시 대상</div>
              <div className="flex flex-col gap-2">
                {(meta?.modes ?? []).map((item) => (
                  <label key={item.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="excel-compare-mode"
                      checked={mode === item.id}
                      disabled={busy}
                      onChange={() => setMode(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600">일치 판정</div>
              <div className="flex flex-col gap-2">
                {(meta?.matchKinds ?? []).map((item) => (
                  <label key={item.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="excel-compare-match"
                      checked={matchKind === item.id}
                      disabled={busy}
                      onChange={() => setMatchKind(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={skipEmpty}
                  disabled={busy}
                  onChange={(event) => setSkipEmpty(event.target.checked)}
                />
                빈 칸이 있는 행은 비교에서 제외
              </label>
              <p className="mt-1.5 m-0 text-xs leading-relaxed text-slate-500">
                비교 키로 고른 열 중 하나라도 비어 있으면 그 행은 비교·하이라이트 대상에서 뺍니다. (기본값: 켜짐)
                <br />
                원본에서는 빈 칸이 있는 행을 키 목록에 넣지 않고, 비교 파일에서는 그런 행을 하이라이트하지 않습니다.
                <br />
                끄면 빈 칸도 값으로 보고 비교합니다. 키를 여러 열로 쓸 때 일부만 비어 있어도 제외됩니다.
              </p>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold text-slate-600">하이라이트 색상</div>
              <div className="flex flex-wrap gap-4">
                {(meta?.colors ?? []).map((item) => (
                  <label key={item.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="excel-compare-color"
                      checked={color === item.id}
                      disabled={busy}
                      onChange={() => setColor(item.id)}
                    />
                    <span
                      className="inline-block h-4 w-4 rounded border border-slate-300"
                      style={{ backgroundColor: item.swatch }}
                      aria-hidden="true"
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>

            {jobRunning ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                  <span>{progressMessage || '처리 중…'}</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-app-accent transition-[width] duration-200"
                    style={{ width: `${Math.max(2, progress)}%` }}
                  />
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnPrimaryClass} disabled={!canRun} onClick={() => void run()}>
                {jobRunning ? '처리 중…' : '비교 실행 및 저장'}
              </button>
              <button type="button" className={btnClass} disabled={busy} onClick={clearAll}>
                초기화
              </button>
              {lastOutput ? (
                <button
                  type="button"
                  className={btnClass}
                  disabled={busy}
                  onClick={() => void api('excelCompare.reveal', { path: lastOutput })}
                >
                  결과 파일 위치 열기
                </button>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title="안내">
          <ul className="m-0 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
            <li>헤더 범위 다음 행부터 데이터로 비교합니다. 다중 컬럼은 순서대로 이어 붙여 키로 씁니다.</li>
            <li>기본은 완전 일치입니다. 포함 일치는 짧은 문자열이 긴 값에 끼면 오탐이 날 수 있습니다.</li>
            <li>결과 시트에서 선택한 비교 컬럼 칸만 배경색을 바꿉니다.</li>
            <li>
              지원: <code className={codeClass}>.xlsx .xlsm .xltx .xltm .xls .xlt .xlsb</code> (결과는 항상 .xlsx)
            </li>
          </ul>
        </Section>

        <div ref={logSectionRef}>
          <Section title="로그">
            <pre
              ref={logRef}
              className="m-0 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-700"
            >
              {logs.length ? logs.join('\n') : '아직 로그가 없습니다.'}
            </pre>
          </Section>
        </div>
      </div>
    </div>
  );
}
