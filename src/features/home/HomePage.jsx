import { useMemo, useRef, useState } from 'react';
import AppLogo from '../../components/common/AppLogo.jsx';
import { useAppInfo } from '../../context/AppInfoContext.jsx';
import { PINNED_FEATURE_IDS, canFavoriteFeature } from '../../lib/featureOrder.js';

/**
 * 홈: 메뉴 바로가기 + 사용 안내.
 * 홈·런처는 카드에 넣지 않음(사이드·하단 바로가기). 카드는 별표·드래그 순서 변경.
 *
 * @param {{
 *   features?: import('../registry.js').FeatureDefinition[],
 *   onNavigate?: (id: string) => void,
 *   onReorder?: (ids: string[]) => void | Promise<void>,
 *   favoriteIds?: string[],
 *   onToggleFavorite?: (id: string) => void | Promise<void>,
 * }} props
 */
export default function HomePage({
  features = [],
  onNavigate,
  onReorder,
  favoriteIds = [],
  onToggleFavorite,
}) {
  // 홈·런처는 상단 바로가기 아이콘으로만 — 카드 목록에서는 제외
  const shortcuts = useMemo(
    () => features.filter((feature) => !PINNED_FEATURE_IDS.includes(feature.id)),
    [features],
  );
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const pinnedSet = useMemo(() => new Set(PINNED_FEATURE_IDS), []);
  const appInfo = useAppInfo();
  const dragIdRef = useRef(/** @type {string | null} */ (null));
  /** 드래그가 실제로 시작되면 클릭 이동을 막기 위한 플래그 */
  const didDragRef = useRef(false);
  const [draggingId, setDraggingId] = useState(/** @type {string | null} */ (null));
  const [overId, setOverId] = useState(/** @type {string | null} */ (null));

  const moveBefore = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    // 홈·런처는 카드에 없음 — 방어적으로 고정 id 차단
    if (pinnedSet.has(fromId) || pinnedSet.has(toId)) return;
    const ids = shortcuts.map((feature) => feature.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    void onReorder?.(next);
  };

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-6">
        <section className="flex items-center gap-4">
          <AppLogo size={64} className="rounded-2xl shadow-sm" />
          <div>
            <h1 className="m-0 text-xl font-semibold text-slate-900">{appInfo.name}</h1>
            <p className="mt-1 text-xs text-slate-400">
              별표로 즐겨찾기하고, 카드는 끌어 순서를 바꿀 수 있습니다. 홈·런처는 왼쪽 메뉴와 하단 바로가기를 이용하세요.
            </p>
          </div>
        </section>

        {shortcuts.length > 0 ? (
          <section aria-label="바로가기" className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
            {shortcuts.map((feature) => {
              const pinned = pinnedSet.has(feature.id);
              const favoritable = canFavoriteFeature(feature.id);
              const favorited = favoritable && favoriteSet.has(feature.id);
              const isDragging = draggingId === feature.id;
              const isOver = overId === feature.id && draggingId && draggingId !== feature.id;
              return (
                <div
                  key={feature.id}
                  className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 bg-white p-4 text-left shadow-sm transition ${
                    isDragging
                      ? 'cursor-grabbing border-dashed border-slate-300 opacity-50'
                      : isOver
                        ? 'border-dashed border-app-accent ring-2 ring-app-accent/20'
                        : 'cursor-grab border-solid border-app-border hover:-translate-y-0.5 hover:border-slate-300'
                  }`}
                  draggable
                  title="끌어서 순서 변경 · 클릭하여 이동 · 별표로 즐겨찾기"
                  onDragStart={(event) => {
                    if (pinned) {
                      event.preventDefault();
                      return;
                    }
                    didDragRef.current = true;
                    dragIdRef.current = feature.id;
                    setDraggingId(feature.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/feature-id', feature.id);
                    event.dataTransfer.setData('text/plain', feature.id);
                  }}
                  onDragEnd={() => {
                    dragIdRef.current = null;
                    setDraggingId(null);
                    setOverId(null);
                    window.setTimeout(() => {
                      didDragRef.current = false;
                    }, 0);
                  }}
                  onDragOver={(event) => {
                    if (pinned || !dragIdRef.current) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setOverId(feature.id);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) return;
                    setOverId((current) => (current === feature.id ? null : current));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (pinned) return;
                    const fromId = dragIdRef.current || event.dataTransfer.getData('text/feature-id');
                    moveBefore(fromId, feature.id);
                    dragIdRef.current = null;
                    setDraggingId(null);
                    setOverId(null);
                  }}
                >
                  {favoritable ? (
                    <button
                      type="button"
                      className={`absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full transition ${
                        favorited
                          ? 'text-amber-500 hover:bg-amber-50'
                          : 'text-slate-300 hover:bg-slate-100 hover:text-amber-400'
                      }`}
                      title={favorited ? '즐겨찾기 해제' : '즐겨찾기'}
                      aria-label={favorited ? `${feature.label} 즐겨찾기 해제` : `${feature.label} 즐겨찾기`}
                      aria-pressed={favorited}
                      onMouseDown={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        event.preventDefault();
                        void onToggleFavorite?.(feature.id);
                      }}
                    >
                      <svg
                        className="h-5 w-5"
                        viewBox="0 0 24 24"
                        fill={favorited ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.8L12 16.9 6.8 19.7l1-5.8L3.5 9.7l5.9-.9L12 3.5z" />
                      </svg>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="flex w-full flex-col items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40"
                    aria-label={feature.label}
                    onClick={() => {
                      if (didDragRef.current) return;
                      onNavigate?.(feature.id);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl shadow-sm"
                      style={{
                        background: `linear-gradient(135deg, ${feature.color?.[0] ?? '#94a3b8'}, ${feature.color?.[1] ?? '#64748b'})`,
                      }}
                    >
                      {feature.icon}
                    </span>
                    <span className="pr-6">
                      <span className="block text-sm font-semibold text-slate-900 group-hover:text-app-accent">
                        {feature.label}
                      </span>
                      {feature.description ? (
                        <span className="mt-1 block text-xs leading-relaxed text-slate-500">
                          {feature.description}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </div>
              );
            })}
          </section>
        ) : null}

        <section className="rounded-lg border border-app-border bg-white p-5 shadow-sm">
          <h2 className="m-0 text-sm font-semibold text-slate-800">시작하기</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>환경설정 → 일반의 FFmpeg 경로에서 ffmpeg 폴더를 지정하거나 PATH를 확인합니다.</li>
            <li>왼쪽 메뉴에서 파일을 고르고 옵션을 설정합니다.</li>
            <li>결과는 기본적으로 원본 파일이 있는 폴더에 저장됩니다. (각 화면에서 저장 폴더 변경 가능)</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
