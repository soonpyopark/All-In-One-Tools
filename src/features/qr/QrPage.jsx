import { useCallback, useEffect, useRef, useState } from 'react';
import { Section, btnClass, btnPrimaryClass, inputClass } from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api } from '../../lib/apiClient.js';
import { openExternalUrl } from '../../lib/openExternal.js';
import {
  MAX_QR_HANGUL,
  asHttpUrl,
  clampQrInput,
  displayCharCount,
  integerQrSide,
} from '../../../shared/qrUi.js';

const TITLE = 'QR 코드 생성기';

/**
 * @param {{ dataUrl: string, canvasModules: number }} props
 */
function QrPreview({ dataUrl, canvasModules }) {
  const boxRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [side, setSide] = useState(280);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const update = () => {
      const avail = Math.max(32, Math.min(el.clientWidth - 8, el.clientHeight - 8));
      setSide(integerQrSide(avail, canvasModules || 29));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasModules, dataUrl]);

  return (
    <div ref={boxRef} className="flex min-h-[20rem] flex-1 items-center justify-center rounded-lg bg-white p-2">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="생성된 QR 코드"
          width={side}
          height={side}
          className="bg-white"
          style={{ imageRendering: 'pixelated', width: side, height: side }}
        />
      ) : (
        <p className="m-0 whitespace-pre-line text-center text-sm text-slate-400">
          {'텍스트를 입력하면\nQR이 여기에 표시됩니다'}
        </p>
      )}
    </div>
  );
}

