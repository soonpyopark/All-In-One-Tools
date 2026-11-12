import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Field,
  Section,
  ToggleRow,
  btnClass,
  btnPrimaryClass,
  inputClass,
} from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api } from '../../lib/apiClient.js';
import {
  WINDOWS_SYSTEM_SHORTCUTS,
  orderWindowsSystemShortcuts,
} from '../../../shared/windowsSystem.js';

const TITLE = 'Windows 시스템 관리';

/** 비밀번호 보이기/숨기기 눈 아이콘 */
function EyeIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.4" />
      <path d="M6.1 6.1C3.7 7.8 2 12 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.3-.9" />
    </svg>
  );
}

/**
 * Windows 전용: 제어판·컴퓨터관리·서비스·작업 스케줄러 바로가기, 화면보호기 끄기, 비밀번호 변경.
 */
export default function WindowsSystemPage() {
  const dialog = useDialog();
  const [shortcuts, setShortcuts] = useState(() => orderWindowsSystemShortcuts([]));
  const [screensaverOff, setScreensaverOff] = useState(false);
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingScreen, setSavingScreen] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const dragIdRef = useRef(/** @type {string | null} */ (null));
  const didDragRef = useRef(false);
  const [draggingId, setDraggingId] = useState(/** @type {string | null} */ (null));
  const [overId, setOverId] = useState(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    const state = await api('windowsSystem.state');
    setShortcuts(orderWindowsSystemShortcuts(state?.order));
    setScreensaverOff(state?.screensaverActive === false);
    setUsername(String(state?.username ?? ''));
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    refresh()
      .catch((err) => {
        if (!alive) return;
        void dialog.alert({
          title: TITLE,
          body: err instanceof Error ? err.message : '상태를 불러오지 못했습니다.',
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [dialog, refresh]);

  const persistOrder = async (nextList) => {
    const order = nextList.map((item) => item.id);
    setShortcuts(nextList);
    try {
      const res = await api('windowsSystem.saveOrder', { order });
      setShortcuts(orderWindowsSystemShortcuts(res?.order ?? order));
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '순서 저장에 실패했습니다.',
      });
      void refresh();
    }
  };

  const moveBefore = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const ids = shortcuts.map((item) => item.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...shortcuts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistOrder(next);
  };

  const openShortcut = async (id) => {
    try {
      await api('windowsSystem.open', { id });
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '실행에 실패했습니다.',
      });
    }
  };

  const onToggleScreensaverOff = async (checked) => {
    const prev = screensaverOff;
    setScreensaverOff(checked);
    setSavingScreen(true);
    try {
      // 끄기 토글 ON → 화면보호기 비활성(active=false)
      const res = await api('windowsSystem.setScreensaver', { active: !checked });
      setScreensaverOff(res?.active === false);
    } catch (err) {
      setScreensaverOff(prev);
      void dialog.alert({
        title: '화면보호기',
        body: err instanceof Error ? err.message : '화면보호기 설정에 실패했습니다.',
      });
    } finally {
      setSavingScreen(false);
    }
  };

  const clearPasswordFields = () => {
    setCurrentPassword('');
    setPassword('');
    setConfirm('');
    setShowCurrent(false);
    setShowPassword(false);
    setShowConfirm(false);
  };

  const onChangePassword = async () => {
    if (!currentPassword) {
      void dialog.alert({ title: '비밀번호 설정', body: '현재 비밀번호를 입력해 주세요.' });
      return;
    }
    if (!password) {
      void dialog.alert({ title: '비밀번호 설정', body: '새 비밀번호를 입력해 주세요.' });
      return;
    }
    if (password !== confirm) {
      void dialog.alert({ title: '비밀번호 설정', body: '비밀번호 확인이 일치하지 않습니다.' });
      return;
    }
    if (currentPassword === password) {
      void dialog.alert({ title: '비밀번호 설정', body: '새 비밀번호는 현재 비밀번호와 달라야 합니다.' });
      return;
    }
    const ok = await dialog.confirm({
      title: '비밀번호 설정',
      body: `${username ? `"${username}" ` : ''}Windows 로그온 비밀번호를 변경할까요?\n로컬 계정에서만 동작합니다.`,
      confirmLabel: '변경',
      cancelLabel: '취소',
    });
    if (!ok) return;

    setSavingPassword(true);
    try {
      await api('windowsSystem.changePassword', {
        current: currentPassword,
        password,
        confirm,
      });
      clearPasswordFields();
      void dialog.alert({ title: '비밀번호 설정', body: '비밀번호를 변경했습니다.' });
    } catch (err) {
      void dialog.alert({
        title: '비밀번호 설정',
        body: err instanceof Error ? err.message : '비밀번호 변경에 실패했습니다.',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Windows 전용 메뉴입니다. 바로가기를 끌어 순서를 바꿀 수 있습니다.
          </p>
        </section>

        <Section
          title="바로가기"
          description="제어판 · 컴퓨터관리 · 서비스 · 작업 스케줄러를 엽니다. 카드를 끌어 순서를 바꿀 수 있습니다."
        >
          {loading ? (
            <p className="m-0 text-sm text-slate-400">불러오는 중…</p>
          ) : (
            <div
              className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
              aria-label="Windows 시스템 바로가기"
            >
              {shortcuts.map((item) => {
                const meta = WINDOWS_SYSTEM_SHORTCUTS.find((entry) => entry.id === item.id) ?? item;
                const isDragging = draggingId === item.id;
                const isOver = overId === item.id && draggingId && draggingId !== item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    draggable
                    title="끌어서 순서 변경 · 클릭하여 실행"
                    aria-label={`${meta.label} (끌어서 순서 변경)`}
                    className={`group relative flex flex-col items-start gap-3 rounded-xl border-2 bg-white p-4 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40 ${
                      isDragging
                        ? 'cursor-grabbing border-dashed border-slate-300 opacity-50'
                        : isOver
                          ? 'border-dashed border-app-accent ring-2 ring-app-accent/20'
                          : 'cursor-grab border-solid border-slate-200 hover:-translate-y-0.5 hover:border-slate-300'
                    }`}
                    onDragStart={(event) => {
                      didDragRef.current = true;
                      dragIdRef.current = item.id;
                      setDraggingId(item.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/windows-system-id', item.id);
                      event.dataTransfer.setData('text/plain', item.id);
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
                      if (!dragIdRef.current) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setOverId(item.id);
                    }}
                    onDragLeave={(event) => {
                      if (event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) return;
                      setOverId((current) => (current === item.id ? null : current));
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const fromId =
                        dragIdRef.current || event.dataTransfer.getData('text/windows-system-id');
                      moveBefore(fromId, item.id);
                      dragIdRef.current = null;
                      setDraggingId(null);
                      setOverId(null);
                    }}
                    onClick={() => {
                      if (didDragRef.current) return;
                      void openShortcut(item.id);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 text-2xl shadow-sm"
                    >
                      {meta.icon}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-900 group-hover:text-app-accent">
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                        {meta.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="화면보호기 설정 끄기" description="켜면 화면보호기가 동작하지 않습니다. 다시 끄면 이전처럼 사용할 수 있습니다.">
          <ToggleRow
            label="화면보호기 끄기"
            hint={screensaverOff ? '화면보호기가 꺼져 있습니다.' : '화면보호기가 켜져 있을 수 있습니다.'}
            checked={screensaverOff}
            disabled={loading || savingScreen}
            onChange={(checked) => void onToggleScreensaverOff(checked)}
          />
        </Section>

        <Section
          title="비밀번호 설정"
          description={
            username
              ? `현재 Windows 사용자 "${username}" 의 로컬 로그온 비밀번호를 변경합니다. Microsoft 계정은 Windows 설정에서 변경하세요.`
              : '현재 Windows 로컬 계정의 로그온 비밀번호를 변경합니다.'
          }
        >
          <div className="grid max-w-md gap-4">
            <Field label="현재 비밀번호">
              <div className="relative">
                <input
                  type={showCurrent ? 'text' : 'password'}
                  className={`${inputClass} pr-10`}
                  autoComplete="current-password"
                  value={currentPassword}
                  disabled={savingPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="현재 비밀번호"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-600"
                  title={showCurrent ? '비밀번호 숨기기' : '비밀번호 보기'}
                  aria-label={showCurrent ? '비밀번호 숨기기' : '비밀번호 보기'}
                  aria-pressed={showCurrent}
                  disabled={savingPassword}
                  onClick={() => setShowCurrent((prev) => !prev)}
                >
                  <EyeIcon open={showCurrent} />
                </button>
              </div>
            </Field>
            <Field label="새 비밀번호">
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={`${inputClass} pr-10`}
                  autoComplete="new-password"
                  value={password}
                  disabled={savingPassword}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="새 비밀번호"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-600"
                  title={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                  aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                  aria-pressed={showPassword}
                  disabled={savingPassword}
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>
            </Field>
            <Field label="비밀번호 확인">
              <div className="relative">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  className={`${inputClass} pr-10`}
                  autoComplete="new-password"
                  value={confirm}
                  disabled={savingPassword}
                  onChange={(event) => setConfirm(event.target.value)}
                  placeholder="한 번 더 입력"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-600"
                  title={showConfirm ? '비밀번호 숨기기' : '비밀번호 보기'}
                  aria-label={showConfirm ? '비밀번호 숨기기' : '비밀번호 보기'}
                  aria-pressed={showConfirm}
                  disabled={savingPassword}
                  onClick={() => setShowConfirm((prev) => !prev)}
                >
                  <EyeIcon open={showConfirm} />
                </button>
              </div>
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={savingPassword || !currentPassword || !password}
                onClick={() => void onChangePassword()}
              >
                {savingPassword ? '변경 중…' : '비밀번호 변경'}
              </button>
              <button
                type="button"
                className={btnClass}
                disabled={savingPassword || (!currentPassword && !password && !confirm)}
                onClick={clearPasswordFields}
              >
                초기화
              </button>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
