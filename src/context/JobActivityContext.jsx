import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * 메뉴별 백그라운드 작업 진행 여부.
 * 화면을 바꿔도 keep-alive 된 페이지가 여기로 상태를 올려 사이드바에 표시합니다.
 */

const JobActivityContext = createContext(
  /** @type {{ runningByFeature: Record<string, string>, setRunning: (featureId: string, running: boolean, label?: string) => void } | null} */ (
    null
  ),
);

/**
 * @param {{ children: import('react').ReactNode }} props
 */
export function JobActivityProvider({ children }) {
  const [runningByFeature, setRunningByFeature] = useState(/** @type {Record<string, string>} */ ({}));

  const setRunning = useCallback((featureId, running, label = '작업 중') => {
    const id = String(featureId ?? '');
    if (!id) return;
    setRunningByFeature((prev) => {
      if (!running) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const text = String(label || '작업 중');
      if (prev[id] === text) return prev;
      return { ...prev, [id]: text };
    });
  }, []);

  const value = useMemo(() => ({ runningByFeature, setRunning }), [runningByFeature, setRunning]);

  return <JobActivityContext.Provider value={value}>{children}</JobActivityContext.Provider>;
}

export function useJobActivity() {
  const context = useContext(JobActivityContext);
  if (!context) throw new Error('useJobActivity must be used within JobActivityProvider');
  return context;
}

/**
 * 기능 페이지에서 작업 진행 중 여부를 셸에 알립니다.
 * @param {string | undefined} featureId
 * @param {boolean} running
 * @param {string} [label]
 */
export function useReportJobRunning(featureId, running, label = '작업 중') {
  const { setRunning } = useJobActivity();
  const id = featureId ? String(featureId) : '';
  const active = Boolean(running);

  useEffect(() => {
    if (!id) return undefined;
    setRunning(id, active, label);
    return () => setRunning(id, false);
  }, [id, active, label, setRunning]);
}
