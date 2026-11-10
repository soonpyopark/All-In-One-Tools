import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/apiClient.js';
import { COMMON_KEY_NAMES, codeToKeyName } from '../../../shared/keys.js';
import { btnSmClass, inputSmClass } from '../../components/settings/ui.jsx';
import TargetEditor from './TargetEditor.jsx';

const iconBtn =
  'inline-flex h-7 w-7 items-center justify-center rounded text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent';
const numberInput = `${inputSmClass} w-20 font-mono`;

const TYPE_LABELS = { delay: '지연', key: '키보드', mouse: '마우스', capture: '캡처' };
const TYPE_COLORS = {
  delay: 'bg-slate-100 text-slate-700',
  key: 'bg-violet-50 text-violet-700',
  mouse: 'bg-emerald-50 text-emerald-700',
  capture: 'bg-sky-50 text-sky-700',
};
/** 추가 버튼은 단계 색과 맞춥니다. */
const ADD_COLORS = {
  key: 'border-violet-200 text-violet-700 hover:bg-violet-50',
  mouse: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
  delay: 'border-slate-300 text-slate-700 hover:bg-slate-50',
  capture: 'border-sky-200 text-sky-700 hover:bg-sky-50',
};

/** 새 단계의 기본값 */
export function newStep(type) {
  if (type === 'delay') return { type, ms: 500 };
  if (type === 'key') return { type, action: 'press', key: 'PageDown' };
  if (type === 'mouse') return { type, action: 'click', button: 'left', x: 0, y: 0, amount: 3 };
  return { type: 'capture', target: { mode: 'screen', displayId: null, windowTitle: '', region: null } };
}

/** 키 이름 입력: 직접 입력하거나 "눌러서 입력" 으로 실제 키를 눌러 지정합니다. */
function KeyInput({ value, onChange }) {
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
      const name = codeToKeyName(event.code);
      if (name) {
        onChange(name);
        setCapturing(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, onChange]);

  return (
    <>
      <input
        className={`${inputSmClass} w-32 font-mono`}
        list="capture-key-names"
        value={capturing ? '' : value}
        placeholder={capturing ? '키를 누르세요…' : 'PageDown'}
        onChange={(event) => onChange(event.target.value.replace(/[^A-Za-z0-9]/g, ''))}
        spellCheck={false}
        aria-label="키 이름"
      />
      <button type="button" className={btnSmClass} onClick={() => setCapturing((on) => !on)}>
        {capturing ? '취소' : '눌러서 입력'}
      </button>
    </>
  );
}

