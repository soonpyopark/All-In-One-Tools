import { useState } from 'react';
import { canResolveDroppedFiles, pathsFromDropEvent } from '../../lib/dropPaths.js';

/**
 * 파일·폴더 끌어다 놓기 영역.
 * 평소에도 점선 테두리·안내 문구가 보이며, 끌어오는 중에는 강조됩니다.
 *
 * @param {{
 *   disabled?: boolean,
 *   className?: string,
 *   hint?: string,
 *   emptyHint?: string,
 *   onPaths: (paths: string[]) => void | Promise<void>,
 *   onUnsupported?: () => void,
 *   children: import('react').ReactNode,
 * }} props
 */
export default function InputDropZone({
  disabled = false,
  className = '',
  hint = '파일이나 폴더를 이 영역으로 끌어다 놓으세요',
  emptyHint = '놓으면 목록에 추가됩니다',
  onPaths,
  onUnsupported,
  children,
}) {
  const [dragOver, setDragOver] = useState(false);

  const frameClass = disabled
    ? 'border-slate-200 bg-slate-50/60 opacity-60'
    : dragOver
      ? 'border-blue-500 bg-blue-50 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.35)]'
      : 'border-slate-300 bg-slate-50 hover:border-slate-400 hover:bg-slate-100/80';

  return (
    <div
      className={`relative rounded-lg border-2 border-dashed p-3 transition-colors ${frameClass} ${className}`}
      onDragEnter={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        if (disabled) return;
        if (!canResolveDroppedFiles()) {
          onUnsupported?.();
          return;
        }
        const paths = pathsFromDropEvent(event);
        if (paths.length > 0) void onPaths(paths);
      }}
    >
      {children}
      <div
        className={`mt-3 flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-center text-xs ${
          dragOver
            ? 'border-blue-400 bg-blue-100/80 font-medium text-blue-700'
            : 'border-slate-300 bg-white/70 text-slate-500'
        }`}
        aria-hidden={disabled ? true : undefined}
      >
        <span className="text-base leading-none" aria-hidden="true">
          {dragOver ? '⬇' : '⇩'}
        </span>
        <span>{dragOver ? emptyHint : hint}</span>
      </div>
      {dragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[0.4rem] bg-blue-50/70 text-sm font-medium text-blue-700">
          {emptyHint}
        </div>
      ) : null}
    </div>
  );
}
