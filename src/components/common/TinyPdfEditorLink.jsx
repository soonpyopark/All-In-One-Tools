import { TINY_PDF_EDITOR_URL } from '../../../shared/constants.js';
import { openExternalUrl } from '../../lib/openExternal.js';

/**
 * Tiny PDF Editor 릴리스 페이지로 여는 인라인 링크.
 * @param {{ className?: string }} [props]
 */
export default function TinyPdfEditorLink({ className = '' }) {
  return (
    <button
      type="button"
      className={`font-medium text-app-accent hover:underline ${className}`.trim()}
      onClick={() => void openExternalUrl(TINY_PDF_EDITOR_URL)}
    >
      Tiny PDF Editor
    </button>
  );
}
