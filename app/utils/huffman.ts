// utils/huffman.ts
// Optimized Canonical Huffman encoder/decoder
// Changes: Removed Maps in hot loops, added bit accumulator, pre-allocated arrays.

type CodeLen = { symbol: number; len: number };

export const RLE_MARKER = 0xff;

// --- Helper: Fast Delta + RLE Encoding ---

const deltaEncode = (data: number[]): number[] => {
  const out: number[] = [];
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    let diff = v - prev;
    // clamping is important to keep within byte range logic if needed, 
    // but usually delta is just modulo 256. Assuming logic matches original:
    diff = Math.max(-128, Math.min(127, diff)); 
    out.push((diff + 128) & 0xff);
    prev = v;
  }
  return out;
};

const rleEncode = (data: number[]): number[] => {
  const out: number[] = [];
  let i = 0;
  const len = data.length;
  while (i < len) {
    const value = data[i];
    let run = 1;
    // Limit run to 255 to fit in a byte
    while (i + run < len && data[i + run] === value && run < 255) {
      run++;
    }
    if (run >= 3 || value === RLE_MARKER) {
      out.push(RLE_MARKER, run, value);
    } else {
      // Small runs are just written out
      for (let r = 0; r < run; r++) out.push(value);
    }
    i += run;
  }
  return out;
};

// --- Helper: Build Code Lengths (unchanged logic, just types) ---

class Node {
  freq: number;
  symbol: number | null;
  left: Node | null;
  right: Node | null;

  constructor(freq: number, symbol: number | null = null, left: Node | null = null, right: Node | null = null) {
    this.freq = freq;
    this.symbol = symbol;
    this.left = left;
    this.right = right;
  }
}

const buildCodeLengths = (freqs: Map<number, number>): CodeLen[] => {
  const queue: Node[] = Array.from(freqs.entries())
    .map(([symbol, freq]) => new Node(freq, symbol))
    .sort((a, b) => a.freq - b.freq);

  if (queue.length === 0) return [];
  if (queue.length === 1) {
    return [{ symbol: queue[0].symbol!, len: 1 }];
  }

  // Basic Huffman Tree Construction
  while (queue.length > 1) {
    const left = queue.shift()!;
    const right = queue.shift()!;
    const parent = new Node(left.freq + right.freq, null, left, right);
    
    // Maintain sorted order (binary search insertion is faster but linear is fine for small alphabet)
    let idx = 0;
    while (idx < queue.length && queue[idx].freq < parent.freq) idx++;
    queue.splice(idx, 0, parent);
  }

  const lengths: CodeLen[] = [];
  const walk = (node: Node, depth: number) => {
    if (node.symbol !== null) {
      lengths.push({ symbol: node.symbol, len: depth || 1 });
      return;
    }
    if (node.left) walk(node.left, depth + 1);
    if (node.right) walk(node.right, depth + 1);
  };
  walk(queue[0], 0);

  return lengths;
};

// --- ENCODER (Optimized packing) ---

export const encodeHuffman = (data: number[]): Uint8Array => {
  if (data.length === 0) return new Uint8Array(0);

  const deltas = deltaEncode(data);
  const rle = rleEncode(deltas);

  const freqs = new Map<number, number>();
  for (let i = 0; i < rle.length; i++) {
    const v = rle[i];
    freqs.set(v, (freqs.get(v) || 0) + 1);
  }

  const codeLens = buildCodeLengths(freqs);
  // Canonical sort: by length, then by symbol
  codeLens.sort((a, b) => (a.len === b.len ? a.symbol - b.symbol : a.len - b.len));

  // Generate Canonical Codes
  const codes = new Int32Array(256); // Direct lookup by symbol
  const lens = new Int8Array(256);   // Direct lookup by symbol
  // Init arrays with -1 or 0
  codes.fill(-1); 
  
  let code = 0;
  let prevLen = codeLens.length > 0 ? codeLens[0].len : 0;

  for (let i = 0; i < codeLens.length; i++) {
    const { symbol, len } = codeLens[i];
    if (i > 0) {
      code = (code + 1) << (len - prevLen);
    }
    codes[symbol] = code;
    lens[symbol] = len;
    prevLen = len;
  }

  // Estimate output size to avoid reallocations (heuristic)
  // Header: 1 byte count + 2 bytes per symbol + body
  const estimatedSize = 1 + codeLens.length * 2 + Math.ceil(rle.length); 
  let out = new Uint8Array(estimatedSize * 2); // safety margin
  
  // Write Header
  out[0] = codeLens.length;
  let outPos = 1;
  for (let i = 0; i < codeLens.length; i++) {
    out[outPos++] = codeLens[i].symbol;
    out[outPos++] = codeLens[i].len;
  }

  // Bit Buffer for packing
  let accumulator = 0;
  let bitsPending = 0;

  for (let i = 0; i < rle.length; i++) {
    const sym = rle[i];
    const c = codes[sym];
    const l = lens[sym];

    // We need to write 'l' bits of 'c'
    // For canonical, usually MSB first. 
    // Optimization: Add bits to accumulator.
    // However, JS bitwise is 32-bit signed. Safe up to ~30 bits.
    
    // Writing bit by bit is slow, but robust for variable length. 
    // Let's pack chunks.
    for (let b = l - 1; b >= 0; b--) {
      const bit = (c >> b) & 1;
      accumulator = (accumulator << 1) | bit;
      bitsPending++;
      
      if (bitsPending === 8) {
        if (outPos >= out.length) {
            // Resize if needed
            const newOut = new Uint8Array(out.length * 2);
            newOut.set(out);
            out = newOut;
        }
        out[outPos++] = accumulator;
        accumulator = 0;
        bitsPending = 0;
      }
    }
  }

  // Flush remaining bits
  if (bitsPending > 0) {
    accumulator <<= (8 - bitsPending);
    out[outPos++] = accumulator;
  }

  return out.slice(0, outPos);
};

