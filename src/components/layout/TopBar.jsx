import { useState } from 'react';
import { useAppInfo } from '../../context/AppInfoContext.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { openExternalUrl } from '../../lib/openExternal.js';
import { runUpdateCheck } from '../../lib/updateCheckUi.js';
import AppLogo from '../common/AppLogo.jsx';

const BLOG_URL = 'https://note4all.tistory.com';
const GITHUB_PROFILE_URL = 'https://github.com/soonpyopark';

const iconBtnClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50';
const iconBtnActiveClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-app-accentBorder bg-app-accentSoft text-app-accent transition-colors';

/** 티스토리 로고(다섯 원 T). GitHub 와 같이 currentColor 사용. */
function TistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="7.2" cy="7.2" r="2.15" fill="currentColor" />
      <circle cx="12" cy="7.2" r="2.15" fill="currentColor" />
      <circle cx="16.8" cy="7.2" r="2.15" fill="currentColor" />
      <circle cx="12" cy="12" r="2.15" fill="currentColor" />
      <circle cx="12" cy="16.8" r="2.15" fill="currentColor" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
      />
    </svg>
  );
}

function UpdateCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 6V3L8 7l4 4V8c2.76 0 5 2.24 5 5a5 5 0 0 1-8.66 3.46l-1.42 1.42A7 7 0 0 0 19 13c0-3.87-3.13-7-7-7zm-5 .54A7 7 0 0 0 5 13c0 3.87 3.13 7 7 7v3l4-4-4-4v3c-2.76 0-5-2.24-5-5 0-1.16.4-2.23 1.07-3.08L7 8.54z"
      />
    </svg>
  );
}

/**
 * Top bar. Right side, left → right:  [블로그]  [GitHub]  [업데이트 확인 ⟳]  [환경설정 ⚙]
 *
 * @param {{
 *   settingsOpen: boolean,
 *   onToggleSettings: () => void,
 *   onGoHome?: () => void,
 * }} props
 */
export default function TopBar({ settingsOpen, onToggleSettings, onGoHome }) {
  const appInfo = useAppInfo();
  const dialog = useDialog();
  const [updateChecking, setUpdateChecking] = useState(false);

  const handleUpdateCheck = () => {
    if (updateChecking) return;
    setUpdateChecking(true);
    void runUpdateCheck(dialog).finally(() => setUpdateChecking(false));
  };

  const openBlog = () => {
    void openExternalUrl(BLOG_URL);
  };

  const openGitHub = () => {
    void openExternalUrl(GITHUB_PROFILE_URL);
  };

  const showAbout = () => {
    void dialog.alert({
      title: appInfo.name,
      body: `버전: v${appInfo.version}\n빌드: ${appInfo.buildStampLabel}`,
    });
  };

  return (
    <header className="shrink-0 border-b border-app-border bg-white px-4 py-2 min-h-12">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            className="shrink-0 rounded-md transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40"
            title="홈으로"
            aria-label="홈으로"
            onClick={() => onGoHome?.()}
          >
            <AppLogo size={32} />
          </button>
          <button
            type="button"
            className="flex min-w-0 items-baseline gap-2 rounded-md text-left transition-opacity hover:opacity-80"
            onClick={showAbout}
            aria-label={`${appInfo.name} 정보 보기`}
          >
            <span className="truncate text-sm font-semibold text-slate-800">{appInfo.name}</span>
            <span className="shrink-0 text-xs font-medium text-slate-400">v{appInfo.version}</span>
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            type="button"
            className={iconBtnClass}
            aria-label="티스토리 블로그"
            title="note4all.tistory.com"
            onClick={openBlog}
          >
            <TistoryIcon />
          </button>

          <button
            type="button"
            className={iconBtnClass}
            aria-label="GitHub"
            title="github.com/soonpyopark"
            onClick={openGitHub}
          >
            <GitHubIcon />
          </button>

          <button
            type="button"
            className={iconBtnClass}
            aria-label="업데이트 확인"
            title="업데이트 확인"
            disabled={updateChecking}
            onClick={handleUpdateCheck}
          >
            <UpdateCheckIcon />
          </button>

          <button
            type="button"
            className={settingsOpen ? iconBtnActiveClass : iconBtnClass}
            aria-label={settingsOpen ? '환경설정 닫기' : '환경설정'}
            title={settingsOpen ? '환경설정 닫기' : '환경설정'}
            aria-pressed={settingsOpen}
            onClick={onToggleSettings}
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </header>
  );
}
