import { useRef } from 'react';

/** @typedef {{ left: number, top: number, right: number, bottom: number }} EdgeBox ratios (0..1) of the image */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Shows the preview image with the book region outlined. When `editable`, drag on
 * the image to draw a new region.
 *
 * @param {{
 *   src: string,
 *   box: EdgeBox | null,
 *   editable: boolean,
 *   onChange?: (box: EdgeBox) => void,
 * }} props
 */
export default function RegionPreview({ src, box, editable, onChange }) {
  const frameRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const dragRef = useRef(/** @type {{ x: number, y: number, previous: EdgeBox | null } | null} */ (null));

  /** @param {import('react').PointerEvent} event */
  const point = (event) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  };

  /** @param {import('react').PointerEvent} event */
  const onPointerDown = (event) => {
    if (!editable || !onChange) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event);
    dragRef.current = { x: p.x, y: p.y, previous: box };
  };

  /** @param {import('react').PointerEvent} event */
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || !onChange) return;
    const p = point(event);
    onChange({
      left: Math.min(drag.x, p.x),
      top: Math.min(drag.y, p.y),
      right: Math.max(drag.x, p.x),
      bottom: Math.max(drag.y, p.y),
    });
  };

  /** @param {import('react').PointerEvent} event */
  const onPointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !onChange) return;
    const p = point(event);
    // A click or a tiny drag is not a region: keep what was there before.
    if (Math.abs(p.x - drag.x) < 0.03 || Math.abs(p.y - drag.y) < 0.03) {
      if (drag.previous) onChange(drag.previous);
    }
  };

  return (
    <div
      ref={frameRef}
      className={`relative mx-auto max-w-full select-none overflow-hidden rounded-md border border-slate-300 bg-slate-100 ${
        editable ? 'cursor-crosshair touch-none' : ''
      }`}
      style={{ width: 'fit-content' }}
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
    </div>
  );
}
