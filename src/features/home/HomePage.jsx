import AppLogo from '../../components/common/AppLogo.jsx';
import { useAppInfo } from '../../context/AppInfoContext.jsx';

/**
 * 홈: 메뉴 바로가기 + 사용 안내. 새 기능 화면은 `src/features/<id>/` 에 만들어 registry.js 에
 * 등록하면 바로가기 카드가 자동으로 생깁니다.
 *
 * @param {{
 *   features?: import('../registry.js').FeatureDefinition[],
 *   onNavigate?: (id: string) => void,
 * }} props
 */
export default function HomePage({ features = [], onNavigate }) {
  const shortcuts = features.filter((feature) => feature.id !== 'home');
  const appInfo = useAppInfo();

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="flex items-center gap-4">
          <AppLogo size={64} className="rounded-2xl shadow-sm" />
          <div>
            <h1 className="m-0 text-xl font-semibold text-slate-900">{appInfo.name}</h1>
            <p className="mt-1 text-sm text-slate-500">
              매크로 화면 캡처, 이미지 자르기 & PDF 저장, PDF 중복페이지 정리, Movie2GIF 변환, GIF 이어붙이기, 영상(음원) 피치 & 볼륨 조절, 서브넷 계산기 기능을 사용할 수 있습니다.
            </p>
          </div>
        </section>

        {shortcuts.length > 0 ? (
          <section aria-label="바로가기" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shortcuts.map((feature) => (
              <button
                key={feature.id}
                type="button"
                onClick={() => onNavigate?.(feature.id)}
                className="group flex flex-col items-start gap-3 rounded-xl border border-app-border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-app-accent hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/40"
              >
                <span
                  aria-hidden="true"
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${feature.color?.[0] ?? '#94a3b8'}, ${feature.color?.[1] ?? '#64748b'})`,
                  }}
                >
                  {feature.icon}
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900 group-hover:text-app-accent">
                    {feature.label}
                  </span>
                  {feature.description ? (
                    <span className="mt-1 block text-xs leading-relaxed text-slate-500">{feature.description}</span>
                  ) : null}
                </span>
              </button>
            ))}
          </section>
        ) : null}

        <section className="rounded-lg border border-app-border bg-white p-5 shadow-sm">
          <h2 className="m-0 text-sm font-semibold text-slate-800">시작하기</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>환경설정 → 일반의 FFmpeg 경로에서 ffmpeg 폴더를 지정하거나 PATH를 확인합니다.</li>
            <li>왼쪽 메뉴(매크로 화면 캡처, 이미지 자르기 & PDF 저장, PDF 중복페이지 정리, Movie2GIF 변환, GIF 이어붙이기, 영상(음원) 피치 & 볼륨 조절 등)에서 파일을 고르고 옵션을 설정합니다.</li>
            <li>결과는 기본적으로 원본 파일이 있는 폴더에 저장됩니다. (각 화면에서 저장 폴더 변경 가능)</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
