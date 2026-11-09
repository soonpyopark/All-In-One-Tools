import { useEffect, useRef, useState } from 'react';
import { useAppInfo } from '../../context/AppInfoContext.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { FEATURES } from '../../features/registry.js';
import { runStartupUpdateCheck } from '../../lib/updateCheckUi.js';
import SettingsView from '../settings/SettingsView.jsx';
import TopBar from './TopBar.jsx';

let startupChecked = false;

const floatingButtonClass =
  'flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:border-app-accent hover:text-app-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40';

/**
 * Each feature page is one scroll container (`h-full overflow-auto`) and the first
 * child of <main>; the floating buttons act on that element only (not on nested
 * scroll boxes such as log lists).
 *
 * @param {HTMLElement | null} main
 * @returns {HTMLElement | null}
 */
const pageScroller = (main) => (main?.firstElementChild instanceof HTMLElement ? main.firstElementChild : null);

/** App layout: top bar + (sidebar when there are 2+ features) + feature area. */
export default function AppShell() {
  const appInfo = useAppInfo();
  const dialog = useDialog();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  /** Bumped to rebuild the current page from scratch (the 초기화 button). */
  const [resetCount, setResetCount] = useState(0);

  const features = FEATURES;
  const [activeId, setActiveId] = useState(features[0]?.id ?? '');
  const active = features.find((feature) => feature.id === activeId) ?? features[0];
  const ActiveFeature = active?.component;

  const resetPage = async () => {
    const ok = await dialog.confirm({
      title: '화면 초기화',
      body: `${active?.label ?? '이 화면'}의 선택한 파일과 옵션을 모두 처음 상태로 되돌립니다.`,
      confirmLabel: '초기화',
    });
    if (!ok) return;
    setResetCount((count) => count + 1);
  };

  const goTo = (id) => {
    setActiveId(id);
  };

  const scrollToTop = () => {
    pageScroller(mainRef.current)?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Quiet update check once per page load (setting: 환경설정 → 일반).
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
          <nav className="w-52 shrink-0 overflow-auto bg-app-sidebar p-2" aria-label="기능">
            {features.map((feature) => {
              const selected = feature.id === active?.id;
              return (
                <button
                  key={feature.id}
                  type="button"
                  aria-current={selected ? 'page' : undefined}
                  className={`mb-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    selected
                      ? 'bg-app-sidebarHover font-semibold text-white'
                      : 'text-slate-300 hover:bg-app-sidebarHover/60 hover:text-white'
                  }`}
                  onClick={() => goTo(feature.id)}
                >
                  {feature.icon ? <span aria-hidden="true">{feature.icon}</span> : null}
                  {feature.label}
                </button>
              );
            })}
          </nav>
        ) : null}

        <main
          ref={mainRef}
          className="relative min-w-0 flex-1 bg-app-surface"
        >
          {ActiveFeature ? <ActiveFeature key={`${active.id}:${resetCount}`} features={features} onNavigate={goTo} /> : null}

          <div className="pointer-events-none absolute bottom-5 right-7 z-20 flex flex-col gap-2">
            {active?.id !== features[0]?.id ? (
              <>
                <button
                  type="button"
                  className={`${floatingButtonClass} pointer-events-auto`}
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
                  className={`${floatingButtonClass} pointer-events-auto`}
                  title="화면 초기화"
                  aria-label="화면 초기화"
                  onClick={() => void resetPage()}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
                    <path d="M20 4v5h-5" />
                  </svg>
                </button>
              </>
            ) : null}
            <button
              type="button"
              className={`${floatingButtonClass} pointer-events-auto`}
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
