import { useEffect } from 'react';
import GeneralSettingsPanel from './GeneralSettingsPanel.jsx';

/** 환경설정 화면. 설정 항목은 GeneralSettingsPanel 에 섹션으로 추가하세요. */

/** @param {{ onClose: () => void }} props */
export default function SettingsView({ onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      // Dialogs (z-2000/1100) get Escape first; only close when nothing is above us.
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[900] flex items-stretch justify-center bg-[rgba(32,33,36,0.45)] p-4 sm:p-6">
      <div
        className="flex min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        role="region"
        aria-label="환경설정"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="m-0 text-base font-semibold text-slate-900">환경설정</h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border-0 bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="환경설정 닫기"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z"
              />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50/60 p-6">
          <GeneralSettingsPanel />
        </div>
      </div>
    </div>
  );
}
