import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppInfo } from '../../context/AppInfoContext.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { JobActivityProvider, useJobActivity } from '../../context/JobActivityContext.jsx';
import { FEATURES } from '../../features/registry.js';
import { api, getNative } from '../../lib/apiClient.js';
import { orderFeatures } from '../../lib/featureOrder.js';
import { runStartupUpdateCheck } from '../../lib/updateCheckUi.js';
import SettingsView from '../settings/SettingsView.jsx';
import TopBar from './TopBar.jsx';

const SIDEBAR_COLLAPSED_KEY = 'frame.sidebarCollapsed';
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

let startupChecked = false;

function padTime(n) {
  return String(n).padStart(2, '0');
}

/** @param {Date} date */
function formatSidebarClock(date) {
  return `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`;
}

/** @param {Date} date */
function formatSidebarDay(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

/** @param {boolean} collapsed */
function writeSidebarCollapsed(collapsed) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // 저장 실패해도 이번 세션 토글은 유지
  }
}

const floatingButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md p-0 transition active:scale-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40';

const floatingIconClass = 'h-4 w-4 shrink-0';

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
  // 프로그램 시작 시 왼쪽 메뉴는 항상 접힌 상태
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  /** 메뉴 id → 초기화 횟수. 해당 메뉴만 다시 마운트합니다. */
  const [resetKeys, setResetKeys] = useState(/** @type {Record<string, number>} */ ({}));

  const [featureOrder, setFeatureOrder] = useState(/** @type {string[]} */ ([]));
  /** Windows 전용 메뉴 등은 현재 OS 에 맞게 걸러냅니다. */
  const platformFeatures = useMemo(() => {
    const platform = appInfo?.platform || (typeof process !== 'undefined' ? process.platform : '');
    return FEATURES.filter(
      (feature) => !feature.platforms?.length || feature.platforms.includes(platform),
    );
  }, [appInfo?.platform]);
  const features = useMemo(
    () => orderFeatures(platformFeatures, featureOrder),
    [platformFeatures, featureOrder],
  );
  const [activeId, setActiveId] = useState(FEATURES[0]?.id ?? '');
  const active = features.find((feature) => feature.id === activeId) ?? features[0];
  /** 플로팅 런처에서 요청한 바로가기 편집 id */
  const [launcherEditId, setLauncherEditId] = useState(/** @type {string | null} */ (null));

  /** 한 번이라도 연 메뉴는 마운트 유지(작업·입력 목록 보존). */
  const [mountedIds, setMountedIds] = useState(() => new Set([FEATURES[0]?.id].filter(Boolean)));

  useEffect(() => {
    // 플랫폼에 없는 메뉴가 활성/마운트에 남아 있으면 홈으로 되돌립니다.
    if (!activeId) return;
    if (features.some((feature) => feature.id === activeId)) return;
    const fallback = features[0]?.id;
    if (!fallback) return;
    setActiveId(fallback);
    setMountedIds((prev) => {
      const next = new Set([...prev].filter((id) => features.some((feature) => feature.id === id)));
      next.add(fallback);
      return next;
    });
  }, [activeId, features]);

  useEffect(() => {
    let alive = true;
    api('settings.get')
      .then((settings) => {
        if (!alive) return;
        setFeatureOrder(Array.isArray(settings?.featureOrder) ? settings.featureOrder : []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const native = getNative();
    if (!native?.onLauncherEditItem) return undefined;
    return native.onLauncherEditItem((payload) => {
      const id = String(payload?.id ?? '').trim();
      if (!id) return;
      setActiveId('launcher');
      setMountedIds((prev) => {
        if (prev.has('launcher')) return prev;
        const next = new Set(prev);
        next.add('launcher');
        return next;
      });
      setLauncherEditId(id);
    });
  }, []);

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      writeSidebarCollapsed(next);
      return next;
    });
  };

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

  const saveFeatureOrder = async (ids) => {
    const next = Array.isArray(ids) ? ids.map(String).filter((id) => id && id !== 'home') : [];
    setFeatureOrder(next);
    try {
      const settings = await api('settings.update', { featureOrder: next });
      if (Array.isArray(settings?.featureOrder)) setFeatureOrder(settings.featureOrder);
    } catch {
      // 저장 실패해도 화면 순서는 유지; 다음 실행 시 서버 값이 우선
    }
  };

  const resetPage = async () => {
    if (!active?.id) return;
    if (active.id === 'home') {
      const ok = await dialog.confirm({
        title: '메뉴 순서 초기화',
        body: '홈·사이드바 메뉴 순서를 처음 상태로 되돌립니다.',
        confirmLabel: '초기화',
      });
      if (!ok) return;
      await saveFeatureOrder([]);
      setResetKeys((prev) => ({
        ...prev,
        [active.id]: (prev[active.id] || 0) + 1,
      }));
      return;
    }
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

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const native = getNative();
    if (!native?.getAlwaysOnTop) return;
    let alive = true;
    native
      .getAlwaysOnTop()
      .then((result) => {
        if (alive) setAlwaysOnTop(Boolean(result?.enabled));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const handleAlwaysOnTop = () => {
    const native = getNative();
    if (!native?.setAlwaysOnTop) return;
    const next = !alwaysOnTop;
    setAlwaysOnTop(next);
    void native
      .setAlwaysOnTop(next)
      .then((result) => setAlwaysOnTop(Boolean(result?.enabled)))
      .catch(() => setAlwaysOnTop(!next));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onGoHome={() => goTo(features[0]?.id || 'home')}
      />

      <div className="flex min-h-0 flex-1">
        {features.length > 1 ? (
          <div
            className={`relative flex shrink-0 transition-[width] duration-200 ease-out ${
              sidebarCollapsed ? 'w-14' : 'w-64'
            }`}
          >
            <nav
              className="flex h-full min-w-0 flex-1 flex-col bg-app-sidebar p-2"
              aria-label="기능"
              data-collapsed={sidebarCollapsed ? 'true' : 'false'}
            >
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
                      className={`mb-1 flex w-full items-center rounded-md py-2 text-left text-sm transition-colors ${
                        sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-3'
                      } ${
                        selected
                          ? 'bg-app-sidebarHover font-semibold text-white'
                          : 'text-slate-300 hover:bg-app-sidebarHover/60 hover:text-white'
                      }`}
                      onClick={() => goTo(feature.id)}
                    >
                      {feature.icon ? (
                        <span aria-hidden="true" className="relative shrink-0 text-base leading-none">
                          {feature.icon}
                          {sidebarCollapsed && jobLabel ? (
                            <span
                              className="absolute -right-1 -top-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      ) : null}
                      {!sidebarCollapsed ? (
                        <>
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
                        </>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  className={`flex w-full items-center justify-center rounded-md py-2 transition-colors hover:bg-app-sidebarHover/60 ${
                    sidebarCollapsed ? 'px-0' : 'px-3'
                  }`}
                  title="시간 & 알람으로 이동"
                  aria-label={`현재 시각 ${formatSidebarClock(now)}, ${formatSidebarDay(now)}. 시간 및 알람으로 이동`}
                  onClick={() => goTo('clock')}
                >
                  {sidebarCollapsed ? (
                    <span className="font-mono text-[10px] font-semibold tabular-nums text-slate-300">
                      {padTime(now.getHours())}:{padTime(now.getMinutes())}
                    </span>
                  ) : (
                    <span className="flex min-w-0 items-baseline justify-center gap-2 whitespace-nowrap">
                      <span className="font-mono text-lg font-semibold tabular-nums tracking-tight text-slate-100">
                        {formatSidebarClock(now)}
                      </span>
                      <span className="text-sm text-slate-400">{formatSidebarDay(now)}</span>
                    </span>
                  )}
                </button>
              </div>
            </nav>

            {/* 사이드바 오른쪽 가장자리 띠지 */}
            <button
              type="button"
              className="absolute right-0 top-1/2 z-20 flex h-16 w-3.5 -translate-y-1/2 translate-x-full items-center justify-center rounded-r-md border border-l-0 border-slate-300/80 bg-app-sidebar text-slate-400 shadow-sm transition hover:bg-app-sidebarHover hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40"
              title={sidebarCollapsed ? '메뉴 펼치기' : '메뉴 접기'}
              aria-label={sidebarCollapsed ? '메뉴 펼치기' : '메뉴 접기'}
              aria-expanded={!sidebarCollapsed}
              onClick={toggleSidebar}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`transition-transform duration-200 ${sidebarCollapsed ? 'rotate-180' : ''}`}
              >
                <path d="M15 6 9 12l6 6" />
              </svg>
            </button>
          </div>
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
                  <Comp
                    featureId={feature.id}
                    features={features}
                    onNavigate={goTo}
                    onReorder={feature.id === 'home' ? saveFeatureOrder : undefined}
                    editItemId={feature.id === 'launcher' ? launcherEditId : undefined}
                    onEditItemHandled={
                      feature.id === 'launcher' ? () => setLauncherEditId(null) : undefined
                    }
                  />
                </div>
              );
            })}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-slate-200/80 bg-app-surface px-6 py-2">
            <button
              type="button"
              className={`${floatingButtonClass} text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700`}
              title="홈으로"
              aria-label="홈으로"
              onClick={() => goTo(features[0].id)}
            >
              <svg className={floatingIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 11.5 12 4l9 7.5" />
                <path d="M5.5 10v9.5h13V10" />
                <path d="M10 19.5v-5h4v5" />
              </svg>
            </button>
            <button
              type="button"
              className={`${floatingButtonClass} text-orange-500 hover:bg-orange-50 hover:text-orange-600`}
              title="런처"
              aria-label="런처"
              onClick={() => goTo('launcher')}
            >
              <svg className={floatingIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
              </svg>
            </button>
            <button
              type="button"
              className={`${floatingButtonClass} text-amber-500 hover:bg-amber-50 hover:text-amber-600`}
              title="화면 초기화"
              aria-label="화면 초기화"
              onClick={() => void resetPage()}
            >
              <svg className={floatingIconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3.5 9a9 9 0 0 1 14.85-3.36L22 9.5" />
                <path d="M22 3.5v6h-6" />
                <path d="M20.5 15a9 9 0 0 1-14.85 3.36L2 14.5" />
                <path d="M2 20.5v-6h6" />
              </svg>
            </button>
            <button
              type="button"
              className={`${floatingButtonClass} text-sky-500 hover:bg-sky-50 hover:text-sky-600`}
              title="맨 위로"
              aria-label="맨 위로"
              onClick={scrollToTop}
            >
              <svg className={floatingIconClass} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 6 20 18H4Z" />
              </svg>
            </button>
            <button
              type="button"
              className={`${floatingButtonClass} ${
                alwaysOnTop
                  ? 'bg-app-accentSoft text-app-accent ring-1 ring-app-accentBorder'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
              }`}
              title={alwaysOnTop ? '항상 위 해제' : '항상 위에'}
              aria-label={alwaysOnTop ? '항상 위 해제' : '항상 위에'}
              aria-pressed={alwaysOnTop}
              onClick={handleAlwaysOnTop}
            >
              <svg
                className={`${floatingIconClass} transition-transform ${alwaysOnTop ? 'rotate-45' : ''}`}
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M16 9V4h1V2H7v2h1v5l-2 2v2h5.2v7h1.6v-7H18v-2l-2-2zm-1.5 2H14V4h-4v7H9.5l1.5 1.5L12.5 11z" />
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
