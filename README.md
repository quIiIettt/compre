# Compression Demo (Diploma Guide)

In-browser playground that demonstrates a hybrid image codec: YCrCb conversion, block-wise nodal extraction, optional quantization, bilinear/block reconstruction, Paeth residuals, QOI for the texture, and canonical Huffman for nodal metadata. Built with Next.js; all processing happens client-side.

## High-level pipeline
```
Upload -> RGBA -> YCrCb -> block averages (nodes) -> optional quantization
        -> reconstruction (bilinear or flat blocks) -> Paeth residuals
        -> QOI encode (texture) + delta/RLE + Huffman (nodes) -> size stats
```

## Algorithm steps (detail)
1) **RGB → YCrCb decorrelation**
   - Y = 0.299R + 0.587G + 0.114B
   - Cb = -0.1687R - 0.3313G + 0.5B + 128
   - Cr = 0.5R - 0.4187G - 0.0813B + 128
   - Purpose: separate luma from chroma to reduce inter-channel correlation.

2) **Block partitioning and nodal points**
   - Image is split into tiles of `blockSize x blockSize` (min 2x2).
   - For each block: average Y, Cb, Cr → nodal point (skeleton of the frame).
   - Stores three grids: nodalPointsY/Cb/Cr of size `ceil(W/block) * ceil(H/block)`.

3) **Optional quantization (discardBits 0–6)**
   - Low bits of each nodal component are dropped: `(value >> discardBits) << discardBits`.
   - `discardBits = 0` keeps perfect fidelity; higher values coarsen nodes but reduce entropy.

4) **Frame reconstruction for preview**
   - If `discardBits = 0`: the original pixels are kept (true lossless view).
   - If `discardBits > 0` and smoothing is **on**: bilinear interpolation between four neighboring nodes per pixel (reduces banding, but adds entropy).
   - If smoothing is **off**: flat fill per block from its nodal value (lower entropy, more blockiness).
   - Reconstructed YCrCb is converted back to RGB for display.

5) **Residual formation (Paeth predictor)**
   - On the reconstructed RGB frame, apply a Paeth predictor per channel (left/up/upleft) to produce residuals; alpha is passed through.
   - Residuals lower entropy for QOI.

6) **Texture compression (QOI)**
   - Residual image is fed into `encodeQOI` (reference implementation in `app/utils/qoi.ts`): uses index, diff, luma, run-length, and RGB ops to produce a compact byte stream with O(n) time.

7) **Nodal stream compression (delta + RLE + canonical Huffman)**
   - Nodal arrays are delta-encoded (prev to current), then run-length encoded for repeated bytes; a canonical Huffman codebook is built over the RLE output; bits are packed after a compact header (symbol + codelen pairs).
   - Purpose: give short codes to frequent nodal deltas while staying simple to implement.

8) **Payload estimation**
   - Final simulated size = `QOI bytes + Huffman(nodal Y) + Huffman(nodal Cb) + Huffman(nodal Cr)`.
   - Live stats show QOI vs Huffman breakdown, compression ratio, runtime, and PNG/JPEG baselines.

## User controls
- **Block size (2–32 px)**: sets nodal grid resolution; smaller blocks = more nodes, less blocking, higher entropy; larger blocks = fewer nodes, more blocking, lower entropy.
- **Discard lower bits (0–6)**: quantizes nodal values; 0 is lossless; higher values increase compression but risk banding (mitigated by smoothing).
- **Smoothing toggle**: when on and discardBits>0, bilinear interpolation between nodes reduces banding but raises entropy; when off, blocks stay flat (smaller size, more block edges).

## Files and roles
- `app/page.tsx` — UI orchestration, canvas pipeline, Paeth residuals, QOI + Huffman sizing, controls.
- `app/utils/algorithm.ts` — YCrCb conversion, block nodal extraction, optional quantization, reconstruction (bilinear or flat).
- `app/utils/qoi.ts` — QOI encoder used on the residual image.
- `app/utils/huffman.ts` — delta + RLE + canonical Huffman bit packing for nodal streams.
- `app/components/*` — uploader, stats panel, charts, UI elements.
- `stm32/` — unrelated firmware assets.

