import { useEffect, useState } from 'react';
import { useAppInfo } from '../../context/AppInfoContext.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { FEATURES } from '../../features/registry.js';
import { runStartupUpdateCheck } from '../../lib/updateCheckUi.js';
import SettingsView from '../settings/SettingsView.jsx';
import TopBar from './TopBar.jsx';

let startupChecked = false;

/** App layout: top bar + (sidebar when there are 2+ features) + feature area. */
export default function AppShell() {
  const appInfo = useAppInfo();
  const dialog = useDialog();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const features = FEATURES;
  const [activeId, setActiveId] = useState(features[0]?.id ?? '');
  const active = features.find((feature) => feature.id === activeId) ?? features[0];
  const ActiveFeature = active?.component;

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
                  onClick={() => setActiveId(feature.id)}
                >
                  {feature.icon ? <span aria-hidden="true">{feature.icon}</span> : null}
                  {feature.label}
                </button>
              );
            })}
          </nav>
        ) : null}

        <main className="min-w-0 flex-1 bg-app-surface">
          {ActiveFeature ? <ActiveFeature /> : null}
        </main>
      </div>

      {settingsOpen ? <SettingsView onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}
