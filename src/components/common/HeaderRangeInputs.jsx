/**
 * 헤더 시작 칸 · 끝 칸을 각각 입력하고, 사이에 ~ 를 보여 줍니다.
 *
 * @param {{
 *   from: string,
 *   to: string,
 *   disabled?: boolean,
 *   fromPlaceholder?: string,
 *   toPlaceholder?: string,
 *   fromAriaLabel?: string,
 *   toAriaLabel?: string,
 *   inputClassName?: string,
 *   onFromChange: (value: string) => void,
 *   onToChange: (value: string) => void,
 *   onCommit: (from: string, to: string) => void,
 *   trailing?: import('react').ReactNode,
 * }} props
 */
export default function HeaderRangeInputs({
  from,
  to,
  disabled = false,
  fromPlaceholder = 'A1',
  toPlaceholder = 'D1',
  fromAriaLabel = '헤더 시작 칸',
  toAriaLabel = '헤더 끝 칸',
  inputClassName = 'min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-app-accent focus:ring-2 focus:ring-app-accent/15 disabled:opacity-50',
  onFromChange,
  onToChange,
  onCommit,
  trailing = null,
}) {
  /** @param {import('react').FocusEvent<HTMLInputElement>} event */
  const commitFromDom = (event) => {
    const root = event.currentTarget.closest('[data-header-range]');
    if (!(root instanceof HTMLElement)) {
      onCommit(from, to);
      return;
    }
    const inputs = root.querySelectorAll('input');
    const nextFrom = inputs[0] instanceof HTMLInputElement ? inputs[0].value : from;
    const nextTo = inputs[1] instanceof HTMLInputElement ? inputs[1].value : to;
    onCommit(nextFrom, nextTo);
  };

  return (
    <div className="flex items-stretch gap-2" data-header-range="">
      <input
        className={inputClassName}
        value={from}
        disabled={disabled}
        placeholder={fromPlaceholder}
        aria-label={fromAriaLabel}
        onChange={(event) => onFromChange(event.target.value)}
        onBlur={commitFromDom}
      />
      <span className="flex shrink-0 items-center text-sm font-medium text-slate-500" aria-hidden="true">
        ~
      </span>
      <input
        className={inputClassName}
        value={to}
        disabled={disabled}
        placeholder={toPlaceholder}
        aria-label={toAriaLabel}
        onChange={(event) => onToChange(event.target.value)}
        onBlur={commitFromDom}
      />
      {trailing}
    </div>
  );
}
