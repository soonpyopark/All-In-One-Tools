import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { invalidNameReason, splitName } from '../../../shared/renameRules.js';
import {
  Field,
  btnClass,
  btnPrimaryClass,
  inputClass,
} from '../../components/settings/ui.jsx';
import {
  BRACKET_KINDS,
  SORT_KEYS,
  addExt,
  addNumber,
  addPrefix,
  addSuffix,
  changeExt,
  clearName,
  deleteAt,
  deleteBrackets,
  digitsOnly,
  padDigits,
  regexProblem,
  removeExt,
  replaceText,
  toInt,
} from './ops.js';

const TITLE = '파일명 일괄 변경';

/** 이름 변환 도구 목록. */
const TOOLS = [
  { id: 'replace', label: '문자열 바꾸기', group: '이름', desc: '찾은 문자열을 다른 문자열로 바꿉니다. 바꿀 문자열을 비우면 삭제합니다.' },
  { id: 'prefix', label: '이름 앞에 추가', group: '이름', desc: '이름 맨 앞에 문자열을 붙입니다.' },
  { id: 'suffix', label: '이름 뒤에 추가', group: '이름', desc: '이름 뒤(확장자 앞)에 문자열을 붙입니다.' },
  { id: 'clear', label: '이름 지우기', group: '이름', desc: '이름을 모두 지웁니다. 확장자는 그대로 둡니다.' },
  { id: 'deleteAt', label: '위치 지우기', group: '이름', desc: '지정한 위치부터 몇 글자를 지웁니다.' },
  { id: 'brackets', label: '묶인곳 지우기', group: '이름', desc: '괄호와 그 안의 글자를 지웁니다. (예: 책 (완결) → 책)' },
  { id: 'digits', label: '숫자 남기기/삭제', group: '숫자', desc: '이름에서 숫자만 남기거나, 숫자만 지웁니다.' },
  { id: 'pad', label: '자리수 맞추기', group: '숫자', desc: '이름 속 숫자의 자리수를 0 으로 채워 맞춥니다. (예: 7 → 007)' },
  { id: 'number', label: '번호 붙이기', group: '숫자', desc: '목록에 보이는 순서대로 번호를 붙입니다.' },
  { id: 'removeExt', label: '확장자 삭제', group: '확장자', desc: '확장자(.txt 등)를 지웁니다.' },
  { id: 'addExt', label: '확장자 추가', group: '확장자', desc: '이름 끝에 확장자를 붙입니다.' },
  { id: 'changeExt', label: '확장자 변경', group: '확장자', desc: '확장자를 다른 것으로 바꾸거나 대소문자를 바꿉니다.' },
  { id: 'gather', label: '한 폴더에 모으기', group: '위치', desc: '여러 폴더의 파일을 한 폴더로 옮겨 모읍니다.' },
];

/** 숫자 입력은 입력 도중 값을 그대로 보이도록 문자열로 들고 있다가 적용할 때 해석합니다. */
const DEFAULT_PARAMS = {
  replace: { find: '', replace: '', caseSensitive: false, regex: false, includeExt: false },
  prefix: { text: '' },
  suffix: { text: '' },
  deleteAt: { from: '1', count: '1', fromEnd: false },
  brackets: { kinds: ['round', 'square'], keepInner: false, cleanSpaces: true, customOpen: '', customClose: '' },
  digits: { mode: 'keep' },
  pad: { width: '3', which: 'all', trim: false },
  number: { start: '1', step: '1', width: '3', position: 'prefix', at: '1', sep: '_', replaceName: false, perFolder: false },
  addExt: { text: '', onlyIfNone: true },
  changeExt: { text: '', only: '', caseMode: 'keep' },
};

let idSeed = 0;
const nextId = () => `f${(idSeed += 1)}`;

/** 서버가 준 파일 정보를 목록 항목으로. */
function toItem(file) {
  const { base, ext } = splitName(file.name);
  return {
    id: nextId(),
    path: file.path,
    dir: file.dir,
    origName: file.name,
    base,
    ext,
    targetDir: file.dir,
    size: file.size ?? 0,
    mtimeMs: file.mtimeMs ?? 0,
  };
}

const fullName = (item) => item.base + item.ext;
const isChanged = (item) => fullName(item) !== item.origName || item.targetDir !== item.dir;

/** 경로 비교용 키 (Windows 는 대소문자 구분 없음). */
const pathKey = (dir, name) => `${dir}\u0000${name}`.toLowerCase();

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

/** @param {{ checked: boolean, onChange: (v: boolean) => void, children: import('react').ReactNode }} props */
function Check({ checked, onChange, children }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}

/** @param {{ name: string, value: string, options: [string, string][], onChange: (v: string) => void }} props */
function Radios({ name, value, options, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {options.map(([id, label]) => (
        <label key={id} className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
          <input type="radio" name={name} checked={value === id} onChange={() => onChange(id)} />
          {label}
        </label>
      ))}
    </div>
  );
}

/** 확장자 뱃지 (목록 왼쪽). */
function ExtBadge({ ext }) {
  const label = String(ext || '').replace(/^\./, '').toUpperCase() || 'FILE';
  return (
    <span className="inline-flex min-w-[2.4rem] shrink-0 items-center justify-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500">
      {label.slice(0, 5)}
    </span>
  );
}

const ACCENT_DOT = {
  red: 'bg-rose-400',
  blue: 'bg-sky-400',
  green: 'bg-emerald-400',
  olive: 'bg-amber-400',
};

