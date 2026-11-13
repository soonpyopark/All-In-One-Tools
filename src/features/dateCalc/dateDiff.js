/**
 * 두 날짜(년·월·일) 사이의 달력 차이를 구합니다.
 */

/**
 * @param {number} year
 * @param {number} month 1–12
 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
export function isValidDateParts(year, month, day) {
  if (![year, month, day].every((n) => Number.isInteger(n))) return false;
  if (year < 1 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/**
 * @param {{ year: number, month: number, day: number }} a
 */
function toUtcTime(a) {
  return Date.UTC(a.year, a.month - 1, a.day);
}

/**
 * @param {{ year: number, month: number, day: number }} start
 * @param {{ year: number, month: number, day: number }} end
 * @returns {{
 *   years: number,
 *   months: number,
 *   days: number,
 *   totalDays: number,
 *   swapped: boolean,
 *   label: string,
 * }}
 */
export function diffCalendar(start, end) {
  if (!isValidDateParts(start.year, start.month, start.day)) {
    throw new Error('시작 날짜가 올바르지 않습니다.');
  }
  if (!isValidDateParts(end.year, end.month, end.day)) {
    throw new Error('끝 날짜가 올바르지 않습니다.');
  }

  let from = start;
  let to = end;
  let swapped = false;
  if (toUtcTime(start) > toUtcTime(end)) {
    from = end;
    to = start;
    swapped = true;
  }

  let years = to.year - from.year;
  let months = to.month - from.month;
  let days = to.day - from.day;

  if (days < 0) {
    months -= 1;
    const prevMonth = to.month === 1 ? 12 : to.month - 1;
    const prevYear = to.month === 1 ? to.year - 1 : to.year;
    days += daysInMonth(prevYear, prevMonth);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const totalDays = Math.round((toUtcTime(to) - toUtcTime(from)) / 86_400_000);
  const label = `${years}년 ${months}월 ${days}일`;

  return { years, months, days, totalDays, swapped, label };
}

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function parsePart(value, fallback) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * @typedef {{ years: number, months: number, days: number }} DurationParts
 */

/**
 * @param {DurationParts} parts
 * @returns {string}
 */
export function formatDuration(parts) {
  return `${parts.years}년 ${parts.months}월 ${parts.days}일`;
}

/**
 * 순수 기간 정규화. 일 자리가 모자라면 1개월=30일로 빌립니다.
 * @param {number} years
 * @param {number} months
 * @param {number} days
 * @returns {DurationParts & { label: string }}
 */
export function normalizeDuration(years, months, days) {
  let y = Number.isFinite(years) ? Math.trunc(years) : 0;
  let m = Number.isFinite(months) ? Math.trunc(months) : 0;
  let d = Number.isFinite(days) ? Math.trunc(days) : 0;

  // 일 → 월 (30일 = 1개월)
  if (d >= 30 || d <= -30) {
    m += Math.trunc(d / 30);
    d %= 30;
  }
  while (d < 0) {
    m -= 1;
    d += 30;
  }
  while (d >= 30) {
    m += 1;
    d -= 30;
  }

  // 월 → 년
  if (m >= 12 || m <= -12) {
    y += Math.trunc(m / 12);
    m %= 12;
  }
  while (m < 0) {
    y -= 1;
    m += 12;
  }
  while (m >= 12) {
    y += 1;
    m -= 12;
  }

  const parts = { years: y, months: m, days: d };
  return { ...parts, label: formatDuration(parts) };
}

/**
 * @typedef {{ op: 'add' | 'sub', years: number, months: number, days: number }} DurationTerm
 */

/**
 * 기준일 대비 목표일의 D-Day 를 계산합니다.
 * (같은 날 = D-Day, 이전이면 D−N, 지났으면 D+N · 달력 일자 기준)
 * includeToday 가 true 이면 기준일(오늘)을 하루로 포함해 N 이 1 커집니다.
 * @param {{ year: number, month: number, day: number }} base
 * @param {{ year: number, month: number, day: number }} target
 * @param {{ includeToday?: boolean }} [options]
 * @returns {{
 *   offsetDays: number,
 *   displayDays: number,
 *   totalDaysAbs: number,
 *   includeToday: boolean,
 *   label: string,
 *   detail: string,
 *   swappedHint: boolean,
 * }}
 */
export function calcDday(base, target, options = {}) {
  if (!isValidDateParts(base.year, base.month, base.day)) {
    throw new Error('기준 날짜가 올바르지 않습니다.');
  }
  if (!isValidDateParts(target.year, target.month, target.day)) {
    throw new Error('목표 날짜가 올바르지 않습니다.');
  }

  const includeToday = Boolean(options.includeToday);
  const offsetDays = Math.round((toUtcTime(target) - toUtcTime(base)) / 86_400_000);
  const totalDaysAbs = Math.abs(offsetDays);
  // 오늘 포함: 남은 날·지난 날에 기준일을 하루로 셈 (당일은 D-Day 유지)
  const displayDays = offsetDays === 0 ? 0 : totalDaysAbs + (includeToday ? 1 : 0);
  const includeHint = includeToday ? ' (오늘 포함)' : '';

  if (offsetDays === 0) {
    return {
      offsetDays,
      displayDays,
      totalDaysAbs,
      includeToday,
      label: 'D-Day',
      detail: includeToday
        ? '기준일과 목표일이 같습니다. (오늘 포함해도 D-Day)'
        : '기준일과 목표일이 같습니다.',
      swappedHint: false,
    };
  }
  if (offsetDays > 0) {
    return {
      offsetDays,
      displayDays,
      totalDaysAbs,
      includeToday,
      label: `D-${displayDays}`,
      detail: `목표일까지 ${displayDays.toLocaleString('ko-KR')}일 남았습니다.${includeHint}`,
      swappedHint: false,
    };
  }
  return {
    offsetDays,
    displayDays,
    totalDaysAbs,
    includeToday,
    label: `D+${displayDays}`,
    detail: `목표일로부터 ${displayDays.toLocaleString('ko-KR')}일 지났습니다.${includeHint}`,
    swappedHint: false,
  };
}

/**
 * 기준 기간에 +/− 기간들을 적용합니다.
 * @param {DurationParts} base
 * @param {DurationTerm[]} terms
 */
export function applyDurationOps(base, terms) {
  let years = Number.isFinite(base.years) ? Math.trunc(base.years) : 0;
  let months = Number.isFinite(base.months) ? Math.trunc(base.months) : 0;
  let days = Number.isFinite(base.days) ? Math.trunc(base.days) : 0;

  const list = Array.isArray(terms) ? terms : [];
  /** @type {string[]} */
  const expression = [formatDuration({ years, months, days })];

  for (const term of list) {
    const y = Number.isFinite(term.years) ? Math.trunc(term.years) : 0;
    const m = Number.isFinite(term.months) ? Math.trunc(term.months) : 0;
    const d = Number.isFinite(term.days) ? Math.trunc(term.days) : 0;
    const sign = term.op === 'sub' ? -1 : 1;
    years += sign * y;
    months += sign * m;
    days += sign * d;
    expression.push(`${term.op === 'sub' ? '−' : '+'} ${formatDuration({ years: y, months: m, days: d })}`);
  }

  const result = normalizeDuration(years, months, days);
  return {
    ...result,
    expression: expression.join(' '),
  };
}
