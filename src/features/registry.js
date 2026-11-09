/**
 * ─── 기능 등록 지점 (frontend) ───────────────────────────────────────────────
 *
 * 새 기능 화면은 `src/features/<id>/` 에 만들고 아래 배열에 한 줄만 추가하면
 * 사이드바 메뉴와 본문 영역에 자동으로 붙습니다. (기능이 2개 이상이면 사이드바 표시)
 * 서버 쪽 API 는 `electron/modules/` 에 등록합니다.
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   icon?: string,
 *   description?: string,
 *   color?: [string, string],
 *   component: import('react').ComponentType,
 * }} FeatureDefinition
 */
import AdjustPage from './adjust/AdjustPage.jsx';
import CleanupPage from './cleanup/CleanupPage.jsx';
import ConvertPage from './convert/ConvertPage.jsx';
import HomePage from './home/HomePage.jsx';

/** @type {FeatureDefinition[]} */
export const FEATURES = [
  { id: 'home', label: '홈', icon: '🏠', component: HomePage },
  {
    id: 'convert',
    label: 'Movie2GIF 변환',
    icon: '🎞️',
    description: '동영상을 GIF 로 바꾸고, 여러 GIF 를 하나로 합칩니다.',
    color: ['#5ca6ff', '#2f6be5'],
    component: ConvertPage,
  },
  {
    id: 'adjust',
    label: '피치&볼륨 조절',
    icon: '🎛️',
    description: '영상·음원의 피치(음높이)와 볼륨을 조절합니다.',
    color: ['#b79cff', '#7d58df'],
    component: AdjustPage,
  },
  {
    id: 'cleanup',
    label: '이북(eBook) 정리',
    icon: '📚',
    description: '스크린샷에서 이북 영역을 추출해 PDF 로 만들고, PDF 의 중복 페이지를 제거합니다.',
    color: ['#40e0a8', '#11a46b'],
    component: CleanupPage,
  },
];
