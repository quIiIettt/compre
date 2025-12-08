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
    <label className="group relative block h-full cursor-pointer overflow-hidden rounded-3xl border border-slate-200/80 bg-white/60 p-1 shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:shadow-xl">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-300/20 via-transparent to-blue-300/20 opacity-70" />
      <div className="relative flex h-full flex-col items-center justify-center gap-5 rounded-[calc(1.5rem-1px)] border border-white/70 bg-white/80 px-6 py-8 text-center">
        <div className="flex items-center justify-center">
          <span className="rounded-2xl border border-white/70 bg-violet-100 p-4 text-violet-600 transition group-hover:scale-105">
            <UploadCloud className="h-8 w-8" />
          </span>
        </div>
        <div className="space-y-1">
          <p className="text-lg font-semibold text-slate-800">Choose an image or .kmr file</p>
          <p className="text-sm text-slate-500">Drag & drop or click to upload</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-200/80 bg-violet-100 px-3 py-2 text-xs font-semibold text-violet-700">
          <ImageIcon className="h-4 w-4" />
          Supports PNG, JPG, and KMR files
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
