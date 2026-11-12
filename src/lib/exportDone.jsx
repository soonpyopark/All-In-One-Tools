/**
 * 내보내기 완료 안내: 파일명·위치 정리 + 폴더 열기·경로 복사.
 */

/**
 * @param {string} filePath
 * @returns {{ name: string, folder: string, full: string }}
 */
export function splitExportPath(filePath) {
  const full = String(filePath ?? '').trim();
  const normalized = full.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const name = parts.pop() || full || '(파일)';
  const folder = parts.length > 0 ? parts[parts.length - 1] : '';
  return { name, folder, full };
}

/**
 * @param {{
 *   dialog: {
 *     choose: (options: any) => Promise<'primary' | 'extra' | null>,
 *     alert?: (options: any) => Promise<void>,
 *   },
 *   native?: { showItemInFolder?: (path: string) => unknown },
 *   title?: string,
 *   summary: string,
 *   filePath?: string | null,
 * }} args
 */
export async function showExportDone(args) {
  const title = args.title ?? '내보내기 완료';
  const filePath = String(args.filePath ?? '').trim();
  const { name, folder, full } = splitExportPath(filePath);

  if (!filePath) {
    await args.dialog.alert?.({ title, body: args.summary });
    return;
  }

  const choice = await args.dialog.choose({
    title,
    body: (
      <div className="space-y-2">
        <p className="m-0">{args.summary}</p>
        <div>
          <p className="m-0 break-all font-medium text-slate-800">{name}</p>
          <p className="m-0 mt-0.5 text-xs text-slate-500" title={full}>
            위치: {folder || full}
          </p>
        </div>
      </div>
    ),
    primaryLabel: '폴더 열기',
    extraLabel: '경로 복사',
    cancelLabel: '닫기',
  });

  if (choice === 'primary') {
    args.native?.showItemInFolder?.(filePath);
    return;
  }
  if (choice === 'extra') {
    try {
      await navigator.clipboard.writeText(filePath);
      await args.dialog.alert?.({ title: '경로 복사', body: '파일 경로를 클립보드에 복사했습니다.' });
    } catch {
      await args.dialog.alert?.({
        title: '경로 복사',
        body: `경로를 복사하지 못했습니다.\n직접 선택해 복사해 주세요.\n\n${filePath}`,
      });
    }
  }
}
