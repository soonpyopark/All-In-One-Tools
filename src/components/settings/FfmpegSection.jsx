import { useState } from 'react';
import { api, getNative } from '../../lib/apiClient.js';
import { useDialog } from '../../context/DialogContext.jsx';
import { Badge, Field, Section, btnClass, btnPrimaryClass, codeClass, inputClass } from './ui.jsx';

/**
 * FFmpeg path + availability check (환경설정 → 일반).
 *
 * @param {{
 *   settings: { ffmpegDir?: string },
 *   save: (patch: Record<string, unknown>) => Promise<any>,
 * }} props
 */
export default function FfmpegSection({ settings, save }) {
  const dialog = useDialog();
  const native = getNative();
  const [probe, setProbe] = useState(/** @type {any} */ (null));
  const [probing, setProbing] = useState(false);
  const [dirDraft, setDirDraft] = useState(/** @type {string | null} */ (null));

  const ffmpegDir = dirDraft ?? settings.ffmpegDir ?? '';

  const runProbe = async (dir = ffmpegDir) => {
    setProbing(true);
    try {
      const result = await api('ffmpeg.probe', { ffmpegDir: dir });
      setProbe(result);
      return result;
    } catch (err) {
      const fail = {
        ok: false,
        path: '',
        source: '',
        version: '',
        error: err instanceof Error ? err.message : '확인에 실패했습니다.',
      };
      setProbe(fail);
      return fail;
    } finally {
      setProbing(false);
    }
  };

  const pickFolder = async () => {
    if (!native?.pickDirectory) return;
    const result = await native.pickDirectory();
    if (result?.canceled || !result?.path) return;
    setDirDraft(result.path);
    setProbe(null);
  };

  const saveAndProbe = async () => {
    const saved = await save({ ffmpegDir });
    if (!saved) return;
    setDirDraft(null);
    const result = await runProbe(saved.ffmpegDir ?? '');
    if (result?.ok) {
      void dialog.alert({ title: 'FFmpeg 설정', body: `연결 확인됨\n${result.version}` });
    } else {
      void dialog.alert({
        title: 'FFmpeg 설정',
        body: result?.error || 'ffmpeg를 확인할 수 없습니다.',
      });
    }
  };

  return (
    <Section
      title="FFmpeg 경로"
      description="변환·조절에 사용할 ffmpeg.exe 가 들어 있는 폴더를 지정합니다. 비워 두면 시스템 PATH의 ffmpeg를 사용합니다."
    >
      <div className="space-y-3">
        <Field label="ffmpeg 폴더" hint="예: C:\\ffmpeg\\bin">
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} min-w-[16rem] flex-1`}
              value={ffmpegDir}
              placeholder="(비움 = PATH의 ffmpeg)"
              onChange={(event) => {
                setDirDraft(event.target.value);
                setProbe(null);
              }}
            />
            <button type="button" className={btnClass} onClick={() => void pickFolder()}>
              폴더 선택
            </button>
            <button type="button" className={btnPrimaryClass} disabled={probing} onClick={() => void saveAndProbe()}>
              {probing ? '확인 중…' : '저장 후 확인'}
            </button>
          </div>
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btnClass} disabled={probing} onClick={() => void runProbe()}>
            현재 값으로 확인
          </button>
          {ffmpegDir ? (
            <button
              type="button"
              className={btnClass}
              onClick={() => {
                setDirDraft('');
                setProbe(null);
              }}
            >
              PATH 사용으로 비우기
            </button>
          ) : null}
        </div>

        {probe ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={probe.ok ? 'green' : 'red'}>{probe.ok ? '사용 가능' : '실패'}</Badge>
              {probe.source ? (
                <span className="text-xs text-slate-500">
                  {probe.source === 'dir' ? '지정 폴더' : '시스템 PATH'}
                </span>
              ) : null}
            </div>
            {probe.path ? (
              <p className="mt-2 m-0 break-all">
                <code className={codeClass}>{probe.path}</code>
              </p>
            ) : null}
            {probe.version ? <p className="mt-1 m-0 text-slate-700">{probe.version}</p> : null}
            {probe.error ? <p className="mt-1 m-0 text-red-600">{probe.error}</p> : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
