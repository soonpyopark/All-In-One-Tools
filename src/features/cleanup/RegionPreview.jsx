import { useRef, useState } from 'react';

/** @typedef {{ left: number, top: number, right: number, bottom: number }} EdgeBox ratios (0..1) of the image */
/** @typedef {{ l: boolean, r: boolean, t: boolean, b: boolean, move: boolean, draw: boolean }} Grab what a pointer-down picked up */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** An edge can never come closer than this to the opposite edge (ratio of the image). */
const MIN_SIZE = 0.05;
/** Grab distance around an edge, in screen pixels (independent of the image size). */
const GRAB_PX = 8;
/** 확대경 지름(px), 배율, 포인터와의 간격(px). */
const LOUPE_SIZE = 140;
const LOUPE_ZOOM = 4;
const LOUPE_GAP = 24;

/** @param {Grab} g */
function cursorFor(g) {
  if ((g.l && g.t) || (g.r && g.b)) return 'nwse-resize';
  if ((g.r && g.t) || (g.l && g.b)) return 'nesw-resize';
  if (g.l || g.r) return 'ew-resize';
  if (g.t || g.b) return 'ns-resize';
  if (g.move) return 'move';
  if (g.draw) return 'crosshair';
  return 'default';
}

/**
 * Shows the preview image with the book region outlined.
 *
 * When `editable`, the outline can be adjusted directly: drag an edge or a corner
 * to resize it, drag inside it to move it. With `allowDraw`, dragging outside the
 * outline draws a new region.
 *
 * @param {{
 *   src: string,
 *   box: EdgeBox | null,
 *   editable: boolean,
 *   allowDraw?: boolean,
 *   onChange?: (box: EdgeBox) => void,
 * }} props
 */
