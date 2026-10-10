'use client';

/* oxlint-disable next/no-img-element -- Previewing local screenshot data URLs needs their true dimensions for precise cropping. */

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Camera, ExternalLink, ImagePlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  analyzeCheckoutText,
  extractTableNameCells,
  matchOcrName,
  type CheckoutResult,
} from '@/lib/checkout';
import type { Member } from '@/lib/members';

const RMJ_URL = 'https://rmj.club/';

type Selection = { x: number; y: number; width: number; height: number };
type CaptureStep = 'ready' | 'live' | 'crop';

export function CheckoutFlow({
  members,
  onStart,
  onComplete,
}: {
  members: Member[];
  onStart: () => void;
  onComplete: (result: CheckoutResult) => void;
}) {
  const [captureOpen, setCaptureOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [step, setStep] = useState<CaptureStep>('ready');
  const [sourceImage, setSourceImage] = useState('');
  const [croppedImage, setCroppedImage] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [progress, setProgress] = useState('');
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function stopCapture() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => () => stopCapture(), []);

  useEffect(() => {
    if (step === 'live' && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play();
    }
  }, [step]);

  function startCheckout() {
    onStart();
    setError('');
    setStep('ready');
    setSourceImage('');
    setCroppedImage('');
    setSelection(null);
    setCaptureOpen(true);
    window.open(RMJ_URL, '_blank', 'noopener,noreferrer');
  }

  async function startScreenCapture() {
    setError('');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('当前浏览器不支持共享画面，请截屏后粘贴或上传图片。');
      return;
    }

    try {
      stopCapture();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        streamRef.current = null;
        setStep((current) => (current === 'live' ? 'ready' : current));
      });
      setStep('live');
    } catch {
      setError(
        '没有获取到画面。请选择 rmj.club 标签页或 Edge 窗口，或改用粘贴／上传截图。',
      );
    }
  }

  function freezeFrame() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setError('画面尚未就绪，请稍后再试。');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    stopCapture();
    setSourceImage(canvas.toDataURL('image/png'));
    setSelection(null);
    setStep('crop');
  }

  function loadImageFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件。');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('图片不能超过 20 MB。');
      return;
    }

    stopCapture();
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSourceImage(reader.result);
        setSelection(null);
        setStep('crop');
        setError('');
      }
    };
    reader.onerror = () => setError('无法读取图片，请重试。');
    reader.readAsDataURL(file);
  }

  function getPoint(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const start = getPoint(event);
    dragStartRef.current = start;
    setSelection({ ...start, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start) return;
    const point = getPoint(event);
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;

    const point = getPoint(event);
    const crop = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    setSelection(crop);

    if (crop.width < 12 || crop.height < 12) {
      setError('请按住鼠标，框选包含成绩表的区域。');
      return;
    }

    const image = imageRef.current;
    if (!image) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const scaleX = image.naturalWidth / bounds.width;
    const scaleY = image.naturalHeight / bounds.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.width * scaleX));
    canvas.height = Math.max(1, Math.round(crop.height * scaleY));
    canvas
      .getContext('2d')
      ?.drawImage(
        image,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    setCroppedImage(canvas.toDataURL('image/png'));
    setError('');
    setCaptureOpen(false);
    setConfirmOpen(true);
  }

  async function confirmScreenshot() {
    setConfirmOpen(false);
    setRecognizing(true);
    setProgress('正在识别截图中的游戏 ID…');

    let worker: Awaited<
      ReturnType<(typeof import('tesseract.js'))['createWorker']>
    > | null = null;

    try {
      const { createWorker, PSM } = await import('tesseract.js');
      worker = await createWorker(['chi_sim', 'jpn', 'eng'], 1, {
        logger: (message) => {
          if (message.status === 'recognizing text') {
            setProgress(`正在识别截图… ${Math.round(message.progress * 100)}%`);
          }
        },
      });
      // A score sheet is a regular grid. Single-block mode preserves its rows
      // and columns more reliably than Tesseract's automatic page layout.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      const result = await worker.recognize(
        croppedImage,
        {},
        { text: true, blocks: true },
      );
      const cells = extractTableNameCells(result.data.blocks ?? []);

      // Re-read only cells that did not match a registered card. This catches
      // small single-character names (for example 哥) that the full-table pass
      // can mistake for another glyph. Each corrected cell still counts once.
      if (cells.length) {
        const image = new Image();
        image.src = croppedImage;
        await image.decode();
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
          setProgress('正在复核未识别的昵称…');
          for (const cell of cells) {
            if (matchOcrName(cell.name, members)) continue;
            const height = Math.max(12, cell.bbox.y1 - cell.bbox.y0);
            const horizontalPadding = height * 3;
            const verticalPadding = height * 0.75;
            const x = Math.max(0, cell.bbox.x0 - horizontalPadding);
            const y = Math.max(0, cell.bbox.y0 - verticalPadding);
            const right = Math.min(image.naturalWidth, cell.bbox.x1 + horizontalPadding);
            const bottom = Math.min(image.naturalHeight, cell.bbox.y1 + verticalPadding);
            const width = right - x;
            const cropHeight = bottom - y;
            if (width <= 0 || cropHeight <= 0) continue;
            canvas.width = Math.min(1600, Math.round(width * 4));
            canvas.height = Math.min(600, Math.round(cropHeight * 4));
            context.imageSmoothingEnabled = false;
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, x, y, width, cropHeight, 0, 0, canvas.width, canvas.height);
            const retry = await worker.recognize(canvas.toDataURL('image/png'));
            const retryName = retry.data.text.trim().replace(/\s+/g, '');
            if (matchOcrName(retryName, members)) cell.name = retryName;
          }
        }
      }
      onComplete(
        analyzeCheckoutText(
          result.data.text,
          result.data.blocks ?? [],
          members,
          cells,
        ),
      );
      setSourceImage('');
      setCroppedImage('');
      setStep('ready');
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `图片识别失败：${cause.message}`
          : '图片识别失败，请重新尝试。',
      );
      setCaptureOpen(true);
      setStep('crop');
    } finally {
      await worker?.terminate();
      setRecognizing(false);
      setProgress('');
    }
  }

  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={startCheckout}
        disabled={recognizing}
        className="h-11 rounded-xl bg-[#17202a] px-5 text-base text-white shadow-sm hover:bg-[#303b47]"
      >
        <Camera className="size-5" aria-hidden="true" />
        结账
      </Button>
      {recognizing && (
        <span className="text-sm text-[#66717f]">{progress}</span>
      )}

      <Dialog
        open={captureOpen}
        onOpenChange={(open) => {
          setCaptureOpen(open);
          if (!open) stopCapture();
        }}
      >
        <DialogContent
          className="max-h-[95vh] overflow-y-auto sm:max-w-5xl"
          onPaste={(event) => {
            const file = Array.from(event.clipboardData.files).find((item) =>
              item.type.startsWith('image/'),
            );
            if (file) {
              event.preventDefault();
              loadImageFile(file);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>截取成绩表</DialogTitle>
            <DialogDescription>
              在新打开的 rmj.club 页面找到成绩表，回到这里选择该标签页或 Edge
              窗口；也可以粘贴或上传现成截图。
            </DialogDescription>
          </DialogHeader>

          {step === 'ready' && (
            <div className="flex flex-wrap gap-3 py-5">
              <Button type="button" onClick={() => void startScreenCapture()}>
                <Camera className="size-4" aria-hidden="true" />
                选择 rmj.club 画面
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="size-4" aria-hidden="true" />
                上传截图
              </Button>
              <a
                href={RMJ_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-[#345479] underline-offset-4 hover:underline"
              >
                重新打开 rmj.club <ExternalLink className="size-4" />
              </a>
              <p className="w-full text-sm text-[#66717f]">
                如果使用微信或系统快捷键截屏，回到这个窗口按 Ctrl+V 即可。
              </p>
            </div>
          )}

          {step === 'live' && (
            <div className="space-y-3">
              <p className="text-sm text-[#66717f]">
                确认预览中显示的是成绩表，准备好后冻结画面。
              </p>
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="mx-auto max-h-[60vh] w-full rounded-xl border bg-black object-contain"
              />
              <Button type="button" onClick={freezeFrame}>
                冻结画面并框选
              </Button>
            </div>
          )}

          {step === 'crop' && sourceImage && (
            <div className="space-y-3">
              <p className="text-sm text-[#66717f]">
                按住鼠标框选完整的成绩表，松手后确认截图。
              </p>
              <div className="flex justify-center overflow-auto rounded-xl bg-[#e7ebf0] p-2">
                <div
                  className="relative inline-block cursor-crosshair touch-none select-none"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={() => {
                    dragStartRef.current = null;
                    setSelection(null);
                  }}
                >
                  <img
                    ref={imageRef}
                    src={sourceImage}
                    alt="待框选的成绩表截图"
                    draggable={false}
                    className="block max-h-[60vh] max-w-full"
                  />
                  {selection && (
                    <div
                      className="pointer-events-none absolute border-2 border-blue-600 bg-blue-500/15"
                      style={{
                        left: selection.x,
                        top: selection.y,
                        width: selection.width,
                        height: selection.height,
                      }}
                    />
                  )}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep('ready');
                  setSourceImage('');
                }}
              >
                换一张截图
              </Button>
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) loadImageFile(file);
              event.target.value = '';
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setCaptureOpen(true);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>确定使用这张截图吗？</DialogTitle>
            <DialogDescription>
              将只统计游戏 ID 出现次数，不读取分数，也不会改变会员储值。
            </DialogDescription>
          </DialogHeader>
          <img
            src={croppedImage}
            alt="即将确认的成绩表截图"
            className="max-h-[50vh] w-full rounded-lg border object-contain"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setCaptureOpen(true);
              }}
            >
              重新框选
            </Button>
            <Button type="button" onClick={() => void confirmScreenshot()}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
