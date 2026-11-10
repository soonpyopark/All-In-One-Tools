/**
 * 키 이름 변환 (화면 ↔ 메인 공용).
 *
 * - 매크로 단계의 키 이름은 nut.js 의 `Key` 열거형 이름을 씁니다. (예: `PageDown`, `A`, `Num1`, `LeftControl`)
 * - 단축키(시작/중지)는 Electron `globalShortcut` 의 accelerator 문자열을 씁니다. (예: `F6`, `Ctrl+Shift+S`)
 */

/** KeyboardEvent.code → nut.js Key 이름 (규칙으로 만들 수 없는 것만 직접 나열) */
const CODE_TO_KEY = {
  Escape: 'Escape',
  Backquote: 'Grave',
  Minus: 'Minus',
  Equal: 'Equal',
  Backspace: 'Backspace',
  Tab: 'Tab',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  CapsLock: 'CapsLock',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  ControlLeft: 'LeftControl',
  ControlRight: 'RightControl',
  AltLeft: 'LeftAlt',
  AltRight: 'RightAlt',
  MetaLeft: 'LeftSuper',
  MetaRight: 'RightSuper',
  Space: 'Space',
  ContextMenu: 'Menu',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  PrintScreen: 'Print',
  ScrollLock: 'ScrollLock',
  Pause: 'Pause',
  NumLock: 'NumLock',
  NumpadAdd: 'Add',
  NumpadSubtract: 'Subtract',
  NumpadMultiply: 'Multiply',
  NumpadDivide: 'Divide',
  NumpadDecimal: 'Decimal',
};

/**
 * `KeyboardEvent.code` 를 nut.js 키 이름으로 바꿉니다. 지원하지 않으면 빈 문자열.
 * @param {string} code
 */
export function codeToKeyName(code) {
  const text = String(code ?? '');
  if (CODE_TO_KEY[text]) return CODE_TO_KEY[text];
  let match = /^Key([A-Z])$/.exec(text);
  if (match) return match[1];
  match = /^Digit([0-9])$/.exec(text);
  if (match) return `Num${match[1]}`;
  match = /^Numpad([0-9])$/.exec(text);
  if (match) return `NumPad${match[1]}`;
  match = /^F([0-9]{1,2})$/.exec(text);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 24) return text;
  return '';
}

/** 자주 쓰는 키 이름 (입력창 자동완성용) */
export const COMMON_KEY_NAMES = [
  'PageDown', 'PageUp', 'Right', 'Left', 'Up', 'Down', 'Space', 'Enter', 'Escape', 'Tab', 'Backspace', 'Delete',
  'Home', 'End', 'Insert', 'LeftControl', 'LeftShift', 'LeftAlt', 'RightControl', 'RightShift', 'RightAlt',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
  ...Array.from({ length: 10 }, (_, i) => `Num${i}`),
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];

/** `KeyboardEvent.code` → Electron accelerator 의 주 키 이름 */
const CODE_TO_ACCELERATOR_KEY = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Escape',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  PrintScreen: 'PrintScreen',
};

/**
 * 키 입력 이벤트를 Electron accelerator 문자열로 바꿉니다. (수식 키만 눌렀거나 지원하지 않으면 빈 문자열)
 * @param {{ code: string, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean, metaKey?: boolean }} event
 */
export function eventToAccelerator(event) {
  const code = String(event?.code ?? '');
  let main = CODE_TO_ACCELERATOR_KEY[code] ?? '';
  if (!main) {
    let match = /^Key([A-Z])$/.exec(code);
    if (match) main = match[1];
    else if ((match = /^Digit([0-9])$/.exec(code))) main = match[1];
    else if ((match = /^Numpad([0-9])$/.exec(code))) main = `num${match[1]}`;
    else if ((match = /^F([0-9]{1,2})$/.exec(code)) && Number(match[1]) >= 1 && Number(match[1]) <= 24) main = code;
  }
  if (!main) return '';
  const parts = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(main);
  return parts.join('+');
}

/** accelerator 문자열이 안전한 형식인지 간단히 검사합니다. @param {unknown} value */
export function isValidAccelerator(value) {
  return typeof value === 'string' && /^(?:(?:Ctrl|Alt|Shift|Super)\+)*[^+\s]+$|^(?:(?:Ctrl|Alt|Shift|Super)\+)*\+$/.test(value);
}