/** Tiny QRcode Generator — 보내기 / 받기 */
export default function QrPage() {
  const dialog = useDialog();
  const [mode, setMode] = useState(/** @type {'sender' | 'receiver'} */ ('sender'));

  const [text, setText] = useState('');
  const [live, setLive] = useState(true);
  const [compress, setCompress] = useState(false);
  const [qr, setQr] = useState(
    /** @type {null | {
     *   dataUrl: string,
     *   originalSize: number,
     *   usedCompress: boolean,
     *   isUrl: boolean,
     *   qrVersion: number,
     *   eccLabel: string,
     *   canvasModules: number,
     * }} */ (null),
  );
  const [status, setStatus] = useState('대기 중');
  const liveTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const genSeq = useRef(0);
  const compressRef = useRef(compress);
  compressRef.current = compress;

  const [previewUrl, setPreviewUrl] = useState('');
  const [resultText, setResultText] = useState('');
  const resultTextRef = useRef('');
  const [lastRegion, setLastRegion] = useState(
    /** @type {null | { x: number, y: number, width: number, height: number }} */ (null),
  );
  const [autoCopy, setAutoCopy] = useState(true);
  const [openUrl, setOpenUrl] = useState(true);
  const [watch, setWatch] = useState(false);
  const [recvStatus, setRecvStatus] = useState('대기 중  ·  영역 선택으로 QR을 고르세요');
  const autoCopyRef = useRef(autoCopy);
  const openUrlRef = useRef(openUrl);
  autoCopyRef.current = autoCopy;
  openUrlRef.current = openUrl;
  resultTextRef.current = resultText;

  /**
   * @param {string} [value]
   * @param {boolean} [useCompress]
   * @param {{ quiet?: boolean }} [options]
   */
  const generate = useCallback(
    async (value = text, useCompress = compress, options = {}) => {
      const quiet = Boolean(options.quiet);
      if (!value.trim()) {
        setQr(null);
        setStatus('대기 중');
        return null;
      }
      const seq = ++genSeq.current;
      try {
        const result = await api('qr.generate', { text: value, compress: useCompress });
        if (seq !== genSeq.current) return null;
        setQr(result);
        let modeLabel = '원문 · 카메라 앱에서 한글 표시';
        if (result.isUrl) modeLabel = 'URL · 카메라 앱에서 브라우저로 열림';
        else if (result.usedCompress) modeLabel = '압축 · 이 프로그램 받기로만 복원';
        setStatus(
          `${displayCharCount(value)}자  ·  ${Number(result.originalSize).toLocaleString()} bytes  ·  QR v${result.qrVersion} ${result.eccLabel}  ·  ${modeLabel}`,
        );
        return result;
      } catch (err) {
        if (seq !== genSeq.current) return null;
        setQr(null);
        const message = err instanceof Error ? err.message : 'QR 생성에 실패했습니다.';
        setStatus(message.split('\n')[0] || message);
        if (!quiet) {
          void dialog.alert({ title: 'QR 생성 실패', body: message });
        }
        return null;
      }
    },
    [compress, dialog, text],
  );

  useEffect(() => {
    if (!live) return undefined;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      void generate(text, compressRef.current, { quiet: true });
    }, 280);
    return () => {
      if (liveTimer.current) clearTimeout(liveTimer.current);
    };
  }, [text, compress, live, generate]);

  const applyScanResult = useCallback(async (result) => {
    if (result?.cancelled) {
      setRecvStatus('영역 선택이 취소되었습니다.');
      return;
    }
    if (result?.region) setLastRegion(result.region);
    if (result?.previewDataUrl) setPreviewUrl(result.previewDataUrl);

    if (!result?.text) {
      const extra = result?.tooSmall
        ? ' 캡처가 너무 작습니다. 보내기에서 QR을 크게 보이게 한 뒤, QR 전체와 흰 여백을 포함해 다시 선택하세요.'
        : ' 영역을 조금 넓히거나 다시 스캔해 보세요.';
      setRecvStatus(`${result?.source ?? '영역'}에서 QR을 찾지 못했습니다.${extra}`);
      return;
    }

    if (result.text === resultTextRef.current) {
      setRecvStatus(`인식 성공 (변경 없음)  ·  ${displayCharCount(result.text)}자  ·  ${result.source ?? ''}`);
      return;
    }

    setResultText(result.text);
    resultTextRef.current = result.text;
    const url = asHttpUrl(result.text);
    const parts = ['인식 성공'];
    if (url && openUrlRef.current) {
      try {
        await openExternalUrl(url);
        parts.push('브라우저에서 URL을 열었습니다');
      } catch {
        parts.push('URL이지만 브라우저를 열지 못했습니다');
      }
    } else {
      parts.push(`${displayCharCount(result.text)}자`);
    }
    if (autoCopyRef.current) {
      try {
        await api('qr.clipboardWrite', { text: result.text });
        parts.push('클립보드에 복사됨');
      } catch {
        // ignore
      }
    }
    parts.push(result.source ?? '');
    setRecvStatus(parts.filter(Boolean).join('  ·  '));
  }, []);

  const rescan = useCallback(
    async (source = '다시 스캔') => {
      if (!lastRegion) return;
      try {
        const result = await api('qr.scanRegion', { region: lastRegion, source });
        await applyScanResult(result);
      } catch (err) {
        setRecvStatus(err instanceof Error ? err.message : '다시 스캔에 실패했습니다.');
      }
    },
    [applyScanResult, lastRegion],
  );

  useEffect(() => {
    if (mode !== 'receiver' || !watch || !lastRegion) return undefined;
    const id = setInterval(() => {
      void rescan('감시');
    }, 1000);
    return () => clearInterval(id);
  }, [mode, watch, lastRegion, rescan]);

  const pasteClipboard = async () => {
    try {
      const { text: clip } = await api('qr.clipboardRead');
      if (!clip) {
        setStatus('클립보드에 텍스트가 없습니다.');
        return;
      }
      const { text: next, truncated } = clampQrInput(clip);
      setText(next);
      if (truncated) {
        setStatus(`클립보드 내용이 길어 앞 ${displayCharCount(next).toLocaleString()}자만 붙여넣었습니다.`);
      }
      if (!live) void generate(next, compress, { quiet: false });
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '클립보드를 읽지 못했습니다.',
      });
    }
  };

  const clearSender = () => {
    genSeq.current += 1;
    setText('');
    setQr(null);
    setStatus('대기 중');
  };

  const ensureQr = async () => {
    if (qr?.dataUrl) return qr;
    return generate(text, compress, { quiet: false });
  };

  const savePng = async () => {
    const current = await ensureQr();
    if (!current?.dataUrl) return;
    try {
      const result = await api('qr.savePng', { dataUrl: current.dataUrl });
      if (result?.cancelled) {
        setStatus('저장을 취소했습니다.');
        return;
      }
      if (result?.ok) setStatus(`PNG로 저장함  ·  ${result.filePath}`);
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '저장에 실패했습니다.',
      });
    }
  };

  const showFullscreen = async () => {
    const current = await ensureQr();
    if (!current?.dataUrl) return;
    try {
      await api('qr.showFullscreen', {
        dataUrl: current.dataUrl,
        canvasModules: current.canvasModules,
      });
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '전체 화면을 열지 못했습니다.',
      });
    }
  };

  const pickRegionScan = async () => {
    setRecvStatus('화면을 캡처하는 중…');
    try {
      const result = await api('qr.scanPick');
      await applyScanResult(result);
    } catch (err) {
      setRecvStatus(err instanceof Error ? err.message : '영역 선택에 실패했습니다.');
    }
  };

  const copyResult = async () => {
    if (!resultText) return;
    try {
      await api('qr.clipboardWrite', { text: resultText });
      setRecvStatus(`클립보드에 복사됨  ·  ${displayCharCount(resultText)}자`);
    } catch (err) {
      void dialog.alert({
        title: TITLE,
        body: err instanceof Error ? err.message : '복사에 실패했습니다.',
      });
    }
  };

  const clearReceiver = () => {
    setResultText('');
    resultTextRef.current = '';
    setPreviewUrl('');
    setRecvStatus('지웠습니다.  영역은 유지됩니다.');
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto py-6 pl-6 pr-20">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-xl font-semibold text-slate-900">{TITLE}</h1>
          <p className="mt-1 text-sm text-slate-500">
            캡처보드용 단색 QR로 텍스트를 보내고 받습니다.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${
              mode === 'sender' ? 'bg-app-accent text-white' : 'text-slate-600 hover:bg-white'
            }`}
            onClick={() => setMode('sender')}
          >
            보내기
          </button>
          <button
            type="button"
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${
              mode === 'receiver' ? 'bg-app-accent text-white' : 'text-slate-600 hover:bg-white'
            }`}
            onClick={() => setMode('receiver')}
          >
            받기
          </button>
        </div>
      </div>

      {mode === 'sender' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnClass} onClick={() => void pasteClipboard()}>
              클립보드에서 붙여넣기
            </button>
            <button type="button" className={btnPrimaryClass} onClick={() => void generate(text, compress, { quiet: false })}>
              QR 생성
            </button>
            <button type="button" className={btnClass} onClick={clearSender}>
              지우기
            </button>
            <label className="ml-2 inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
              실시간 생성
            </label>
            <label
              className="inline-flex items-center gap-2 text-sm text-slate-700"
              title="용량을 넘기면 zlib으로 압축합니다. 그때는 이 프로그램 받기로만 복원됩니다."
            >
              <input type="checkbox" checked={compress} onChange={(e) => setCompress(e.target.checked)} />
              긴 텍스트 자동 압축
            </label>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
            <Section title="전송할 텍스트 / URL">
              <textarea
                className={`${inputClass} min-h-[20rem] font-mono`}
                value={text}
                onChange={(e) => {
                  const { text: next, truncated } = clampQrInput(e.target.value);
                  setText(next);
                  if (truncated) setStatus('입력이 길어 앞부분만 유지합니다.');
                }}
                placeholder="텍스트 또는 https://… URL을 입력하세요. URL이면 스캔 시 브라우저가 열립니다."
                spellCheck={false}
              />
            </Section>
            <Section
              title="단색 QR"
              actions={
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btnClass} disabled={!qr?.dataUrl && !text.trim()} onClick={() => void savePng()}>
                    QR 저장하기
                  </button>
                  <button type="button" className={btnClass} disabled={!qr?.dataUrl && !text.trim()} onClick={() => void showFullscreen()}>
                    QR 전체 화면
                  </button>
                </div>
              }
            >
              <QrPreview dataUrl={qr?.dataUrl ?? ''} canvasModules={qr?.canvasModules ?? 29} />
            </Section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-emerald-700">{status}</span>
            <span className="text-slate-500">
              원문 한글 약 {MAX_QR_HANGUL}자. 더 길면 「긴 텍스트 자동 압축」(전용 받기, 일반 문장 약 2,000자).
            </span>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimaryClass} onClick={() => void pickRegionScan()}>
              영역 선택
            </button>
            <button type="button" className={btnClass} disabled={!lastRegion} onClick={() => void rescan()}>
              다시 스캔
            </button>
            <button type="button" className={btnClass} disabled={!resultText} onClick={() => void copyResult()}>
              클립보드로 복사
            </button>
            <button type="button" className={btnClass} onClick={clearReceiver}>
              지우기
            </button>
            <label className="ml-2 inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={autoCopy} onChange={(e) => setAutoCopy(e.target.checked)} />
              자동 복사
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={openUrl} onChange={(e) => setOpenUrl(e.target.checked)} />
              URL이면 브라우저로 열기
            </label>
            <label
              className="inline-flex items-center gap-2 text-sm text-slate-700"
              title="마지막 선택 영역을 주기적으로 다시 읽어 QR이 바뀌면 갱신합니다."
            >
              <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} />
              선택 영역 감시
            </label>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
            <Section title="캡처 미리보기">
              <div className="flex min-h-[20rem] flex-1 items-center justify-center rounded-lg bg-white p-2">
                {previewUrl ? (
                  <img src={previewUrl} alt="캡처 미리보기" className="max-h-[28rem] max-w-full object-contain" />
                ) : (
                  <p className="m-0 text-sm text-slate-400">영역 선택 후 QR이 여기에 표시됩니다</p>
                )}
              </div>
            </Section>
            <Section title="인식된 텍스트">
              <textarea
                className={`${inputClass} min-h-[20rem] font-mono`}
                value={resultText}
                onChange={(e) => {
                  setResultText(e.target.value);
                  resultTextRef.current = e.target.value;
                }}
                placeholder="QR이 인식되면 원문이 여기에 나타납니다."
                spellCheck={false}
              />
            </Section>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-emerald-700">{recvStatus}</span>
            <span className="text-slate-500">OBS/캡처보드가 보이는 모니터에서 QR을 드래그하세요.</span>
          </div>
        </div>
      )}
    </div>
  );
}
