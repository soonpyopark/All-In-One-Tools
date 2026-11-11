import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { useReportJobRunning } from '../../context/JobActivityContext.jsx';
import { useJobProgressScroll } from '../../hooks/useJobProgressScroll.js';
import { eventToAccelerator } from '../../../shared/keys.js';
import {
  Badge,
  Field,
  Section,
  ToggleRow,
  btnClass,
  btnDangerClass,
  btnPrimaryClass,
  btnSmClass,
  inputClass,
} from '../../components/settings/ui.jsx';
import StepEditor, { newStep } from './StepEditor.jsx';
import TargetEditor from './TargetEditor.jsx';

const DEFAULT_TARGET = { mode: 'screen', displayId: null, windowTitle: '', region: null };

/** 새 매크로의 기본값: 캡처 → 다음 페이지(PageDown) → 대기 */
function createPreset() {
  return {
    id: crypto.randomUUID(),
    name: '새 매크로',
    startKey: 'F6',
    stopKey: 'F7',
    repeat: 1000,
    outputDir: '',
    format: 'png',
    jpegQuality: 90,
    detectSame: true,
    changeTimeoutMs: 15000,
    resendOnTimeout: false,
    sameThreshold: 0.0001,
    hideApp: true,
    startDelayMs: 1000,
    steps: [{ ...newStep('capture') }, { ...newStep('key') }, { type: 'delay', ms: 600 }],
  };
}

const snapshot = (preset) => JSON.stringify(preset);

/** 시작/중지 단축키 입력: "누를 때" 를 누른 뒤 원하는 키(조합)를 누릅니다. */
function HotkeyInput({ value, onChange, label }) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return undefined;
    const onKeyDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCapturing(false);
        return;
      }
      const accelerator = eventToAccelerator(event);
      if (accelerator) {
        onChange(accelerator);
        setCapturing(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onChange]);

  return (
    <button
      type="button"
      onClick={() => setCapturing((on) => !on)}
      aria-label={label}
      title="클릭한 뒤 원하는 키(조합)를 누르세요. Esc 로 취소합니다."
      className={`${inputClass} flex items-center justify-between text-left font-mono ${capturing ? 'border-app-accent ring-2 ring-app-accent/15' : ''}`}
    >
      <span className={capturing ? 'text-app-accent' : ''}>{capturing ? '키를 누르세요…' : value}</span>
      <span className="font-sans text-xs text-slate-400">{capturing ? 'Esc 취소' : '클릭해서 변경'}</span>
    </button>
  );
}

/**
 * 프리셋 이름 바꾸기 팝업. Enter 로 확인, Esc 로 취소합니다.
 *
 * @param {{ initialName: string, onSubmit: (name: string) => void, onClose: () => void }} props
 */
function RenameDialog({ initialName, onSubmit, onClose }) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const trimmed = name.trim();

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-[rgba(32,33,36,0.4)] p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="프리셋 이름 바꾸기"
        className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
      >
        <h2 className="m-0 text-base font-semibold text-slate-900">프리셋 이름 바꾸기</h2>
        <input
          ref={inputRef}
          className={`${inputClass} mt-4`}
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          aria-label="새 이름"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={btnClass} onClick={onClose}>취소</button>
          <button type="button" className={btnPrimaryClass} disabled={!trimmed} onClick={submit}>확인</button>
        </div>
      </div>
    </div>
  );
}

