import { useEffect, useMemo, useState } from 'react';
import { Section, btnClass, btnPrimaryClass, inputClass } from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { showExportDone } from '../../lib/exportDone.jsx';

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   time: string,
 *   enabled: boolean,
 *   repeat: 'once' | 'daily',
 *   snoozeUntil?: number | null,
 * }} AlarmItem
 */

/**
 * @typedef {{
 *   running: boolean,
 *   remainingMs: number,
 *   durationMs: number,
 * }} TimerState
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatClock(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDate(date) {
  const week = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${week[date.getDay()]})`;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** 시간 & 알람: 시계 · 타이머 · 알람. */
export default function ClockPage() {
  const dialog = useDialog();
  const native = getNative();
  const [now, setNow] = useState(() => new Date());
  const [alarms, setAlarms] = useState(/** @type {AlarmItem[]} */ ([]));
  const [timer, setTimer] = useState(/** @type {TimerState} */ ({ running: false, remainingMs: 0, durationMs: 0 }));
  const [ringing, setRinging] = useState(/** @type {{ kind: string, id: string, title: string } | null} */ (null));
  const [timerMin, setTimerMin] = useState(5);
  const [timerSec, setTimerSec] = useState(0);
  const [draftTitle, setDraftTitle] = useState('알람');
  const [draftTime, setDraftTime] = useState('09:00');
  const [draftRepeat, setDraftRepeat] = useState(/** @type {'once' | 'daily'} */ ('once'));
  const [soundPath, setSoundPath] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const [alarmRes, statusRes] = await Promise.all([api('clock.alarms.list'), api('clock.status')]);
        if (!alive) return;
        setAlarms(Array.isArray(alarmRes?.alarms) ? alarmRes.alarms : []);
        if (statusRes?.timer) setTimer(statusRes.timer);
        setRinging(statusRes?.ringing ?? null);
        if (typeof statusRes?.soundPath === 'string') setSoundPath(statusRes.soundPath);
      } catch {
        // 폴링 실패는 다음 틱에 재시도
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const sortedAlarms = useMemo(
    () => [...alarms].sort((a, b) => String(a.time).localeCompare(String(b.time))),
    [alarms],
  );

  const soundLabel = useMemo(() => {
    if (!soundPath) return '기본 비프음';
    const parts = soundPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || soundPath;
  }, [soundPath]);

  const addAlarm = async () => {
    setBusy(true);
    try {
      const res = await api('clock.alarms.upsert', {
        alarm: {
          title: draftTitle.trim() || '알람',
          time: draftTime,
          enabled: true,
          repeat: draftRepeat,
        },
      });
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : alarms);
    } catch (err) {
      void dialog.alert({
        title: '알람 추가 실패',
        body: err instanceof Error ? err.message : '알람을 추가하지 못했습니다.',
      });
    } finally {
      setBusy(false);
    }
  };

  const toggleAlarm = async (alarm) => {
    try {
      const res = await api('clock.alarms.upsert', {
        alarm: { ...alarm, enabled: !alarm.enabled, snoozeUntil: null },
      });
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : alarms);
    } catch (err) {
      void dialog.alert({
        title: '알람 변경 실패',
        body: err instanceof Error ? err.message : '상태를 바꾸지 못했습니다.',
      });
    }
  };

  const removeAlarm = async (alarm) => {
    const ok = await dialog.confirm({
      title: '알람 삭제',
      body: `「${alarm.title}」 ${alarm.time} 알람을 삭제할까요?`,
      confirmLabel: '삭제',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api('clock.alarms.remove', { id: alarm.id });
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : alarms.filter((item) => item.id !== alarm.id));
    } catch (err) {
      void dialog.alert({
        title: '삭제 실패',
        body: err instanceof Error ? err.message : '삭제하지 못했습니다.',
      });
    }
  };

  const startTimer = async () => {
    const seconds = Math.max(0, Math.floor(timerMin) * 60 + Math.floor(timerSec));
    if (seconds < 1) {
      void dialog.alert({ title: '타이머', body: '1초 이상으로 설정하세요.' });
      return;
    }
    try {
      const res = await api('clock.timer.start', { seconds });
      if (res?.timer) setTimer(res.timer);
    } catch (err) {
      void dialog.alert({
        title: '타이머',
        body: err instanceof Error ? err.message : '시작하지 못했습니다.',
      });
    }
  };

  const pauseOrResume = async () => {
    try {
      const res = timer.running ? await api('clock.timer.pause') : await api('clock.timer.resume');
      if (res?.timer) setTimer(res.timer);
    } catch (err) {
      void dialog.alert({
        title: '타이머',
        body: err instanceof Error ? err.message : '조작에 실패했습니다.',
      });
    }
  };

  const resetTimer = async () => {
    try {
      const res = await api('clock.timer.reset');
      if (res?.timer) setTimer(res.timer);
    } catch {
      // ignore
    }
  };

  const dismiss = async () => {
    try {
      await api('clock.dismiss');
      setRinging(null);
    } catch {
      setRinging(null);
    }
  };

  const snooze = async () => {
    try {
      await api('clock.snooze', { minutes: 5 });
      setRinging(null);
      const alarmRes = await api('clock.alarms.list');
      setAlarms(Array.isArray(alarmRes?.alarms) ? alarmRes.alarms : alarms);
    } catch (err) {
      void dialog.alert({
        title: '스누즈 실패',
        body: err instanceof Error ? err.message : '스누즈하지 못했습니다.',
      });
    }
  };

  const exportAlarms = async () => {
    try {
      const res = await api('clock.alarms.export');
      if (res?.cancelled) return;
      await showExportDone({
        dialog,
        native,
        summary: `${res?.count ?? 0}개 알람을 저장했습니다.`,
        filePath: res?.filePath,
      });
    } catch (err) {
      void dialog.alert({
        title: '내보내기 실패',
        body: err instanceof Error ? err.message : '내보내기에 실패했습니다.',
      });
    }
  };

  const pickSound = async () => {
    try {
      const res = await api('clock.sound.pick');
      if (res?.cancelled) return;
      setSoundPath(typeof res?.soundPath === 'string' ? res.soundPath : '');
    } catch (err) {
      void dialog.alert({
        title: '음원 설정 실패',
        body: err instanceof Error ? err.message : '음원을 선택하지 못했습니다.',
      });
    }
  };

  const clearSound = async () => {
    try {
      const res = await api('clock.sound.clear');
      setSoundPath(typeof res?.soundPath === 'string' ? res.soundPath : '');
    } catch (err) {
      void dialog.alert({
        title: '음원 초기화 실패',
        body: err instanceof Error ? err.message : '기본 소리로 되돌리지 못했습니다.',
      });
    }
  };

  const previewSound = async () => {
    try {
      await api('clock.sound.preview');
    } catch (err) {
      void dialog.alert({
        title: '미리듣기 실패',
        body: err instanceof Error ? err.message : '소리를 재생하지 못했습니다.',
      });
    }
  };

  const stopPreview = async () => {
    try {
      await api('clock.sound.stopPreview');
    } catch {
      // ignore
    }
  };

  const importAlarms = async () => {
    const choice = await dialog.choose({
      title: '알람 목록 가져오기',
      body: '파일을 어떻게 적용할까요?\n· 바꾸기: 현재 알람을 가져온 내용으로 교체\n· 합치기: 없는 항목만 추가',
      primaryLabel: '바꾸기',
      extraLabel: '합치기',
      cancelLabel: '취소',
    });
    if (!choice) return;
    const mode = choice === 'extra' ? 'merge' : 'replace';
    if (mode === 'replace' && alarms.length > 0) {
      const ok = await dialog.confirm({
        title: '목록 바꾸기',
        body: '현재 알람 목록이 가져온 내용으로 바뀝니다. 계속할까요?',
        confirmLabel: '바꾸기',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    try {
      const res = await api('clock.alarms.import', { mode });
      if (res?.cancelled) return;
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : []);
      void dialog.alert({
        title: '가져오기 완료',
        body: mode === 'merge' ? `합친 뒤 ${res?.count ?? 0}개입니다.` : `${res?.count ?? 0}개로 바꿨습니다.`,
      });
    } catch (err) {
      void dialog.alert({
        title: '가져오기 실패',
        body: err instanceof Error ? err.message : '가져오지 못했습니다.',
      });
    }
  };

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">시간 & 알람</h1>
          <p className="mt-1 text-sm text-slate-500">
            현재 시각, 타이머, 알람을 사용합니다. 다른 메뉴에 있어도 메인에서 울립니다.
          </p>
        </section>

        {ringing ? (
          <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm">
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-amber-700">
              {ringing.kind === 'timer' ? '타이머 종료' : '알람'}
            </p>
            <p className="mt-1 text-lg font-semibold text-amber-950">{ringing.title || '시간이 되었습니다.'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={btnPrimaryClass} onClick={() => void dismiss()}>
                확인
              </button>
              {ringing.kind === 'alarm' ? (
                <button type="button" className={btnClass} onClick={() => void snooze()}>
                  5분 스누즈
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <Section title="현재 시각">
          <p className="m-0 font-mono text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {formatClock(now)}
          </p>
          <p className="mt-2 text-sm text-slate-500">{formatDate(now)}</p>
        </Section>

        <Section
          title="알림 소리"
          description="알람·타이머가 울릴 때 재생할 음원을 지정합니다. 비워 두면 기본 비프음을 씁니다."
        >
          <p className="m-0 truncate text-sm text-slate-700" title={soundPath || undefined}>
            {soundLabel}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={btnPrimaryClass} onClick={() => void pickSound()}>
              음원 선택
            </button>
            <button type="button" className={btnClass} onClick={() => void previewSound()}>
              미리듣기
            </button>
            <button type="button" className={btnClass} onClick={() => void stopPreview()}>
              정지
            </button>
            <button type="button" className={btnClass} disabled={!soundPath} onClick={() => void clearSound()}>
              기본으로
            </button>
          </div>
        </Section>

        <Section
          title="알람"
          description="지정한 시각에 알림이 울립니다. 일회/매일을 고를 수 있습니다."
          actions={
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnClass} onClick={() => void exportAlarms()}>
                내보내기
              </button>
              <button type="button" className={btnClass} onClick={() => void importAlarms()}>
                가져오기
              </button>
            </div>
          }
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">이름</span>
              <input
                className={`${inputClass} w-40`}
                value={draftTitle}
                maxLength={80}
                onChange={(event) => setDraftTitle(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">시각</span>
              <input
                type="time"
                className={`${inputClass} w-36`}
                value={draftTime}
                onChange={(event) => setDraftTime(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">반복</span>
              <select
                className={inputClass}
                value={draftRepeat}
                onChange={(event) => setDraftRepeat(/** @type {'once' | 'daily'} */ (event.target.value))}
              >
                <option value="once">일회</option>
                <option value="daily">매일</option>
              </select>
            </label>
            <button type="button" className={btnPrimaryClass} disabled={busy} onClick={() => void addAlarm()}>
              추가
            </button>
          </div>

          {sortedAlarms.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">등록된 알람이 없습니다.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {sortedAlarms.map((alarm) => (
                <li key={alarm.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <button
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      alarm.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                    onClick={() => void toggleAlarm(alarm)}
                  >
                    {alarm.enabled ? '켜짐' : '꺼짐'}
                  </button>
                  <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">{alarm.time}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{alarm.title}</span>
                  <span className="text-xs text-slate-400">{alarm.repeat === 'daily' ? '매일' : '일회'}</span>
                  {alarm.snoozeUntil && alarm.snoozeUntil > Date.now() ? (
                    <span className="text-xs text-amber-600">스누즈 중</span>
                  ) : null}
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    onClick={() => void removeAlarm(alarm)}
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="타이머" description="분이 끝나면 알림과 소리로 알려 줍니다.">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">분</span>
              <input
                type="number"
                min={0}
                max={24 * 60}
                className={`${inputClass} w-24`}
                value={timerMin}
                disabled={timer.running || timer.remainingMs > 0}
                onChange={(event) => setTimerMin(Number(event.target.value) || 0)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">초</span>
              <input
                type="number"
                min={0}
                max={59}
                className={`${inputClass} w-24`}
                value={timerSec}
                disabled={timer.running || timer.remainingMs > 0}
                onChange={(event) => setTimerSec(Number(event.target.value) || 0)}
              />
            </label>
            <button
              type="button"
              className={btnPrimaryClass}
              disabled={timer.running || timer.remainingMs > 0}
              onClick={() => void startTimer()}
            >
              시작
            </button>
            <button
              type="button"
              className={btnClass}
              disabled={timer.remainingMs <= 0 && !timer.running}
              onClick={() => void pauseOrResume()}
            >
              {timer.running ? '일시정지' : '계속'}
            </button>
            <button type="button" className={btnClass} onClick={() => void resetTimer()}>
              리셋
            </button>
          </div>
          <p className="mt-4 font-mono text-3xl font-semibold tabular-nums text-slate-800">
            {formatDuration(timer.remainingMs)}
          </p>
        </Section>
      </div>
    </div>
  );
}