/** 좌우 기능 버튼 한 개. */
function SideButton({ label, color, disabled, title, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="flex max-h-14 min-h-9 w-full flex-1 items-center gap-2 px-3 text-left text-[13px] text-slate-700 transition-colors hover:bg-white hover:text-slate-900 active:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACCENT_DOT[color] || 'bg-slate-300'}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * 상단 메뉴 막대 (파일·편집). 항목은 `{ label, onClick, disabled?, checked?, hint? }` 또는 `{ separator: true }`.
 *
 * @param {{ menus: { id: string, label: string, items: any[] }[] }} props
 */
function MenuBar({ menus }) {
  const [openId, setOpenId] = useState(/** @type {string | null} */ (null));
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    if (openId === null) return undefined;
    const onDown = (event) => {
      if (!ref.current?.contains(event.target)) setOpenId(null);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openId]);

  return (
    <div ref={ref} className="flex items-center border-b border-slate-200 bg-slate-50/80 px-1 text-[13px] text-slate-700">
      {menus.map((menu) => (
        <div key={menu.id} className="relative">
          <button
            type="button"
            aria-expanded={openId === menu.id}
            className={`rounded-md px-3 py-1.5 ${
              openId === menu.id ? 'bg-white text-slate-900 shadow-sm' : 'hover:bg-white/80 hover:text-slate-900'
            }`}
            onClick={() => setOpenId(openId === menu.id ? null : menu.id)}
            onMouseEnter={() => openId !== null && setOpenId(menu.id)}
          >
            {menu.label}
          </button>
          {openId === menu.id ? (
            <div className="absolute left-0 top-full z-30 min-w-[14rem] rounded-md border border-slate-200 bg-white py-1 shadow-lg">
              {menu.items.map((item, index) =>
                item.separator ? (
                  <div key={`sep-${index}`} className="my-1 border-t border-slate-100" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    disabled={item.disabled}
                    className="flex w-full items-center justify-between gap-6 px-4 py-1.5 text-left hover:bg-app-accentSoft hover:text-app-accentText disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit"
                    onClick={() => {
                      setOpenId(null);
                      item.onClick();
                    }}
                  >
                    <span>
                      {item.checked === undefined ? '' : item.checked ? '✓ ' : '\u2003'}
                      {item.label}
                    </span>
                    {item.hint ? <span className="text-xs text-slate-400">{item.hint}</span> : null}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * 옵션 설정 모달. Enter 로 적용, Esc 로 닫습니다. (확인창이 위에 떠 있으면 Esc 는 그쪽이 먼저 처리)
 *
 * @param {{
 *   title: string,
 *   scope: string,
 *   onApply: () => void,
 *   onClose: () => void,
 *   children: import('react').ReactNode,
 * }} props
 */
function ToolModal({ title, scope, onApply, onClose, children }) {
  const dialogRef = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !document.querySelector('[role="alertdialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 처음 열릴 때 첫 입력 칸에 커서를 둡니다.
  useEffect(() => {
    dialogRef.current
      ?.querySelector('input:not([type="checkbox"]):not([type="radio"]), select')
      ?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(32,33,36,0.4)] p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onKeyDown={(event) => {
          const target = /** @type {HTMLInputElement} */ (event.target);
          if (event.key === 'Enter' && target.tagName === 'INPUT' && !['checkbox', 'radio'].includes(target.type)) {
            event.preventDefault();
            onApply();
          }
        }}
      >
        <div className="border-b border-slate-100 px-6 pb-3 pt-5">
          <h2 className="m-0 text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{scope}</p>
        </div>
        <div className="px-6 py-5">{children}</div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-3">
          <button type="button" className={btnClass} onClick={onClose}>취소</button>
          <button type="button" className={btnPrimaryClass} onClick={onApply}>적용</button>
        </div>
      </div>
    </div>
  );
}

export default function RenamePage() {
  const dialog = useDialog();
  const native = getNative();

  const [items, setItems] = useState(/** @type {ReturnType<typeof toItem>[]} */ ([]));
  const [selected, setSelected] = useState(/** @type {Set<string>} */ (new Set()));
  const anchorRef = useRef(/** @type {string | null} */ (null));
  const editCancelRef = useRef(false);
  const [editing, setEditing] = useState(/** @type {{ id: string, text: string } | null} */ (null));
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [includeSub, setIncludeSub] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [sortNatural, setSortNatural] = useState(true);
  const [busy, setBusy] = useState(false);
  /** 열려 있는 옵션 팝업(도구 키, 'sort') 과 끌어놓기 강조. */
  const [modal, setModal] = useState(/** @type {string | null} */ (null));
  const [dragOver, setDragOver] = useState(false);
  /** 마지막으로 적용한 변경 (실행 취소용). */
  const [undoInfo, setUndoInfo] = useState(
    /** @type {{ from: string, prevDir: string, prevName: string }[] | null} */ (null),
  );

  const setP = (toolId, key, value) =>
    setParams((prev) => ({ ...prev, [toolId]: { ...prev[toolId], [key]: value } }));
  const p = params;

  /* ------------------------------ 검증 / 요약 ------------------------------ */

  /** 항목별 문제(id → 메시지). 이름 규칙 위반과 같은 위치의 같은 이름. */
  const problems = useMemo(() => {
    const found = new Map();
    const groups = new Map();
    for (const item of items) {
      const name = fullName(item);
      if (item.base === '') found.set(item.id, '이름이 비어 있습니다.');
      else {
        const reason = invalidNameReason(name);
        if (reason) found.set(item.id, reason);
      }
      const key = pathKey(item.targetDir, name);
      groups.set(key, [...(groups.get(key) ?? []), item.id]);
    }
    for (const ids of groups.values()) {
      if (ids.length > 1) for (const id of ids) if (!found.has(id)) found.set(id, '같은 위치에 같은 이름이 있습니다.');
    }
    return found;
  }, [items]);

  const changedItems = useMemo(() => items.filter(isChanged), [items]);
  const changedProblems = changedItems.filter((item) => problems.has(item.id));
  const targetCount = selected.size > 0 ? items.filter((item) => selected.has(item.id)).length : items.length;

  /* --------------------------------- 목록 --------------------------------- */

  const addFiles = (files) => {
    if (!files?.length) return;
    setItems((prev) => {
      const seen = new Set(prev.map((item) => item.path.toLowerCase()));
      const added = [];
      for (const file of files) {
        const key = file.path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(toItem(file));
      }
      return [...prev, ...added];
    });
  };

  const pickFiles = async () => {
    if (!native?.pickOpenFiles) return;
    const result = await native.pickOpenFiles({
      memoryKey: 'renameInput',
      title: '이름을 바꿀 파일 선택 (여러 개 가능)',
      multi: true,
      filters: [{ name: '모든 파일', extensions: ['*'] }],
    });
    if (result?.canceled || !result?.paths?.length) return;
    await addPaths(result.paths);
  };

  const addFolder = async () => {
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({ memoryKey: 'renameInput', title: '파일을 가져올 폴더 선택' });
    if (picked?.canceled || !picked?.path) return;
    await addPaths([picked.path]);
  };

  /** 파일·폴더 경로를 목록에 추가합니다. 폴더는 안의 파일로 펼칩니다. */
  const addPaths = async (paths) => {
    if (!paths?.length) return;
    try {
      const { files, skipped, truncated } = await api('rename.inspect', { paths, recursive: includeSub });
      addFiles(files);
      const notes = [];
      if (files.length === 0) notes.push('추가할 파일이 없습니다.');
      if (skipped > 0) notes.push(`읽을 수 없는 항목 ${skipped}개는 제외했습니다.`);
      if (truncated) notes.push('파일이 너무 많아 일부만 가져왔습니다. (최대 20,000개)');
      if (notes.length > 0) void dialog.alert({ title: TITLE, body: notes.join('\n') });
    } catch (err) {
      void dialog.alert({ title: TITLE, body: err instanceof Error ? err.message : '파일을 읽지 못했습니다.' });
    }
  };

  /** 탐색기에서 끌어다 놓은 파일·폴더. */
  const onDropFiles = (event) => {
    event.preventDefault();
    setDragOver(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    if (!native?.getPathForFile) {
      void dialog.alert({ title: TITLE, body: '파일 끌어놓기를 쓰려면 앱을 다시 시작해 주세요. (파일 추가 메뉴는 바로 사용할 수 있습니다)' });
      return;
    }
    void addPaths(files.map((file) => native.getPathForFile(file)).filter(Boolean));
  };

  const removeSelected = () => {
    if (selected.size === 0) return;
    setItems((prev) => prev.filter((item) => !selected.has(item.id)));
    setSelected(new Set());
  };

  const clearList = async () => {
    if (items.length === 0) return;
    if (changedItems.length > 0) {
      const ok = await dialog.confirm({
        title: '목록 지우기',
        body: '아직 적용하지 않은 변경이 있습니다. 목록을 비울까요? (파일은 바뀌지 않습니다)',
        confirmLabel: '목록 지우기',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    setItems([]);
    setSelected(new Set());
    setEditing(null);
  };

  /** 선택한 줄을 위/아래로 한 칸씩 옮깁니다. */
  const moveSelected = (direction) => {
    if (selected.size === 0) return;
    setItems((prev) => {
      const arr = [...prev];
      const isSel = (item) => selected.has(item.id);
      if (direction < 0) {
        for (let i = 1; i < arr.length; i += 1) {
          if (isSel(arr[i]) && !isSel(arr[i - 1])) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        }
      } else {
        for (let i = arr.length - 2; i >= 0; i -= 1) {
          if (isSel(arr[i]) && !isSel(arr[i + 1])) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        }
      }
      return arr;
    });
  };

  const sortList = () => {
    const collator = new Intl.Collator('ko', { numeric: sortNatural, sensitivity: 'base' });
    const valueOf = (item) => {
      switch (sortKey) {
        case 'newName': return fullName(item);
        case 'dir': return item.dir;
        case 'mtime': return item.mtimeMs;
        case 'size': return item.size;
        case 'ext': return item.ext;
        default: return item.origName;
      }
    };
    setItems((prev) => {
      const sorted = [...prev].sort((a, b) => {
        const va = valueOf(a);
        const vb = valueOf(b);
        const result = typeof va === 'number' ? va - vb : collator.compare(String(va), String(vb));
        return result || collator.compare(a.origName, b.origName);
      });
      return sortDesc ? sorted.reverse() : sorted;
    });
  };

  /** 대상(선택, 없으면 전체)을 원래 이름·위치로 되돌립니다. */
  const resetNames = () => {
    setItems((prev) =>
      prev.map((item) => {
        if (selected.size > 0 && !selected.has(item.id)) return item;
        return { ...item, ...splitName(item.origName), targetDir: item.dir };
      }),
    );
  };

  /* --------------------------------- 선택 --------------------------------- */

  const onRowClick = (event, item) => {
    if (editing) return;
    if (event.shiftKey && anchorRef.current) {
      const a = items.findIndex((x) => x.id === anchorRef.current);
      const b = items.findIndex((x) => x.id === item.id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        const range = items.slice(from, to + 1).map((x) => x.id);
        setSelected((prev) => new Set(event.ctrlKey || event.metaKey ? [...prev, ...range] : range));
        return;
      }
    }
    anchorRef.current = item.id;
    if (event.ctrlKey || event.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
    } else {
      setSelected(new Set([item.id]));
    }
  };

  const startEdit = (item) => {
    editCancelRef.current = false;
    setEditing({ id: item.id, text: fullName(item) });
  };

  const startEditSelected = () => {
    const first = items.find((item) => selected.has(item.id));
    if (!first) {
      void dialog.alert({ title: TITLE, body: '이름을 직접 바꿀 항목을 먼저 선택해 주세요. (바뀔 이름 칸을 더블클릭해도 됩니다)' });
      return;
    }
    startEdit(first);
  };

  const commitEdit = () => {
    if (!editing) return;
    // Esc 로 취소한 뒤 입력 칸이 사라지며 blur 가 와도 반영하지 않습니다.
    if (editCancelRef.current) {
      editCancelRef.current = false;
      setEditing(null);
      return;
    }
    const { id, text } = editing;
    setEditing(null);
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...splitName(text) } : item)));
  };

  const onTableKeyDown = (event) => {
    if (editing) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelected(new Set(items.map((item) => item.id)));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (undoInfo && !busy) void undoLast();
    } else if (event.key === 'F2') {
      event.preventDefault();
      startEditSelected();
    } else if (event.key === 'Delete') {
      removeSelected();
    }
  };

  /* ------------------------------ 이름 변환 적용 ------------------------------ */

  /**
   * 대상 항목마다 `fn(parts, order)` 를 적용합니다. `order` 는 대상 안에서의 순서
   * (`perFolder` 면 폴더별 순서).
   */
  const mutate = (fn, perFolder = false) => {
    if (items.length === 0) {
      void dialog.alert({ title: TITLE, body: '먼저 파일이나 폴더를 추가해 주세요.' });
      return;
    }
    const useSelection = selected.size > 0;
    setItems((prev) => {
      let order = 0;
      const perDir = new Map();
      return prev.map((item) => {
        if (useSelection && !selected.has(item.id)) return item;
        let index = order;
        order += 1;
        if (perFolder) {
          index = perDir.get(item.dir) ?? 0;
          perDir.set(item.dir, index + 1);
        }
        return { ...item, ...fn({ base: item.base, ext: item.ext }, index) };
      });
    });
  };

  const gather = async () => {
    if (items.length === 0) {
      void dialog.alert({ title: TITLE, body: '먼저 파일이나 폴더를 추가해 주세요.' });
      return;
    }
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({ memoryKey: 'renameGather', title: '파일을 모을 폴더 선택' });
    if (picked?.canceled || !picked?.path) return;
    const useSelection = selected.size > 0;
    setItems((prev) =>
      prev.map((item) => (useSelection && !selected.has(item.id) ? item : { ...item, targetDir: picked.path })),
    );
  };

  /** 도구를 대상에 적용합니다. 적용했으면 true, 입력이 잘못돼 안내만 띄웠으면 false. */
  const runTool = (toolKey) => {
    switch (toolKey) {
      case 'replace': {
        const q = p.replace;
        if (!q.find) {
          void dialog.alert({ title: TITLE, body: '찾을 문자열을 입력해 주세요.' });
          return;
        }
        const problem = regexProblem(q.find, q.regex);
        if (problem) {
          void dialog.alert({ title: TITLE, body: problem });
          return;
        }
        mutate((parts) => replaceText(parts, q));
        break;
      }
      case 'prefix':
        if (!p.prefix.text) return void dialog.alert({ title: TITLE, body: '추가할 문자열을 입력해 주세요.' });
        mutate((parts) => addPrefix(parts, p.prefix.text));
        break;
      case 'suffix':
        if (!p.suffix.text) return void dialog.alert({ title: TITLE, body: '추가할 문자열을 입력해 주세요.' });
        mutate((parts) => addSuffix(parts, p.suffix.text));
        break;
      case 'clear':
        mutate((parts) => clearName(parts));
        break;
      case 'deleteAt': {
        const q = {
          from: toInt(p.deleteAt.from, 1, 999, 1),
          count: toInt(p.deleteAt.count, 1, 999, 1),
          fromEnd: p.deleteAt.fromEnd,
        };
        mutate((parts) => deleteAt(parts, q));
        break;
      }
      case 'brackets': {
        const q = p.brackets;
        const pairs = BRACKET_KINDS.filter((kind) => q.kinds.includes(kind.id)).map((kind) => [kind.open, kind.close]);
        if (q.customOpen && q.customClose) pairs.push([q.customOpen, q.customClose]);
        if (pairs.length === 0) return void dialog.alert({ title: TITLE, body: '지울 묶음 기호를 하나 이상 선택해 주세요.' });
        mutate((parts) => deleteBrackets(parts, { pairs, keepInner: q.keepInner, cleanSpaces: q.cleanSpaces }));
        break;
      }
      case 'digits':
        mutate((parts) => digitsOnly(parts, p.digits.mode));
        break;
      case 'pad': {
        const q = { width: toInt(p.pad.width, 1, 20, 3), which: p.pad.which, trim: p.pad.trim };
        mutate((parts) => padDigits(parts, q));
        break;
      }
      case 'number': {
        const q = p.number;
        const opts = {
          start: toInt(q.start, 0, 999999999, 1),
          step: toInt(q.step, 1, 999999, 1),
          width: toInt(q.width, 1, 20, 3),
          position: q.position,
          at: toInt(q.at, 1, 999, 1),
          sep: q.sep,
          replaceName: q.replaceName,
        };
        mutate((parts, index) => addNumber(parts, index, opts), q.perFolder);
        break;
      }
      case 'removeExt':
        mutate((parts) => removeExt(parts));
        break;
      case 'addExt':
        if (!p.addExt.text.trim()) return void dialog.alert({ title: TITLE, body: '추가할 확장자를 입력해 주세요.' });
        mutate((parts) => addExt(parts, p.addExt));
        break;
      case 'changeExt':
        if (!p.changeExt.text.trim() && p.changeExt.caseMode === 'keep') {
          return void dialog.alert({ title: TITLE, body: '새 확장자를 입력하거나 대소문자 변환을 선택해 주세요.' });
        }
        mutate((parts) => changeExt(parts, p.changeExt));
        break;
      default:
        break;
    }
    return true;
  };

  /* ------------------------------ 실제 적용 / 취소 ------------------------------ */

  /** 성공한 결과를 목록에 반영합니다. (현재 이름·위치가 새 값이 되고 변경 예정은 없어짐) */
  const applyResults = (results) => {
    const byFrom = new Map(results.filter((r) => r.ok).map((r) => [r.from.toLowerCase(), r]));
    setItems((prev) =>
      prev.map((item) => {
        const result = byFrom.get(item.path.toLowerCase());
        if (!result) return item;
        return {
          ...item,
          path: result.to,
          dir: result.toDir,
          origName: result.toName,
          ...splitName(result.toName),
          targetDir: result.toDir,
        };
      }),
    );
  };

  const applyRename = async () => {
    if (busy) return;
    if (changedItems.length === 0) {
      void dialog.alert({ title: TITLE, body: '바뀌는 이름이 없습니다. 도구로 이름을 바꾸거나 이름을 직접 수정해 주세요.' });
      return;
    }
    if (changedProblems.length > 0) {
      const lines = changedProblems
        .slice(0, 8)
        .map((item) => `${item.origName} → ${fullName(item) || '(빈 이름)'}: ${problems.get(item.id)}`);
      void dialog.alert({
        title: '적용할 수 없습니다',
        body: `문제가 있는 항목이 ${changedProblems.length}개 있습니다. 빨간색으로 표시된 줄을 고쳐 주세요.\n\n${lines.join('\n')}`,
      });
      return;
    }
    const moves = changedItems.filter((item) => item.targetDir !== item.dir).length;
    const ok = await dialog.confirm({
      title: '실제로 적용',
      body: `${changedItems.length}개 파일을 바꿉니다.${moves > 0 ? ` (그중 ${moves}개는 다른 폴더로 이동)` : ''}\n적용 후에도 "실행 취소"로 되돌릴 수 있습니다.`,
      confirmLabel: '적용',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const snapshot = new Map(changedItems.map((item) => [item.path.toLowerCase(), item]));
      const res = await api('rename.apply', {
        items: changedItems.map((item) => ({ from: item.path, toDir: item.targetDir, toName: fullName(item) })),
      });
      const undo = [];
      applyResults(res.results);
      for (const result of res.results) {
        if (!result.ok) continue;
        const before = snapshot.get(result.from.toLowerCase());
        if (before) undo.push({ from: result.to, prevDir: before.dir, prevName: before.origName });
      }
      setUndoInfo(undo.length > 0 ? undo : null);
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length > 0) {
        void dialog.alert({
          title: TITLE,
          body: `${res.done}개 적용, ${failed.length}개 실패했습니다.\n\n${failed
            .slice(0, 8)
            .map((r) => `${r.from}\n  → ${r.error}`)
            .join('\n')}`,
        });
      }
    } catch (err) {
      void dialog.alert({ title: TITLE, body: err instanceof Error ? err.message : '적용하지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const undoLast = async () => {
    if (!undoInfo || busy) return;
    const ok = await dialog.confirm({
      title: '실행 취소',
      body: `마지막으로 적용한 ${undoInfo.length}개 파일을 이전 이름·위치로 되돌릴까요?`,
      confirmLabel: '되돌리기',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api('rename.apply', {
        items: undoInfo.map((entry) => ({ from: entry.from, toDir: entry.prevDir, toName: entry.prevName })),
      });
      applyResults(res.results);
      const failed = res.results.filter((r) => !r.ok);
      setUndoInfo(null);
      if (failed.length > 0) {
        void dialog.alert({
          title: TITLE,
          body: `${res.done}개 되돌리고 ${failed.length}개는 되돌리지 못했습니다.\n\n${failed
            .slice(0, 8)
            .map((r) => `${r.from}\n  → ${r.error}`)
            .join('\n')}`,
        });
      }
    } catch (err) {
      void dialog.alert({ title: TITLE, body: err instanceof Error ? err.message : '되돌리지 못했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  /* --------------------------------- 도구 UI --------------------------------- */

  const toolPanel = (toolKey) => {
    switch (toolKey) {
      case 'replace':
        return (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="찾을 문자열">
                <input className={inputClass} value={p.replace.find} onChange={(e) => setP('replace', 'find', e.target.value)} />
              </Field>
              <Field label="바꿀 문자열 (비우면 삭제)">
                <input className={inputClass} value={p.replace.replace} onChange={(e) => setP('replace', 'replace', e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Check checked={p.replace.caseSensitive} onChange={(v) => setP('replace', 'caseSensitive', v)}>대소문자 구분</Check>
              <Check checked={p.replace.regex} onChange={(v) => setP('replace', 'regex', v)}>정규식 사용 ($1 등 사용 가능)</Check>
              <Check checked={p.replace.includeExt} onChange={(v) => setP('replace', 'includeExt', v)}>확장자 포함</Check>
            </div>
          </div>
        );
      case 'prefix':
        return (
          <Field label="이름 앞에 붙일 문자열">
            <input className={inputClass} value={p.prefix.text} onChange={(e) => setP('prefix', 'text', e.target.value)} />
          </Field>
        );
      case 'suffix':
        return (
          <Field label="이름 뒤(확장자 앞)에 붙일 문자열">
            <input className={inputClass} value={p.suffix.text} onChange={(e) => setP('suffix', 'text', e.target.value)} />
          </Field>
        );
      case 'clear':
        return (
          <p className="m-0 text-sm text-slate-600">
            이어서 <b>번호 붙이기</b>나 <b>이름 앞에 추가</b>로 새 이름을 만드세요.
          </p>
        );
      case 'deleteAt':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="시작 위치 (번째 글자)">
                <input className={`${inputClass} w-32`} type="number" min={1} value={p.deleteAt.from} onChange={(e) => setP('deleteAt', 'from', e.target.value)} />
              </Field>
              <Field label="지울 글자 수">
                <input className={`${inputClass} w-32`} type="number" min={1} value={p.deleteAt.count} onChange={(e) => setP('deleteAt', 'count', e.target.value)} />
              </Field>
            </div>
            <Check checked={p.deleteAt.fromEnd} onChange={(v) => setP('deleteAt', 'fromEnd', v)}>뒤에서부터 세기 (1 = 마지막 글자)</Check>
          </div>
        );
      case 'brackets':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {BRACKET_KINDS.map((kind) => (
                <Check
                  key={kind.id}
                  checked={p.brackets.kinds.includes(kind.id)}
                  onChange={(v) =>
                    setP('brackets', 'kinds', v ? [...p.brackets.kinds, kind.id] : p.brackets.kinds.filter((id) => id !== kind.id))
                  }
                >
                  {kind.label}
                </Check>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="직접 지정: 여는 기호">
                <input className={`${inputClass} w-28`} value={p.brackets.customOpen} onChange={(e) => setP('brackets', 'customOpen', e.target.value)} />
              </Field>
              <Field label="닫는 기호">
                <input className={`${inputClass} w-28`} value={p.brackets.customClose} onChange={(e) => setP('brackets', 'customClose', e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Check checked={p.brackets.keepInner} onChange={(v) => setP('brackets', 'keepInner', v)}>기호만 지우고 안의 글자는 남기기</Check>
              <Check checked={p.brackets.cleanSpaces} onChange={(v) => setP('brackets', 'cleanSpaces', v)}>남는 공백 정리</Check>
            </div>
          </div>
        );
      case 'digits':
        return (
          <Radios
            name="digits-mode"
            value={p.digits.mode}
            onChange={(v) => setP('digits', 'mode', v)}
            options={[
              ['keep', '숫자만 남기기 (숫자 외 글자 삭제)'],
              ['remove', '숫자 지우기 (숫자만 삭제)'],
            ]}
          />
        );
      case 'pad':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="자리수">
                <input className={`${inputClass} w-32`} type="number" min={1} max={20} value={p.pad.width} onChange={(e) => setP('pad', 'width', e.target.value)} />
              </Field>
            </div>
            <Radios
              name="pad-which"
              value={p.pad.which}
              onChange={(v) => setP('pad', 'which', v)}
              options={[['all', '모든 숫자'], ['first', '첫 번째 숫자'], ['last', '마지막 숫자']]}
            />
            <Check checked={p.pad.trim} onChange={(v) => setP('pad', 'trim', v)}>자리수를 넘는 앞쪽 0 은 줄이기 (예: 0007 → 07)</Check>
            <p className="m-0 text-xs text-slate-500">예) 자리수 3: 7 → 007, 12 → 012</p>
          </div>
        );
      case 'number':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="시작 번호">
                <input className={`${inputClass} w-28`} type="number" min={0} value={p.number.start} onChange={(e) => setP('number', 'start', e.target.value)} />
              </Field>
              <Field label="증가값">
                <input className={`${inputClass} w-28`} type="number" min={1} value={p.number.step} onChange={(e) => setP('number', 'step', e.target.value)} />
              </Field>
              <Field label="자리수">
                <input className={`${inputClass} w-28`} type="number" min={1} max={20} value={p.number.width} onChange={(e) => setP('number', 'width', e.target.value)} />
              </Field>
              <Field label="이름과의 구분 문자">
                <input className={`${inputClass} w-28`} value={p.number.sep} onChange={(e) => setP('number', 'sep', e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Radios
                name="number-pos"
                value={p.number.position}
                onChange={(v) => setP('number', 'position', v)}
                options={[['prefix', '이름 앞'], ['suffix', '이름 뒤'], ['at', '지정한 위치']]}
              />
              {p.number.position === 'at' ? (
                <input
                  className={`${inputClass} w-24`}
                  type="number"
                  min={1}
                  aria-label="번호를 넣을 위치(번째 글자 앞)"
                  value={p.number.at}
                  onChange={(e) => setP('number', 'at', e.target.value)}
                />
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Check checked={p.number.replaceName} onChange={(v) => setP('number', 'replaceName', v)}>기존 이름은 지우고 번호만 사용</Check>
              <Check checked={p.number.perFolder} onChange={(v) => setP('number', 'perFolder', v)}>폴더마다 번호 다시 시작</Check>
            </div>
            <p className="m-0 text-xs text-slate-500">목록에 보이는 순서대로 번호가 붙습니다. 순서는 “목록 정렬”, “선택항목 위로/아래로”로 바꿀 수 있습니다.</p>
          </div>
        );
      case 'removeExt':
        return <p className="m-0 text-sm text-slate-600">별도 설정이 없습니다. 아래 버튼을 누르면 대상 파일의 확장자가 사라집니다.</p>;
      case 'addExt':
        return (
          <div className="space-y-3">
            <Field label="추가할 확장자 (점 없이)">
              <input className={`${inputClass} w-48`} placeholder="예: txt" value={p.addExt.text} onChange={(e) => setP('addExt', 'text', e.target.value)} />
            </Field>
            <Check checked={p.addExt.onlyIfNone} onChange={(v) => setP('addExt', 'onlyIfNone', v)}>확장자가 없는 파일에만 추가</Check>
          </div>
        );
      case 'changeExt':
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="새 확장자 (점 없이)">
                <input className={`${inputClass} w-44`} placeholder="예: jpg" value={p.changeExt.text} onChange={(e) => setP('changeExt', 'text', e.target.value)} />
              </Field>
              <Field label="이 확장자만 변경 (비우면 전체, 쉼표로 구분)">
                <input className={`${inputClass} w-64`} placeholder="예: jpeg, jpe" value={p.changeExt.only} onChange={(e) => setP('changeExt', 'only', e.target.value)} />
              </Field>
            </div>
            <Radios
              name="ext-case"
              value={p.changeExt.caseMode}
              onChange={(v) => setP('changeExt', 'caseMode', v)}
              options={[['keep', '대소문자 그대로'], ['lower', '소문자로'], ['upper', '대문자로']]}
            />
            <p className="m-0 text-xs text-slate-500">확장자가 없는 파일은 건너뜁니다. 새 확장자를 비우고 대소문자만 바꿀 수도 있습니다.</p>
          </div>
        );
      default:
        return null;
    }
  };

  /** 목록 정렬 팝업의 내용. */
  const sortPanel = () => (
    <div className="space-y-4">
      <Radios
        name="rename-sort"
        value={sortKey}
        onChange={setSortKey}
        options={SORT_KEYS.map((key) => [key.id, key.label])}
      />
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <Check checked={sortDesc} onChange={setSortDesc}>내림차순</Check>
        <Check checked={sortNatural} onChange={setSortNatural}>숫자 크기로 정렬 (2 &lt; 10)</Check>
      </div>
    </div>
  );

  /** 팝업의 [적용]: 도구를 적용하고 성공하면 닫습니다. */
  const applyModal = () => {
    if (modal === 'sort') {
      sortList();
      setModal(null);
      return;
    }
    if (modal && runTool(modal)) setModal(null);
  };

  const hasSelection = selected.size > 0;
  const hasItems = items.length > 0;
  const moveCount = changedItems.filter((item) => item.targetDir !== item.dir).length;
  const firstProblem = changedProblems[0] ?? items.find((item) => problems.has(item.id));
  const modalTitle = modal === 'sort' ? '목록 정렬' : (TOOLS.find((t) => t.id === modal)?.label ?? '');
  const scopeText = `${hasSelection ? `선택한 ${targetCount}개` : `전체 ${items.length}개`}에 적용합니다. 파일은 아직 바뀌지 않으며 “바뀔이름”에만 반영됩니다.`;

  /** 왼쪽·오른쪽 버튼 열. 도구 버튼은 옵션 팝업을, 나머지는 바로 실행합니다. */
  const leftButtons = [
    { label: '실제로 적용하기', color: 'red', disabled: busy || changedItems.length === 0, onClick: () => void applyRename() },
    { label: '문자열 바꾸기', color: 'red', onClick: () => setModal('replace') },
    { label: '이름 앞에 추가', color: 'red', onClick: () => setModal('prefix') },
    { label: '이름 뒤에 추가', color: 'red', onClick: () => setModal('suffix') },
    { label: '이름 지우기', color: 'blue', title: '이름(확장자 제외)을 바로 지웁니다', onClick: () => runTool('clear') },
    { label: '위치 지우기', color: 'blue', onClick: () => setModal('deleteAt') },
    { label: '묶인곳 지우기', color: 'blue', onClick: () => setModal('brackets') },
    { label: '숫자 남기기/삭제', color: 'blue', onClick: () => setModal('digits') },
    { label: '자리수 맞추기', color: 'green', onClick: () => setModal('pad') },
    { label: '번호 붙이기', color: 'green', onClick: () => setModal('number') },
  ];
  const rightButtons = [
    { label: '원래 이름으로', color: 'red', onClick: resetNames, title: '선택항목(없으면 전체)을 원래 이름·위치로' },
    { label: '목록 지우기', color: 'blue', onClick: () => void clearList() },
    { label: '목록 정렬', color: 'blue', onClick: () => setModal('sort') },
    { label: '이름 직접 변경', color: 'blue', onClick: startEditSelected, title: '바뀔이름 칸을 더블클릭하거나 F2 로도 가능' },
    { label: '선택항목 위로', color: 'blue', disabled: !hasSelection, onClick: () => moveSelected(-1) },
    { label: '선택항목 아래로', color: 'blue', disabled: !hasSelection, onClick: () => moveSelected(1) },
    { label: '한 폴더에 모으기', color: 'olive', onClick: () => void gather() },
    { label: '확장자 삭제', color: 'green', title: '확장자를 바로 지웁니다', onClick: () => runTool('removeExt') },
    { label: '확장자 추가', color: 'green', onClick: () => setModal('addExt') },
    { label: '확장자 변경', color: 'green', onClick: () => setModal('changeExt') },
  ];

  const menus = [
    {
      id: 'file',
      label: '파일(F)',
      items: [
        { label: '파일 추가…', onClick: () => void pickFiles() },
        { label: '폴더 추가…', onClick: () => void addFolder() },
        { label: '폴더 추가 시 하위 폴더 포함', checked: includeSub, onClick: () => setIncludeSub((v) => !v) },
        { separator: true },
        { label: '실제로 적용하기', disabled: busy || changedItems.length === 0, onClick: () => void applyRename() },
      ],
    },
    {
      id: 'edit',
      label: '편집(E)',
      items: [
        { label: '실행 취소', hint: 'Ctrl+Z', disabled: busy || !undoInfo, onClick: () => void undoLast() },
        { separator: true },
        { label: '전체 선택', hint: 'Ctrl+A', disabled: !hasItems, onClick: () => setSelected(new Set(items.map((i) => i.id))) },
        { label: '선택 해제', disabled: !hasSelection, onClick: () => setSelected(new Set()) },
        { label: '선택 항목을 목록에서 제거', hint: 'Delete', disabled: !hasSelection, onClick: removeSelected },
      ],
    },
  ];

  /* --------------------------------- 렌더 --------------------------------- */

  return (
    <div
      className="flex h-full flex-col gap-3 overflow-auto px-6 py-6"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
    >
      <div>
        <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
        <p className="mt-1 text-sm text-slate-500">
          도구로 “바뀔이름”을 미리보기한 뒤, 적용을 눌러 실제 파일을 바꿉니다.
        </p>
      </div>

      <div className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <MenuBar menus={menus} />

        <div className="flex min-h-0 flex-1">
          {/* 왼쪽 버튼 열 */}
          <aside className="flex w-40 shrink-0 flex-col border-r border-slate-200 bg-slate-50 py-1">
            {leftButtons.map((button) => (
              <SideButton
                key={button.label}
                {...button}
                disabled={button.disabled ?? (!hasItems && button.label !== '실제로 적용하기')}
              />
            ))}
          </aside>

          {/* 가운데 목록 — 열 전체(빈 화면·목록 모두)가 끌어다 놓기 영역 */}
          <div
            tabIndex={0}
            onKeyDown={onTableKeyDown}
            onDragEnter={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setDragOver(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) return;
              setDragOver(false);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              onDropFiles(event);
            }}
            className={`relative flex min-w-0 flex-1 flex-col overflow-auto outline-none ${
              dragOver ? 'bg-app-accentSoft/40' : hasItems ? 'bg-white' : 'bg-slate-50/50'
            }`}
          >
            {!hasItems ? (
              <div
                className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-2 border-dashed px-6 text-center ${
                  dragOver
                    ? 'border-app-accent bg-app-accentSoft text-app-accentText'
                    : 'border-slate-200 bg-white text-slate-500'
                }`}
              >
                <p className="m-0 text-sm">
                  {dragOver
                    ? '놓으면 목록에 추가됩니다'
                    : '이름을 바꿀 파일이나 폴더를 여기로 끌어다 놓거나, 아래 버튼으로 추가하세요.'}
                </p>
                <div className="flex gap-2">
                  <button type="button" className={btnPrimaryClass} onClick={() => void pickFiles()}>파일 추가</button>
                  <button type="button" className={btnClass} onClick={() => void addFolder()}>폴더 추가</button>
                </div>
              </div>
            ) : (
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '36%' }} />
                  <col />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-600">
                  <tr className="border-b border-slate-200">
                    <th className="px-3 py-2 text-xs font-semibold">현재이름</th>
                    <th className="px-3 py-2 text-xs font-semibold">바뀔이름</th>
                    <th className="px-3 py-2 text-xs font-semibold">파일위치</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const changed = isChanged(item);
                    const problem = problems.get(item.id);
                    const isSel = selected.has(item.id);
                    const moved = item.targetDir !== item.dir;
                    return (
                      <tr
                        key={item.id}
                        onClick={(event) => onRowClick(event, item)}
                        className={`cursor-default border-b border-slate-100 ${
                          isSel
                            ? 'bg-app-accentSoft ring-1 ring-inset ring-app-accentBorder'
                            : 'text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <td className="truncate px-3 py-1.5" title={item.origName}>
                          <span className="inline-flex max-w-full items-center gap-2">
                            <ExtBadge ext={item.ext} />
                            <span className="truncate">{item.origName}</span>
                          </span>
                        </td>
                        <td
                          className={`px-3 py-1.5 ${
                            problem ? 'text-red-600' : changed ? 'font-medium text-app-accent' : ''
                          }`}
                          title={problem || fullName(item)}
                          onDoubleClick={() => startEdit(item)}
                        >
                          {editing?.id === item.id ? (
                            <input
                              autoFocus
                              className="w-full rounded border border-app-accent bg-white px-1.5 py-0 text-sm font-normal text-slate-900 outline-none"
                              value={editing.text}
                              onChange={(e) => setEditing({ id: item.id, text: e.target.value })}
                              onFocus={(e) => {
                                const { base } = splitName(e.target.value);
                                e.target.setSelectionRange(0, base.length);
                              }}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitEdit();
                                if (e.key === 'Escape') {
                                  editCancelRef.current = true;
                                  setEditing(null);
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onDoubleClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <span className={`block truncate ${problem ? 'font-medium' : ''}`}>
                              {fullName(item) || '(빈 이름)'}
                            </span>
                          )}
                        </td>
                        <td
                          className={`truncate px-3 py-1.5 text-slate-500 ${moved ? 'text-amber-700' : ''}`}
                          title={moved ? `${item.dir} → ${item.targetDir}` : item.dir}
                        >
                          {moved ? `→ ${item.targetDir}` : item.dir}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {dragOver && hasItems ? (
              <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-app-accent bg-app-accentSoft/80 text-sm font-medium text-app-accentText">
                놓으면 목록에 추가됩니다
              </div>
            ) : null}
          </div>

          {/* 오른쪽 버튼 열 */}
          <aside className="flex w-40 shrink-0 flex-col border-l border-slate-200 bg-slate-50 py-1">
            {rightButtons.map((button) => (
              <SideButton
                key={button.label}
                {...button}
                disabled={button.disabled ?? !hasItems}
              />
            ))}
          </aside>
        </div>

        {/* 하단 요약 */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {firstProblem ? (
            <span className="text-red-600">
              {firstProblem.origName}: {problems.get(firstProblem.id)}
            </span>
          ) : (
            <>
              <span>{items.length}개</span>
              {hasItems ? (
                <>
                  <span className="text-slate-300">·</span>
                  <span>선택 {selected.size}</span>
                  <span className="text-slate-300">·</span>
                  <span>변경 예정 {changedItems.length}</span>
                  {moveCount > 0 ? (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>이동 {moveCount}</span>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      </div>

      {modal ? (
        <ToolModal title={modalTitle} scope={scopeText} onApply={applyModal} onClose={() => setModal(null)}>
          {modal === 'sort' ? sortPanel() : toolPanel(modal)}
        </ToolModal>
      ) : null}
    </div>
  );
}
