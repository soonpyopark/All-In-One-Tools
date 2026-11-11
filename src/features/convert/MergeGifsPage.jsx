import ConvertPage from './ConvertPage.jsx';

/** GIF 이어붙이기 메뉴: 변환 화면을 `merge` 모드로 보여 줍니다. */
export default function MergeGifsPage(props) {
  return <ConvertPage mode="merge" {...props} />;
}
