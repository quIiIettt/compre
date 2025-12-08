import { NextResponse } from "next/server";
import sharp from "sharp";
import { processImageFrame } from "@/utils/algorithm";
import { encodeQOI } from "@/utils/qoi";
import { encodeHuffman } from "@/utils/huffman";
import { buildContainer } from "@/utils/container";
import { decodeContainerToImage } from "@/utils/decode";

// Minimal ImageData polyfill for Node (used by processImageFrame/decodeQOI).
if (typeof ImageData === "undefined") {
  // @ts-expect-error polyfill for server runtime
  globalThis.ImageData = class {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

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
      out[o + 3] = a;
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
  varA /= Math.max(1, count - 1);
  varB /= Math.max(1, count - 1);
  cov /= Math.max(1, count - 1);

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;

  const ssim =
    ((2 * meanA * meanB + c1) * (2 * cov + c2)) / ((meanA * meanA + meanB * meanB + c1) * (varA + varB + c2));
  return ssim;
};

const encodeDecode = async (
  rawData: Uint8ClampedArray,
  width: number,
  height: number,
  format: "png" | "jpeg" | "webp"
) => {
  const options =
    format === "png"
      ? {}
      : format === "jpeg"
        ? { quality: 90 }
        : { quality: 90 };

  const encodeStart = performance.now();
  const encoded = await sharp(rawData, { raw: { width, height, channels: 4 } })[format](options).toBuffer();
  const encodeMs = performance.now() - encodeStart;

  const decodeStart = performance.now();
  await sharp(encoded).ensureAlpha().raw().toBuffer();
  const decodeMs = performance.now() - decodeStart;

  return { encoded, encodeMs, decodeMs };
};

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const blockSize = Number(form.get("blockSize") ?? 8);
  const discardBits = Number(form.get("discardBits") ?? 0);
  const smooth = (form.get("smooth") ?? "true") === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const raw = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const imageData = new ImageData(new Uint8ClampedArray(raw.data.buffer.slice(raw.data.byteOffset, raw.data.byteOffset + raw.data.byteLength) as ArrayBuffer), raw.info.width, raw.info.height);

  const customStart = performance.now();
  const processed = processImageFrame(imageData, blockSize, discardBits, smooth);
  const residual = buildResidualImage(processed.processedImageData);
  const qoiBytes = encodeQOI(residual);
  const huffmanY = encodeHuffman(processed.nodalPointsY);
  const huffmanCb = encodeHuffman(processed.nodalPointsCb);
  const huffmanCr = encodeHuffman(processed.nodalPointsCr);
  const container = buildContainer({
    width: raw.info.width,
    height: raw.info.height,
    blockSize,
    discardBits,
    smooth,
    qoi: qoiBytes,
    huffmanY,
    huffmanCb,
    huffmanCr,
  });
  const customEncodeMs = performance.now() - customStart;

  const previewPng = await sharp(processed.processedImageData.data, {
    raw: { width: processed.processedImageData.width, height: processed.processedImageData.height, channels: 4 },
  })
    .png()
    .toBuffer();

  const [pngStats, jpegStats, webpStats] = await Promise.all([
    encodeDecode(imageData.data, imageData.width, imageData.height, "png"),
    encodeDecode(imageData.data, imageData.width, imageData.height, "jpeg"),
    encodeDecode(imageData.data, imageData.width, imageData.height, "webp"),
  ]);

  let customDecodeMs: number | null = null;
  try {
    const t = performance.now();
    decodeContainerToImage(container.buffer.slice(container.byteOffset, container.byteOffset + container.byteLength) as ArrayBuffer);
    customDecodeMs = performance.now() - t;
  } catch {
    customDecodeMs = NaN;
  }

  const psnr = computePSNR(imageData, processed.processedImageData);
  const ssim = computeSSIM(imageData, processed.processedImageData);

  return NextResponse.json({
    dimensions: { width: imageData.width, height: imageData.height },
    previewPng: previewPng.toString("base64"),
    container: Buffer.from(container).toString("base64"),
    sizes: {
      raw: imageData.width * imageData.height * 3,
      custom: container.length,
      png: pngStats.encoded.length,
      jpeg: jpegStats.encoded.length,
      webp: webpStats.encoded.length,
      qoi: qoiBytes.length,
      nodal: huffmanY.length + huffmanCb.length + huffmanCr.length,
    },
    metrics: {
      psnr,
      ssim,
    },
    timings: {
      png: { encodeMs: pngStats.encodeMs, decodeMs: pngStats.decodeMs },
      jpeg: { encodeMs: jpegStats.encodeMs, decodeMs: jpegStats.decodeMs },
      webp: { encodeMs: webpStats.encodeMs, decodeMs: webpStats.decodeMs },
      custom: { encodeMs: customEncodeMs, decodeMs: customDecodeMs },
    },
  });
}
