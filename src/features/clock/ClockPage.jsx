import { useEffect, useMemo, useState } from 'react';
import { formatClockTime } from '../../../shared/timeFormat.js';
import { Section, ToggleRow, btnClass, btnPrimaryClass, inputClass } from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { notifyClockHour12 } from '../../lib/clockHour12.js';
import { showExportDone } from '../../lib/exportDone.jsx';

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   time: string,
 *   date?: string | null,
 *   enabled: boolean,
 *   repeat: 'once' | 'daily' | 'date',
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

function formatDate(date) {
  const week = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${week[date.getDay()]})`;
}

/** @param {Date} [date] */
function toDateInputValue(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** @param {AlarmItem} alarm */
function alarmSortKey(alarm) {
  if (alarm.repeat === 'date' && alarm.date) return `${alarm.date}T${alarm.time}`;
  return `9999-99-99T${alarm.time}`;
}

/** @param {AlarmItem} alarm */
function alarmRepeatLabel(alarm) {
  if (alarm.repeat === 'daily') return '매일';
  if (alarm.repeat === 'date') return '날짜';
  return '일회';
}

/** @param {AlarmItem} alarm */
function alarmWhenLabel(alarm) {
  if (alarm.repeat === 'date' && alarm.date) return `${alarm.date} ${alarm.time}`;
  return alarm.time;
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
  const [draftDate, setDraftDate] = useState(() => toDateInputValue());
  const [draftRepeat, setDraftRepeat] = useState(/** @type {'once' | 'daily' | 'date'} */ ('once'));
  /** 수정 중인 알람 id. 없으면 새 알람 추가 모드. */
  const [editingId, setEditingId] = useState(/** @type {string | null} */ (null));
  const [editingEnabled, setEditingEnabled] = useState(true);
  const [soundPath, setSoundPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [hour12, setHour12] = useState(false);
  const [savingHour12, setSavingHour12] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    api('settings.get')
      .then((settings) => {
        if (!alive) return;
        const next = settings?.clockHour12 === true;
        setHour12(next);
        notifyClockHour12(next);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
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
    () => [...alarms].sort((a, b) => alarmSortKey(a).localeCompare(alarmSortKey(b))),
    [alarms],
  );

  const soundLabel = useMemo(() => {
    if (!soundPath) return '기본 비프음';
    const parts = soundPath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || soundPath;
  }, [soundPath]);

  const resetDraft = () => {
    setEditingId(null);
    setEditingEnabled(true);
    setDraftTitle('알람');
    setDraftTime('09:00');
    setDraftDate(toDateInputValue());
    setDraftRepeat('once');
  };

  /** @param {AlarmItem} alarm */
  const beginEditAlarm = (alarm) => {
    setEditingId(alarm.id);
    setEditingEnabled(alarm.enabled !== false);
    setDraftTitle(alarm.title || '알람');
    setDraftTime(alarm.time || '09:00');
    setDraftRepeat(alarm.repeat || 'once');
    setDraftDate(alarm.repeat === 'date' && alarm.date ? alarm.date : toDateInputValue());
  };

  const saveAlarm = async () => {
    const isEdit = Boolean(editingId);
    const dialogTitle = isEdit ? '알람 수정' : '알람 추가';
    if (draftRepeat === 'date') {
      if (!draftDate) {
        void dialog.alert({ title: dialogTitle, body: '날짜를 선택하세요.' });
        return;
      }
      const when = new Date(`${draftDate}T${draftTime}:00`);
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        void dialog.alert({
          title: dialogTitle,
          body: '지난 일시는 등록할 수 없습니다. 미래 날짜와 시각을 선택하세요.',
        });
        return;
      }
    }
    setBusy(true);
    try {
      const res = await api('clock.alarms.upsert', {
        alarm: {
          ...(isEdit ? { id: editingId } : {}),
          title: draftTitle.trim() || '알람',
          time: draftTime,
          date: draftRepeat === 'date' ? draftDate : null,
          enabled: isEdit ? editingEnabled : true,
          repeat: draftRepeat,
          snoozeUntil: null,
        },
      });
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : alarms);
      resetDraft();
    } catch (err) {
      void dialog.alert({
        title: isEdit ? '알람 수정 실패' : '알람 추가 실패',
        body: err instanceof Error ? err.message : `알람을 ${isEdit ? '수정' : '추가'}하지 못했습니다.`,
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
      body: `「${alarm.title}」 ${alarmWhenLabel(alarm)} 알람을 삭제할까요?`,
      confirmLabel: '삭제',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api('clock.alarms.remove', { id: alarm.id });
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : alarms.filter((item) => item.id !== alarm.id));
      if (editingId === alarm.id) resetDraft();
    } catch (err) {
      void dialog.alert({
        title: '삭제 실패',
        body: err instanceof Error ? err.message : '삭제하지 못했습니다.',
      });
    }
  };

  const disabledCount = useMemo(() => alarms.filter((item) => !item.enabled).length, [alarms]);

  const removeDisabledAlarms = async () => {
    if (disabledCount < 1) {
      void dialog.alert({ title: '꺼진 알람 삭제', body: '꺼진 알람이 없습니다.' });
      return;
    }
    const ok = await dialog.confirm({
      title: '꺼진 알람 일괄 삭제',
      body: `꺼진 알람 ${disabledCount}개를 모두 삭제할까요? 켜져 있는 알람은 그대로 둡니다.`,
      confirmLabel: '삭제',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api('clock.alarms.removeDisabled');
      setAlarms(Array.isArray(res?.alarms) ? res.alarms : alarms.filter((item) => item.enabled));
    } catch (err) {
      void dialog.alert({
        title: '삭제 실패',
        body: err instanceof Error ? err.message : '꺼진 알람을 삭제하지 못했습니다.',
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

  const onToggleHour12 = async (checked) => {
    const prev = hour12;
    setHour12(checked);
    setSavingHour12(true);
    try {
      const next = await api('settings.update', { clockHour12: checked });
      const value = next?.clockHour12 === true;
      setHour12(value);
      notifyClockHour12(value);
    } catch (err) {
      setHour12(prev);
      void dialog.alert({
        title: '시간 표시',
        body: err instanceof Error ? err.message : '시제 설정을 저장하지 못했습니다.',
      });
    } finally {
      setSavingHour12(false);
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
            현재 시각, 타이머, 알람을 사용합니다. 울리면 화면 가운데에 큰 알림이 뜨며, 닫기를 누를 때까지 유지됩니다.
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

        <Section
          title="현재 시각"
          description="24시간제와 12시간제(오전/오후) 중 고를 수 있습니다. 왼쪽 메뉴 하단 시각에도 같이 적용됩니다."
        >
          <p className="m-0 font-mono text-5xl font-semibold tracking-tight text-slate-900 tabular-nums">
            {formatClockTime(now, { hour12, withSeconds: true })}
          </p>
          <p className="mt-2 text-sm text-slate-500">{formatDate(now)}</p>
          <div className="mt-4 border-t border-slate-100 pt-2">
            <ToggleRow
              label="12시간제로 표시"
              hint={hour12 ? '오전/오후로 표시합니다.' : '0–23시 기준으로 표시합니다.'}
              checked={hour12}
              disabled={savingHour12}
              onChange={(checked) => void onToggleHour12(checked)}
            />
          </div>
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
          description="지정한 시각에 알림이 울립니다. 일회·매일·특정 날짜를 고를 수 있습니다."
          actions={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnClass}
                disabled={disabledCount < 1}
                title={disabledCount < 1 ? '꺼진 알람이 없습니다' : `꺼진 알람 ${disabledCount}개 삭제`}
                onClick={() => void removeDisabledAlarms()}
              >
                꺼진 알람 삭제{disabledCount > 0 ? ` (${disabledCount})` : ''}
              </button>
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
              <span className="text-xs font-medium text-slate-600">반복</span>
              <select
                className={inputClass}
                value={draftRepeat}
                onChange={(event) => {
                  const next = /** @type {'once' | 'daily' | 'date'} */ (event.target.value);
                  setDraftRepeat(next);
                  if (next === 'date' && !draftDate) setDraftDate(toDateInputValue());
                }}
              >
                <option value="once">일회</option>
                <option value="daily">매일</option>
                <option value="date">날짜 지정</option>
              </select>
            </label>
            {draftRepeat === 'date' ? (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">날짜</span>
                <input
                  type="date"
                  className={`${inputClass} w-40`}
                  value={draftDate}
                  min={toDateInputValue()}
                  onChange={(event) => setDraftDate(event.target.value)}
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">시각</span>
              <input
                type="time"
                className={`${inputClass} w-36`}
                value={draftTime}
                onChange={(event) => setDraftTime(event.target.value)}
              />
            </label>
            <button type="button" className={btnPrimaryClass} disabled={busy} onClick={() => void saveAlarm()}>
              {editingId ? '저장' : '추가'}
            </button>
            {editingId ? (
              <button type="button" className={btnClass} disabled={busy} onClick={resetDraft}>
                수정 취소
              </button>
            ) : null}
          </div>
          {editingId ? (
            <p className="mt-2 text-xs text-amber-700">목록에서 고른 알람을 수정 중입니다. 바꾼 뒤 저장하세요.</p>
          ) : null}

          {sortedAlarms.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">등록된 알람이 없습니다.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {sortedAlarms.map((alarm) => (
                <li
                  key={alarm.id}
                  className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${
                    editingId === alarm.id ? 'bg-amber-50/80' : ''
                  }`}
                >
                  <button
                    type="button"
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      alarm.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                    onClick={() => void toggleAlarm(alarm)}
                  >
                    {alarm.enabled ? '켜짐' : '꺼짐'}
                  </button>
                  <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">
                    {alarmWhenLabel(alarm)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{alarm.title}</span>
                  <span className="text-xs text-slate-400">{alarmRepeatLabel(alarm)}</span>
                  {alarm.snoozeUntil && alarm.snoozeUntil > Date.now() ? (
                    <span className="text-xs text-amber-600">스누즈 중</span>
                  ) : null}
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                    disabled={busy}
                    onClick={() => beginEditAlarm(alarm)}
                  >
                    수정
                  </button>
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