/** "⋯" 더보기 메뉴 (복제 / 이동 / 삭제 등). */
function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className={`${btnClass} px-2.5`} onClick={() => setOpen((on) => !on)} aria-haspopup="menu" aria-expanded={open} aria-label="더보기">
        ⋯
      </button>
      {open ? (
        <ul role="menu" className="absolute right-0 z-20 mt-1 w-36 list-none overflow-hidden rounded-md border border-slate-200 bg-white p-1 shadow-lg">
          {items.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`w-full rounded px-3 py-1.5 text-left text-sm disabled:opacity-40 ${
                  item.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** 소수 입력(%) 칸. 입력 도중의 "0." 같은 값은 그대로 두고, 올바른 값일 때만 반영합니다. */
function PercentInput({ value, onChange, min = 0.0001, max = 50, step = 0.01, label = '' }) {
  const [text, setText] = useState(String(value));

  // 프리셋을 바꾸는 등 바깥에서 값이 바뀌면 입력 칸도 맞춥니다.
  useEffect(() => {
    setText((current) => (Number(current) === value ? current : String(value)));
  }, [value]);

  return (
    <input
      className={inputClass}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const n = Number(event.target.value);
        if (event.target.value.trim() !== '' && Number.isFinite(n) && n >= min) onChange(Math.min(max, n));
      }}
      onBlur={() => setText(String(value))}
      aria-label={label}
    />
  );
}

/** 소수점 6자리까지 반올림 (100 − x 계산에서 생기는 부동소수 오차 제거). */
const round6 = (n) => Math.round(n * 1e6) / 1e6;

const TABS = [
  { id: 'macro', label: '매크로 캡처' },
  { id: 'quick', label: '빠른 캡처' },
];

function runTone(state) {
  if (state === 'running') return 'amber';
  if (state === 'done') return 'green';
  if (state === 'stopped') return 'slate';
  return 'red';
}

const RUN_LABELS = { running: '실행 중', done: '완료', stopped: '중지됨', error: '오류' };

/** 매크로 화면 캡처: 화면/창/영역 캡처 + 키보드·마우스 매크로 프리셋. */
export default function CapturePage({ featureId } = {}) {
  const dialog = useDialog();
  const native = getNative();

  const [tab, setTab] = useState('macro');
  const [info, setInfo] = useState(/** @type {{ defaultOutputDir: string } | null} */ (null));
  const [targets, setTargets] = useState(/** @type {any} */ (null));
  const [presets, setPresets] = useState(/** @type {any[]} */ ([]));
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState(/** @type {any} */ (null));
  const [savedJson, setSavedJson] = useState('');
  const [status, setStatus] = useState(/** @type {any} */ ({ run: null, armed: null, hotkeyError: '' }));

  // 빠른 캡처
  const [snapTarget, setSnapTarget] = useState(DEFAULT_TARGET);
  const [snapDir, setSnapDir] = useState('');
  const [snapFormat, setSnapFormat] = useState('png');
  const [snapDelay, setSnapDelay] = useState(0);
  const [snapBusy, setSnapBusy] = useState(false);
  const [snapResult, setSnapResult] = useState(/** @type {{ path: string, width: number, height: number } | null} */ (null));
  const [snapDirLoaded, setSnapDirLoaded] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const running = status.run?.state === 'running';
  useReportJobRunning(featureId, running, '매크로 캡처 중');
  const run = status.run;
  const progressFollowKey = run
    ? `${run.state}:${run.logs?.length ?? 0}:${run.captures ?? 0}:${run.stepIndex ?? 0}:${run.note ?? ''}`
    : '';
  const { sectionRef: progressSectionRef, logRef: progressLogRef } = useJobProgressScroll({
    active: Boolean(run),
    followKey: progressFollowKey,
  });
  const dirty = draft ? snapshot(draft) !== savedJson : false;
  const isArmed = Boolean(draft && status.armed?.presetId === draft.id);

  const showError = useCallback(
    (message) => void dialog.alert({ title: '매크로 화면 캡처', body: message }),
    [dialog],
  );
  const toMessage = (err, fallback) => (err instanceof Error ? err.message : fallback);

  const reloadTargets = useCallback(() => {
    api('capture.targets')
      .then(setTargets)
      .catch(() => undefined);
  }, []);

  /** 프리셋을 편집 상태로 불러옵니다. */
  const loadDraft = useCallback((preset) => {
    setSelectedId(preset.id);
    setDraft(structuredClone(preset));
    setSavedJson(snapshot(preset));
  }, []);

  // 처음 불러오기
  useEffect(() => {
    let alive = true;
    api('capture.info')
      .then((res) => alive && setInfo(res))
      .catch(() => undefined);
    reloadTargets();
    api('capture.presets.list')
      .then((res) => {
        if (!alive) return;
        setPresets(res.presets);
        if (res.presets[0]) loadDraft(res.presets[0]);
      })
      .catch((err) => alive && showError(toMessage(err, '프리셋을 불러오지 못했습니다.')));
    api('folders.get', { key: 'captureOutput' })
      .then((res) => alive && res?.path && setSnapDir((current) => current || res.path))
      .catch(() => undefined)
      .finally(() => alive && setSnapDirLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  // 빠른 캡처 저장 폴더 기억
  useEffect(() => {
    if (!snapDirLoaded) return undefined;
    const timer = window.setTimeout(() => {
      void api('folders.set', { key: 'captureOutput', path: snapDir.trim() }).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [snapDir, snapDirLoaded]);

  // 실행 상태 (단축키로 시작/중지해도 반영되도록 계속 확인)
  useEffect(() => {
    let alive = true;
    const poll = () =>
      api('capture.macro.status')
        .then((res) => alive && setStatus(res))
        .catch(() => undefined);
    void poll();
    const timer = window.setInterval(poll, 700);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  /* ---- 프리셋 목록 동작 ---- */

  const confirmDiscard = async () => {
    if (!dirty) return true;
    return dialog.confirm({
      title: '저장하지 않은 변경',
      body: '저장하지 않은 변경 사항이 사라집니다. 계속할까요?',
      confirmLabel: '계속',
    });
  };

  const selectPreset = async (preset) => {
    if (preset.id === selectedId) return;
    if (!(await confirmDiscard())) return;
    loadDraft(preset);
  };

  const addPreset = async () => {
    if (!(await confirmDiscard())) return;
    const preset = createPreset();
    setSelectedId(preset.id);
    setDraft(preset);
    setSavedJson(''); // 아직 저장 전
  };

  /**
   * 프리셋 이름만 바꿉니다. 저장된 프리셋이면 이름만 바로 저장하고, 편집 중인 다른 변경은
   * 저장하지 않은 채로 남겨 둡니다. 아직 저장 전인 새 매크로는 편집 중 이름만 바꿉니다.
   */
  const renamePreset = async (nextName) => {
    setRenaming(false);
    if (!draft || nextName === draft.name) return;
    const stored = presets.find((p) => p.id === draft.id);
    if (!stored) {
      patchDraft({ name: nextName });
      return;
    }
    try {
      const res = await api('capture.presets.save', { preset: { ...stored, name: nextName } });
      setPresets(res.presets);
      setDraft((current) => (current ? { ...current, name: res.preset.name } : current));
      setSavedJson(snapshot(res.preset));
      if (res.rearmError) showError(`이름은 바꿨지만 단축키를 다시 등록하지 못했습니다.\n${res.rearmError}`);
    } catch (err) {
      showError(toMessage(err, '이름을 바꾸지 못했습니다.'));
    }
  };

  const duplicatePreset = async () => {
    if (!draft) return;
    const copy = { ...structuredClone(draft), id: crypto.randomUUID(), name: `${draft.name} 복사본` };
    try {
      const res = await api('capture.presets.save', { preset: copy });
      setPresets(res.presets);
      loadDraft(res.preset);
    } catch (err) {
      showError(toMessage(err, '복제하지 못했습니다.'));
    }
  };

  const deletePreset = async () => {
    if (!draft) return;
    const ok = await dialog.confirm({
      title: '프리셋 삭제',
      body: `"${draft.name}" 프리셋을 삭제할까요?`,
      confirmLabel: '삭제',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api('capture.presets.remove', { id: draft.id });
      setPresets(res.presets);
      if (res.presets[0]) loadDraft(res.presets[0]);
      else {
        setDraft(null);
        setSelectedId('');
        setSavedJson('');
      }
    } catch (err) {
      showError(toMessage(err, '삭제하지 못했습니다.'));
    }
  };

  const movePreset = async (direction) => {
    if (!draft || !presets.some((p) => p.id === draft.id)) return;
    try {
      const res = await api('capture.presets.move', { id: draft.id, direction });
      setPresets(res.presets);
    } catch (err) {
      showError(toMessage(err, '순서를 바꾸지 못했습니다.'));
    }
  };

  const savePreset = async () => {
    if (!draft) return null;
    try {
      const res = await api('capture.presets.save', { preset: draft });
      setPresets(res.presets);
      loadDraft(res.preset);
      if (res.rearmError) showError(`저장했지만 단축키를 다시 등록하지 못했습니다.\n${res.rearmError}`);
      return res.preset;
    } catch (err) {
      showError(toMessage(err, '저장하지 못했습니다.'));
      return null;
    }
  };

  const patchDraft = (patch) => setDraft((current) => (current ? { ...current, ...patch } : current));

  /* ---- 실행 / 중지 ---- */

  const startMacro = async () => {
    if (!draft) return;
    const saved = await savePreset();
    if (!saved) return;
    try {
      const res = await api('capture.macro.start', { presetId: saved.id });
      setStatus((current) => ({ ...current, run: res.run }));
    } catch (err) {
      showError(toMessage(err, '매크로를 시작하지 못했습니다.'));
    }
  };

  const stopMacro = async () => {
    try {
      await api('capture.macro.stop');
    } catch (err) {
      showError(toMessage(err, '중지하지 못했습니다.'));
    }
  };

  const toggleArm = async (on) => {
    if (!draft) return;
    try {
      if (on) {
        const saved = dirty || !presets.some((p) => p.id === draft.id) ? await savePreset() : draft;
        if (!saved) return;
        await api('capture.hotkeys.arm', { presetId: saved.id });
      } else {
        await api('capture.hotkeys.disarm');
      }
      const res = await api('capture.macro.status');
      setStatus(res);
    } catch (err) {
      showError(toMessage(err, '단축키를 설정하지 못했습니다.'));
    }
  };

  /* ---- 폴더 / 빠른 캡처 ---- */

  const pickDir = async (apply) => {
    if (!native?.pickDirectory) return;
    const picked = await native.pickDirectory({ memoryKey: 'captureOutput', title: '저장 폴더 선택' });
    if (picked?.canceled || !picked?.path) return;
    apply(picked.path);
  };

  const snap = async () => {
    setSnapBusy(true);
    setSnapResult(null);
    try {
      const res = await api('capture.snap', {
        target: snapTarget,
        outputDir: snapDir,
        format: snapFormat,
        delayMs: Math.round(snapDelay * 1000),
      });
      setSnapResult(res);
    } catch (err) {
      showError(toMessage(err, '캡처하지 못했습니다.'));
    } finally {
      setSnapBusy(false);
    }
  };

  const openFolder = (target) => void native?.showItemInFolder?.(target);

  const progressText = useMemo(() => {
    if (!run) return '';
    const total = run.repeat === 0 ? '∞' : run.repeat;
    return `폴더 ${run.folderCount} / ${total}장 · 이번 ${run.captures}장 저장`;
  }, [run]);

  const defaultDir = info?.defaultOutputDir ?? '';
  const isSaved = Boolean(draft && presets.some((p) => p.id === draft.id));
  const canReorder = Boolean(draft) && isSaved;
  const unsaved = Boolean(draft) && (dirty || !isSaved);
  const runningHere = Boolean(draft) && running && run?.presetId === draft.id;

  // 단축키는 기본 켜짐: 선택한(저장된) 프리셋의 단축키가 아직 등록 전이면 자동으로 등록합니다.
  // 끄면(status.enabled === false) 다시 자동으로 켜지 않습니다. 같은 상황에서 실패한 등록은 한 번만 시도합니다.
  const armAttempt = useRef('');
  const draftId = draft?.id ?? '';
  const armedId = status.armed?.presetId ?? '';
  useEffect(() => {
    if (!draftId || !isSaved || running || status.enabled !== true || armedId === draftId) return;
    const attemptKey = `${draftId}|${armedId}`;
    if (armAttempt.current === attemptKey) return;
    armAttempt.current = attemptKey;
    api('capture.hotkeys.arm', { presetId: draftId })
      .then(() => api('capture.macro.status'))
      .then(setStatus)
      .catch((err) => showError(toMessage(err, '단축키를 설정하지 못했습니다.')));
  }, [draftId, isSaved, running, status.enabled, armedId, showError]);

  /** 저장 폴더 입력 (매크로 / 빠른 캡처 공용) */
  const dirField = (value, onChange, hint) => (
    <Field label="저장 폴더" hint={hint}>
      <span className="flex gap-2">
        <input className={inputClass} value={value} onChange={(event) => onChange(event.target.value)} placeholder={defaultDir} spellCheck={false} />
        <button type="button" className={`${btnClass} shrink-0`} onClick={() => void pickDir(onChange)}>
          선택
        </button>
      </span>
    </Field>
  );

  /* ---- 빠른 캡처 탭 ---- */
  const quickTab = (
    <Section title="빠른 캡처" description="지금 한 장을 캡처해 저장합니다. 캡처하는 동안 이 창은 잠시 최소화됩니다.">
      <div className="space-y-5">
        <TargetEditor idPrefix="snap" value={snapTarget} onChange={setSnapTarget} targets={targets} onReloadTargets={reloadTargets} onError={showError} />

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
          {dirField(snapDir, setSnapDir, `비우면 기본 폴더: ${defaultDir}`)}
          <Field label="형식">
            <select className={inputClass} value={snapFormat} onChange={(event) => setSnapFormat(event.target.value)}>
              <option value="png">PNG</option>
              <option value="jpg">JPG</option>
            </select>
          </Field>
          <Field label="캡처 전 대기(초)">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={30}
              value={snapDelay}
              onChange={(event) => setSnapDelay(Math.max(0, Number(event.target.value) || 0))}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnPrimaryClass} onClick={() => void snap()} disabled={snapBusy || running}>
            {snapBusy ? '캡처 중…' : '지금 캡처'}
          </button>
          {snapResult ? (
            <p className="m-0 flex min-w-0 flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge tone="green">저장됨</Badge>
              <span className="break-all font-mono text-xs">{snapResult.path}</span>
              <span className="text-xs text-slate-400">
                {snapResult.width}×{snapResult.height}
              </span>
              <button type="button" className={btnSmClass} onClick={() => openFolder(snapResult.path)}>
                폴더에서 보기
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </Section>
  );

  /* ---- 매크로 탭 ---- */
  const macroTab = (
    <div className="space-y-4">
      {/* 프리셋 선택 / 저장 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <select
          className={`${inputClass} min-w-[12rem] flex-1 sm:max-w-sm`}
          value={selectedId}
          onChange={(event) => {
            const preset = presets.find((p) => p.id === event.target.value);
            if (preset) void selectPreset(preset);
          }}
          disabled={presets.length === 0 && !draft}
          aria-label="매크로 프리셋"
        >
          {presets.length === 0 && !draft ? <option value="">저장된 매크로가 없습니다</option> : null}
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
          {draft && !isSaved ? <option value={draft.id}>{draft.name} (저장 전)</option> : null}
        </select>
        <button type="button" className={btnClass} onClick={() => void addPreset()}>
          + 새로 만들기
        </button>
        <span className="flex-1" />
        {draft ? (
          <>
            {unsaved ? <span className="text-xs text-amber-600">저장 안 됨</span> : null}
            <button type="button" className={btnPrimaryClass} onClick={() => void savePreset()} disabled={!unsaved}>
              저장
            </button>
            <MoreMenu
              items={[
                { label: '이름 바꾸기', onClick: () => setRenaming(true) },
                { label: '복제', onClick: () => void duplicatePreset(), disabled: !canReorder },
                { label: '위로 이동', onClick: () => void movePreset(-1), disabled: !canReorder },
                { label: '아래로 이동', onClick: () => void movePreset(1), disabled: !canReorder },
                { label: '삭제', onClick: () => void deletePreset(), danger: true },
              ]}
            />
          </>
        ) : null}
      </div>

      {renaming && draft ? (
        <RenameDialog initialName={draft.name} onSubmit={(name) => void renamePreset(name)} onClose={() => setRenaming(false)} />
      ) : null}

      {!draft ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="m-0 text-sm text-slate-500">캡처 → 다음 페이지 → 대기 같은 동작을 순서대로 반복하는 매크로를 만들어 보세요.</p>
          <button type="button" className={btnPrimaryClass} onClick={() => void addPreset()}>
            새 매크로 만들기
          </button>
        </div>
      ) : (
        <>
          {/* 실행 */}
          <section ref={progressSectionRef} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-slate-600" title="저장 폴더 안의 이미지 파일 수(기존 파일 포함)가 이 수에 도달하면 끝납니다. 0 이면 중지할 때까지 계속합니다.">
                <span className="whitespace-nowrap">목표 이미지 수</span>
                <input
                  className={`${inputClass} w-24`}
                  type="number"
                  min={0}
                  value={draft.repeat}
                  disabled={running}
                  onChange={(event) => patchDraft({ repeat: Math.max(0, Math.round(Number(event.target.value)) || 0) })}
                  aria-label="목표 이미지 수 (폴더 안 이미지 수 기준, 0 이면 제한 없음)"
                />
              </label>
              {running ? (
                <button type="button" className={`${btnDangerClass} px-5 py-2`} onClick={() => void stopMacro()}>
                  ■ 중지
                </button>
              ) : (
                <button type="button" className={`${btnPrimaryClass} px-5 py-2`} onClick={() => void startMacro()}>
                  ▶ 실행
                </button>
              )}

              {run ? (
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
                  <Badge tone={runTone(run.state)}>{RUN_LABELS[run.state] ?? run.state}</Badge>
                  <span className="truncate font-medium text-slate-800">{run.presetName}</span>
                  <span className="text-slate-500">{progressText}</span>
                  {run.state === 'running' && run.note ? <Badge tone="amber">{run.note}</Badge> : null}
                  {run.captures > 0 ? (
                    <button type="button" className={btnSmClass} onClick={() => openFolder(run.outputDir)}>
                      폴더 열기
                    </button>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-slate-400">저장하지 않은 변경은 실행 전에 자동 저장됩니다.</span>
              )}
            </div>

            {run?.error ? <p className="mb-0 mt-3 whitespace-pre-wrap text-sm text-red-600">{run.error}</p> : null}
            {status.hotkeyError ? <p className="mb-0 mt-3 text-sm text-red-600">{status.hotkeyError}</p> : null}
            {run && run.logs.length > 0 ? (
              <details className="mt-3 text-xs text-slate-500" open={running ? true : undefined}>
                <summary className="cursor-pointer select-none">실행 기록 ({run.logs.length})</summary>
                <ul
                  ref={progressLogRef}
                  className="m-0 mt-1 max-h-32 list-none overflow-auto p-0 font-mono"
                >
                  {run.logs.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </details>
            ) : null}

            <div className="mt-3 border-t border-slate-100 pt-1">
              <ToggleRow
                label="단축키로 실행/중지"
                hint={`켜 두면 다른 프로그램을 쓰는 중에도 ${draft.startKey} 로 시작, ${draft.stopKey} 로 중지합니다. 기본으로 켜져 있고, 끄면 다음 실행에도 꺼진 채로 둡니다.`}
                checked={isArmed}
                disabled={running}
                onChange={(on) => void toggleArm(on)}
              />
              {status.armed && !isArmed ? (
                <p className="m-0 pb-1 text-xs text-amber-600">다른 프리셋의 단축키가 켜져 있습니다. 이 프리셋을 켜면 그쪽은 해제됩니다.</p>
              ) : null}
            </div>
          </section>

          {/* 동작 순서 */}
          <Section title="동작 순서" description="위에서 아래로 실행하고, 끝나면 처음부터 반복합니다. 저장 폴더의 이미지 수가 목표에 도달하면 끝납니다.">
            <StepEditor
              steps={draft.steps}
              onChange={(steps) => patchDraft({ steps })}
              activeIndex={runningHere ? run.stepIndex : -1}
              targets={targets}
              onReloadTargets={reloadTargets}
              onError={showError}
            />
          </Section>

          {/* 설정 */}
          <Section title="설정">
            <div className="space-y-4">
              <Field label="매크로 이름">
                <input className={inputClass} value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} maxLength={60} />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="시작 단축키">
                  <HotkeyInput label="시작 단축키" value={draft.startKey} onChange={(startKey) => patchDraft({ startKey })} />
                </Field>
                <Field label="중지 단축키">
                  <HotkeyInput label="중지 단축키" value={draft.stopKey} onChange={(stopKey) => patchDraft({ stopKey })} />
                </Field>
              </div>

              <div>
                <ToggleRow
                  label="같은 화면이면 전환될 때까지 기다림"
                  hint="직전 캡처와 같으면 입력을 다시 보내지 않고 화면이 바뀔 때까지 기다립니다. 바뀌면 화면이 멈춘 뒤 저장하고, 중복 이미지는 저장하지 않습니다. 끝나는 조건은 목표 이미지 수 도달뿐이며, 책이 목표보다 짧으면 계속 기다리니 중지 단축키로 멈추세요."
                  checked={draft.detectSame}
                  onChange={(detectSame) => patchDraft({ detectSame })}
                />
                {draft.detectSame ? (
                  <div className="mt-2 space-y-2">
                    <Field
                      label="같은 화면 판단 기준(유사도 %)"
                      hint="직전 화면과 유사도가 이 값 이상이면 같은 화면으로 봅니다(기본 99.9999 = 사실상 완전히 같을 때만). 페이지가 바뀌었는데 계속 같은 화면이라면 값을 높이고, 커서·시계 때문에 안 넘어가면 낮추세요. 대기 중에는 현재 변화량이 표시됩니다."
                    >
                      <span className="block w-40">
                        <PercentInput
                          label="같은 화면 판단 기준(유사도 %)"
                          min={50}
                          max={99.9999}
                          step={0.0001}
                          value={round6(100 - draft.sameThreshold)}
                          onChange={(similarity) => patchDraft({ sameThreshold: round6(100 - similarity) })}
                        />
                      </span>
                    </Field>
                    <ToggleRow
                      label="오래 안 바뀌면 입력을 1회 다시 보내기"
                      hint="클릭이 씹히는 뷰어용입니다. 느린 뷰어에서는 페이지를 한 장 건너뛸 수 있어 기본은 꺼 둡니다."
                      checked={draft.resendOnTimeout}
                      onChange={(resendOnTimeout) => patchDraft({ resendOnTimeout })}
                    />
                    {draft.resendOnTimeout ? (
                      <Field label="입력을 다시 보내기까지 대기(초)" hint="이 시간 동안 화면이 안 바뀌면 넘기는 동작을 한 번 다시 보냅니다.">
                        <input
                          className={`${inputClass} w-40`}
                          type="number"
                          min={1}
                          max={600}
                          step={1}
                          value={draft.changeTimeoutMs / 1000}
                          onChange={(event) =>
                            patchDraft({ changeTimeoutMs: Math.min(600_000, Math.max(1000, Math.round((Number(event.target.value) || 0) * 1000))) })
                          }
                        />
                      </Field>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]">
                {dirField(
                  draft.outputDir,
                  (outputDir) => patchDraft({ outputDir }),
                  `비우면 기본 폴더(${defaultDir})에 바로 저장`,
                )}
                <Field label="형식">
                  <select className={inputClass} value={draft.format} onChange={(event) => patchDraft({ format: event.target.value })}>
                    <option value="png">PNG</option>
                    <option value="jpg">JPG</option>
                  </select>
                </Field>
                <Field label="시작 전 대기(ms)">
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    value={draft.startDelayMs}
                    onChange={(event) => patchDraft({ startDelayMs: Math.max(0, Math.round(Number(event.target.value)) || 0) })}
                  />
                </Field>
              </div>

              <ToggleRow
                label="실행 중 이 창 최소화"
                hint="이 앱 창이 캡처 화면에 찍히지 않게 합니다. 끝나면 자동으로 복원됩니다."
                checked={draft.hideApp}
                onChange={(hideApp) => patchDraft({ hideApp })}
              />
            </div>
          </Section>
        </>
      )}
    </div>
  );

  return (
    <div className="h-full overflow-auto py-6 pl-6 pr-20">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">매크로 화면 캡처</h1>
          <p className="mt-1 text-sm text-slate-500">
            화면·창·영역을 캡처하거나, 키보드·마우스 매크로로 페이지를 넘기며 자동으로 캡처합니다. 캡처한 폴더는 이미지 자르기 & PDF 저장에서 바로 쓸 수 있습니다.
          </p>
        </section>

        <div className="flex gap-1 border-b border-slate-200" role="tablist" aria-label="캡처 방식">
          {TABS.map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  active ? 'border-app-accent text-app-accent' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {item.label}
                {item.id === 'macro' && running ? <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500 align-middle" /> : null}
              </button>
            );
          })}
        </div>

        {tab === 'macro' ? macroTab : quickTab}
      </div>
    </div>
  );
}
