import { parseContainer } from './container';
import { decodeQOI } from './qoi';
import { decodeHuffman } from './huffman';

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

const decodePaethResidual = (residual: ImageData): ImageData => {
  const { width, height, data } = residual;
  const out = new Uint8ClampedArray(data.length);
  const idx = (x: number, y: number) => (y * width + x) * 4;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = idx(x, y);
      const hasLeft = x > 0;
      const hasUp = y > 0;
      const left = hasLeft ? idx(x - 1, y) : -1;
      const up = hasUp ? idx(x, y - 1) : -1;
      const upLeft = hasLeft && hasUp ? idx(x - 1, y - 1) : -1;

      const pred = (c: 0 | 1 | 2) => {
        const A = hasLeft ? out[left + c] : 0;
        const B = hasUp ? out[up + c] : 0;
        const C = hasLeft && hasUp ? out[upLeft + c] : 0;
        return paeth(A, B, C);
      };

      out[o] = (data[o] + pred(0)) & 0xff;
      out[o + 1] = (data[o + 1] + pred(1)) & 0xff;
      out[o + 2] = (data[o + 2] + pred(2)) & 0xff;
      out[o + 3] = data[o + 3];
    }
  }

  return new ImageData(out, width, height);
};

export interface DecodedContainer {
  imageData: ImageData;
  width: number;
  height: number;
  blockSize: number;
  discardBits: number;
  smooth: boolean;
  qoiSize: number;
  nodalSize: number;
  totalSize: number;
  nodalPointsY: Uint8Array;
  nodalPointsCb: Uint8Array;
  nodalPointsCr: Uint8Array;
}

export const decodeContainerToImage = (buffer: ArrayBuffer): DecodedContainer => {
  const parsed = parseContainer(buffer);
  const { width, height, blockSize, discardBits, smooth, qoi, huffmanY, huffmanCb, huffmanCr, totalSize } = parsed;

  const gridWidth = Math.ceil(width / Math.max(2, blockSize));
  const gridHeight = Math.ceil(height / Math.max(2, blockSize));
  const nodeCount = gridWidth * gridHeight;

  const nodalPointsY = decodeHuffman(huffmanY, nodeCount);
  const nodalPointsCb = decodeHuffman(huffmanCb, nodeCount);
  const nodalPointsCr = decodeHuffman(huffmanCr, nodeCount);

  const residualImage = decodeQOI(qoi);
  if (residualImage.width !== width || residualImage.height !== height) {
    throw new Error('QOI payload dimensions do not match container header');
  }
  const reconstructed = decodePaethResidual(residualImage);

  return {
    imageData: reconstructed,
    width,
    height,
    blockSize,
    discardBits,
    smooth,
    qoiSize: qoi.length,
    nodalSize: huffmanY.length + huffmanCb.length + huffmanCr.length,
    totalSize,
    nodalPointsY,
    nodalPointsCb,
    nodalPointsCr,
  };
};
