'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ImageUploader } from '@/components/ImageUploader';
import { StatsPanel } from '@/components/StatsPanel';
import { processImageFrame } from '@/utils/algorithm';
import { decodeContainerToImage } from '@/utils/decode';
import { buildContainer, CONTAINER_EXTENSION } from '@/utils/container';
import { encodeQOI } from '@/utils/qoi';
import { encodeHuffman } from '@/utils/huffman';
import {
  BarChart3,
  Camera,
  Download,
  Gauge,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  SlidersHorizontal,
  Waves,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ChartBar = {
  label: string;
  value: number;
  color: string;
  icon: LucideIcon;
};

type YCrCbPreview = {
  y: string;
  cb: string;
  cr: string;
  composite: string;
};

const ComparisonChart = ({
  raw,
  jpeg,
  png,
  webp,
  mine,
}: {
  raw: number;
  jpeg: number;
  png: number;
  webp: number;
  mine: number;
}) => {
  const bars: ChartBar[] = [
    { label: 'Raw RGB', value: raw, color: 'bg-slate-300', icon: Layers },
    { label: 'PNG', value: png, color: 'bg-sky-400', icon: ImageIcon },
    { label: 'JPEG', value: jpeg, color: 'bg-amber-400', icon: Camera },
    { label: 'WebP', value: webp, color: 'bg-fuchsia-400', icon: Waves },
    { label: 'Custom', value: mine, color: 'bg-gradient-to-r from-violet-500 to-blue-500', icon: Sparkles },
  ];

  const maxVal = Math.max(...bars.map((bar) => bar.value), 1);
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <div className="w-full rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-lg backdrop-blur-md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Size Comparison</p>
          <h3 className="text-xl font-bold text-slate-800">Which Codec is Best?</h3>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-violet-100/80 px-3 py-1 text-xs font-semibold text-violet-700">
          <BarChart3 className="h-4 w-4" />
          Lower is Better
        </div>
      </div>
      <div className="mt-6 space-y-5 text-sm font-medium text-slate-700">
        {bars.map((bar) => {
          const percent = Math.max(1, (bar.value / maxVal) * 100);
          const isCustom = bar.label === 'Custom';
          return (
            <div key={bar.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <span
                  className={`flex items-center gap-2 font-semibold ${
                    isCustom ? 'text-violet-700' : 'text-slate-700'
                  }`}
                >
                  <bar.icon className={`h-4 w-4 ${isCustom ? 'text-violet-600' : 'text-slate-500'}`} />
                  {bar.label}
                </span>
                <span className={`${isCustom ? 'font-bold text-violet-700' : 'text-slate-500'}`}>
                  {formatBytes(bar.value)}
                </span>
              </div>
              <div className={`h-3 w-full rounded-full ${isCustom ? 'bg-violet-100' : 'bg-slate-200/70'}`}>
                <div className={`h-full rounded-full ${bar.color}`} style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const buildResidualImage = (imageData: ImageData) => {
  const { width, height, data } = imageData;
  const out = new Uint8ClampedArray(data.length);
  const idx = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = idx(x, y);
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const a = data[o + 3];

      const hasLeft = x > 0;
      const hasUp = y > 0;
      const left = hasLeft ? idx(x - 1, y) : -1;
      const up = hasUp ? idx(x, y - 1) : -1;
      const upLeft = hasLeft && hasUp ? idx(x - 1, y - 1) : -1;

      const paeth = (cA: number, cB: number, cC: number) => {
        const p = cA + cB - cC;
        const pa = Math.abs(p - cA);
        const pb = Math.abs(p - cB);
        const pc = Math.abs(p - cC);
        if (pa <= pb && pa <= pc) return cA;
        if (pb <= pc) return cB;
        return cC;
      };

      const pred = (c: 0 | 1 | 2) => {
        const A = hasLeft ? data[left + c] : 0;
        const B = hasUp ? data[up + c] : 0;
        const C = hasLeft && hasUp ? data[upLeft + c] : 0;
        return paeth(A, B, C);
      };

      const pr = pred(0);
      const pg = pred(1);
      const pb = pred(2);

      out[o] = (r - pr + 256) & 0xff;
      out[o + 1] = (g - pg + 256) & 0xff;
      out[o + 2] = (b - pb + 256) & 0xff;
      out[o + 3] = a; // keep alpha
    }
  }

  return new ImageData(out, width, height);
};

const computePSNR = (a: ImageData, b: ImageData): number => {
  if (a.width !== b.width || a.height !== b.height) return NaN;
  let mse = 0;
  const len = a.data.length;
  for (let i = 0; i < len; i += 4) {
    const dr = a.data[i] - b.data[i];
    const dg = a.data[i + 1] - b.data[i + 1];
    const db = a.data[i + 2] - b.data[i + 2];
    mse += dr * dr + dg * dg + db * db;
  }
  mse /= (len / 4) * 3;
  if (mse === 0) return Infinity;
  return 10 * Math.log10((255 * 255) / mse);
};

const computeSSIM = (a: ImageData, b: ImageData): number => {
  if (a.width !== b.width || a.height !== b.height) return NaN;
  const len = a.data.length;
  let meanA = 0;
  let meanB = 0;
  const lumA = new Float32Array(len / 4);
  const lumB = new Float32Array(len / 4);
  for (let i = 0, p = 0; i < len; i += 4, p++) {
    const yA = 0.299 * a.data[i] + 0.587 * a.data[i + 1] + 0.114 * a.data[i + 2];
    const yB = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
    lumA[p] = yA;
    lumB[p] = yB;
    meanA += yA;
    meanB += yB;
  }
  const count = len / 4;
  meanA /= count;
  meanB /= count;

  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < count; i++) {
    const da = lumA[i] - meanA;
    const db = lumB[i] - meanB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= count - 1;
  varB /= count - 1;
  cov /= count - 1;

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;

  const ssim = ((2 * meanA * meanB + c1) * (2 * cov + c2)) / ((meanA * meanA + meanB * meanB + c1) * (varA + varB + c2));
  return ssim;
};

const buildHeatmap = (a: ImageData, b: ImageData): ImageData | null => {
  if (a.width !== b.width || a.height !== b.height) return null;
  const out = new Uint8ClampedArray(a.data.length);
  const len = a.data.length;
  for (let i = 0; i < len; i += 4) {
    const dr = Math.abs(a.data[i] - b.data[i]);
    const dg = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const db = Math.abs(a.data[i + 2] - b.data[i + 2]);
    out[i] = Math.min(255, dr * 4);
    out[i + 1] = Math.min(255, dg * 4);
    out[i + 2] = Math.min(255, db * 4);
    out[i + 3] = 255;
  }
  return new ImageData(out, a.width, a.height);
};

const measureDecodeTime = (dataUrl: string) =>
  new Promise<number>((resolve) => {
    const start = performance.now();
    const img = new Image();
    img.onload = () => resolve(performance.now() - start);
    img.onerror = () => resolve(NaN);
    img.src = dataUrl;
  });

const dataUrlToImageData = (url: string, width?: number, height?: number): Promise<ImageData> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = width ?? img.width;
      const h = height ?? img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No 2D context'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });

const imageToImageData = (img: HTMLImageElement): ImageData | null => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
};

const clampToByte = (value: number) => Math.min(255, Math.max(0, Math.round(value)));

const buildYCrCbPlanes = (imageData: ImageData) => {
  const { width, height, data } = imageData;
  const yPlane = new Uint8ClampedArray(data.length);
  const cbPlane = new Uint8ClampedArray(data.length);
  const crPlane = new Uint8ClampedArray(data.length);
  const recombined = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const Y = 0.299 * r + 0.587 * g + 0.114 * b;
    const Cb = -0.1687 * r - 0.3313 * g + 0.5 * b + 128;
    const Cr = 0.5 * r - 0.4187 * g - 0.0813 * b + 128;

    const yVal = clampToByte(Y);
    const cbVal = clampToByte(Cb);
    const crVal = clampToByte(Cr);

    const cbCentered = cbVal - 128;
    const crCentered = crVal - 128;

    const reconR = clampToByte(yVal + 1.402 * crCentered);
    const reconG = clampToByte(yVal - 0.34414 * cbCentered - 0.71414 * crCentered);
    const reconB = clampToByte(yVal + 1.772 * cbCentered);

    yPlane[i] = yPlane[i + 1] = yPlane[i + 2] = yVal;
    yPlane[i + 3] = 255;

    cbPlane[i] = 32;
    cbPlane[i + 1] = 64;
    cbPlane[i + 2] = cbVal;
    cbPlane[i + 3] = 255;

    crPlane[i] = crVal;
    crPlane[i + 1] = 48;
    crPlane[i + 2] = 48;
    crPlane[i + 3] = 255;

    recombined[i] = reconR;
    recombined[i + 1] = reconG;
    recombined[i + 2] = reconB;
    recombined[i + 3] = 255;
  }

  return {
    y: new ImageData(yPlane, width, height),
    cb: new ImageData(cbPlane, width, height),
    cr: new ImageData(crPlane, width, height),
    recombined: new ImageData(recombined, width, height),
  };
};


export default function Home() {
  const [originalImage, setOriginalImage] = useState<HTMLImageElement | null>(null);
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
  const [processedImageData, setProcessedImageData] = useState<ImageData | null>(null);
  const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<'image' | 'container' | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [containerBytes, setContainerBytes] = useState<Uint8Array | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);
  const [heatmapUrl, setHeatmapUrl] = useState<string | null>(null);
  const [ycrcbPreview, setYcrcbPreview] = useState<YCrCbPreview | null>(null);
  const [metrics, setMetrics] = useState<{ psnr: number | null; ssim: number | null }>({ psnr: null, ssim: null });
  const [codecMetrics, setCodecMetrics] = useState<{
    jpeg: { encodeMs: number | null; decodeMs: number | null };
    png: { encodeMs: number | null; decodeMs: number | null };
    webp: { encodeMs: number | null; decodeMs: number | null };
    custom: { encodeMs: number | null; decodeMs: number | null };
  }>({
    jpeg: { encodeMs: null, decodeMs: null },
    png: { encodeMs: null, decodeMs: null },
    webp: { encodeMs: null, decodeMs: null },
    custom: { encodeMs: null, decodeMs: null },
  });
  const [backendLocked, setBackendLocked] = useState(false);
  const [blockSize, setBlockSize] = useState(8);
  const [discardBits, setDiscardBits] = useState(0);
  const [smooth, setSmooth] = useState(true);

  const [stats, setStats] = useState({
    rawSize: 0,
    compressedSize: 0,
    nodalSize: 0,
    qoiSize: 0,
    time: 0,
    jpegSize: 0,
    pngSize: 0,
    webpSize: 0,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getBase64Size = (dataUrl: string) => {
    const head = 'data:image/*;base64,'.length;
    return Math.floor(((dataUrl.length - head) * 3) / 4);
  };

  const imageDataToDataUrl = (imageData: ImageData) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  };
  const base64ToUint8 = (b64: string) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  const updateYCrCbPreview = (imageData: ImageData | null) => {
    if (!imageData) {
      setYcrcbPreview(null);
      return;
    }

    const planes = buildYCrCbPlanes(imageData);
    const yUrl = imageDataToDataUrl(planes.y);
    const cbUrl = imageDataToDataUrl(planes.cb);
    const crUrl = imageDataToDataUrl(planes.cr);
    const compositeUrl = imageDataToDataUrl(planes.recombined);

    if (yUrl && cbUrl && crUrl && compositeUrl) {
      setYcrcbPreview({ y: yUrl, cb: cbUrl, cr: crUrl, composite: compositeUrl });
    } else {
      setYcrcbPreview(null);
    }
  };

  const handleImageSelect = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        setSourceKind('image');
        setProcessedImageUrl(null);
        setDisplayImageUrl(event.target?.result as string);
        setContainerBytes(null);
        setOriginalImage(img);
        setProcessedImageData(null);
        setHeatmapUrl(null);
        setYcrcbPreview(null);
        setMetrics({ psnr: null, ssim: null });
        setCodecMetrics({
          jpeg: { encodeMs: null, decodeMs: null },
          png: { encodeMs: null, decodeMs: null },
          webp: { encodeMs: null, decodeMs: null },
          custom: { encodeMs: null, decodeMs: null },
        });
        setDimensions({ width: img.width, height: img.height });
        const rawSize = img.width * img.height * 3;

        setStats({
          rawSize,
          compressedSize: 0,
          nodalSize: 0,
          qoiSize: 0,
          time: 0,
          jpegSize: 0,
          pngSize: 0,
          webpSize: 0,
        });

        const runBackend = async () => {
          try {
            setBackendLocked(true);
            setIsProcessing(true);
            const form = new FormData();
            form.append('file', file);
            form.append('blockSize', String(blockSize));
            form.append('discardBits', String(discardBits));
            form.append('smooth', String(smooth));

            const res = await fetch('/api/compress', { method: 'POST', body: form });
            if (!res.ok) throw new Error('Backend compression failed');
            const json = await res.json();

            const previewUrl = `data:image/png;base64,${json.previewPng}`;
            const container = base64ToUint8(json.container);

            setProcessedImageUrl(previewUrl);
            setContainerBytes(container);
            const processedData = await dataUrlToImageData(previewUrl, img.width, img.height);
            setProcessedImageData(processedData);

            const originalData = imageToImageData(img);
            if (originalData) {
              const psnr = computePSNR(originalData, processedData);
              const ssim = computeSSIM(originalData, processedData);
              const heatmap = buildHeatmap(originalData, processedData);
              setMetrics({ psnr, ssim });
              setHeatmapUrl(heatmap ? imageDataToDataUrl(heatmap) : null);
            } else {
              setMetrics({ psnr: json.metrics.psnr ?? null, ssim: json.metrics.ssim ?? null });
              setHeatmapUrl(null);
            }
            updateYCrCbPreview(originalData ?? processedData);
            setCodecMetrics({
              png: json.timings.png,
              jpeg: json.timings.jpeg,
              webp: json.timings.webp,
              custom: json.timings.custom,
            });
            setStats((prev) => ({
              ...prev,
              rawSize: json.sizes.raw,
              compressedSize: json.sizes.custom,
              nodalSize: json.sizes.nodal,
              qoiSize: json.sizes.qoi,
              jpegSize: json.sizes.jpeg,
              pngSize: json.sizes.png,
              webpSize: json.sizes.webp,
              time: json.timings.custom.encodeMs ?? prev.time,
            }));
            setDimensions(json.dimensions);
          } catch (err) {
            console.error(err);
            setBackendLocked(false);
            runCompressionSimulation();
          } finally {
            setIsProcessing(false);
          }
        };

        runBackend();
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleContainerSelect = async (file: File) => {
    const start = performance.now();
    try {
      setIsProcessing(false);
      const buffer = await file.arrayBuffer();
      const decoded = decodeContainerToImage(buffer);
      const dataUrl = imageDataToDataUrl(decoded.imageData);
      if (!dataUrl) throw new Error('Failed to render decoded image');

      setSourceKind('container');
      setOriginalImage(null);
      setProcessedImageUrl(dataUrl);
      setDisplayImageUrl(dataUrl);
      setProcessedImageData(decoded.imageData);
      setHeatmapUrl(null);
      setMetrics({ psnr: null, ssim: null });
      updateYCrCbPreview(decoded.imageData);
      setCodecMetrics({
        custom: { encodeMs: null, decodeMs: null },
        jpeg: { encodeMs: null, decodeMs: null },
        png: { encodeMs: null, decodeMs: null },
        webp: { encodeMs: null, decodeMs: null },
      });
      setContainerBytes(new Uint8Array(buffer));
      setDimensions({ width: decoded.width, height: decoded.height });
      setBlockSize(decoded.blockSize);
      setDiscardBits(decoded.discardBits);
      setSmooth(decoded.smooth);

      if (canvasRef.current) {
        canvasRef.current.width = decoded.width;
        canvasRef.current.height = decoded.height;
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.putImageData(decoded.imageData, 0, 0);
      }

      const end = performance.now();
      setStats({
        rawSize: decoded.width * decoded.height * 3,
        compressedSize: decoded.totalSize,
        nodalSize: decoded.nodalSize,
        qoiSize: decoded.qoiSize,
        time: end - start,
        jpegSize: 0,
        pngSize: 0,
        webpSize: 0,
      });
      setCodecMetrics((prev) => ({
        ...prev,
        custom: { encodeMs: prev.custom.encodeMs, decodeMs: end - start },
      }));

    } catch (err) {
      console.error(err);
      alert('Failed to decode container. Make sure the file is a valid .kmr export.');
    }
  };

  const runCompressionSimulation = () => {
    if (!originalImage || !canvasRef.current) return;

    setContainerBytes(null);
    setIsProcessing(true);

    setTimeout(async () => {
      const startTime = performance.now();
      const ctx = canvasRef.current!.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      canvasRef.current!.width = originalImage.width;
      canvasRef.current!.height = originalImage.height;

      ctx.drawImage(originalImage, 0, 0);
      const imageData = ctx.getImageData(0, 0, originalImage.width, originalImage.height);
      updateYCrCbPreview(imageData);
      const jpegStart = performance.now();
      const jpegUrl = canvasRef.current!.toDataURL('image/jpeg', 0.9);
      const jpegEncodeMs = performance.now() - jpegStart;

      const pngStart = performance.now();
      const pngUrl = canvasRef.current!.toDataURL('image/png');
      const pngEncodeMs = performance.now() - pngStart;

      const webpStart = performance.now();
      const webpUrl = canvasRef.current!.toDataURL('image/webp', 0.9);
      const webpEncodeMs = performance.now() - webpStart;
      const jpegBytes = getBase64Size(jpegUrl);
      const pngBytes = getBase64Size(pngUrl);
      const webpBytes = getBase64Size(webpUrl);

      const result = processImageFrame(imageData, blockSize, discardBits, smooth);

      const residualImage = buildResidualImage(result.processedImageData);
      const qoiBytes = encodeQOI(residualImage);

      const huffmanY = encodeHuffman(result.nodalPointsY);
      const huffmanCb = encodeHuffman(result.nodalPointsCb);
      const huffmanCr = encodeHuffman(result.nodalPointsCr);
      const totalHuffmanSize = huffmanY.length + huffmanCb.length + huffmanCr.length;

      const container = buildContainer({
        width: originalImage.width,
        height: originalImage.height,
        blockSize,
        discardBits,
        smooth,
        qoi: qoiBytes,
        huffmanY,
        huffmanCb,
        huffmanCr,
      });
      const totalSize = container.length;

      ctx.putImageData(result.processedImageData, 0, 0);
      const dataUrl = canvasRef.current!.toDataURL('image/png');
      setProcessedImageUrl(dataUrl);
      setProcessedImageData(result.processedImageData);
      setContainerBytes(container);

      let customDecodeMs: number | null = null;
      try {
        const customDecodeStart = performance.now();
        decodeContainerToImage(container.slice().buffer);
        customDecodeMs = performance.now() - customDecodeStart;
      } catch {
        customDecodeMs = NaN;
      }

      const [jpegDecodeMs, pngDecodeMs, webpDecodeMs] = await Promise.all([
        measureDecodeTime(jpegUrl),
        measureDecodeTime(pngUrl),
        measureDecodeTime(webpUrl),
      ]);

      const endTime = performance.now();
      setCodecMetrics({
        jpeg: { encodeMs: jpegEncodeMs, decodeMs: jpegDecodeMs },
        png: { encodeMs: pngEncodeMs, decodeMs: pngDecodeMs },
        webp: { encodeMs: webpEncodeMs, decodeMs: webpDecodeMs },
        custom: { encodeMs: endTime - startTime, decodeMs: customDecodeMs },
      });

      const psnr = computePSNR(imageData, result.processedImageData);
      const ssim = computeSSIM(imageData, result.processedImageData);
      const heatmap = buildHeatmap(imageData, result.processedImageData);
      setMetrics({ psnr, ssim });
      setHeatmapUrl(heatmap ? imageDataToDataUrl(heatmap) : null);

      setStats((prev) => ({
        ...prev,
        compressedSize: totalSize,
        qoiSize: qoiBytes.length,
        nodalSize: totalHuffmanSize,
        time: endTime - startTime,
        jpegSize: jpegBytes,
        pngSize: pngBytes,
        webpSize: webpBytes,
      }));

      setIsProcessing(false);
    }, 50);
  };

  useEffect(() => {
    if (sourceKind === 'image' && originalImage && !backendLocked) runCompressionSimulation();
  }, [sourceKind, originalImage, blockSize, discardBits, smooth, backendLocked]);

  useEffect(() => {
    if (processedImageData && canvasRef.current) {
      canvasRef.current.width = processedImageData.width;
      canvasRef.current.height = processedImageData.height;
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.putImageData(processedImageData, 0, 0);
    }
  }, [processedImageData]);

  const handleDownloadCompressed = () => {
    if (!containerBytes || !dimensions) return;

    const blob = new Blob([containerBytes as any], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const name = `codec-${dimensions.width}x${dimensions.height}-b${blockSize}-d${discardBits}${
      smooth ? '-smooth' : '-nosmooth'
    }${CONTAINER_EXTENSION}`;

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openLightbox = (src: string | null, label: string) => {
    if (!src) return;
    setLightbox({ src, label });
  };

  const closeLightbox = () => setLightbox(null);

  const handleDownloadPreview = (format: 'png' | 'jpeg') => {
    if (!canvasRef.current || !dimensions) return;
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvasRef.current.toDataURL(mime, format === 'jpeg' ? 0.95 : undefined);
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = `decoded-${dimensions.width}x${dimensions.height}.${format === 'png' ? 'png' : 'jpg'}`;
    anchor.click();
  };

  const handleDownloadHeatmap = () => {
    if (!heatmapUrl || !dimensions) return;
    const anchor = document.createElement('a');
    anchor.href = heatmapUrl;
    anchor.download = `heatmap-${dimensions.width}x${dimensions.height}.png`;
    anchor.click();
  };

  const handleDownloadJsonSummary = () => {
    if (!dimensions) return;
    const summary = {
      kind: sourceKind,
      dimensions,
      blockSize,
      discardBits,
      smooth,
      stats,
      metrics,
      codecMetrics,
      timestamp: Date.now(),
    };
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `summary-${dimensions.width}x${dimensions.height}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const featureChips = [
    { icon: Sparkles, label: 'Lossless visual output (set discard bits to 0)' },
    { icon: Layers, label: 'Block-wise YCrCb nodes for Huffman' },
    { icon: Zap, label: 'QOI + Huffman reversible packing' },
  ];
  const originalLabel = sourceKind === 'container' ? 'Decoded (.kmr)' : 'Original';
  const previewLabel = sourceKind === 'container' ? 'Decoded preview' : 'Compressed preview';
  const previewSrc = processedImageUrl ?? displayImageUrl;
  const formatMs = (v: number | null) => {
    if (v === null) return 'N/A';
    if (Number.isNaN(v)) return 'Error';
    return `${v.toFixed(1)} ms`;
  };

  return (
    <main className="light-theme relative min-h-screen overflow-hidden bg-white text-slate-900">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-48 -top-48 h-[52rem] w-[52rem] rounded-full bg-gradient-to-br from-sky-500 via-blue-600/80 to-transparent blur-[180px] opacity-100" />
        <div className="absolute -right-48 -bottom-48 h-[56rem] w-[56rem] rounded-full bg-gradient-to-tl from-purple-800 via-violet-600/80 to-transparent blur-[200px] opacity-100" />
        <div className="absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-blue-100/60 via-transparent to-transparent" />
        <div className="absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-purple-100/60 via-transparent to-transparent" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12">
        <header className="space-y-6 text-center">
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/80 bg-white/50 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-violet-700 shadow-sm backdrop-blur-sm">
              <Sparkles className="h-4 w-4" />
              Experimental Codec
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-5xl font-black leading-tight text-slate-900 sm:text-6xl">
              Modern Image Compression,
              <br />
              <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
                Instant Visualization
              </span>
            </h1>
            <p className="mx-auto max-w-3xl text-lg text-slate-600">
              Upload an image to see a custom image compression algorithm in action. Adjust settings to see how it
              affects the result and file size in real-time.
            </p>
            <div className="flex flex-wrap justify-center gap-4 pt-4">
              {featureChips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/50 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm backdrop-blur-sm"
                >
                  <chip.icon className="h-4 w-4 text-violet-600" />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        </header>

        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-3xl border border-slate-200/80 bg-white/60 p-6 shadow-lg backdrop-blur-md">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Controls</p>
                <h2 className="text-xl font-bold text-slate-800">Balance Fidelity and Size</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-violet-100/80 px-3 py-1 text-xs font-semibold text-violet-700">
                <Sparkles className="h-4 w-4" />
                Auto-updating simulation
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200/80 bg-slate-100/50 p-4 shadow-inner">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">Block size</p>
                      <p className="text-xs text-slate-500">Node size for Huffman.</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-violet-700">
                    {blockSize}px
                  </span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="32"
                  step="2"
                  value={blockSize}
                  onChange={(e) => setBlockSize(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200/80 bg-slate-100/50 p-4 shadow-inner">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
                      <SlidersHorizontal className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">Discard lower bits</p>
                      <p className="text-xs text-slate-500">0 for lossless.</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-blue-700">
                    <span>{discardBits}</span>
                    <span>bits</span>
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="1"
                  value={discardBits}
                  onChange={(e) => setDiscardBits(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex items-center justify-between pt-2">
                  <p className="font-medium text-slate-700">Smoothing</p>
                  <button
                    onClick={() => setSmooth((v) => !v)}
                    className={`relative h-6 w-11 rounded-full transition ${
                      smooth ? 'bg-violet-500' : 'bg-slate-400'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                        smooth ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="h-full">
            <ImageUploader onImageSelected={handleImageSelect} onContainerSelected={handleContainerSelect} />
          </div>
        </section>

        {!displayImageUrl ? (
          <div className="mt-10 text-sm text-slate-300/80">
            Choose an image to see lossless compression results or upload a .kmr to decode it back into the preview.
          </div>
        ) : (
          <div className="mt-10 space-y-8">
            <StatsPanel originalSize={stats.rawSize} estimatedCompressedSize={stats.compressedSize} time={stats.time} />

            <ComparisonChart
              raw={stats.rawSize}
              jpeg={stats.jpegSize}
              png={stats.pngSize}
              webp={stats.webpSize}
              mine={stats.compressedSize}
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-lg backdrop-blur-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Gauge className="h-5 w-5 text-violet-600" />
                    <h3 className="text-lg font-bold text-slate-800">Quality Metrics</h3>
                  </div>
                  <span className="text-xs text-slate-500">
                    {sourceKind === 'container' ? 'Original needed' : 'vs. Original'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-100/60 p-4 text-center shadow-inner">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">PSNR</p>
                    <p className="mt-2 text-2xl font-bold text-violet-600">
                      {metrics.psnr === null
                        ? 'N/A'
                        : metrics.psnr === Infinity
                          ? '∞'
                          : `${metrics.psnr.toFixed(2)}`}
                      <span className="text-base font-medium text-violet-500"> dB</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200/80 bg-slate-100/60 p-4 text-center shadow-inner">
                    <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">SSIM</p>
                    <p className="mt-2 text-2xl font-bold text-violet-600">
                      {metrics.ssim === null ? 'N/A' : metrics.ssim.toFixed(4)}
                    </p>
                  </div>
                </div>
                {heatmapUrl && (
                  <div className="mt-4">
                    <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
                      Difference Heatmap
                    </p>
                    <button
                      type="button"
                      onClick={() => openLightbox(heatmapUrl, 'Difference heatmap')}
                      className="mt-2 block overflow-hidden rounded-2xl border-2 border-slate-200/80 shadow-lg transition hover:border-violet-400/80 hover:shadow-xl"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={heatmapUrl} alt="Heatmap" className="w-full" />
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-lg backdrop-blur-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Layers className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-bold text-slate-800">Container Inspector</h3>
                  </div>
                  <span className="text-xs text-slate-500">File structure</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    { label: 'Dimensions', value: dimensions ? `${dimensions.width}×${dimensions.height}` : '—' },
                    { label: 'Block / Discard', value: `${blockSize}px / ${discardBits}b` },
                    { label: 'QOI Bytes', value: `${(stats.qoiSize / 1024).toFixed(1)} KB` },
                    { label: 'Huffman Bytes', value: `${(stats.nodalSize / 1024).toFixed(1)} KB` },
                    { label: 'Total Size', value: `${(stats.compressedSize / 1024).toFixed(1)} KB` },
                    { label: 'Smoothing', value: smooth ? 'On' : 'Off' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-slate-200/80 bg-slate-100/60 p-3 shadow-inner"
                    >
                      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">{item.label}</p>
                      <p className="mt-1 text-lg font-bold text-blue-600">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {ycrcbPreview && (
              <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-lg backdrop-blur-md">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Waves className="h-5 w-5 text-sky-600" />
                    <h3 className="text-lg font-bold text-slate-800">YCrCb Color Space</h3>
                  </div>
                  <span className="text-xs text-slate-500">Luma & Chroma planes</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  {[
                    { label: 'Luma (Y)', src: ycrcbPreview.y },
                    { label: 'Blue Chroma (Cb)', src: ycrcbPreview.cb },
                    { label: 'Red Chroma (Cr)', src: ycrcbPreview.cr },
                    { label: 'Recombined', src: ycrcbPreview.composite },
                  ].map((row) => (
                    <div key={row.label}>
                      <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">
                        {row.label}
                      </p>
                      <button
                        type="button"
                        onClick={() => openLightbox(row.src, row.label)}
                        className="mt-2 block overflow-hidden rounded-2xl border-2 border-slate-200/80 shadow-lg transition hover:border-sky-400/80 hover:shadow-xl"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={row.src} alt={row.label} className="w-full" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-lg backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Zap className="h-5 w-5 text-amber-500" />
                  <h3 className="text-lg font-bold text-slate-800">Codec Timings</h3>
                </div>
                <span className="text-xs text-slate-500">Encode / Decode Performance</span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                {[
                  { label: 'PNG', data: codecMetrics.png, size: stats.pngSize },
                  { label: 'JPEG', data: codecMetrics.jpeg, size: stats.jpegSize },
                  { label: 'WebP', data: codecMetrics.webp, size: stats.webpSize },
                  { label: 'Custom', data: codecMetrics.custom, size: stats.compressedSize },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="rounded-2xl border border-slate-200/80 bg-slate-100/60 p-4 text-center shadow-inner"
                  >
                    <p className="text-sm font-bold uppercase tracking-widest text-slate-600">{row.label}</p>
                    <p className="mt-1 text-xs text-slate-500">{(row.size / 1024).toFixed(1)} KB</p>
                    <p className="mt-2 text-sm font-semibold text-slate-700">
                      <span className="font-medium text-slate-500">Enc:</span> {formatMs(row.data.encodeMs)}
                    </p>
                    <p className="text-sm font-semibold text-slate-700">
                      <span className="font-medium text-slate-500">Dec:</span> {formatMs(row.data.decodeMs)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-4 pt-4 text-sm font-medium">
              <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/50 px-4 py-2 text-slate-600 shadow-sm backdrop-blur-sm">
                <span className="h-3 w-3 rounded-full bg-green-400" />
                QOI: {(stats.qoiSize / 1024).toFixed(1)} KB
              </div>
              <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/50 px-4 py-2 text-slate-600 shadow-sm backdrop-blur-sm">
                <span className="h-3 w-3 rounded-full bg-indigo-400" />
                Huffman: {(stats.nodalSize / 1024).toFixed(1)} KB
              </div>
              {isProcessing && (
                <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-violet-100/80 px-4 py-2 text-violet-700 shadow-sm backdrop-blur-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating preview
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-4 shadow-lg backdrop-blur-md">
                <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
                  <Camera className="h-4 w-4 text-slate-500" />
                  {originalLabel}
                </div>
                <button
                  type="button"
                  onClick={() => openLightbox(displayImageUrl, originalLabel)}
                  className="block w-full overflow-hidden rounded-2xl border-2 border-slate-200/80 shadow-lg transition hover:border-slate-400/80 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-violet-400/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={displayImageUrl ?? undefined} className="w-full" alt={originalLabel} />
                </button>
              </div>
              <div className="rounded-3xl border border-slate-200/80 bg-white/70 p-4 shadow-lg backdrop-blur-md">
                <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-violet-700">
                  <Sparkles className="h-4 w-4 text-violet-500" />
                  {previewLabel}
                </div>
                {previewSrc && (
                  <button
                    type="button"
                    onClick={() => openLightbox(previewSrc, previewLabel)}
                    className="block w-full overflow-hidden rounded-2xl border-2 border-violet-300/80 shadow-lg transition hover:border-violet-400/80 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-violet-400/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewSrc} className="w-full" alt="Processed" />
                  </button>
                )}
              </div>
            </div>

            <div className="pt-8 flex flex-col items-center gap-4 text-center">
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={handleDownloadCompressed}
                  disabled={!containerBytes || isProcessing}
                  className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  Download .kmr
                </button>
                <button
                  onClick={() => handleDownloadPreview('png')}
                  disabled={!processedImageUrl && !processedImageData}
                  className="inline-flex items-center gap-2 rounded-full bg-white/80 px-6 py-3 text-sm font-semibold text-slate-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  Download PNG
                </button>
                <button
                  onClick={handleDownloadJsonSummary}
                  disabled={!dimensions}
                  className="inline-flex items-center gap-2 rounded-full bg-white/60 px-6 py-3 text-sm font-semibold text-slate-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Download className="h-4 w-4" />
                  Download JSON
                </button>
                <button
                  onClick={() => {
                    setOriginalImage(null);
                    setProcessedImageUrl(null);
                    setDisplayImageUrl(null);
                    setSourceKind(null);
                    setDimensions(null);
                    setContainerBytes(null);
                    setProcessedImageData(null);
                    setHeatmapUrl(null);
                    setYcrcbPreview(null);
                    setMetrics({ psnr: null, ssim: null });
                    setCodecMetrics({
                      jpeg: { encodeMs: null, decodeMs: null },
                      png: { encodeMs: null, decodeMs: null },
                      webp: { encodeMs: null, decodeMs: null },
                      custom: { encodeMs: null, decodeMs: null },
                    });
                    setBackendLocked(false);
                    setStats({
                      rawSize: 0,
                      compressedSize: 0,
                      nodalSize: 0,
                      qoiSize: 0,
                      time: 0,
                      jpegSize: 0,
                      pngSize: 0,
                      webpSize: 0,
                    });
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset
                </button>
              </div>
              <p className="text-xs text-slate-500">
                Download the custom container, preview images, or a JSON summary of the results.
              </p>
            </div>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
        {lightbox && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-md"
            onClick={closeLightbox}
            role="presentation"
          >
            <div
              className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={lightbox.label}
            >
              <button
                onClick={closeLightbox}
                className="absolute right-3 top-3 rounded-full bg-slate-200/80 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white"
              >
                Close
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightbox.src} alt={lightbox.label} className="max-h-[80vh] w-auto rounded-lg object-contain" />
              <p className="mt-2 text-center text-sm text-slate-600">{lightbox.label}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
