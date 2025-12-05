import React from 'react';
import { Image as ImageIcon, UploadCloud } from 'lucide-react';

interface Props {
  onImageSelected: (file: File) => void;
  onContainerSelected?: (file: File) => void;
}

export const ImageUploader: React.FC<Props> = ({ onImageSelected, onContainerSelected }) => {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.name.toLowerCase().endsWith('.kmr') && onContainerSelected) {
        onContainerSelected(file);
      } else {
        onImageSelected(file);
      }
    }
  };

  return (
    <label className="group relative block h-full overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900/80 to-slate-950 p-[1px] shadow-2xl backdrop-blur transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_-20px_rgba(16,185,129,0.55)]">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/15 via-transparent to-cyan-400/10 opacity-70" />
      <div className="relative flex h-full flex-col items-center justify-center gap-5 rounded-[calc(1.5rem-1px)] border border-white/10 bg-slate-900/80 px-6 py-8 text-center text-slate-100">
        <div className="flex items-center justify-center">
          <span className="rounded-2xl border border-white/10 bg-white/5 p-4 text-emerald-200 transition group-hover:scale-105">
            <UploadCloud className="h-8 w-8" />
          </span>
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold">Drag and drop or choose an image or .kmr</p>
          <p className="text-sm text-slate-300/80">
            PNG/JPG for encoding; .kmr for decoding your custom container back into the preview.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-emerald-100">
          <ImageIcon className="h-4 w-4" />
          Use at least 512x512 for a clearer comparison
        </div>
        <input
          type="file"
          accept="image/*,.kmr"
          onChange={handleFileChange}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </label>
  );
};
