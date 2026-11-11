import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppInfo } from '../../context/AppInfoContext.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { JobActivityProvider, useJobActivity } from '../../context/JobActivityContext.jsx';
import { FEATURES } from '../../features/registry.js';
import { openExternalUrl } from '../../lib/openExternal.js';
import { runStartupUpdateCheck } from '../../lib/updateCheckUi.js';
import SettingsView from '../settings/SettingsView.jsx';
import TopBar from './TopBar.jsx';

const BLOG_URL = 'https://note4all.tistory.com';

let startupChecked = false;

const floatingButtonClass =
  'flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-600 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:border-app-accent hover:text-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40';

/**
 * 활성 기능 페이지 스크롤 컨테이너를 찾습니다.
 * @param {HTMLElement | null} main
 * @returns {HTMLElement | null}
 */
const pageScroller = (main) => {
  if (!main) return null;
  const active = main.querySelector('[data-feature-page][data-active="true"]');
  if (active instanceof HTMLElement) {
    const inner = active.firstElementChild;
    if (inner instanceof HTMLElement) return inner;
    return active;
  }
  const first = main.firstElementChild;
  return first instanceof HTMLElement ? first : null;
};

/** 기능 영역 + 사이드바 (작업 상태 컨텍스트 안에서 동작). */
function AppShellInner() {
  const appInfo = useAppInfo();
  const dialog = useDialog();
  const { runningByFeature } = useJobActivity();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  /** 메뉴 id → 초기화 횟수. 해당 메뉴만 다시 마운트합니다. */
  const [resetKeys, setResetKeys] = useState(/** @type {Record<string, number>} */ ({}));

  const features = FEATURES;
  const [activeId, setActiveId] = useState(features[0]?.id ?? '');
  const active = features.find((feature) => feature.id === activeId) ?? features[0];

  /** 한 번이라도 연 메뉴는 마운트 유지(작업·입력 목록 보존). */
  const [mountedIds, setMountedIds] = useState(() => new Set([features[0]?.id].filter(Boolean)));

  useEffect(() => {
    if (!active?.id) return;
    setMountedIds((prev) => {
      if (prev.has(active.id)) return prev;
      const next = new Set(prev);
      next.add(active.id);
      return next;
    });
  }, [active?.id]);

  const backgroundJobs = useMemo(
    () =>
      features
        .filter((feature) => feature.id !== active?.id && runningByFeature[feature.id])
        .map((feature) => ({
          id: feature.id,
          label: feature.label,
          status: runningByFeature[feature.id],
        })),
    [features, active?.id, runningByFeature],
  );

  const resetPage = async () => {
    if (!active?.id) return;
    if (runningByFeature[active.id]) {
      const ok = await dialog.confirm({
        title: '화면 초기화',
        body: `${active.label}에서 작업이 진행 중입니다.\n화면을 초기화해도 백그라운드 작업은 계속될 수 있습니다. 진행할까요?`,
        confirmLabel: '초기화',
      });
      if (!ok) return;
    } else {
      const ok = await dialog.confirm({
        title: '화면 초기화',
        body: `${active.label}의 선택한 파일과 옵션을 모두 처음 상태로 되돌립니다.`,
        confirmLabel: '초기화',
      });
      if (!ok) return;
    }
    setResetKeys((prev) => ({
      ...prev,
      [active.id]: (prev[active.id] || 0) + 1,
    }));
  };

  const goTo = (id) => {
    setActiveId(id);
  };

  const scrollToTop = () => {
    pageScroller(mainRef.current)?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    if (appInfo.startupUpdateCheck === false || startupChecked) return;
    startupChecked = true;
    void runStartupUpdateCheck(dialog);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar settingsOpen={settingsOpen} onToggleSettings={() => setSettingsOpen((open) => !open)} />

      <div className="flex min-h-0 flex-1">
        {features.length > 1 ? (
          <nav className="flex w-64 shrink-0 flex-col bg-app-sidebar p-2" aria-label="기능">
            <div className="min-h-0 flex-1 overflow-auto">
              {features.map((feature) => {
                const selected = feature.id === active?.id;
                const jobLabel = runningByFeature[feature.id];
                return (
                  <button
                    key={feature.id}
                    type="button"
                    aria-current={selected ? 'page' : undefined}
                    title={jobLabel ? `${feature.label} · ${jobLabel}` : feature.label}
                    className={`mb-1 flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? 'bg-app-sidebarHover font-semibold text-white'
                        : 'text-slate-300 hover:bg-app-sidebarHover/60 hover:text-white'
                    }`}
                    onClick={() => goTo(feature.id)}
                  >
                    {feature.icon ? <span aria-hidden="true">{feature.icon}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{feature.label}</span>
                    {jobLabel ? (
                      <span
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                        aria-label={jobLabel}
                      >
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" aria-hidden="true" />
                        진행
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <a
              href={BLOG_URL}
              className="mt-2 shrink-0 truncate rounded-md px-3 py-2 text-left text-xs text-slate-400 transition-colors hover:bg-app-sidebarHover/60 hover:text-slate-200"
              title={BLOG_URL}
              onClick={(event) => {
                event.preventDefault();
                void openExternalUrl(BLOG_URL);
              }}
            >
              note4all.tistory.com
            </a>
          </nav>
        ) : null}

        <main ref={mainRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-app-surface">
          {backgroundJobs.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
              <span className="font-medium">다른 메뉴에서 작업 진행 중</span>
              {backgroundJobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-amber-800 transition hover:border-amber-400 hover:bg-amber-100"
                  onClick={() => goTo(job.id)}
                >
                  {job.label} · {job.status}
                </button>
              ))}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            {features.map((feature) => {
              if (!mountedIds.has(feature.id)) return null;
              const Comp = feature.component;
              const isActive = feature.id === active?.id;
              const resetKey = resetKeys[feature.id] || 0;
              return (
                <div
                  key={`${feature.id}:${resetKey}`}
                  data-feature-page
                  data-active={isActive ? 'true' : 'false'}
                  className={isActive ? 'absolute inset-0' : 'hidden'}
                  aria-hidden={isActive ? undefined : true}
                >
                  <Comp featureId={feature.id} features={features} onNavigate={goTo} />
                </div>
              );
            })}
          </div>

          <div className="pointer-events-none absolute bottom-5 right-7 z-20 flex flex-col gap-2">
            <button
              type="button"
              className={`${floatingButtonClass} pointer-events-auto bg-green-100 hover:bg-green-200`}
              title="홈으로"
              aria-label="홈으로"
              onClick={() => goTo(features[0].id)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M5.5 10v9.5h13V10" />
                <path d="M10 19.5v-5h4v5" />
              </svg>
            </button>
            <button
              type="button"
              className={`${floatingButtonClass} pointer-events-auto bg-yellow-100 hover:bg-yellow-200`}
              title="화면 초기화"
              aria-label="화면 초기화"
              onClick={() => void resetPage()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.5 9a9 9 0 0 1 14.85-3.36L22 9.5" />
                <path d="M22 3.5v6h-6" />
                <path d="M20.5 15a9 9 0 0 1-14.85 3.36L2 14.5" />
                <path d="M2 20.5v-6h6" />
              </svg>
            </button>
            <button
              type="button"
              className={`${floatingButtonClass} pointer-events-auto bg-sky-100 hover:bg-sky-200`}
              title="맨 위로"
              aria-label="맨 위로"
              onClick={scrollToTop}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 6 20 18H4Z" />
              </svg>
            </button>
          </div>
        </main>
      </div>

      {settingsOpen ? <SettingsView onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

/** App layout: top bar + (sidebar when there are 2+ features) + feature area. */
export default function AppShell() {
  return (
    <JobActivityProvider>
      <AppShellInner />
    </JobActivityProvider>
  );
}