/** 마우스 좌표 입력 + "3초 뒤 좌표 가져오기" */
function CoordInput({ x, y, onChange, onError }) {
  const [countdown, setCountdown] = useState(0);
  // 3초 기다리는 동안 다른 편집이 있었어도 최신 상태에 반영되도록 최신 콜백을 ref 로 들고 있습니다.
  const latest = useRef({ onChange, onError });
  latest.current = { onChange, onError };

  useEffect(() => {
    if (countdown <= 0) return undefined;
    const timer = window.setTimeout(() => {
      if (countdown > 1) {
        setCountdown(countdown - 1);
        return;
      }
      setCountdown(0);
      api('capture.cursorPos')
        .then((pos) => latest.current.onChange({ x: pos.x, y: pos.y }))
        .catch((err) => latest.current.onError(err instanceof Error ? err.message : '마우스 좌표를 가져오지 못했습니다.'));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdown]);

  return (
    <>
      <span className="text-xs text-slate-500">X</span>
      <input className={numberInput} type="number" value={x} onChange={(event) => onChange({ x: Math.round(Number(event.target.value)) || 0 })} />
      <span className="text-xs text-slate-500">Y</span>
      <input className={numberInput} type="number" value={y} onChange={(event) => onChange({ y: Math.round(Number(event.target.value)) || 0 })} />
      <button type="button" className={btnSmClass} onClick={() => setCountdown(3)} disabled={countdown > 0} title="버튼을 누르고 3초 안에 원하는 위치로 마우스를 옮기세요">
        {countdown > 0 ? `${countdown}초…` : '좌표 가져오기'}
      </button>
    </>
  );
}

/**
 * 매크로 단계 목록 편집기.
 *
 * @param {{
 *   steps: any[],
 *   onChange: (steps: any[]) => void,
 *   activeIndex?: number,
 *   targets: any,
 *   onReloadTargets: () => void,
 *   onError: (message: string) => void,
 * }} props
 */
export default function StepEditor({ steps, onChange, activeIndex = -1, targets, onReloadTargets, onError }) {
  const update = (index, patch) => onChange(steps.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  const remove = (index) => onChange(steps.filter((_, i) => i !== index));
  const move = (index, direction) => {
    const next = index + direction;
    if (next < 0 || next >= steps.length) return;
    const copy = [...steps];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    onChange(copy);
  };
  const add = (type) => onChange([...steps, newStep(type)]);

  return (
    <div className="space-y-3">
      <datalist id="capture-key-names">
        {COMMON_KEY_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      {steps.length === 0 ? (
        <p className="m-0 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">
          단계가 없습니다. 아래 버튼으로 추가하세요.
        </p>
      ) : null}

      <ol className="m-0 list-none space-y-1.5 p-0">
        {steps.map((step, index) => (
          <li
            key={index}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
              index === activeIndex ? 'border-app-accent bg-app-accentSoft/40' : 'border-slate-200 bg-white'
            }`}
          >
            <span className="flex h-7 shrink-0 items-center gap-2">
              <span className="w-4 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
              <span className={`w-14 rounded-full py-0.5 text-center text-xs font-medium ${TYPE_COLORS[step.type]}`}>{TYPE_LABELS[step.type]}</span>
            </span>

            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-px">
              {step.type === 'delay' ? (
                <>
                  <input
                    className={numberInput}
                    type="number"
                    min={0}
                    value={step.ms}
                    onChange={(event) => update(index, { ms: Math.max(0, Math.round(Number(event.target.value)) || 0) })}
                    aria-label="지연 시간(ms)"
                  />
                  <span className="text-xs text-slate-500">ms ({(step.ms / 1000).toFixed(2)}초)</span>
                </>
              ) : null}

              {step.type === 'key' ? (
                <>
                  <select className={inputSmClass} value={step.action} onChange={(event) => update(index, { action: event.target.value })} aria-label="키 동작">
                    <option value="press">누르기</option>
                    <option value="down">누른 채 유지</option>
                    <option value="up">떼기</option>
                  </select>
                  <KeyInput value={step.key} onChange={(key) => update(index, { key })} />
                </>
              ) : null}

              {step.type === 'mouse' ? (
                <>
                  <select className={inputSmClass} value={step.action} onChange={(event) => update(index, { action: event.target.value })} aria-label="마우스 동작">
                    <option value="click">클릭</option>
                    <option value="double">더블클릭</option>
                    <option value="down">버튼 누르기</option>
                    <option value="up">버튼 떼기</option>
                    <option value="move">이동만</option>
                    <option value="scroll">스크롤</option>
                  </select>
                  {step.action !== 'move' && step.action !== 'scroll' ? (
                    <select className={inputSmClass} value={step.button} onChange={(event) => update(index, { button: event.target.value })} aria-label="마우스 버튼">
                      <option value="left">왼쪽</option>
                      <option value="right">오른쪽</option>
                      <option value="middle">가운데</option>
                    </select>
                  ) : null}
                  {step.action === 'scroll' ? (
                    <>
                      <input
                        className={numberInput}
                        type="number"
                        value={step.amount}
                        onChange={(event) => update(index, { amount: Math.round(Number(event.target.value)) || 0 })}
                        aria-label="스크롤 칸 수"
                      />
                      <span className="text-xs text-slate-500">칸 (+ 아래 / − 위)</span>
                    </>
                  ) : null}
                  <CoordInput x={step.x} y={step.y} onChange={(patch) => update(index, patch)} onError={onError} />
                </>
              ) : null}

              {step.type === 'capture' ? (
                <div className="min-w-0 flex-1">
                  <TargetEditor
                    idPrefix={`step${index}`}
                    value={step.target}
                    onChange={(target) => update(index, { target })}
                    targets={targets}
                    onReloadTargets={onReloadTargets}
                    onError={onError}
                  />
                </div>
              ) : null}
            </div>

            <span className="flex shrink-0 items-center">
              <button type="button" className={iconBtn} onClick={() => move(index, -1)} disabled={index === 0} title="위로" aria-label="위로">
                ▲
              </button>
              <button type="button" className={iconBtn} onClick={() => move(index, 1)} disabled={index === steps.length - 1} title="아래로" aria-label="아래로">
                ▼
              </button>
              <button type="button" className={`${iconBtn} hover:!bg-red-50 hover:!text-red-600`} onClick={() => remove(index)} title="삭제" aria-label="삭제">
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <span className="text-xs text-slate-400">단계 추가</span>
        {['key', 'mouse', 'delay', 'capture'].map((type) => (
          <button
            key={type}
            type="button"
            className={`rounded-full border bg-white px-3 py-1 text-xs font-medium transition-colors ${ADD_COLORS[type]}`}
            onClick={() => add(type)}
          >
            + {TYPE_LABELS[type]}
          </button>
        ))}
      </div>
    </div>
  );
}
