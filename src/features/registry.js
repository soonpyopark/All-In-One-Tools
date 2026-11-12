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
import CapturePage from './capture/CapturePage.jsx';
import CleanupPage from './cleanup/CleanupPage.jsx';
import PdfDedupPage from './cleanup/PdfDedupPage.jsx';
import ClockPage from './clock/ClockPage.jsx';
import ConvertPage from './convert/ConvertPage.jsx';
import MergeGifsPage from './convert/MergeGifsPage.jsx';
import HomePage from './home/HomePage.jsx';
import LauncherPage from './launcher/LauncherPage.jsx';
import OcrPage from './ocr/OcrPage.jsx';
import PdfCompressPage from './pdfCompress/PdfCompressPage.jsx';
import QrPage from './qr/QrPage.jsx';
import RenamePage from './rename/RenamePage.jsx';
import SubnetPage from './subnet/SubnetPage.jsx';

/** @type {FeatureDefinition[]} */
export const FEATURES = [
  { id: 'home', label: '홈', icon: '🏠', component: HomePage },
  {
    id: 'launcher',
    label: '런처',
    icon: '🚀',
    description: '자주 쓰는 프로그램·웹사이트·폴더·파일을 바로 엽니다.',
    color: ['#fb923c', '#ea580c'],
    component: LauncherPage,
  },
  {
    id: 'capture',
    label: '매크로 & 화면 캡처',
    icon: '📸',
    description: '화면·창·영역을 캡처하고, 키보드·마우스 매크로 프리셋으로 페이지를 넘기며 자동 캡처합니다.',
    color: ['#ff7aa8', '#e0426f'],
    component: CapturePage,
  },
  {
    id: 'cleanup',
    label: '이미지 자르기 & PDF 저장',
    icon: '📚',
    description: '스크린샷 같은 이미지에서 특정 영역(예: 이북 화면)을 자동으로 추출하고, 연속된 유사 이미지는 제외해 PDF 로 만듭니다.',
    color: ['#40e0a8', '#11a46b'],
    component: CleanupPage,
  },
  {
    id: 'pdf-ocr',
    label: 'PDF & 이미지 OCR',
    icon: '🔤',
    description: '스캔 PDF·이미지에 검색 가능한 글자 층을 붙입니다. 이미지는 PDF 로 변환한 뒤 OCR 합니다. 기본 한국어·영어.',
    color: ['#38bdf8', '#0284c7'],
    component: OcrPage,
  },
  {
    id: 'pdf-compress',
    label: 'PDF 용량 줄이기',
    icon: '🗜️',
    description: 'Tiny PDF Editor 와 같이 텍스트·검색은 유지하고 이미지 위주로 PDF 용량을 줄입니다.',
    color: ['#fbbf24', '#d97706'],
    component: PdfCompressPage,
  },
  {
    id: 'pdf-dedup',
    label: 'PDF 중복페이지 자동 정리',
    icon: '🧹',
    description: 'PDF 에서 비슷한 페이지를 찾아 제거합니다. (연속 / 문서 전체)',
    color: ['#2dd4bf', '#0f9488'],
    component: PdfDedupPage,
  },
  {
    id: 'rename',
    label: '파일명 일괄 변경',
    icon: '✏️',
    description: '여러 파일의 이름을 한 번에 바꿉니다. 문자열 바꾸기, 앞뒤 추가, 위치·묶인곳 지우기, 번호 붙이기, 확장자 변경, 한 폴더에 모으기를 지원합니다.',
    color: ['#f472b6', '#c026d3'],
    component: RenamePage,
  },
  {
    id: 'convert',
    label: 'Movie2GIF 변환',
    icon: '🎞️',
    description: '동영상을 GIF 로 변환합니다. 용량 프리셋으로 FPS·너비를 맞출 수 있습니다.',
    color: ['#5ca6ff', '#2f6be5'],
    component: ConvertPage,
  },
  {
    id: 'merge-gifs',
    label: 'GIF 이어붙이기',
    icon: '🔗',
    description: '여러 GIF 를 순서대로 이어 붙여 하나의 GIF 로 만듭니다.',
    color: ['#7dd3fc', '#2b8fd6'],
    component: MergeGifsPage,
  },
  {
    id: 'qr',
    label: 'QR 코드 생성기',
    icon: '🔳',
    description: '텍스트·URL을 단색 QR로 보내고, 화면의 QR을 읽어 텍스트로 복원합니다. (캡처보드용)',
    color: ['#94a3b8', '#475569'],
    component: QrPage,
  },
  {
    id: 'adjust',
    label: '피치 & 볼륨 조절',
    icon: '🎛️',
    description: '영상·음원의 피치(음높이)와 볼륨을 조절합니다.',
    color: ['#b79cff', '#7d58df'],
    component: AdjustPage,
  },
  {
    id: 'subnet',
    label: '서브넷 계산기',
    icon: '🧮',
    description: 'IPv4 주소와 서브넷마스크로 네트워크·브로드캐스트 주소와 사용 가능한 호스트 범위를 계산합니다.',
    color: ['#ffb454', '#e8791a'],
    component: SubnetPage,
  },
  {
    id: 'clock',
    label: '시간 & 알람',
    icon: '⏰',
    description: '현재 시각, 타이머, 알람을 사용합니다. 다른 메뉴에 있어도 알림이 울립니다.',
    color: ['#67e8f9', '#0891b2'],
    component: ClockPage,
  },
];
