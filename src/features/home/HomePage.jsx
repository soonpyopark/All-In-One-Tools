import AppLogo from '../../components/common/AppLogo.jsx';
import { useAppInfo } from '../../context/AppInfoContext.jsx';

/** 홈: 사용 안내. 새 기능 화면은 `src/features/<id>/` 에 만들어 registry.js 에 등록합니다. */
export default function HomePage() {
  const appInfo = useAppInfo();

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="flex items-center gap-4">
          <AppLogo size={64} className="rounded-2xl shadow-sm" />
          <div>
            <h1 className="m-0 text-xl font-semibold text-slate-900">{appInfo.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              Movie to GIF 변환, 피치&볼륨 조절, 이북(eBook) 정리(영역 추출·PDF 중복 페이지 제거) 기능을 사용할 수 있습니다.
            </p>
          </div>
        </section>

        <section className="rounded-lg border border-app-border bg-white p-5 shadow-sm">
          <h2 className="m-0 text-sm font-semibold text-slate-800">시작하기</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>환경설정 → 일반의 FFmpeg 경로에서 ffmpeg 폴더를 지정하거나 PATH를 확인합니다.</li>
            <li>Movie to GIF 변환 / 피치&볼륨 조절 / 이북(eBook) 정리 메뉴에서 파일을 고르고 옵션을 설정합니다.</li>
            <li>결과는 기본적으로 원본 파일이 있는 폴더에 저장됩니다. (각 화면에서 저장 폴더 변경 가능)</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
