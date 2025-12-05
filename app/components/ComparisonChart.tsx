// components/ComparisonChart.tsx
import React from 'react';

interface Props {
  rawSize: number;
  mySize: number;
  jpegSize: number;
  pngSize: number;
}

export const ComparisonChart: React.FC<Props> = ({ rawSize, mySize, jpegSize, pngSize }) => {
  // Знаходимо максимальне значення для масштабування графіка (зазвичай це Raw, але беремо з запасом)
  const maxVal = Math.max(rawSize, mySize, jpegSize, pngSize);

  const getWidth = (val: number) => {
    return `${Math.max(1, (val / maxVal) * 100)}%`;
  };

  const formatSize = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

  return (
    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 w-full">
      <h3 className="text-sm font-bold text-slate-500 uppercase mb-6">Порівняння ефективності (Менше - краще)</h3>
      
      <div className="space-y-5">
        {/* RAW */}
        <div className="relative">
          <div className="flex justify-between text-xs font-medium text-slate-500 mb-1">
            <span>Raw RGB (Нестиснутий)</span>
            <span>{formatSize(rawSize)}</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div style={{ width: '100%' }} className="h-full bg-slate-300"></div>
          </div>
        </div>

        {/* PNG */}
        <div className="relative">
          <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
            <span>PNG (Lossless)</span>
            <span>{formatSize(pngSize)}</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div style={{ width: getWidth(pngSize) }} className="h-full bg-blue-400 rounded-full"></div>
          </div>
        </div>

        {/* JPEG */}
        <div className="relative">
          <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
            <span>JPEG (Standard Lossy)</span>
            <span>{formatSize(jpegSize)}</span>
          </div>
          <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
            <div style={{ width: getWidth(jpegSize) }} className="h-full bg-orange-400 rounded-full"></div>
          </div>
        </div>

        {/* ВАШ МЕТОД */}
        <div className="relative">
          <div className="flex justify-between text-sm font-bold text-emerald-700 mb-1">
            <span>Ваш метод (KMR Hybrid)</span>
            <span>{formatSize(mySize)}</span>
          </div>
          <div className="h-4 bg-emerald-100 rounded-full overflow-hidden border border-emerald-200 shadow-inner">
            <div 
              style={{ width: getWidth(mySize) }} 
              className="h-full bg-emerald-500 rounded-full relative transition-all duration-500"
            >
                {/* Блік для краси */}
                <div className="absolute top-0 right-0 bottom-0 w-1 bg-white/30"></div>
            </div>
          </div>
          <p className="text-xs text-emerald-600 mt-1 text-right">
            {mySize < pngSize ? "Ефективніше за PNG!" : ""}
          </p>
        </div>
      </div>
    </div>
  );
};