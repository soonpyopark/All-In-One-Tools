import { useState } from 'react';
import { api } from '../../lib/apiClient.js';
import { btnSmClass, inputSmClass } from '../../components/settings/ui.jsx';

const MODES = [
  { id: 'screen', label: '화면' },
  { id: 'window', label: '창' },
  { id: 'region', label: '영역' },
];

const numberInput = `${inputSmClass} w-20 font-mono`;

/**
 * 캡처 대상 편집기: 화면 / 창 / 영역.
 *
 * @param {{
 *   value: { mode: 'screen' | 'window' | 'region', displayId: number | null, windowTitle: string, region: { x: number, y: number, width: number, height: number } | null },
 *   onChange: (next: any) => void,
 *   targets: { displays: { id: number, label: string }[], windows: string[] } | null,
 *   onReloadTargets: () => void,
 *   onError: (message: string) => void,
 *   idPrefix: string,
 * }} props
 */
export default function TargetEditor({ value, onChange, targets, onReloadTargets, onError, idPrefix }) {
  const [picking, setPicking] = useState(false);
  const displays = targets?.displays ?? [];
  const windows = targets?.windows ?? [];
  const patch = (next) => onChange({ ...value, ...next });

  const pickRegion = async () => {
    setPicking(true);
    try {
      const res = await api('capture.pickRegion', {});
      if (res?.region) patch({ region: res.region });
    } catch (err) {
      onError(err instanceof Error ? err.message : '영역을 선택하지 못했습니다.');
    } finally {
      setPicking(false);
    }
  };

  /** 모든 모니터에 번호를 잠깐 띄웁니다. */
  const identify = async () => {
    try {
      await api('capture.identifyDisplays', {});
    } catch (err) {
      onError(err instanceof Error ? err.message : '모니터를 인식하지 못했습니다.');
    }
  };

  const setRegionField = (key, text) => {
    const n = Math.round(Number(text));
    const base = value.region ?? { x: 0, y: 0, width: 0, height: 0 };
    patch({ region: { ...base, [key]: Number.isFinite(n) ? n : 0 } });
  };

  const displaySelect = (
    <>
      <select
        className={`${inputSmClass} max-w-[16rem]`}
        value={value.displayId ?? ''}
        onChange={(event) => patch({ displayId: event.target.value === '' ? null : Number(event.target.value) })}
        aria-label="모니터 선택"
      >
        <option value="">주 모니터</option>
        {displays.map((display) => (
          <option key={display.id} value={display.id}>
            {display.label}
          </option>
        ))}
      </select>
      <button type="button" className={btnSmClass} onClick={() => void identify()} title="각 모니터에 번호를 잠깐 표시합니다">
        인식
      </button>
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md bg-slate-100 p-0.5" role="radiogroup" aria-label="캡처 대상">
          {MODES.map((mode) => {
            const active = value.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patch({ mode: mode.id })}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {value.mode === 'screen' ? displaySelect : null}

        {value.mode === 'window' ? (
          <>
            <input
              className={`${inputSmClass} w-64 max-w-full`}
              list={`${idPrefix}-windows`}
              value={value.windowTitle}
              onChange={(event) => patch({ windowTitle: event.target.value })}
              placeholder="창 제목 (목록에서 고르거나 일부만 입력)"
              spellCheck={false}
              aria-label="창 제목"
            />
            <datalist id={`${idPrefix}-windows`}>
              {windows.map((title) => (
                <option key={title} value={title} />
              ))}
            </datalist>
            <button type="button" className={btnSmClass} onClick={onReloadTargets}>
              목록 새로고침
            </button>
          </>
        ) : null}

        {value.mode === 'region' ? (
          <>
            <button type="button" className={btnSmClass} onClick={() => void pickRegion()} disabled={picking} title="모든 모니터가 어두워지면 원하는 모니터에서 드래그하세요">
              {picking ? '선택 중…' : '영역 선택'}
            </button>
            <button type="button" className={btnSmClass} onClick={() => void identify()} title="각 모니터에 번호를 잠깐 표시합니다">
              모니터 인식
            </button>
          </>
        ) : null}
      </div>

      {value.mode === 'window' ? (
        <p className="m-0 text-xs text-slate-400">제목이 같은 창을 찾고, 없으면 제목에 포함된 창을 캡처합니다. 최소화된 창은 캡처할 수 없습니다.</p>
      ) : null}

      {value.mode === 'region' ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>X</span>
          <input className={numberInput} type="number" value={value.region?.x ?? 0} onChange={(event) => setRegionField('x', event.target.value)} />
          <span>Y</span>
          <input className={numberInput} type="number" value={value.region?.y ?? 0} onChange={(event) => setRegionField('y', event.target.value)} />
          <span>너비</span>
          <input className={numberInput} type="number" min={0} value={value.region?.width ?? 0} onChange={(event) => setRegionField('width', event.target.value)} />
          <span>높이</span>
          <input className={numberInput} type="number" min={0} value={value.region?.height ?? 0} onChange={(event) => setRegionField('height', event.target.value)} />
          <span className="text-slate-400">(모든 모니터 기준 절대 좌표)</span>
          {!value.region ? <span className="text-amber-600">영역을 지정해 주세요.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