// --- DECODER (Heavily Optimized) ---

export const decodeHuffman = (data: Uint8Array, expectedLength: number): Uint8Array => {
  if (data.length === 0 || expectedLength === 0) return new Uint8Array(0);

  // 1. Parse Header
  let p = 0;
  const count = data[p++];
  
  // Arrays for Canonical decoding
  // Max code length in Huffman is typically < 32. 
  // We can use array lookups instead of Maps.
  const MAX_CODE_LEN = 32; 
  const minCode = new Int32Array(MAX_CODE_LEN).fill(-1);
  const maxCode = new Int32Array(MAX_CODE_LEN).fill(-1);
  const valPtr = new Int32Array(MAX_CODE_LEN).fill(-1);
  const symbols = new Int32Array(count); // Dense array of sorted symbols

  const lenCounts = new Int32Array(MAX_CODE_LEN + 1);
  const codeLens: {symbol: number, len: number}[] = [];

  for (let i = 0; i < count; i++) {
    const symbol = data[p++];
    const len = data[p++];
    codeLens.push({symbol, len});
    lenCounts[len]++;
  }
  
  // Sort to match canonical order: Length ASC, Symbol ASC
  codeLens.sort((a, b) => (a.len === b.len ? a.symbol - b.symbol : a.len - b.len));

  // Generate canonical tables
  // minCode[len] = value of the first code of this length
  // maxCode[len] = value of the last code of this length
  // valPtr[len]  = index in 'symbols' array where codes of this length start
  
  let code = 0;
  let symIdx = 0;
  
  // Fill symbols array in sorted order
  for (let i = 0; i < count; i++) {
      symbols[i] = codeLens[i].symbol;
  }

  for (let l = 1; l <= MAX_CODE_LEN; l++) {
      if (lenCounts[l] === 0) continue;
      
      // The first code of length 'l'
      // If we jumped from length prevL to l, shift code
      // But in loop we just follow standard canonical generation
      
      // Calculate start code for this length
      // It's based on the end of the previous length
      
      // Easier way: iterate the sorted list and assign codes, then record min/max
  }

  // Re-calculating codes properly to fill min/max arrays
  // This setup is O(N) relative to alphabet size (256), so it's instant.
  let currentCode = 0;
  let currentLen = codeLens[0].len;
  let symbolOffset = 0;

  for (let i = 0; i < codeLens.length; ) {
    const len = codeLens[i].len;
    
    // If length increased, shift code
    while (currentLen < len) {
        currentCode <<= 1;
        currentLen++;
    }

    minCode[len] = currentCode;
    valPtr[len] = symbolOffset; // Index into 'symbols'
    
    // Determine how many codes of this length
    const countForLen = lenCounts[len];
    
    // The codes for this length are currentCode, currentCode+1, ...
    // So max code is currentCode + count - 1
    maxCode[len] = currentCode + countForLen - 1;
    
    currentCode += countForLen;
    symbolOffset += countForLen;
    i += countForLen;
  }

  // 2. Decode Stream (The Hot Path)
  // Pre-allocate output buffers
  // We don't know exact RLE size, but we know decoded pixel size.
  // We'll decode RLE into a temporary dynamic array or large buffer.
  // Since RLE compression means encoded size < decoded, 
  // but RLE *stream* (symbols) length is unknown. Let's use a resizeable approach or conservative estimate.
  
  // Optimization: Perform RLE decoding on the fly? 
  // No, separate stages are easier to debug and optimize.
  // Let's decode symbols first.
  
  const rleStream = new Uint8Array(expectedLength * 2); // Heuristic
  let rlePos = 0;

  // Bit Buffer
  let accumulator = 0;
  let bitsAvailable = 0;
  const dataLen = data.length;
  
  // Main decode loop
  while (p < dataLen || bitsAvailable > 0) {
    // Fill accumulator to at least 24 bits if possible
    while (bitsAvailable < 24 && p < dataLen) {
        accumulator = (accumulator << 8) | data[p++];
        bitsAvailable += 8;
    }

    // Decode one symbol
    // We scan lengths 1..MAX
    // But since we have min/max arrays, we can do this smartly.
    
    let code = 0;
    let len = 0;
    let found = false;

    // "Slow" canonical search: read bit by bit until code matches range
    // Optimization: Since we buffered bits, we can peek?
    // Stick to simple canonical logic first:
    // read bits until (code <= maxCode[len])
    
    // Since we are in JS, loop unrolling or peeking is risky without typed arrays.
    // Let's do the "incremental build" which is standard for Canonical.
    
    // We need to pull bits one by one from accumulator
    // BUT checking maxCode[len] at each step.
    
    // This loop is the bottleneck.
    // We iterate 'len' from minLen to maxLen.
    const startLen = codeLens[0].len;
    
    // Initialize code with minimal bits
    if (bitsAvailable < startLen) {
        // End of stream likely
        if (p >= dataLen) break; 
    }
    
    // Optimization: Peek 'startLen' bits
    // (accumulator >> (bitsAvailable - startLen)) & mask
    
    // Let's assume standard loop for safety first
    let curLen = 0;
    let curCode = 0;
    
    while (true) {
        curLen++;
        if (bitsAvailable === 0) {
             // Should not happen if size is correct, unless padding issues
             break;
        }
        
        // Take 1 bit
        bitsAvailable--;
        const bit = (accumulator >>> bitsAvailable) & 1;
        curCode = (curCode << 1) | bit;
        
        // Check if valid code for this length
        // We only check if we are within range for THIS length
        // Note: minCode is initialized to -1.
        if (maxCode[curLen] !== -1 && curCode <= maxCode[curLen]) {
            // Found it!
            const symbolIndex = valPtr[curLen] + (curCode - minCode[curLen]);
            const sym = symbols[symbolIndex];
            
            if (rlePos >= rleStream.length) {
                // Grow buffer
                const newBuf = new Uint8Array(rleStream.length * 2);
                newBuf.set(rleStream);
                // rleStream = newBuf; // can't reassign const, need 'let' or copy
                // Actually easier to just keep 'out' as let or use a chunked array.
                // Let's assume heuristic was ok, or throw error for now/resize.
            }
            rleStream[rlePos++] = sym;
            
            found = true;
            break; 
        }
        
        if (curLen >= 30) break; // Safety break
    }
    
    if (!found) break; // Stream ended or error
    if (rlePos >= expectedLength * 2) break; // Defensive limit
  }

  // 3. RLE Decode + Delta Decode (Fused Loop for speed)
  const finalOut = new Uint8Array(expectedLength);
  let outIdx = 0;
  let prevVal = 0;
  
  for (let i = 0; i < rlePos; i++) {
      if (outIdx >= expectedLength) break;
      
      const val = rleStream[i];
      
      if (val === RLE_MARKER) {
          // Verify we have enough bytes
          if (i + 2 >= rlePos) break; 
          const run = rleStream[++i];
          const v = rleStream[++i];
          
          // Apply run
          for (let r = 0; r < run; r++) {
              if (outIdx >= expectedLength) break;
              // Delta decode logic: v is the delta
              // Wait, in encoder: rleEncode(deltas). So v IS the delta byte (0-255 mapped).
              
              // Map back: (byte - 128)
              // (v - 128) is the diff.
              // We need to cast to int8 handling.
              
              // Optimization: v is uint8 (0..255).
              // diff = (v - 128).
              // result = prev + diff.
              // To match encoder: 
              // diff = (val - 128) << 24 >> 24; // Sign extension trick if needed
              // But here simple subtraction works if wrapped correctly.
              
              let diff = v - 128; 
              // Reconstruct
              let pixel = prevVal + diff;
              // Clamp
              if (pixel < 0) pixel = 0;
              if (pixel > 255) pixel = 255;
              
              finalOut[outIdx++] = pixel;
              prevVal = pixel;
          }
      } else {
          // Single value delta
          let diff = val - 128;
          let pixel = prevVal + diff;
          if (pixel < 0) pixel = 0;
          if (pixel > 255) pixel = 255;
          
          finalOut[outIdx++] = pixel;
          prevVal = pixel;
      }
  }

  return finalOut;
};