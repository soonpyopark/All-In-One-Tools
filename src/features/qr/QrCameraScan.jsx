import { useCallback, useEffect, useRef } from 'react';
import jsQR from 'jsqr';
import { restoreQrPayload } from '../../../shared/qrProtocol.js';

/**
 * 웹캠으로 QR을 연속 스캔한다. 성공 시 onDecoded 후 상위가 active를 끄면 스트림이 멈춘다.
 * @param {{
 *   active: boolean,
 *   onDecoded: (result: { text: string, previewDataUrl: string, source: string }) => void | Promise<void>,
 *   onStatus: (msg: string) => void,
 *   onFatal: (msg: string) => void,
 * }} props
 */
export default function QrCameraScan({ active, onDecoded, onStatus, onFatal }) {
  const videoRef = useRef(/** @type {HTMLVideoElement | null} */ (null));
  const streamRef = useRef(/** @type {MediaStream | null} */ (null));
  const canvasRef = useRef(/** @type {HTMLCanvasElement | null} */ (null));
  const rafRef = useRef(0);
  const lastRawRef = useRef('');
  const busyRef = useRef(false);
  const onDecodedRef = useRef(onDecoded);
  const onStatusRef = useRef(onStatus);
  const onFatalRef = useRef(onFatal);
  onDecodedRef.current = onDecoded;
  onStatusRef.current = onStatus;
  onFatalRef.current = onFatal;

  const stopStream = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => t.stop());
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    lastRawRef.current = '';
    busyRef.current = false;
  }, []);

  useEffect(() => {
    if (!active) {
      stopStream();
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        /** @type {MediaStream} */
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();
        onStatusRef.current('카메라 준비됨  ·  QR을 화면에 비추세요');

        const tick = () => {
          if (cancelled || !streamRef.current) return;
          rafRef.current = requestAnimationFrame(tick);
          const v = videoRef.current;
          if (!v || v.readyState < 2 || busyRef.current) return;
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) return;

          let canvas = canvasRef.current;
          if (!canvas) {
            canvas = document.createElement('canvas');
            canvasRef.current = canvas;
          }
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });
          if (!code?.data) return;
          if (code.data === lastRawRef.current) return;
          lastRawRef.current = code.data;

          busyRef.current = true;
          let text;
          try {
            text = restoreQrPayload(code.data);
          } catch (err) {
            busyRef.current = false;
            onStatusRef.current(
              err instanceof Error ? err.message : 'QR 페이로드를 복원하지 못했습니다.',
            );
            return;
          }
          const previewDataUrl = canvas.toDataURL('image/jpeg', 0.85);
          void Promise.resolve(
            onDecodedRef.current({
              text,
              previewDataUrl,
              source: '카메라',
            }),
          ).finally(() => {
            busyRef.current = false;
          });
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof Error
            ? err.message
            : '카메라를 열지 못했습니다. 권한·연결을 확인하세요.';
        onFatalRef.current(msg);
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [active, stopStream]);

  return (
    <video
      ref={videoRef}
      className="max-h-[28rem] max-w-full rounded-md bg-black object-contain"
      playsInline
      muted
      autoPlay
    />
  );
}