## Practical guidance / presets
- **Lossless visual & best ratio**: `discardBits = 0`, smoothing irrelevant → no artifacts; Paeth+QOI still compresses residuals.
- **Higher compression, minimal banding**: `discardBits = 1–2`, smoothing ON, block size 4–8.
- **Max compression, accept blocks**: `discardBits = 2–4`, smoothing OFF, block size 8–16.

## Running locally
- Prerequisites: Node.js 18+ and npm.
- Install: `npm install`
- Dev server: `npm run dev` then open http://localhost:3000
- Production: `npm run build` then `npm start`

## Extension ideas (future work)
- Add a decoder path for round-trip verification and bit-exact payload parsing.
- Try reversible predictors on nodal grids (left/up/avg/Paeth) before Huffman.
- Add reversible chroma subsampling modes (4:4:4 vs reversible 4:2:0).
- Support alternative entropy coders (range/ANS) for nodal streams.
- Add automated PSNR/SSIM metrics for near-lossless experiments.

## Notes and limitations
- All processing is client-side; very large images may be slow or memory-heavy.
- PNG/JPEG references use browser encoders via `canvas.toDataURL` (when backend is unavailable).
- Server-side path (Next API) uses `sharp` for PNG/JPEG/WebP baselines and to run the custom codec off the UI thread; if the API is unreachable, the app falls back to the original client-only simulation.
- Custom container `.kmr` packs: header (magic/version/settings/dims/section lengths) + QOI residuals + three Huffman nodal streams. Decoder path is available for preview but not yet exposed as a standalone CLI.

## ASCII schemes

### End-to-end flow
```
[Image Upload]
      |
      v
[Canvas RGBA]
      |
      v
[YCrCb convert]
      |
      v
[Block averages (nodes)]
      |
      |-- optional discard bits (quantize nodes)
      |
      v
[Reconstruct frame]
    |      |
    |      +-- smoothing ON  -> bilinear between nodes
    |      +-- smoothing OFF -> flat blocks
    v
[Paeth residuals on RGB]
      |
      v
[QOI encode residual image] ----+
                               |
[Delta + RLE + Huffman on nodes]+--> [Simulated container size = QOI + Huffman streams]
```

## Features added in UI
- WebP baseline in size chart (alongside PNG/JPEG/custom).
- PSNR/SSIM readout and clickable difference heatmap between original and preview.
- Downloads: custom `.kmr`, preview PNG/JPEG, heatmap PNG, JSON summary of settings/sizes/metrics.
- Lightbox zoom on previews for detailed inspection.
- Codec timings card (encode/decode) for PNG/JPEG/WebP/custom; with backend enabled, times come from server-side `sharp` + codec, otherwise from in-browser measurement.

## Backend compression API (Node/Next)
- Route: `POST /api/compress`
- Body: `form-data` with fields `file` (image), `blockSize`, `discardBits`, `smooth` (true/false).
- Response: JSON containing base64 `previewPng`, base64 `container`, sizes (raw/custom/png/jpeg/webp/qoi/nodal), timings for each codec (encode/decode), and PSNR.
- Implementation uses `sharp` for decoding/encoding and the same custom codec modules as the client.
- If backend is unavailable, the client automatically falls back to the client-only path.

### Nodal grid vs blocks (top view)
```
Pixels (width x height)
+-----------------------------+
| blk(0,0) | blk(1,0) | ...   |
|          |          |       |
|----------+----------+-------|
| blk(0,1) | blk(1,1) | ...   |
|          |          |       |
|----------+----------+-------|
|    ...   |   ...    | ...   |
+-----------------------------+

Nodes stored as a grid:
node[gx, gy] = avg(Y,Cb,Cr) over blk(gx, gy)
Grid size = ceil(W/block) x ceil(H/block)
```

### Huffman prep for nodes
```
Nodal stream (Y or Cb or Cr)
      |
      v
[Delta encode]  (curr - prev, clamped to -128..127, biased +128)
      |
      v
[Run-Length Encode] (RLE_MARKER=0xFF used to store runs)
      |
      v
[Freq table] -> [Canonical Huffman code lengths]
      |
      v
[Pack bits] with tiny header: count, (symbol,len) pairs, then payload bits
```