export default function RegionPreview({ src, box, editable, allowDraw = false, onChange }) {
  const frameRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const dragRef = useRef(
    /** @type {{ grab: Grab, x: number, y: number, start: EdgeBox | null } | null} */ (null),
  );
  const [cursor, setCursor] = useState('default');
  /** 테두리·모서리를 끄는 동안의 확대경 상태 (화면 좌표 + 이미지 비율 좌표). */
  const [loupe, setLoupe] = useState(
    /** @type {{ grab: Grab, clientX: number, clientY: number, px: number, py: number } | null} */ (null),
  );

  const frameRect = () => frameRef.current?.getBoundingClientRect();

  /** Pointer position as ratios of the image. @param {import('react').PointerEvent} event */
  const point = (event) => {
    const rect = frameRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  /** What is under the pointer: an edge / corner, the inside, or empty space. @param {import('react').PointerEvent} event @returns {Grab} */
  const hitTest = (event) => {
    /** @type {Grab} */
    const none = { l: false, r: false, t: false, b: false, move: false, draw: allowDraw };
    const rect = frameRect();
    if (!box || !rect) return none;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = box.left * rect.width;
    const right = box.right * rect.width;
    const top = box.top * rect.height;
    const bottom = box.bottom * rect.height;

    const withinX = x >= left - GRAB_PX && x <= right + GRAB_PX;
    const withinY = y >= top - GRAB_PX && y <= bottom + GRAB_PX;
    const l = withinY && Math.abs(x - left) <= GRAB_PX;
    const r = withinY && Math.abs(x - right) <= GRAB_PX;
    const t = withinX && Math.abs(y - top) <= GRAB_PX;
    const b = withinX && Math.abs(y - bottom) <= GRAB_PX;

    // On a very small box the two opposite edges overlap: prefer the nearer one.
    const grab = {
      l: l && !(r && Math.abs(x - right) < Math.abs(x - left)),
      r: r && !(l && Math.abs(x - left) <= Math.abs(x - right)),
      t: t && !(b && Math.abs(y - bottom) < Math.abs(y - top)),
      b: b && !(t && Math.abs(y - top) <= Math.abs(y - bottom)),
      move: false,
      draw: false,
    };
    if (grab.l || grab.r || grab.t || grab.b) return grab;

    const inside = x > left && x < right && y > top && y < bottom;
    return { ...none, move: inside, draw: !inside && allowDraw };
  };

  /** @param {import('react').PointerEvent} event */
  const onPointerDown = (event) => {
    if (!editable || !onChange) return;
    const grab = hitTest(event);
    if (!(grab.l || grab.r || grab.t || grab.b || grab.move || grab.draw)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    dragRef.current = { grab, x: p.x, y: p.y, start: box };
    setCursor(cursorFor(grab));
    updateLoupe(event, grab);
  };

  /** 크기 조절(테두리·모서리)일 때만 확대경을 보여 줍니다. 이동·새로 그리기는 제외. */
  const updateLoupe = (event, grab) => {
    if (!(grab.l || grab.r || grab.t || grab.b)) return;
    const p = point(event);
    setLoupe({ grab, clientX: event.clientX, clientY: event.clientY, px: p.x, py: p.y });
  };

  /** @param {import('react').PointerEvent} event */
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) {
      if (editable) {
        const next = cursorFor(hitTest(event));
        if (next !== cursor) setCursor(next);
      }
      return;
    }
    if (!onChange) return;

    const p = point(event);
    const { grab, start } = drag;

    if (grab.draw || !start) {
      onChange({
        left: Math.min(drag.x, p.x),
        top: Math.min(drag.y, p.y),
        right: Math.max(drag.x, p.x),
        bottom: Math.max(drag.y, p.y),
      });
      return;
    }

    if (grab.move) {
      const width = start.right - start.left;
      const height = start.bottom - start.top;
      const left = Math.min(1 - width, Math.max(0, start.left + (p.x - drag.x)));
      const top = Math.min(1 - height, Math.max(0, start.top + (p.y - drag.y)));
      onChange({ left, top, right: left + width, bottom: top + height });
      return;
    }

    updateLoupe(event, grab);
    const next = { ...start };
    if (grab.l) next.left = Math.min(p.x, start.right - MIN_SIZE);
    if (grab.r) next.right = Math.max(p.x, start.left + MIN_SIZE);
    if (grab.t) next.top = Math.min(p.y, start.bottom - MIN_SIZE);
    if (grab.b) next.bottom = Math.max(p.y, start.top + MIN_SIZE);
    onChange(next);
  };

  /** @param {import('react').PointerEvent} event */
  const onPointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setLoupe(null);
    if (!drag) return;
    if (drag.grab.draw && onChange) {
      const p = point(event);
      // A click or a tiny drag is not a region: keep what was there before.
      if (Math.abs(p.x - drag.x) < 0.03 || Math.abs(p.y - drag.y) < 0.03) {
        if (drag.start) onChange(drag.start);
      }
    }
    setCursor(cursorFor(hitTest(event)));
  };

  const handles = box
    ? [
        [box.left, box.top],
        [(box.left + box.right) / 2, box.top],
        [box.right, box.top],
        [box.left, (box.top + box.bottom) / 2],
        [box.right, (box.top + box.bottom) / 2],
        [box.left, box.bottom],
        [(box.left + box.right) / 2, box.bottom],
        [box.right, box.bottom],
      ]
    : [];

  // 확대경: 잡고 있는 테두리(또는 모서리) 지점을 중심으로 원본을 확대해 보여 줍니다.
  let loupeView = null;
  const frame = frameRef.current?.getBoundingClientRect();
  if (loupe && box && frame && frame.width > 0 && frame.height > 0) {
    const { grab } = loupe;
    // 확대 중심: 잡은 테두리의 위치, 잡지 않은 축은 포인터 위치
    const cx = grab.l ? box.left : grab.r ? box.right : loupe.px;
    const cy = grab.t ? box.top : grab.b ? box.bottom : loupe.py;
    const W = frame.width * LOUPE_ZOOM;
    const H = frame.height * LOUPE_ZOOM;
    const half = LOUPE_SIZE / 2;
    // 확대경 안에서의 좌표(px)
    const toX = (ratio) => half + (ratio - cx) * W;
    const toY = (ratio) => half + (ratio - cy) * H;

    // 포인터 오른쪽 위에 띄우고, 화면 밖으로 나가면 반대쪽으로 뒤집습니다.
    let left = loupe.clientX + LOUPE_GAP;
    let top = loupe.clientY - LOUPE_GAP - LOUPE_SIZE;
    if (left + LOUPE_SIZE > window.innerWidth) left = loupe.clientX - LOUPE_GAP - LOUPE_SIZE;
    if (top < 0) top = loupe.clientY + LOUPE_GAP;

    loupeView = (
      <div
        className="pointer-events-none fixed z-50 overflow-hidden rounded-full border-2 border-white bg-slate-100 shadow-lg ring-1 ring-slate-400"
        style={{
          left,
          top,
          width: LOUPE_SIZE,
          height: LOUPE_SIZE,
          backgroundImage: `url("${src}")`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${W}px ${H}px`,
          backgroundPosition: `${half - cx * W}px ${half - cy * H}px`,
        }}
      >
        <div
          className="absolute border border-app-accent"
          style={{
            left: toX(box.left),
            top: toY(box.top),
            width: (box.right - box.left) * W,
            height: (box.bottom - box.top) * H,
          }}
        />
        <div className="absolute left-0 right-0 h-px bg-black/30" style={{ top: half }} />
        <div className="absolute bottom-0 top-0 w-px bg-black/30" style={{ left: half }} />
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className={`relative w-full select-none overflow-hidden rounded-md border border-slate-300 bg-slate-100 ${
        editable ? 'touch-none' : ''
      }`}
      style={{ cursor: editable ? cursor : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img src={src} alt="첫 번째 이미지 미리보기" draggable={false} className="block h-auto w-full" />
      {box ? (
        <div
          className="pointer-events-none absolute border-2 border-app-accent"
          style={{
            left: `${box.left * 100}%`,
            top: `${box.top * 100}%`,
            width: `${(box.right - box.left) * 100}%`,
            height: `${(box.bottom - box.top) * 100}%`,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.5)',
          }}
        />
      ) : null}
      {editable
        ? handles.map(([x, y], index) => (
            <span
              key={index}
              className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-app-accent bg-white"
              style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
            />
          ))
        : null}
      {loupeView}
    </div>
  );
}
