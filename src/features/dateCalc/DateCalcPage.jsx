import { useMemo, useState } from 'react';
import { Section, ToggleRow, btnClass, btnDangerClass, inputClass } from '../../components/settings/ui.jsx';
import {
  applyDurationOps,
  calcDday,
  diffCalendar,
  formatDuration,
  parsePart,
} from './dateDiff.js';

/**
 * @param {{
 *   label: string,
 *   year: string,
 *   month: string,
 *   day: string,
 *   onYear: (v: string) => void,
 *   onMonth: (v: string) => void,
 *   onDay: (v: string) => void,
 *   yearMin?: number,
 * }} props
 */
function YmdFields({ label, year, month, day, onYear, onMonth, onDay, yearMin = 0 }) {
  return (
    <fieldset className="min-w-0 rounded-lg border border-slate-200 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">{label}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-slate-500">년</span>
          <input
            type="number"
            inputMode="numeric"
            className={`${inputClass} w-[5.5rem] tabular-nums`}
            value={year}
            min={yearMin}
            max={9999}
            onChange={(event) => onYear(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-slate-500">월</span>
          <input
            type="number"
            inputMode="numeric"
            className={`${inputClass} w-16 tabular-nums`}
            value={month}
            min={0}
            max={999}
            onChange={(event) => onMonth(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-slate-500">일</span>
          <input
            type="number"
            inputMode="numeric"
            className={`${inputClass} w-16 tabular-nums`}
            value={day}
            min={0}
            max={9999}
            onChange={(event) => onDay(event.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}

function todayParts() {
  const now = new Date();
  return {
    year: String(now.getFullYear()),
    month: String(now.getMonth() + 1),
    day: String(now.getDate()),
  };
}

let termSeq = 1;
function newTerm(op = /** @type {'add' | 'sub'} */ ('sub')) {
  return {
    id: `term-${termSeq++}`,
    op,
    year: '0',
    month: '0',
    day: '0',
  };
}

const MODE_TABS = [
  { id: 'span', label: '날짜 차이' },
  { id: 'duration', label: '기간 더하기·빼기' },
  { id: 'dday', label: 'D-Day 계산기' },
];

/** 날짜 계산기: 날짜 차이 + 기간 가감 + D-Day. */
export default function DateCalcPage() {
  const [mode, setMode] = useState(/** @type {'span' | 'duration' | 'dday'} */ ('span'));

  const today = todayParts();
  const [startYear, setStartYear] = useState(today.year);
  const [startMonth, setStartMonth] = useState(today.month);
  const [startDay, setStartDay] = useState(today.day);
  const [endYear, setEndYear] = useState(today.year);
  const [endMonth, setEndMonth] = useState(today.month);
  const [endDay, setEndDay] = useState(today.day);

  const [baseYear, setBaseYear] = useState('11');
  const [baseMonth, setBaseMonth] = useState('1');
  const [baseDay, setBaseDay] = useState('12');
  const [terms, setTerms] = useState(() => [
    { id: 'term-init-1', op: /** @type {'add' | 'sub'} */ ('sub'), year: '1', month: '9', day: '0' },
    { id: 'term-init-2', op: /** @type {'add' | 'sub'} */ ('sub'), year: '2', month: '2', day: '28' },
  ]);

  const [ddayBaseYear, setDdayBaseYear] = useState(today.year);
  const [ddayBaseMonth, setDdayBaseMonth] = useState(today.month);
  const [ddayBaseDay, setDdayBaseDay] = useState(today.day);
  const [ddayTargetYear, setDdayTargetYear] = useState(today.year);
  const [ddayTargetMonth, setDdayTargetMonth] = useState(today.month);
  const [ddayTargetDay, setDdayTargetDay] = useState(today.day);
  /** 남은/지난 날 수에 기준일(오늘)을 하루로 포함할지 */
  const [ddayIncludeToday, setDdayIncludeToday] = useState(false);

  const spanShown = useMemo(() => {
    try {
      return diffCalendar(
        {
          year: parsePart(startYear, 0),
          month: parsePart(startMonth, 0),
          day: parsePart(startDay, 0),
        },
        {
          year: parsePart(endYear, 0),
          month: parsePart(endMonth, 0),
          day: parsePart(endDay, 0),
        },
      );
    } catch {
      return null;
    }
  }, [startYear, startMonth, startDay, endYear, endMonth, endDay]);

  const durationResult = useMemo(() => {
    return applyDurationOps(
      {
        years: parsePart(baseYear, 0),
        months: parsePart(baseMonth, 0),
        days: parsePart(baseDay, 0),
      },
      terms.map((term) => ({
        op: term.op,
        years: parsePart(term.year, 0),
        months: parsePart(term.month, 0),
        days: parsePart(term.day, 0),
      })),
    );
  }, [baseYear, baseMonth, baseDay, terms]);

  const ddayShown = useMemo(() => {
    try {
      return calcDday(
        {
          year: parsePart(ddayBaseYear, 0),
          month: parsePart(ddayBaseMonth, 0),
          day: parsePart(ddayBaseDay, 0),
        },
        {
          year: parsePart(ddayTargetYear, 0),
          month: parsePart(ddayTargetMonth, 0),
          day: parsePart(ddayTargetDay, 0),
        },
        { includeToday: ddayIncludeToday },
      );
    } catch {
      return null;
    }
  }, [
    ddayBaseYear,
    ddayBaseMonth,
    ddayBaseDay,
    ddayTargetYear,
    ddayTargetMonth,
    ddayTargetDay,
    ddayIncludeToday,
  ]);

  const ddaySpan = useMemo(() => {
    if (!ddayShown || ddayShown.offsetDays === 0) return null;
    try {
      return diffCalendar(
        {
          year: parsePart(ddayBaseYear, 0),
          month: parsePart(ddayBaseMonth, 0),
          day: parsePart(ddayBaseDay, 0),
        },
        {
          year: parsePart(ddayTargetYear, 0),
          month: parsePart(ddayTargetMonth, 0),
          day: parsePart(ddayTargetDay, 0),
        },
      );
    } catch {
      return null;
    }
  }, [
    ddayShown,
    ddayBaseYear,
    ddayBaseMonth,
    ddayBaseDay,
    ddayTargetYear,
    ddayTargetMonth,
    ddayTargetDay,
  ]);

  const updateTerm = (id, patch) => {
    setTerms((prev) => prev.map((term) => (term.id === id ? { ...term, ...patch } : term)));
  };

  const setDdayBaseToday = () => {
    const now = todayParts();
    setDdayBaseYear(now.year);
    setDdayBaseMonth(now.month);
    setDdayBaseDay(now.day);
  };

  return (
    <div className="h-full overflow-auto px-6 py-6">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">날짜 계산기</h1>
          <p className="mt-1 text-sm text-slate-500">
            날짜 차이, 기간 가감, D-Day(남은 날·지난 날)를 계산합니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
            {MODE_TABS.map((tab) => {
              const selected = mode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    selected
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  aria-pressed={selected}
                  onClick={() => setMode(/** @type {'span' | 'duration' | 'dday'} */ (tab.id))}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </section>

        {mode === 'span' ? (
          <>
            <Section title="날짜 입력" description="입력하는 즉시 계산됩니다. 앞쪽이 더 늦으면 순서를 바꿔 계산합니다.">
              <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                <YmdFields
                  label="시작"
                  year={startYear}
                  month={startMonth}
                  day={startDay}
                  onYear={setStartYear}
                  onMonth={setStartMonth}
                  onDay={setStartDay}
                  yearMin={1}
                />
                <div className="hidden text-center text-slate-400 lg:block" aria-hidden>
                  →
                </div>
                <YmdFields
                  label="끝"
                  year={endYear}
                  month={endMonth}
                  day={endDay}
                  onYear={setEndYear}
                  onMonth={setEndMonth}
                  onDay={setEndDay}
                  yearMin={1}
                />
              </div>
            </Section>

            <Section title="결과">
              {spanShown ? (
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                    {spanShown.label}
                  </p>
                  <p className="m-0 text-sm text-slate-500">
                    총 {spanShown.totalDays.toLocaleString('ko-KR')}일
                    {spanShown.swapped ? ' · 입력 순서를 바꿔 계산했습니다' : ''}
                  </p>
                </div>
              ) : (
                <p className="m-0 text-sm text-slate-500">올바른 년·월·일을 입력하면 결과가 표시됩니다.</p>
              )}
            </Section>
          </>
        ) : null}

        {mode === 'duration' ? (
          <>
            <Section
              title="기간 연산"
              description="기준 기간에서 다른 기간을 더하거나 뺍니다. 일 자리가 모자라면 1개월을 30일로 빌려 계산합니다."
            >
              <div className="space-y-4">
                <YmdFields
                  label="기준 기간"
                  year={baseYear}
                  month={baseMonth}
                  day={baseDay}
                  onYear={setBaseYear}
                  onMonth={setBaseMonth}
                  onDay={setBaseDay}
                />

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="m-0 text-xs font-semibold text-slate-700">더하기·빼기</h4>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => setTerms((prev) => [...prev, newTerm('add')])}
                      >
                        + 기간 추가
                      </button>
                      <button
                        type="button"
                        className={btnClass}
                        onClick={() => setTerms((prev) => [...prev, newTerm('sub')])}
                      >
                        − 기간 추가
                      </button>
                    </div>
                  </div>

                  {terms.length === 0 ? (
                    <p className="m-0 text-sm text-slate-500">더하거나 뺄 기간을 추가하세요.</p>
                  ) : (
                    <ul className="m-0 list-none space-y-2 p-0">
                      {terms.map((term, index) => (
                        <li
                          key={term.id}
                          className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3"
                        >
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-500">연산 {index + 1}</span>
                            <select
                              className={`${inputClass} w-[5.5rem] cursor-pointer`}
                              value={term.op}
                              onChange={(event) =>
                                updateTerm(term.id, {
                                  op: /** @type {'add' | 'sub'} */ (event.target.value),
                                })
                              }
                            >
                              <option value="add">+</option>
                              <option value="sub">−</option>
                            </select>
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-500">년</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              className={`${inputClass} w-[5.5rem] tabular-nums`}
                              value={term.year}
                              min={0}
                              onChange={(event) => updateTerm(term.id, { year: event.target.value })}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-500">월</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              className={`${inputClass} w-16 tabular-nums`}
                              value={term.month}
                              min={0}
                              onChange={(event) => updateTerm(term.id, { month: event.target.value })}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-slate-500">일</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              className={`${inputClass} w-16 tabular-nums`}
                              value={term.day}
                              min={0}
                              onChange={(event) => updateTerm(term.id, { day: event.target.value })}
                            />
                          </label>
                          <button
                            type="button"
                            className={btnDangerClass}
                            onClick={() => setTerms((prev) => prev.filter((entry) => entry.id !== term.id))}
                          >
                            삭제
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </Section>

            <Section title="결과">
              <div className="space-y-2">
                <p className="m-0 text-3xl font-semibold tracking-tight text-slate-900 tabular-nums">
                  {durationResult.label}
                </p>
                <p className="m-0 break-keep text-sm text-slate-500">{durationResult.expression}</p>
                <p className="m-0 text-xs text-slate-400">
                  예: {formatDuration({ years: 11, months: 1, days: 12 })} −{' '}
                  {formatDuration({ years: 1, months: 9, days: 0 })} −{' '}
                  {formatDuration({ years: 2, months: 2, days: 28 })}
                </p>
              </div>
            </Section>
          </>
        ) : null}

        {mode === 'dday' ? (
          <>
            <Section
              title="D-Day 입력"
              description="기준일에서 목표일까지 남은 날(D−N)·당일(D-Day)·지난 날(D+N)을 바로 계산합니다."
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="m-0 text-xs text-slate-500">기준일은 보통 오늘입니다.</p>
                  <button type="button" className={btnClass} onClick={setDdayBaseToday}>
                    기준일을 오늘로
                  </button>
                </div>
                <div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
                  <YmdFields
                    label="기준일"
                    year={ddayBaseYear}
                    month={ddayBaseMonth}
                    day={ddayBaseDay}
                    onYear={setDdayBaseYear}
                    onMonth={setDdayBaseMonth}
                    onDay={setDdayBaseDay}
                    yearMin={1}
                  />
                  <div className="hidden text-center text-slate-400 lg:block" aria-hidden>
                    →
                  </div>
                  <YmdFields
                    label="목표일"
                    year={ddayTargetYear}
                    month={ddayTargetMonth}
                    day={ddayTargetDay}
                    onYear={setDdayTargetYear}
                    onMonth={setDdayTargetMonth}
                    onDay={setDdayTargetDay}
                    yearMin={1}
                  />
                </div>
              </div>
            </Section>

            <Section title="결과">
              <div className="space-y-4">
                <ToggleRow
                  label="오늘 포함"
                  hint="남은 날·지난 날에 기준일(오늘)을 하루로 셉니다. 예: 달력 차이 4일이면 D−5."
                  checked={ddayIncludeToday}
                  onChange={setDdayIncludeToday}
                />
                {ddayShown ? (
                  <div className="space-y-2">
                    <p
                      className={`m-0 text-4xl font-semibold tracking-tight tabular-nums ${
                        ddayShown.offsetDays === 0
                          ? 'text-app-accent'
                          : ddayShown.offsetDays > 0
                            ? 'text-slate-900'
                            : 'text-slate-600'
                      }`}
                    >
                      {ddayShown.label}
                    </p>
                    <p className="m-0 text-sm text-slate-500">{ddayShown.detail}</p>
                    {ddayIncludeToday && ddayShown.offsetDays !== 0 ? (
                      <p className="m-0 text-xs text-slate-400">
                        오늘 미포함이면 {ddayShown.offsetDays > 0 ? `D−${ddayShown.totalDaysAbs}` : `D+${ddayShown.totalDaysAbs}`}
                      </p>
                    ) : null}
                    {ddaySpan ? (
                      <p className="m-0 text-xs text-slate-400">
                        달력 차이 {ddaySpan.label} · 총 {ddaySpan.totalDays.toLocaleString('ko-KR')}일
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="m-0 text-sm text-slate-500">올바른 년·월·일을 입력하면 결과가 표시됩니다.</p>
                )}
              </div>
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}
