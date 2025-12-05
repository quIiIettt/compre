// utils/algorithm.ts

// Y component (luma) and chroma conversion coefficients
const R_Y = 0.299;
const G_Y = 0.587;
const B_Y = 0.114;

export interface ProcessResult {
  processedImageData: ImageData;
  nodalPointsY: number[];
  nodalPointsCb: number[];
  nodalPointsCr: number[];
}

/**
 * Pipeline:
 * 1) RGB -> YCrCb.
 * 2) Block-average to produce nodal points (min 2x2 block).
 * 3) Optional quantization (discard lower bits) on nodal points.
 * 4) Bilinear interpolation between nodal points to build a smoothed frame.
 * 5) Return processed frame + nodal arrays (for Huffman).
 */
export const processImageFrame = (
  imageData: ImageData,
  blockSize: number = 8,
  discardBits: number = 0,
  smooth: boolean = true
): ProcessResult => {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  const block = Math.max(2, Math.floor(blockSize)); // enforce min 2x2 blocks
  const discard = Math.min(6, Math.max(0, Math.floor(discardBits)));

  const gridWidth = Math.ceil(width / block);
  const gridHeight = Math.ceil(height / block);

  const nodalY: number[] = new Array(gridWidth * gridHeight).fill(0);
  const nodalCb: number[] = new Array(gridWidth * gridHeight).fill(0);
  const nodalCr: number[] = new Array(gridWidth * gridHeight).fill(0);

  const quantize = (val: number) => {
    const rounded = Math.round(val);
    if (discard === 0) return rounded;
    return ((rounded >> discard) << discard) & 0xff;
  };

  // Step 1-3: compute nodal points
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      let sumY = 0;
      let sumCb = 0;
      let sumCr = 0;
      let count = 0;

      const xStart = gx * block;
      const yStart = gy * block;
      const xEnd = Math.min(width, xStart + block);
      const yEnd = Math.min(height, yStart + block);

      for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
          const offset = (y * width + x) * 4;
          const r = data[offset];
          const g = data[offset + 1];
          const b = data[offset + 2];

          const Y = R_Y * r + G_Y * g + B_Y * b;
          const Cb = -0.1687 * r - 0.3313 * g + 0.5 * b + 128;
          const Cr = 0.5 * r - 0.4187 * g - 0.0813 * b + 128;

          sumY += Y;
          sumCb += Cb;
          sumCr += Cr;
          count++;
        }
      }

      if (count === 0) continue;

      const avgY = quantize(sumY / count);
      const avgCb = quantize(Math.min(255, Math.max(0, sumCb / count)));
      const avgCr = quantize(Math.min(255, Math.max(0, sumCr / count)));

      const idx = gy * gridWidth + gx;
      nodalY[idx] = avgY;
      nodalCb[idx] = avgCb;
      nodalCr[idx] = avgCr;
    }
  }

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  // Step 4: reconstruct frame (or keep original for truly lossless view)
  const outputData = new Uint8ClampedArray(data.length);
  if (discard === 0) {
    // No quantization: keep original pixels to avoid blur.
    outputData.set(data);
  } else if (!smooth) {
    // Fill each block with its nodal value (no smoothing).
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const idx = gy * gridWidth + gx;
        const Yv = nodalY[idx];
        const Cbv = nodalCb[idx] - 128;
        const Crv = nodalCr[idx] - 128;

        const r = Yv + 1.402 * Crv;
        const g = Yv - 0.34414 * Cbv - 0.71414 * Crv;
        const b = Yv + 1.772 * Cbv;

        const xStart = gx * block;
        const yStart = gy * block;
        const xEnd = Math.min(width, xStart + block);
        const yEnd = Math.min(height, yStart + block);

        for (let y = yStart; y < yEnd; y++) {
          for (let x = xStart; x < xEnd; x++) {
            const offset = (y * width + x) * 4;
            outputData[offset] = Math.min(255, Math.max(0, r));
            outputData[offset + 1] = Math.min(255, Math.max(0, g));
            outputData[offset + 2] = Math.min(255, Math.max(0, b));
            outputData[offset + 3] = 255;
          }
        }
      }
    }
  } else {
    for (let y = 0; y < height; y++) {
      const gy = Math.floor(y / block);
      const gy1 = Math.min(gy + 1, gridHeight - 1);
      const y0 = gy * block;
      const y1 = Math.min(height - 1, (gy + 1) * block);
      const ty = y1 === y0 ? 0 : (y - y0) / (y1 - y0);

      for (let x = 0; x < width; x++) {
        const gx = Math.floor(x / block);
        const gx1 = Math.min(gx + 1, gridWidth - 1);
        const x0 = gx * block;
        const x1 = Math.min(width - 1, (gx + 1) * block);
        const tx = x1 === x0 ? 0 : (x - x0) / (x1 - x0);

        const idx00 = gy * gridWidth + gx;
        const idx10 = gy * gridWidth + gx1;
        const idx01 = gy1 * gridWidth + gx;
        const idx11 = gy1 * gridWidth + gx1;

        const yTopY = lerp(nodalY[idx00], nodalY[idx10], tx);
        const yBotY = lerp(nodalY[idx01], nodalY[idx11], tx);
        const yVal = lerp(yTopY, yBotY, ty);

        const yTopCb = lerp(nodalCb[idx00], nodalCb[idx10], tx);
        const yBotCb = lerp(nodalCb[idx01], nodalCb[idx11], tx);
        const cbVal = lerp(yTopCb, yBotCb, ty) - 128;

        const yTopCr = lerp(nodalCr[idx00], nodalCr[idx10], tx);
        const yBotCr = lerp(nodalCr[idx01], nodalCr[idx11], tx);
        const crVal = lerp(yTopCr, yBotCr, ty) - 128;

        const r = yVal + 1.402 * crVal;
        const g = yVal - 0.34414 * cbVal - 0.71414 * crVal;
        const b = yVal + 1.772 * cbVal;

        const offset = (y * width + x) * 4;
        outputData[offset] = Math.min(255, Math.max(0, r));
        outputData[offset + 1] = Math.min(255, Math.max(0, g));
        outputData[offset + 2] = Math.min(255, Math.max(0, b));
        outputData[offset + 3] = 255;
      }
    }
  }

  return {
    processedImageData: new ImageData(outputData, width, height),
    nodalPointsY: nodalY,
    nodalPointsCb: nodalCb,
    nodalPointsCr: nodalCr,
  };
};
