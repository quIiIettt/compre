'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, RefreshCw, Sparkles, UploadCloud } from 'lucide-react';

type BatchStatus = 'pending' | 'processing' | 'done' | 'error';

type BatchItem = {
  id: string;
  name: string;
  size: number;
  status: BatchStatus;
  message?: string;
  result?: {
    raw: number;
    custom: number;
    jpeg: number;
    png: number;
    webp: number;
    width: number;
    height: number;
    psnr?: number;
    ssim?: number;
  };
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

export default function BatchCompressionPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [blockSize, setBlockSize] = useState(8);
  const [discardBits, setDiscardBits] = useState(0);
  const [smooth, setSmooth] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const csvHeader =
    'timestamp,context,source,width,height,blockSize,discardBits,smooth,psnr,ssim,rawSize,compressedSize,nodalSize,qoiSize,jpegSize,pngSize,webpSize,customEncodeMs,customDecodeMs,jpegEncodeMs,jpegDecodeMs,pngEncodeMs,pngDecodeMs,webpEncodeMs,webpDecodeMs';

  const pendingCount = useMemo(() => items.filter((i) => i.status !== 'done').length, [items]);
  const doneItems = useMemo(() => items.filter((i) => i.status === 'done' && i.result), [items]);

  const stats = useMemo(() => {
    if (!doneItems.length) {
      return null;
    }
    const totalRaw = doneItems.reduce((acc, i) => acc + (i.result?.raw ?? 0), 0);
    const totalCustom = doneItems.reduce((acc, i) => acc + (i.result?.custom ?? 0), 0);
    const saved = totalRaw - totalCustom;
    const ratios = doneItems.map((i) => (i.result ? i.result.raw / i.result.custom : 0));
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const avgPsnr =
      doneItems.reduce((a, i) => a + (i.result?.psnr ?? 0), 0) / Math.max(1, doneItems.length);
    const avgSsim =
      doneItems.reduce((a, i) => a + (i.result?.ssim ?? 0), 0) / Math.max(1, doneItems.length);

    return {
      totalRaw,
      totalCustom,
      saved,
      avgRatio,
      avgPsnr,
      avgSsim,
      ratios,
    };
  }, [doneItems]);

  const toCsvCell = (value: string | number | boolean | null | undefined) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return `${value}`;
  };

  const appendCsvRow = (row: {
    context: string;
    source: string | null;
    width: number;
    height: number;
    blockSize: number;
    discardBits: number;
    smooth: boolean;
    psnr: number | null | undefined;
    ssim: number | null | undefined;
    raw: number;
    custom: number;
    nodal: number;
    qoi: number;
    jpeg: number;
    png: number;
    webp: number;
    customEnc?: number | null;
    customDec?: number | null;
    jpegEnc?: number | null;
    jpegDec?: number | null;
    pngEnc?: number | null;
    pngDec?: number | null;
    webpEnc?: number | null;
    webpDec?: number | null;
  }) => {
    const line = [
      new Date().toISOString(),
      row.context,
      row.source ?? '',
      row.width,
      row.height,
      row.blockSize,
      row.discardBits,
      row.smooth,
      row.psnr ?? '',
      row.ssim ?? '',
      row.raw,
      row.custom,
      row.nodal,
      row.qoi,
      row.jpeg,
      row.png,
      row.webp,
      row.customEnc ?? '',
      row.customDec ?? '',
      row.jpegEnc ?? '',
      row.jpegDec ?? '',
      row.pngEnc ?? '',
      row.pngDec ?? '',
      row.webpEnc ?? '',
      row.webpDec ?? '',
    ]
      .map(toCsvCell)
      .join(',');

    fetch('/api/log-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: line, header: csvHeader }),
    }).catch((err) => console.error('Failed to append batch CSV row', err));
  };

  const handleSelect = (fileList: FileList | null) => {
    if (!fileList) return;
    const picked = Array.from(fileList).slice(0, 100);
    setFiles(picked);
    setItems(
      picked.map((f, idx) => ({
        id: `${Date.now()}-${idx}`,
        name: f.name,
        size: f.size,
        status: 'pending',
      }))
    );
  };

  const processQueue = async () => {
    if (!files.length) return;
    setIsRunning(true);
    const updated: BatchItem[] = [...items];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      updated[i] = { ...updated[i], status: 'processing', message: undefined };
      setItems([...updated]);
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('blockSize', String(blockSize));
        form.append('discardBits', String(discardBits));
        form.append('smooth', String(smooth));

        const res = await fetch('/api/compress', { method: 'POST', body: form });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        updated[i] = {
          ...updated[i],
          status: 'done',
          result: {
            raw: json.sizes.raw,
            custom: json.sizes.custom,
            jpeg: json.sizes.jpeg,
            png: json.sizes.png,
            webp: json.sizes.webp,
            width: json.dimensions.width,
            height: json.dimensions.height,
            psnr: json.metrics?.psnr ?? undefined,
            ssim: json.metrics?.ssim ?? undefined,
          },
        };
        appendCsvRow({
          context: 'batch',
          source: 'image',
          width: json.dimensions.width,
          height: json.dimensions.height,
          blockSize,
          discardBits,
          smooth,
          psnr: json.metrics?.psnr ?? null,
          ssim: json.metrics?.ssim ?? null,
          raw: json.sizes.raw,
          custom: json.sizes.custom,
          nodal: json.sizes.nodal ?? 0,
          qoi: json.sizes.qoi ?? 0,
          jpeg: json.sizes.jpeg,
          png: json.sizes.png,
          webp: json.sizes.webp,
          customEnc: json.timings?.custom?.encodeMs ?? null,
          customDec: json.timings?.custom?.decodeMs ?? null,
          jpegEnc: json.timings?.jpeg?.encodeMs ?? null,
          jpegDec: json.timings?.jpeg?.decodeMs ?? null,
          pngEnc: json.timings?.png?.encodeMs ?? null,
          pngDec: json.timings?.png?.decodeMs ?? null,
          webpEnc: json.timings?.webp?.encodeMs ?? null,
          webpDec: json.timings?.webp?.decodeMs ?? null,
        });
      } catch (err: any) {
        updated[i] = { ...updated[i], status: 'error', message: err?.message ?? 'Failed' };
      }
      setItems([...updated]);
    }

    setIsRunning(false);
  };

  useEffect(() => {
    // Reset selection if files cleared
    if (!files.length) {
      setItems([]);
    }
  }, [files]);

  const renderRatiosBar = () => {
    if (!stats?.ratios.length) return null;
    const max = Math.max(...stats.ratios, 1);
    return (
      <div className="mt-3 flex h-12 items-end gap-[2px] rounded-xl bg-slate-50 p-2">
        {stats.ratios.map((r, idx) => (
          <div
            key={idx}
            className="w-full rounded-sm bg-gradient-to-t from-violet-500 to-blue-400"
            style={{ height: `${Math.min(100, (r / max) * 100)}%` }}
            title={`Ratio ${r.toFixed(2)}`}
          />
        ))}
      </div>
    );
  };

  return (
    <main className="light-theme min-h-screen bg-white text-slate-900">
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-10">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600">Batch compression</p>
            <h1 className="text-3xl font-black text-slate-900">Process multiple images at once</h1>
            <p className="text-sm text-slate-600">Upload up to 20 images; each will be compressed and logged.</p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5"
          >
            <Sparkles className="h-4 w-4" />
            Back to single preview
          </Link>
        </header>

        <section className="mt-8 rounded-3xl border border-slate-200/80 bg-white/80 p-6 shadow-lg backdrop-blur-md">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 shadow-inner">
              <p className="text-sm font-semibold text-slate-800">Upload images</p>
              <p className="text-xs text-slate-500">PNG/JPEG; max 100 files.</p>
              <button
                onClick={() => inputRef.current?.click()}
                className="mt-3 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-violet-700"
              >
                <UploadCloud className="h-4 w-4" />
                Select files
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => handleSelect(e.target.files)}
                className="hidden"
              />
              <p className="mt-2 text-xs text-slate-500">Selected: {files.length}</p>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 shadow-inner">
              <p className="text-sm font-semibold text-slate-800">Block size</p>
              <p className="text-xs text-slate-500">Choose node size (min 2).</p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="range"
                  min={2}
                  max={32}
                  step={2}
                  value={blockSize}
                  onChange={(e) => setBlockSize(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
                <span className="text-sm font-semibold text-slate-800">{blockSize}px</span>
              </div>

              <p className="mt-4 text-sm font-semibold text-slate-800">Discard bits</p>
              <p className="text-xs text-slate-500">0 = lossless preview.</p>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={6}
                  step={1}
                  value={discardBits}
                  onChange={(e) => setDiscardBits(Number(e.target.value))}
                  className="w-full accent-violet-500"
                />
                <span className="text-sm font-semibold text-slate-800">{discardBits}b</span>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">Smoothing</span>
                <button
                  onClick={() => setSmooth((v) => !v)}
                  className={`relative h-6 w-11 rounded-full transition ${smooth ? 'bg-violet-500' : 'bg-slate-300'}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                      smooth ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 shadow-inner">
              <p className="text-sm font-semibold text-slate-800">Run</p>
              <p className="text-xs text-slate-500">Queue will process sequentially.</p>
              <button
                onClick={processQueue}
                disabled={!files.length || isRunning}
                className={`mt-3 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow transition ${
                  !files.length || isRunning
                    ? 'cursor-not-allowed bg-slate-300'
                    : 'bg-emerald-600 hover:-translate-y-0.5 hover:bg-emerald-700'
                }`}
              >
                {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {isRunning ? 'Processing…' : 'Start batch'}
              </button>
              <button
                onClick={() => {
                  setFiles([]);
                  setItems([]);
                  setIsRunning(false);
                }}
                className="mt-2 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5"
              >
                <RefreshCw className="h-4 w-4" />
                Reset
              </button>
              <p className="mt-2 text-xs text-slate-500">Pending/processing: {pendingCount}</p>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-3xl border border-slate-200/80 bg-white/80 p-6 shadow-lg backdrop-blur-md">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Batch results</h2>
            <span className="text-xs text-slate-500">{items.length} items</span>
          </div>
          {stats && (
            <div className="mt-4 grid grid-cols-1 gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 shadow-inner sm:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Avg ratio</p>
                <p className="text-2xl font-bold text-violet-700">{stats.avgRatio.toFixed(2)}x</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Avg PSNR</p>
                <p className="text-2xl font-bold text-slate-800">
                  {Number.isFinite(stats.avgPsnr) ? stats.avgPsnr.toFixed(2) : 'N/A'}
                  <span className="text-base font-medium text-slate-600"> dB</span>
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Avg SSIM</p>
                <p className="text-2xl font-bold text-slate-800">
                  {Number.isFinite(stats.avgSsim) ? stats.avgSsim.toFixed(4) : 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Total savings</p>
                <p className="text-2xl font-bold text-emerald-700">
                  {formatBytes(stats.saved)}
                  <span className="text-base font-medium text-slate-600"> saved</span>
                </p>
              </div>
              <div className="sm:col-span-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Ratios per image</p>
                {renderRatiosBar()}
              </div>
            </div>
          )}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm text-slate-800">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-widest text-slate-500">
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Dims</th>
                  <th className="px-3 py-2 text-left">Custom</th>
                  <th className="px-3 py-2 text-left">JPEG</th>
                  <th className="px-3 py-2 text-left">PNG</th>
                  <th className="px-3 py-2 text-left">WebP</th>
                  <th className="px-3 py-2 text-left">PSNR</th>
                  <th className="px-3 py-2 text-left">SSIM</th>
                  <th className="px-3 py-2 text-left">Message</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const r = item.result;
                  return (
                    <tr key={item.id} className="border-b border-slate-100 last:border-none">
                      <td className="px-3 py-2">
                        <div className="flex flex-col">
                          <span className="font-semibold">{item.name}</span>
                          <span className="text-xs text-slate-500">{formatBytes(item.size)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {item.status === 'processing' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Processing
                          </span>
                        )}
                        {item.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                            Pending
                          </span>
                        )}
                        {item.status === 'done' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">
                            Done
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">
                            Error
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        {r ? `${r.width}x${r.height}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r ? formatBytes(r.custom) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r ? formatBytes(r.jpeg) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r ? formatBytes(r.png) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">{r ? formatBytes(r.webp) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {r?.psnr !== undefined && r?.psnr !== null ? r.psnr.toFixed(2) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {r?.ssim !== undefined && r?.ssim !== null ? r.ssim.toFixed(4) : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-rose-600">{item.message ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
