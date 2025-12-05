export const CONTAINER_MAGIC = 'KMR1';
export const CONTAINER_EXTENSION = '.kmr';

export interface ContainerInput {
  width: number;
  height: number;
  blockSize: number;
  discardBits: number;
  smooth: boolean;
  qoi: Uint8Array;
  huffmanY: Uint8Array;
  huffmanCb: Uint8Array;
  huffmanCr: Uint8Array;
}

const HEADER_SIZE = 32; // 4 magic + 1 version + 3 control bytes + 2x uint32 + 4x uint32 lengths

export const buildContainer = ({
  width,
  height,
  blockSize,
  discardBits,
  smooth,
  qoi,
  huffmanY,
  huffmanCb,
  huffmanCr,
}: ContainerInput): Uint8Array => {
  const block = Math.max(2, Math.min(255, Math.floor(blockSize)));
  const discard = Math.max(0, Math.min(255, Math.floor(discardBits)));

  const totalSize = HEADER_SIZE + qoi.length + huffmanY.length + huffmanCb.length + huffmanCr.length;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  for (let i = 0; i < CONTAINER_MAGIC.length; i++) {
    view.setUint8(offset++, CONTAINER_MAGIC.charCodeAt(i));
  }

  view.setUint8(offset++, 1); // version
  view.setUint8(offset++, block);
  view.setUint8(offset++, discard);
  view.setUint8(offset++, smooth ? 1 : 0);

  view.setUint32(offset, width, false);
  offset += 4;
  view.setUint32(offset, height, false);
  offset += 4;

  view.setUint32(offset, qoi.length, false);
  offset += 4;
  view.setUint32(offset, huffmanY.length, false);
  offset += 4;
  view.setUint32(offset, huffmanCb.length, false);
  offset += 4;
  view.setUint32(offset, huffmanCr.length, false);
  offset += 4;

  const out = new Uint8Array(buffer);
  let payloadOffset = HEADER_SIZE;
  out.set(qoi, payloadOffset);
  payloadOffset += qoi.length;
  out.set(huffmanY, payloadOffset);
  payloadOffset += huffmanY.length;
  out.set(huffmanCb, payloadOffset);
  payloadOffset += huffmanCb.length;
  out.set(huffmanCr, payloadOffset);

  return out;
};

export interface ParsedContainer {
  version: number;
  width: number;
  height: number;
  blockSize: number;
  discardBits: number;
  smooth: boolean;
  qoi: Uint8Array;
  huffmanY: Uint8Array;
  huffmanCb: Uint8Array;
  huffmanCr: Uint8Array;
  totalSize: number;
}

export const parseContainer = (buffer: ArrayBuffer): ParsedContainer => {
  const view = new DataView(buffer);
  let offset = 0;

  let magic = '';
  for (let i = 0; i < 4; i++) {
    magic += String.fromCharCode(view.getUint8(offset++));
  }
  if (magic !== CONTAINER_MAGIC) {
    throw new Error('Invalid container magic');
  }

  const version = view.getUint8(offset++);
  if (version !== 1) {
    throw new Error(`Unsupported container version: ${version}`);
  }

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

  return {
    version,
    width,
    height,
    blockSize,
    discardBits,
    smooth,
    qoi,
    huffmanY,
    huffmanCb,
    huffmanCr,
    totalSize: bytes.length,
  };
};
