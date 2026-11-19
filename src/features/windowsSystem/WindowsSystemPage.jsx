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
import { ApiRequestError, api } from '../../lib/apiClient.js';
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
 * @typedef {{
 *   mountPoint: string,
 *   lockStatus: string,
 *   protectionStatus: string,
 *   volumeStatus: string,
 *   capacityGB: number,
 *   locked: boolean,
 * }} BitLockerVolume
 */

/**
 * Windows 전용: 제어판·컴퓨터관리·서비스·작업 스케줄러 바로가기,
 * 화면보호기 끄기, BitLocker 잠금·해제, 비밀번호 변경.
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
  const [elevated, setElevated] = useState(false);
  const [relaunchingElevated, setRelaunchingElevated] = useState(false);
  const [bitlockerVolumes, setBitlockerVolumes] = useState(/** @type {BitLockerVolume[]} */ ([]));
  const [bitlockerLoading, setBitlockerLoading] = useState(false);
  const [bitlockerBusy, setBitlockerBusy] = useState(/** @type {string | null} */ (null));
  const [bitlockerPasswords, setBitlockerPasswords] = useState(/** @type {Record<string, string>} */ ({}));
  const [bitlockerShowPass, setBitlockerShowPass] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [bitlockerError, setBitlockerError] = useState(/** @type {string | null} */ (null));

  const dragIdRef = useRef(/** @type {string | null} */ (null));
  const didDragRef = useRef(false);
  const [draggingId, setDraggingId] = useState(/** @type {string | null} */ (null));
  const [overId, setOverId] = useState(/** @type {string | null} */ (null));

  const refresh = useCallback(async () => {
    const state = await api('windowsSystem.state');
    setShortcuts(orderWindowsSystemShortcuts(state?.order));
    setScreensaverOff(state?.screensaverActive === false);
    setUsername(String(state?.username ?? ''));
    setElevated(Boolean(state?.elevated));
  }, []);

  const refreshBitlocker = useCallback(async () => {
    setBitlockerLoading(true);
    setBitlockerError(null);
    try {
      const res = await api('windowsSystem.bitlocker.list');
      setBitlockerVolumes(Array.isArray(res?.volumes) ? res.volumes : []);
    } catch (err) {
      setBitlockerVolumes([]);
      setBitlockerError(
        err instanceof Error ? err.message : 'BitLocker 볼륨을 불러오지 못했습니다.',
      );
    } finally {
      setBitlockerLoading(false);
    }
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
    void refreshBitlocker();
    return () => {
      alive = false;
    };
  }, [dialog, refresh, refreshBitlocker]);

  const setBitlockerPassword = (mountPoint, value) => {
    setBitlockerPasswords((prev) => ({ ...prev, [mountPoint]: value }));
  };

  const clearBitlockerPassword = (mountPoint) => {
    setBitlockerPasswords((prev) => {
      const next = { ...prev };
      delete next[mountPoint];
      return next;
    });
    setBitlockerShowPass((prev) => {
      const next = { ...prev };
      delete next[mountPoint];
      return next;
    });
  };

  const onUnlockBitlocker = async (mountPoint) => {
    const pass = String(bitlockerPasswords[mountPoint] ?? '');
    if (!pass) {
      void dialog.alert({ title: 'BitLocker', body: '암호를 입력해 주세요.' });
      return;
    }
    setBitlockerBusy(mountPoint);
    try {
      await api('windowsSystem.bitlocker.unlock', { mountPoint, password: pass });
      clearBitlockerPassword(mountPoint);
      await refreshBitlocker();
      void dialog.alert({ title: 'BitLocker', body: `${mountPoint} 잠금을 해제했습니다.` });
    } catch (err) {
      void dialog.alert({
        title: 'BitLocker',
        body: err instanceof Error ? err.message : '잠금 해제에 실패했습니다.',
      });
    } finally {
      setBitlockerBusy(null);
    }
  };

  const runLockBitlocker = async (mountPoint, force) => {
    setBitlockerBusy(mountPoint);
    try {
      await api('windowsSystem.bitlocker.lock', { mountPoint, force });
      await refreshBitlocker();
      void dialog.alert({
        title: 'BitLocker',
        body: force ? `${mountPoint} 을(를) 강제 잠금했습니다.` : `${mountPoint} 을(를) 잠갔습니다.`,
      });
      return true;
    } catch (err) {
      const inUse =
        err instanceof ApiRequestError &&
        (err.data?.code === 'BITLOCKER_IN_USE' || /사용 중/.test(err.message));
      if (!force && inUse) {
        const ok = await dialog.confirm({
          title: 'BitLocker 강제 잠금',
          body: `${mountPoint} 이(가) 사용 중이라 잠글 수 없습니다. 연결을 끊고 강제 잠금할까요? 열려 있는 파일은 저장되지 않을 수 있습니다.`,
          confirmLabel: '강제 잠금',
          cancelLabel: '취소',
          confirmVariant: 'danger',
        });
        if (ok) return runLockBitlocker(mountPoint, true);
        return false;
      }
      void dialog.alert({
        title: 'BitLocker',
        body: err instanceof Error ? err.message : '잠금에 실패했습니다.',
      });
      return false;
    } finally {
      setBitlockerBusy(null);
    }
  };

  const onLockBitlocker = async (mountPoint) => {
    const ok = await dialog.confirm({
      title: 'BitLocker 잠금',
      body: `${mountPoint} 드라이브를 다시 잠글까요? (복호화하지 않고 잠금만 합니다.)`,
      confirmLabel: '잠그기',
      cancelLabel: '취소',
    });
    if (!ok) return;
    await runLockBitlocker(mountPoint, false);
  };

  const onRelaunchElevated = async () => {
    if (elevated) {
      void dialog.alert({ title: 'BitLocker', body: '이미 관리자 권한으로 실행 중입니다.' });
      return;
    }
    const ok = await dialog.confirm({
      title: '관리자 권한으로 다시 실행',
      body: 'UAC 창이 뜨면 허용해 주세요. 허용되면 현재 창을 닫고 관리자 권한으로 앱을 다시 시작합니다.',
      confirmLabel: '다시 실행',
      cancelLabel: '취소',
    });
    if (!ok) return;
    setRelaunchingElevated(true);
    try {
      const res = await api('windowsSystem.relaunchElevated');
      if (res?.already) {
        setElevated(true);
        void dialog.alert({ title: 'BitLocker', body: '이미 관리자 권한으로 실행 중입니다.' });
      }
      // 성공 시 곧 앱이 종료됨
    } catch (err) {
      void dialog.alert({
        title: '관리자 권한으로 다시 실행',
        body: err instanceof Error ? err.message : '다시 실행에 실패했습니다.',
      });
    } finally {
      setRelaunchingElevated(false);
    }
  };

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
      body: `${username ? `"${username}" ` : ''}Windows 로그온 비밀번호를 변경할까요?`,
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
                ? `현재 Windows 사용자 "${username}" 의 로그온 비밀번호를 변경합니다. (이 PC 로컬 계정 · 현재 비밀번호 확인 후 본인이 변경)`
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

        <Section
          title="BitLocker"
          description="BitLocker로 보호된 드라이브를 암호로 잠금 해제하거나, manage-bde로 다시 잠급니다. 복호화는 하지 않습니다. 관리자 권한이 필요할 수 있습니다."
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnClass}
              disabled={bitlockerLoading || Boolean(bitlockerBusy) || relaunchingElevated}
              onClick={() => void refreshBitlocker()}
            >
              {bitlockerLoading ? '불러오는 중…' : '새로고침'}
            </button>
            {elevated ? (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                관리자 권한으로 실행 중
              </span>
            ) : (
              <button
                type="button"
                className={btnPrimaryClass}
                disabled={relaunchingElevated || Boolean(bitlockerBusy)}
                onClick={() => void onRelaunchElevated()}
              >
                {relaunchingElevated ? '요청 중…' : '관리자 권한으로 다시 실행'}
              </button>
            )}
          </div>
          {bitlockerLoading && bitlockerVolumes.length === 0 ? (
            <p className="m-0 text-sm text-slate-400">볼륨을 불러오는 중…</p>
          ) : bitlockerError ? (
            <p className="m-0 text-sm text-amber-800">{bitlockerError}</p>
          ) : bitlockerVolumes.length === 0 ? (
            <p className="m-0 text-sm text-slate-500">
              BitLocker로 보호 중이거나 잠긴 드라이브가 없습니다.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-3 p-0">
              {bitlockerVolumes.map((vol) => {
                const busy = bitlockerBusy === vol.mountPoint;
                const showPass = Boolean(bitlockerShowPass[vol.mountPoint]);
                const passValue = bitlockerPasswords[vol.mountPoint] ?? '';
                return (
                  <li
                    key={vol.mountPoint}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="m-0 text-sm font-semibold text-slate-900">
                          {vol.mountPoint}
                          <span
                            className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              vol.locked
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {vol.locked ? '잠김' : '열림'}
                          </span>
                        </p>
                        <p className="mt-1 m-0 text-xs text-slate-500">
                          {vol.capacityGB > 0 ? `${vol.capacityGB} GB` : '용량 미확인'}
                          {vol.volumeStatus ? ` · ${vol.volumeStatus}` : ''}
                          {vol.protectionStatus ? ` · 보호 ${vol.protectionStatus}` : ''}
                        </p>
                      </div>
                      {!vol.locked ? (
                        <button
                          type="button"
                          className={btnPrimaryClass}
                          disabled={busy || bitlockerLoading}
                          onClick={() => void onLockBitlocker(vol.mountPoint)}
                        >
                          {busy ? '처리 중…' : '잠그기'}
                        </button>
                      ) : null}
                    </div>
                    {vol.locked ? (
                      <div className="mt-3 flex max-w-md flex-wrap items-end gap-2">
                        <div className="min-w-[12rem] flex-1">
                          <Field label="BitLocker 암호">
                            <div className="relative">
                              <input
                                type={showPass ? 'text' : 'password'}
                                className={`${inputClass} pr-10`}
                                autoComplete="off"
                                value={passValue}
                                disabled={busy}
                                onChange={(event) =>
                                  setBitlockerPassword(vol.mountPoint, event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void onUnlockBitlocker(vol.mountPoint);
                                  }
                                }}
                                placeholder="암호 입력"
                              />
                              <button
                                type="button"
                                className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-600"
                                title={showPass ? '암호 숨기기' : '암호 보기'}
                                aria-label={showPass ? '암호 숨기기' : '암호 보기'}
                                aria-pressed={showPass}
                                disabled={busy}
                                onClick={() =>
                                  setBitlockerShowPass((prev) => ({
                                    ...prev,
                                    [vol.mountPoint]: !prev[vol.mountPoint],
                                  }))
                                }
                              >
                                <EyeIcon open={showPass} />
                              </button>
                            </div>
                          </Field>
                        </div>
                        <button
                          type="button"
                          className={btnPrimaryClass}
                          disabled={busy || !passValue}
                          onClick={() => void onUnlockBitlocker(vol.mountPoint)}
                        >
                          {busy ? '해제 중…' : '잠금 해제'}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
