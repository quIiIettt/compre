import React from 'react';
import { Gauge, HardDrive, Timer, Zap } from 'lucide-react';

interface Props {
  originalSize: number;
  estimatedCompressedSize: number;
  time: number;
}

export const StatsPanel: React.FC<Props> = ({ originalSize, estimatedCompressedSize, time }) => {
  const ratio = estimatedCompressedSize > 0 ? originalSize / estimatedCompressedSize : 0;
  const savings = originalSize > 0 ? (1 - estimatedCompressedSize / originalSize) * 100 : 0;

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  return (
    <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-4">
      <div className="relative flex flex-col justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl backdrop-blur md:col-span-2">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-0 top-0 h-full w-1/2 bg-gradient-to-r from-emerald-500/10 to-transparent" />
        </div>
        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300/80">Compression ratio</p>
              <div className="mt-3 flex items-end gap-3">
                <p className="text-5xl font-black text-emerald-200">
                  {ratio.toFixed(2)}
                  <span className="text-3xl">x</span>
                </p>
                {savings > 0 && (
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-100">
                    -{savings.toFixed(1)}%
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-200/80">Higher values mean more aggressive compression vs raw.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-emerald-100">
              <Gauge className="h-4 w-4" />
              Dynamic
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-300/80">File sizes</p>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-100">
              <HardDrive className="h-4 w-4 text-slate-300" />
              Raw
            </span>
            <span className="text-base font-semibold text-white">{formatBytes(originalSize)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-100">
              <Zap className="h-4 w-4 text-emerald-300" />
              Compressed
            </span>
            <span className="text-lg font-bold text-emerald-200">{formatBytes(estimatedCompressedSize)}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300/80">JS time</p>
        <p className="mt-2 text-3xl font-bold text-white">
          {time.toFixed(0)} <span className="text-lg text-slate-300">ms</span>
        </p>
        <p className="mt-2 text-xs text-slate-200/80">Pure client-side calculation to preview results instantly.</p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-cyan-100">
          <Timer className="h-4 w-4" />
          No backend
        </div>
      </div>
    </div>
  );
};
