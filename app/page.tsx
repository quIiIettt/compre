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
    { label: 'Raw RGB (24-bit)', value: raw, color: 'from-slate-200 to-slate-400', icon: Layers },
    { label: 'PNG (lossless)', value: png, color: 'from-sky-300 to-sky-500', icon: ImageIcon },
    { label: 'JPEG (Q=90)', value: jpeg, color: 'from-amber-300 to-orange-400', icon: Camera },
    { label: 'WebP (Q=90)', value: webp, color: 'from-fuchsia-300 to-fuchsia-500', icon: Waves },
    { label: 'Custom codec', value: mine, color: 'from-emerald-300 to-emerald-500', icon: Sparkles },
  ];

  const maxVal = Math.max(...bars.map((bar) => bar.value), 1);
  const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

  return (
    <div className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300/80">Size comparison</p>
          <h3 className="text-xl font-bold text-white">How each format compresses</h3>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-emerald-200">
          <BarChart3 className="h-4 w-4" />
          Live simulation
        </div>
      </div>
      <div className="mt-6 space-y-5 text-sm font-medium text-slate-100">
        {bars.map((bar) => {
          const percent = Math.max(6, (bar.value / maxVal) * 100);
          return (
            <div key={bar.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-slate-200">
                  <bar.icon className="h-4 w-4 text-slate-300" />
                  {bar.label}
                </span>
                <span className="text-slate-200/80">{formatMB(bar.value)}</span>
              </div>
              <div className="h-3 w-full rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${bar.color}`}
                  style={{ width: `${percent}%` }}
                />
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
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-50">
      <div className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute left-10 top-10 h-56 w-56 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="absolute right-[-60px] top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-cyan-400/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12">
        <header className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200">
            <Sparkles className="h-4 w-4" />
            Experimental codec — lossless preview
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
              Flexible compression with instant visualization
            </h1>
            <p className="max-w-3xl text-lg text-slate-200/80">
              Upload any image and see the pipeline convert RGB to YCrCb, encode with QOI, and pack residual data with
              Huffman coding. Keep discard bits at 0 for lossless preview.
            </p>
            <div className="flex flex-wrap gap-3">
              {featureChips.map((chip) => (
                <span
                  key={chip.label}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-100"
                >
                  <chip.icon className="h-4 w-4 text-emerald-200" />
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        </header>

        <section className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300/80">Controls</p>
                <h2 className="text-xl font-bold text-white">Balance fidelity and size</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                <Sparkles className="h-4 w-4" />
                Auto-updating simulation
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-inner">
                <div className="mb-4 flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-200">
                      <Layers className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Block size</p>
                      <p className="text-xs text-slate-300/80">Choose node size for Huffman (min 2x2).</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-emerald-100">
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
                  className="w-full accent-emerald-400"
                />
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4 shadow-inner space-y-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-200">
                      <SlidersHorizontal className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Discard lower bits</p>
                      <p className="text-xs text-slate-300/80">Set to 0 for lossless; raise to trade detail for size.</p>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-white/5 px-3 py-1 text-xs font-semibold text-cyan-100">
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
                  className="w-full accent-cyan-400"
                />
                <div className="flex items-center justify-between">
  <p className="text-sm font-medium text-slate-200">Smoothing between nodes</p>

  <button
    onClick={() => setSmooth(v => !v)}
    className={`relative h-6 w-11 rounded-full transition 
    ${smooth ? 'bg-emerald-500/80' : 'bg-slate-500/60'}`}
  >
    <span
      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition
      ${smooth ? 'translate-x-5' : 'translate-x-0'}`}
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

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Gauge className="h-4 w-4 text-emerald-200" />
                    Quality metrics
                  </div>
                  <span className="text-xs text-slate-300/80">{sourceKind === 'container' ? 'Needs original for PSNR/SSIM' : 'vs original'}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">PSNR</p>
                    <p className="mt-2 text-xl font-bold text-white">
                      {metrics.psnr === null
                        ? 'N/A'
                        : metrics.psnr === Infinity
                          ? '∞ dB'
                          : `${metrics.psnr.toFixed(2)} dB`}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">SSIM</p>
                    <p className="mt-2 text-xl font-bold text-white">
                      {metrics.ssim === null ? 'N/A' : metrics.ssim.toFixed(4)}
                    </p>
                  </div>
                </div>
                {heatmapUrl && (
                  <div className="mt-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Difference heatmap</p>
                    <button
                      type="button"
                      onClick={() => openLightbox(heatmapUrl, 'Difference heatmap')}
                      className="mt-2 block overflow-hidden rounded-2xl border border-white/10 shadow-lg transition hover:scale-[1.01]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={heatmapUrl} alt="Heatmap" className="w-full" />
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Layers className="h-4 w-4 text-cyan-200" />
                    Container inspector
                  </div>
                  <span className="text-xs text-slate-300/80">Header + sizes</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm text-slate-100">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Dimensions</p>
                    <p className="mt-1 text-lg font-semibold">
                      {dimensions ? `${dimensions.width}×${dimensions.height}` : '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Block / Discard</p>
                    <p className="mt-1 text-lg font-semibold">
                      {blockSize}px / {discardBits} bits {smooth ? '• smooth' : '• flat'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">QOI bytes</p>
                    <p className="mt-1 text-lg font-semibold">{(stats.qoiSize / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Huffman bytes</p>
                    <p className="mt-1 text-lg font-semibold">{(stats.nodalSize / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Total container</p>
                    <p className="mt-1 text-lg font-semibold">{(stats.compressedSize / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">Source</p>
                    <p className="mt-1 text-lg font-semibold capitalize">{sourceKind ?? '—'}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Zap className="h-4 w-4 text-amber-200" />
                  Codec timings
                </div>
                <span className="text-xs text-slate-300/80">Encode / decode</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm text-slate-100 sm:grid-cols-4">
                {[
                  { label: 'PNG', data: codecMetrics.png, size: stats.pngSize },
                  { label: 'JPEG', data: codecMetrics.jpeg, size: stats.jpegSize },
                  { label: 'WebP', data: codecMetrics.webp, size: stats.webpSize },
                  { label: 'Custom', data: codecMetrics.custom, size: stats.compressedSize },
                ].map((row) => (
                  <div key={row.label} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-300/80">{row.label}</p>
                    <p className="mt-1 text-xs text-slate-300">Size: {(row.size / 1024).toFixed(1)} KB</p>
                    <p className="mt-1 text-sm font-semibold text-white">Enc: {formatMs(row.data.encodeMs)}</p>
                    <p className="text-sm font-semibold text-white">Dec: {formatMs(row.data.decodeMs)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-4 text-sm font-medium text-slate-100">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
                <span className="h-3 w-3 rounded-full bg-emerald-400" />
                QOI: {(stats.qoiSize / 1024).toFixed(1)} KB
              </div>
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2">
                <span className="h-3 w-3 rounded-full bg-indigo-400" />
                Huffman: {(stats.nodalSize / 1024).toFixed(1)} KB
              </div>
              {isProcessing && (
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-emerald-100">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating preview
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
                <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-slate-100">
                  <Camera className="h-4 w-4 text-slate-300" />
                  {originalLabel}
                </div>
                <button
                  type="button"
                  onClick={() => openLightbox(displayImageUrl, originalLabel)}
                  className="block w-full overflow-hidden rounded-2xl border border-white/10 shadow-lg transition hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={displayImageUrl ?? undefined} className="w-full" alt={originalLabel} />
                </button>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur">
                <div className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-slate-100">
                  <Sparkles className="h-4 w-4 text-emerald-200" />
                  {previewLabel}
                </div>
                {previewSrc && (
                  <button
                    type="button"
                    onClick={() => openLightbox(previewSrc, previewLabel)}
                    className="block w-full overflow-hidden rounded-2xl border border-white/10 shadow-lg transition hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-emerald-300/60"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewSrc} className="w-full" alt="Processed" />
                  </button>
                )}
              </div>
            </div>

            <div className="pt-4 flex flex-col items-center gap-3 text-center">
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={handleDownloadCompressed}
                  disabled={!containerBytes || isProcessing}
                  className={`inline-flex items-center gap-2 rounded-full bg-emerald-100 text-slate-900 px-6 py-3 text-sm font-semibold transition ${
                    !containerBytes || isProcessing
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:translate-y-[-1px] hover:bg-emerald-50'
                  }`}
                >
                  <Download className="h-4 w-4" />
                  Download custom .kmr
                </button>
                <button
                  onClick={() => handleDownloadPreview('png')}
                  disabled={!processedImageUrl && !processedImageData}
                  className={`inline-flex items-center gap-2 rounded-full bg-white/80 text-slate-900 px-6 py-3 text-sm font-semibold transition ${
                    !processedImageUrl && !processedImageData
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:translate-y-[-1px] hover:bg-white'
                  }`}
                >
                  <Download className="h-4 w-4" />
                  Download preview PNG
                </button>
                <button
                  onClick={() => handleDownloadPreview('jpeg')}
                  disabled={!processedImageUrl && !processedImageData}
                  className={`inline-flex items-center gap-2 rounded-full bg-white/80 text-slate-900 px-6 py-3 text-sm font-semibold transition ${
                    !processedImageUrl && !processedImageData
                      ? 'cursor-not-allowed opacity-60'
                      : 'hover:translate-y-[-1px] hover:bg-white'
                  }`}
                >
                  <Download className="h-4 w-4" />
                  Download preview JPEG
                </button>
                <button
                  onClick={handleDownloadHeatmap}
                  disabled={!heatmapUrl}
                  className={`inline-flex items-center gap-2 rounded-full bg-white/60 text-slate-900 px-6 py-3 text-sm font-semibold transition ${
                    !heatmapUrl ? 'cursor-not-allowed opacity-60' : 'hover:translate-y-[-1px] hover:bg-white'
                  }`}
                >
                  <Download className="h-4 w-4" />
                  Download heatmap
                </button>
                <button
                  onClick={handleDownloadJsonSummary}
                  disabled={!dimensions}
                  className={`inline-flex items-center gap-2 rounded-full bg-white/60 text-slate-900 px-6 py-3 text-sm font-semibold transition ${
                    !dimensions ? 'cursor-not-allowed opacity-60' : 'hover:translate-y-[-1px] hover:bg-white'
                  }`}
                >
                  <Download className="h-4 w-4" />
                  Download JSON summary
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
                  className="inline-flex items-center gap-2 rounded-full bg-white text-slate-900 px-6 py-3 text-sm font-semibold transition hover:translate-y-[-1px] hover:bg-slate-100"
                >
                  <RefreshCw className="h-4 w-4" />
                  Reset and try another image
                </button>
              </div>
              <p className="text-xs text-slate-300/80">
                Saves the residual QOI + Huffman nodal streams into a single custom container ({CONTAINER_EXTENSION}).
              </p>
            </div>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
        {lightbox && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={closeLightbox}
            role="presentation"
          >
            <div
              className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-2xl border border-white/10 bg-slate-900/80 p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label={lightbox.label}
            >
              <button
                onClick={closeLightbox}
                className="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Close
              </button>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lightbox.src} alt={lightbox.label} className="max-h-[80vh] w-auto rounded-lg object-contain" />
              <p className="mt-2 text-center text-sm text-slate-200">{lightbox.label}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
