import { useRef, useState } from 'react';

/** @typedef {{ left: number, top: number, right: number, bottom: number }} EdgeBox ratios (0..1) of the image */
/** @typedef {{ l: boolean, r: boolean, t: boolean, b: boolean, move: boolean, draw: boolean }} Grab what a pointer-down picked up */

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** An edge can never come closer than this to the opposite edge (ratio of the image). */
const MIN_SIZE = 0.05;
/** Grab distance around an edge, in screen pixels (independent of the image size). */
const GRAB_PX = 8;

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

  return (
    <div
      ref={frameRef}
      className={`relative mx-auto max-w-full select-none overflow-hidden rounded-md border border-slate-300 bg-slate-100 ${
        editable ? 'touch-none' : ''
      }`}
      style={{ width: 'fit-content', cursor: editable ? cursor : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img src={src} alt="첫 번째 이미지 미리보기" draggable={false} className="block max-h-[28rem] max-w-full" />
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
    </div>
  );
}
