#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const RLE_MARKER = 0xff;
const CONTAINER_MAGIC = 'KMR1';

class ImageData {
  constructor(data, width, height) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const parseContainer = (buffer) => {
  const view = new DataView(buffer);
  let offset = 0;

  let magic = '';
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(view.getUint8(offset++));
  if (magic !== CONTAINER_MAGIC) throw new Error('Invalid container magic');

  const version = view.getUint8(offset++);
  if (version !== 1) throw new Error(`Unsupported version ${version}`);

  const blockSize = view.getUint8(offset++);
  const discardBits = view.getUint8(offset++);
  const smooth = view.getUint8(offset++) === 1;

  const width = view.getUint32(offset, false);
  offset += 4;
  const height = view.getUint32(offset, false);
  offset += 4;

  const qoiLen = view.getUint32(offset, false);
  offset += 4;
  const yLen = view.getUint32(offset, false);
  offset += 4;
  const cbLen = view.getUint32(offset, false);
  offset += 4;
  const crLen = view.getUint32(offset, false);
  offset += 4;

  const bytes = new Uint8Array(buffer);
  const qoi = bytes.slice(offset, offset + qoiLen);
  offset += qoiLen;
  const huffmanY = bytes.slice(offset, offset + yLen);
  offset += yLen;
  const huffmanCb = bytes.slice(offset, offset + cbLen);
  offset += cbLen;
  const huffmanCr = bytes.slice(offset, offset + crLen);

  return { width, height, blockSize, discardBits, smooth, qoi, huffmanY, huffmanCb, huffmanCr };
};

const decodeHuffman = (data, expectedLength) => {
  if (data.length === 0 || expectedLength === 0) return [];
  const count = data[0];
  let p = 1;
  const codeLens = [];
  for (let i = 0; i < count; i++) {
    const symbol = data[p++];
    const len = data[p++];
    codeLens.push({ symbol, len });
  }
  codeLens.sort((a, b) => (a.len === b.len ? a.symbol - b.symbol : a.len - b.len));

  const lenMap = new Map();
  let code = 0;
  let prevLen = codeLens[0].len;
  for (let i = 0; i < codeLens.length; i++) {
    const { symbol, len } = codeLens[i];
    if (i > 0) code = (code + 1) << (len - prevLen);
    if (!lenMap.has(len)) lenMap.set(len, new Map());
    lenMap.get(len).set(code, symbol);
    prevLen = len;
  }

  const rleStream = [];
  let bitPos = p * 8;
  let currentCode = 0;
  let currentLen = 0;
  const readBit = (i) => {
    const byteIndex = Math.floor(i / 8);
    const bitInByte = 7 - (i % 8);
    return (data[byteIndex] >> bitInByte) & 1;
  };
  while (bitPos < data.length * 8 && rleStream.length < expectedLength * 2) {
    currentCode = (currentCode << 1) | readBit(bitPos++);
    currentLen++;
    const bucket = lenMap.get(currentLen);
    if (bucket && bucket.has(currentCode)) {
      rleStream.push(bucket.get(currentCode));
      currentCode = 0;
      currentLen = 0;
    }
  }

  const outRle = [];
  for (let i = 0; i < rleStream.length; i++) {
    const val = rleStream[i];
    if (val === RLE_MARKER) {
      const run = rleStream[++i];
      const value = rleStream[++i];
      for (let r = 0; r < run; r++) outRle.push(value);
    } else {
      outRle.push(val);
    }
  }

  const out = [];
  let prev = 0;
  for (let i = 0; i < outRle.length && out.length < expectedLength; i++) {
    const diff = (outRle[i] - 128) << 24 >> 24;
    const val = Math.min(255, Math.max(0, prev + diff));
    out.push(val);
    prev = val;
  }
  if (out.length < expectedLength) throw new Error('Decoded Huffman shorter than expected');
  return out.slice(0, expectedLength);
};

const qoiHash = (r, g, b, a) => (r * 3 + g * 5 + b * 7 + a * 11) % 64;

const decodeQOI = (bytes) => {
  let p = 0;
  const magic = String.fromCharCode(bytes[p++], bytes[p++], bytes[p++], bytes[p++]);
  if (magic !== 'qoif') throw new Error('Invalid QOI magic');
  const width = (bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
  const height = (bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
  const channels = bytes[p++];
  p++; // colorspace
  if (channels !== 4) throw new Error('Only RGBA supported');

  const index = new Uint8Array(64 * 4);
  let px_r = 0, px_g = 0, px_b = 0, px_a = 255;
  let run = 0;
  const pixels = new Uint8ClampedArray(width * height * 4);
  let pxPos = 0;
  while (pxPos < pixels.length && p < bytes.length - 8) {
    if (run > 0) {
      run--;
    } else {
      const b1 = bytes[p++];
      if (b1 === 0xfe) {
        px_r = bytes[p++]; px_g = bytes[p++]; px_b = bytes[p++];
      } else if (b1 === 0xff) {
        px_r = bytes[p++]; px_g = bytes[p++]; px_b = bytes[p++]; px_a = bytes[p++];
      } else {
        const tag = b1 & 0xc0;
        if (tag === 0x00) {
          const idx = (b1 & 0x3f) * 4;
          px_r = index[idx]; px_g = index[idx + 1]; px_b = index[idx + 2]; px_a = index[idx + 3];
        } else if (tag === 0x40) {
          px_r = (px_r + ((b1 >> 4) & 0x03) - 2 + 256) & 0xff;
          px_g = (px_g + ((b1 >> 2) & 0x03) - 2 + 256) & 0xff;
          px_b = (px_b + (b1 & 0x03) - 2 + 256) & 0xff;
        } else if (tag === 0x80) {
          const b2 = bytes[p++];
          const vg = (b1 & 0x3f) - 32;
          const dr = ((b2 >> 4) & 0x0f) - 8;
          const db = (b2 & 0x0f) - 8;
          px_r = (px_r + vg + dr + 256) & 0xff;
          px_g = (px_g + vg + 256) & 0xff;
          px_b = (px_b + vg + db + 256) & 0xff;
        } else if (tag === 0xc0) {
          run = (b1 & 0x3f);
        }
      }
      const indexPos = qoiHash(px_r, px_g, px_b, px_a) * 4;
      index[indexPos] = px_r; index[indexPos + 1] = px_g; index[indexPos + 2] = px_b; index[indexPos + 3] = px_a;
    }
    pixels[pxPos++] = px_r;
    pixels[pxPos++] = px_g;
    pixels[pxPos++] = px_b;
    pixels[pxPos++] = px_a;
  }
  return new ImageData(pixels, width, height);
};

const decodePaethResidual = (residual) => {
  const { width, height, data } = residual;
  const out = new Uint8ClampedArray(data.length);
  const idx = (x, y) => (y * width + x) * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = idx(x, y);
      const hasLeft = x > 0;
      const hasUp = y > 0;
      const left = hasLeft ? idx(x - 1, y) : -1;
      const up = hasUp ? idx(x, y - 1) : -1;
      const upLeft = hasLeft && hasUp ? idx(x - 1, y - 1) : -1;
      const pred = (c) => {
        const A = hasLeft ? out[left + c] : 0;
        const B = hasUp ? out[up + c] : 0;
        const C = hasLeft && hasUp ? out[upLeft + c] : 0;
        const p = A + B - C;
        const pa = Math.abs(p - A);
        const pb = Math.abs(p - B);
        const pc = Math.abs(p - C);
        if (pa <= pb && pa <= pc) return A;
        if (pb <= pc) return B;
        return C;
      };
      out[o] = (data[o] + pred(0)) & 0xff;
      out[o + 1] = (data[o + 1] + pred(1)) & 0xff;
      out[o + 2] = (data[o + 2] + pred(2)) & 0xff;
      out[o + 3] = data[o + 3];
    }
  }
  return new ImageData(out, width, height);
};

const decodeContainer = (buf) => {
  const parsed = parseContainer(buf);
  const gridW = Math.ceil(parsed.width / Math.max(2, parsed.blockSize));
  const gridH = Math.ceil(parsed.height / Math.max(2, parsed.blockSize));
  const count = gridW * gridH;

  const nodalY = decodeHuffman(parsed.huffmanY, count);
  const nodalCb = decodeHuffman(parsed.huffmanCb, count);
  const nodalCr = decodeHuffman(parsed.huffmanCr, count);

  const residual = decodeQOI(parsed.qoi);
  if (residual.width !== parsed.width || residual.height !== parsed.height) {
    throw new Error('QOI dimensions mismatch');
  }
  const decoded = decodePaethResidual(residual);
  return { ...parsed, nodalY, nodalCb, nodalCr, imageData: decoded };
};

const main = async () => {
  const [, , arg1, arg2] = process.argv;
  if (!arg1 || arg1 === '--help' || arg1 === '-h') {
    console.log('Usage: node scripts/decode-kmr.js <file.kmr> [output.png]');
    process.exit(0);
  }
  const inputPath = arg1;
  const outputPath = arg2 || 'decoded.png';
  const buf = fs.readFileSync(inputPath);
  const decoded = decodeContainer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

  console.log(`Decoded ${path.basename(inputPath)}`);
  console.log(`  Dimensions: ${decoded.width}x${decoded.height}`);
  console.log(`  Block/discard/smooth: ${decoded.blockSize}px / ${decoded.discardBits} bits / ${decoded.smooth}`);
  console.log(`  Sizes (bytes): custom=${buf.length}, qoi=${decoded.qoi.length}, nodal=${decoded.huffmanY.length + decoded.huffmanCb.length + decoded.huffmanCr.length}`);

  await sharp(Buffer.from(decoded.imageData.data.buffer), {
    raw: { width: decoded.width, height: decoded.height, channels: 4 },
  })
    .png()
    .toFile(outputPath);

  console.log(`  Wrote preview: ${outputPath}`);
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
