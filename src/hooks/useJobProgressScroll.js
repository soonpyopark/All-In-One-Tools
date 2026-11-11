import { useEffect, useRef } from 'react';

const NEAR_BOTTOM_PX = 56;

/**
 * @param {HTMLElement} el
 * @param {number} [threshold]
 */
function isNearBottom(el, threshold = NEAR_BOTTOM_PX) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/**
 * 페이지(기능 화면) 스크롤 컨테이너를 찾습니다.
 * @param {HTMLElement | null} from
 * @returns {HTMLElement | null}
 */
function findPageScroller(from) {
  let el = from?.parentElement ?? null;
  while (el) {
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 작업 진행 구간 자동 스크롤.
 * - 진행 UI가 나타나면 페이지를 아래로 내려 보이게 함
 * - 로그 박스는 최신이 보이도록 따라감
 * - 사용자가 위로 올리면 중지, 다시 맨 아래면 재개
 *
 * @param {{
 *   active: boolean,
 *   followKey?: unknown,
 * }} options
 * @returns {{
 *   sectionRef: import('react').MutableRefObject<HTMLElement | null>,
 *   logRef: import('react').MutableRefObject<HTMLElement | null>,
 * }}
 */
export function useJobProgressScroll({ active, followKey }) {
  const sectionRef = useRef(/** @type {HTMLElement | null} */ (null));
  const logRef = useRef(/** @type {HTMLElement | null} */ (null));
  const stickPageRef = useRef(true);
  const stickLogRef = useRef(true);
  const wasActiveRef = useRef(false);
  const ignorePageScrollRef = useRef(false);
  const ignoreLogScrollRef = useRef(false);

  const scrollPageToBottom = (behavior = 'auto') => {
    const page = findPageScroller(sectionRef.current);
    if (!page) {
      sectionRef.current?.scrollIntoView({ block: 'end', behavior });
      return;
    }
    ignorePageScrollRef.current = true;
    if (behavior === 'smooth') {
      page.scrollTo({ top: page.scrollHeight, behavior: 'smooth' });
    } else {
      page.scrollTop = page.scrollHeight;
    }
    window.setTimeout(() => {
      ignorePageScrollRef.current = false;
    }, behavior === 'smooth' ? 400 : 50);
  };

  const scrollLogToBottom = () => {
    const log = logRef.current;
    if (!log) return;
    ignoreLogScrollRef.current = true;
    log.scrollTop = log.scrollHeight;
    window.setTimeout(() => {
      ignoreLogScrollRef.current = false;
    }, 50);
  };

  // 스크롤 위치 감시(사용자가 올렸는지 / 맨 아래인지)
  useEffect(() => {
    if (!active) {
      wasActiveRef.current = false;
      stickPageRef.current = true;
      stickLogRef.current = true;
      return undefined;
    }

    const page = findPageScroller(sectionRef.current);
    const log = logRef.current;

    const onPageScroll = () => {
      if (ignorePageScrollRef.current || !page) return;
      stickPageRef.current = isNearBottom(page);
    };
    const onLogScroll = () => {
      if (ignoreLogScrollRef.current || !log) return;
      stickLogRef.current = isNearBottom(log);
    };

    page?.addEventListener('scroll', onPageScroll, { passive: true });
    log?.addEventListener('scroll', onLogScroll, { passive: true });

    // 진행 구간이 처음 나타날 때: 따라가기 켜고 화면을 맞춤
    if (!wasActiveRef.current) {
      wasActiveRef.current = true;
      stickPageRef.current = true;
      stickLogRef.current = true;
      // 레이아웃 반영 후 스크롤
      requestAnimationFrame(() => {
        scrollPageToBottom('smooth');
        scrollLogToBottom();
      });
    }

    return () => {
      page?.removeEventListener('scroll', onPageScroll);
      log?.removeEventListener('scroll', onLogScroll);
    };
  }, [active, followKey]);

  // 진행 내용이 갱신될 때: 따라가는 중이면 아래로
  useEffect(() => {
    if (!active) return;
    if (stickLogRef.current) scrollLogToBottom();
    if (stickPageRef.current) {
      requestAnimationFrame(() => scrollPageToBottom('auto'));
    }
  }, [active, followKey]);

  return { sectionRef, logRef };
}
