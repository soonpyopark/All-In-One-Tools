import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { inputClass } from '../components/settings/ui.jsx';

/**
 * App-styled replacements for window.alert / confirm / prompt.
 *
 *   const { alert, confirm, choose, prompt } = useDialog();
 *   if (await confirm({ title: '삭제', body: '삭제할까요?', confirmVariant: 'danger' })) { … }
 *   const res = await prompt({ title: '비밀번호', body: '파일명.pdf', extraLabel: '건너뛰기' });
 */

/**
 * @typedef {{
 *   title?: string,
 *   body?: string | import('react').ReactNode,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   confirmVariant?: 'primary' | 'danger',
 * }} DialogOptions
 *
 * @typedef {{
 *   title?: string,
 *   body?: string | import('react').ReactNode,
 *   primaryLabel?: string,
 *   extraLabel?: string,
 *   cancelLabel?: string,
 * }} ChoiceOptions
 *
 * @typedef {{
 *   title?: string,
 *   body?: string | import('react').ReactNode,
 *   placeholder?: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   extraLabel?: string,
 *   defaultValue?: string,
 *   inputType?: 'text' | 'password',
 * }} PromptOptions
 *
 * @typedef {{ action: 'ok' | 'skip' | 'cancel', value: string }} PromptResult
 */

const DialogContext = createContext(
  /** @type {{
   *   alert: (options: DialogOptions) => Promise<void>,
   *   confirm: (options: DialogOptions) => Promise<boolean>,
   *   choose: (options: ChoiceOptions) => Promise<'primary' | 'extra' | null>,
   *   prompt: (options: PromptOptions) => Promise<PromptResult>,
   * } | null} */ (null),
);

const btnBase = 'rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-60';
const btnPrimary = `${btnBase} bg-app-accent text-white hover:bg-app-accentHover`;
const btnDanger = `${btnBase} bg-red-600 text-white hover:bg-red-700`;
const btnGhost = `${btnBase} text-slate-700 hover:bg-slate-100`;
const btnSoft = `${btnBase} bg-app-accentSoft text-app-accentText hover:bg-app-accentSoftHover`;

export function DialogProvider({ children }) {
  /** @type {[{ kind: 'alert' | 'confirm' | 'choose' | 'prompt', options: any, resolve: (value: any) => void } | null, Function]} */
  const [dialog, setDialog] = useState(null);
  const [promptValue, setPromptValue] = useState('');
  const promptInputRef = useRef(/** @type {HTMLInputElement | null} */ (null));

  const open = useCallback(
    (kind, options) =>
      new Promise((resolve) => {
        if (kind === 'prompt') setPromptValue(String(options?.defaultValue ?? ''));
        setDialog({ kind, options: options ?? {}, resolve });
      }),
    [],
  );

  const alert = useCallback((options) => open('alert', options), [open]);
  const confirm = useCallback((options) => open('confirm', options), [open]);
  const choose = useCallback((options) => open('choose', options), [open]);
  const prompt = useCallback((options) => open('prompt', options), [open]);

  const close = useCallback((result) => {
    setDialog((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  const cancelResult =
    dialog?.kind === 'confirm'
      ? false
      : dialog?.kind === 'choose'
        ? null
        : dialog?.kind === 'prompt'
          ? { action: 'cancel', value: '' }
          : undefined;

  useEffect(() => {
    if (!dialog) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close(cancelResult);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialog, close, cancelResult]);

  useEffect(() => {
    if (dialog?.kind !== 'prompt') return undefined;
    const id = window.setTimeout(() => promptInputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [dialog]);

  const value = useMemo(() => ({ alert, confirm, choose, prompt }), [alert, confirm, choose, prompt]);
  const options = dialog?.options ?? {};

  return (
    <DialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-[rgba(32,33,36,0.4)] p-4"
          role="presentation"
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            className="w-full max-w-[400px] rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 id="app-dialog-title" className="m-0 text-lg font-medium text-slate-900">
              {options.title ??
                (dialog.kind === 'confirm'
                  ? '확인'
                  : dialog.kind === 'prompt'
                    ? '입력'
                    : '알림')}
            </h2>
            <div className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {options.body}
            </div>
            {dialog.kind === 'prompt' ? (
              <input
                ref={promptInputRef}
                className={`${inputClass} mt-3 w-full`}
                type={options.inputType === 'text' ? 'text' : 'password'}
                placeholder={options.placeholder ?? ''}
                value={promptValue}
                onChange={(event) => setPromptValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    close({ action: 'ok', value: promptValue });
                  }
                }}
              />
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {dialog.kind === 'alert' ? (
                <button type="button" autoFocus className={btnPrimary} onClick={() => close(undefined)}>
                  {options.confirmLabel ?? '확인'}
                </button>
              ) : null}
              {dialog.kind === 'confirm' ? (
                <>
                  <button type="button" className={btnGhost} onClick={() => close(false)}>
                    {options.cancelLabel ?? '취소'}
                  </button>
                  <button
                    type="button"
                    autoFocus
                    className={options.confirmVariant === 'danger' ? btnDanger : btnPrimary}
                    onClick={() => close(true)}
                  >
                    {options.confirmLabel ?? '확인'}
                  </button>
                </>
              ) : null}
              {dialog.kind === 'choose' ? (
                <>
                  <button type="button" className={btnGhost} onClick={() => close(null)}>
                    {options.cancelLabel ?? '취소'}
                  </button>
                  {options.extraLabel ? (
                    <button type="button" className={btnSoft} onClick={() => close('extra')}>
                      {options.extraLabel}
                    </button>
                  ) : null}
                  <button type="button" autoFocus className={btnPrimary} onClick={() => close('primary')}>
                    {options.primaryLabel ?? '확인'}
                  </button>
                </>
              ) : null}
              {dialog.kind === 'prompt' ? (
                <>
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => close({ action: 'cancel', value: '' })}
                  >
                    {options.cancelLabel ?? '취소'}
                  </button>
                  {options.extraLabel ? (
                    <button
                      type="button"
                      className={btnSoft}
                      onClick={() => close({ action: 'skip', value: '' })}
                    >
                      {options.extraLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={btnPrimary}
                    onClick={() => close({ action: 'ok', value: promptValue })}
                  >
                    {options.confirmLabel ?? '확인'}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within DialogProvider');
  return context;
}
