import CleanupPage from './CleanupPage.jsx';

/** PDF 중복페이지 정리 메뉴: 정리 화면을 `pdf-dedup` 작업으로 보여 줍니다. */
export default function PdfDedupPage(props) {
  return <CleanupPage tool="pdf-dedup" {...props} />;
}
