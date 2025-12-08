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
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  type CardData = {
    title: string;
    value: string;
    subValue: string;
    icon: React.ElementType;
    color: 'violet' | 'blue' | 'fuchsia';
  };

  const statCards: CardData[] = [
    {
      title: 'Compression Ratio',
      value: `${ratio.toFixed(2)}x`,
      subValue: savings > 0 ? `Saved ${savings.toFixed(1)}%` : ' ',
      icon: Gauge,
      color: 'violet',
    },
    {
      title: 'Compressed Size',
      value: formatBytes(estimatedCompressedSize),
      subValue: `Raw: ${formatBytes(originalSize)}`,
      icon: HardDrive,
      color: 'blue',
    },
    {
      title: 'Processing Time',
      value: `${time.toFixed(0)}ms`,
      subValue: 'Client-side JS',
      icon: Timer,
      color: 'fuchsia',
    },
  ];

  const textColors = {
    violet: 'text-violet-600',
    blue: 'text-blue-600',
    fuchsia: 'text-fuchsia-600',
  };

  const ringColors = {
    violet: 'ring-violet-300/70',
    blue: 'ring-blue-300/70',
    fuchsia: 'ring-fuchsia-300/70',
  };

  return (
    <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-3">
      {statCards.map((card) => (
        <div
          key={card.title}
          className="relative flex flex-col justify-center overflow-hidden rounded-3xl border border-slate-200/80 bg-white/70 p-6 shadow-lg backdrop-blur-md"
        >
          <div className="flex items-center gap-4">
            <div
              className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white shadow-inner shadow-slate-200/80 ring-1 ${
                ringColors[card.color]
              }`}
            >
              <card.icon className={`h-6 w-6 ${textColors[card.color]}`} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-600">{card.title}</p>
              <p className={`truncate text-2xl font-bold ${textColors[card.color]}`}>{card.value}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-500">{card.subValue}</p>
        </div>
      ))}
    </div>
  );
};
