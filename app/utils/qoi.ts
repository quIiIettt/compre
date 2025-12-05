// utils/qoi.ts

// Константи тегів згідно зі специфікацією [cite: 2049, 2074, 2086, 2093, 2104]
const QOI_OP_INDEX = 0x00; // 00xxxxxx
const QOI_OP_DIFF  = 0x40; // 01xxxxxx
const QOI_OP_LUMA  = 0x80; // 10xxxxxx
const QOI_OP_RUN   = 0xC0; // 11xxxxxx
const QOI_OP_RGB   = 0xFE; // 11111110
const QOI_OP_RGBA  = 0xFF; // 11111111

const QOI_MASK_2   = 0xC0; // 11000000

// Хеш-функція для масиву індексів 
// index_position = (r * 3 + g * 5 + b * 7 + a * 11) % 64
const qoiHash = (r: number, g: number, b: number, a: number) => {
  return (r * 3 + g * 5 + b * 7 + a * 11) % 64;
};

export const encodeQOI = (imageData: ImageData): Uint8Array => {
  const width = imageData.width;
  const height = imageData.height;
  const pixels = imageData.data;
  
  // Максимальний можливий розмір:
  // header (14) + pixels * 5 (worst case RGBA) + padding (8)
  const maxSize = 14 + (width * height * 5) + 8;
  const bytes = new Uint8Array(maxSize);
  
  let p = 0; // Поточна позиція в буфері

  // --- HEADER [cite: 2047, 2048] ---
  // Magic "qoif"
  bytes[p++] = 113; // q
  bytes[p++] = 111; // o
  bytes[p++] = 105; // i
  bytes[p++] = 102; // f
  
  // Width (Big Endian)
  bytes[p++] = (width >> 24) & 0xFF;
  bytes[p++] = (width >> 16) & 0xFF;
  bytes[p++] = (width >> 8) & 0xFF;
  bytes[p++] = width & 0xFF;
  
  // Height (Big Endian)
  bytes[p++] = (height >> 24) & 0xFF;
  bytes[p++] = (height >> 16) & 0xFF;
  bytes[p++] = (height >> 8) & 0xFF;
  bytes[p++] = height & 0xFF;
  
  // Channels (4 for RGBA) & Colorspace (0 = sRGB with linear alpha)
  bytes[p++] = 4; 
  bytes[p++] = 0; 

  // --- ENCODING DATA ---
  // Початковий стан: r=0, g=0, b=0, a=255 [cite: 2057]
  let px_r = 0, px_g = 0, px_b = 0, px_a = 255;
  let run = 0;
  
  // Масив з 64 раніше бачених пікселів (zero-initialized) 
  const index = new Uint8Array(64 * 4); // Зберігаємо r,g,b,a лінійно

  const totalPixels = width * height;
  
  for (let pxPos = 0; pxPos < totalPixels * 4; pxPos += 4) {
    const r = pixels[pxPos];
    const g = pixels[pxPos + 1];
    const b = pixels[pxPos + 2];
    const a = pixels[pxPos + 3];

    // Перевірка на ідентичність попередньому пікселю (RUN) [cite: 2059]
    if (r === px_r && g === px_g && b === px_b && a === px_a) {
      run++;
      // Ліміт run-length: 62 [cite: 2112]
      if (run === 62) {
        bytes[p++] = QOI_OP_RUN | (run - 1); // bias -1 [cite: 2113]
        run = 0;
      }
    } else {
      // Якщо був активний run, записуємо його перед обробкою поточного пікселя
      if (run > 0) {
        bytes[p++] = QOI_OP_RUN | (run - 1);
        run = 0;
      }

      // Спробуємо знайти в INDEX [cite: 2060]
      const indexPos = qoiHash(r, g, b, a);
      const idxOffset = indexPos * 4;
      
      if (
        index[idxOffset] === r &&
        index[idxOffset + 1] === g &&
        index[idxOffset + 2] === b &&
        index[idxOffset + 3] === a
      ) {
        bytes[p++] = QOI_OP_INDEX | indexPos;
      } else {
        // Зберігаємо поточний піксель в масив індексів [cite: 2064]
        index[idxOffset] = r;
        index[idxOffset + 1] = g;
        index[idxOffset + 2] = b;
        index[idxOffset + 3] = a;

        // Якщо альфа не змінилася, пробуємо DIFF або LUMA
        if (a === px_a) {
          const vr = (r - px_r + 256) % 256; // wraparound operation [cite: 2089]
          const vg = (g - px_g + 256) % 256;
          const vb = (b - px_b + 256) % 256;

          // В оригінальній специфікації diff це signed char з wrap.
          // Щоб перевірити діапазон -2..1, переводимо в signed 8-bit:
          const vg_r = (r - px_r) << 24 >> 24;
          const vg_g = (g - px_g) << 24 >> 24;
          const vg_b = (b - px_b) << 24 >> 24;

          // QOI_OP_DIFF [cite: 2087]
          if (
            vg_r > -3 && vg_r < 2 &&
            vg_g > -3 && vg_g < 2 &&
            vg_b > -3 && vg_b < 2
          ) {
            // bias of 2 [cite: 2090]
            bytes[p++] = QOI_OP_DIFF | ((vg_r + 2) << 4) | ((vg_g + 2) << 2) | (vg_b + 2);
          } 
          // QOI_OP_LUMA [cite: 2093, 2094]
          else {
            const vg_dr = (vg_r - vg_g) << 24 >> 24;
            const vg_db = (vg_b - vg_g) << 24 >> 24;

            if (
              vg_g > -33 && vg_g < 32 &&
              vg_dr > -9 && vg_dr < 8 &&
              vg_db > -9 && vg_db < 8
            ) {
              // Green bias 32, dr/db bias 8 [cite: 2100]
              bytes[p++] = QOI_OP_LUMA | (vg_g + 32);
              bytes[p++] = ((vg_dr + 8) << 4) | (vg_db + 8);
            } else {
              // Fallback to QOI_OP_RGB [cite: 2074]
              bytes[p++] = QOI_OP_RGB;
              bytes[p++] = r;
              bytes[p++] = g;
              bytes[p++] = b;
            }
          }
        } else {
          // Fallback to QOI_OP_RGBA [cite: 2102]
          bytes[p++] = QOI_OP_RGBA;
          bytes[p++] = r;
          bytes[p++] = g;
          bytes[p++] = b;
          bytes[p++] = a;
        }
      }
    }

    px_r = r;
    px_g = g;
    px_b = b;
    px_a = a;
  }

  // Якщо файл закінчився на run
  if (run > 0) {
    bytes[p++] = QOI_OP_RUN | (run - 1);
  }

  // --- END MARKER  ---
  // 7 bytes 0x00 followed by a single 0x01 byte
  for (let i = 0; i < 7; i++) bytes[p++] = 0x00;
  bytes[p++] = 0x01;

  // Повертаємо тільки заповнену частину буфера
  return bytes.slice(0, p);
};

export const decodeQOI = (bytes: Uint8Array): ImageData => {
  if (bytes.length < 14 + 8) {
    throw new Error('QOI stream too small');
  }

  let p = 0;
  const magic = String.fromCharCode(bytes[p++], bytes[p++], bytes[p++], bytes[p++]);
  if (magic !== 'qoif') throw new Error('Invalid QOI magic');

  const width = (bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
  const height = (bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++];
  const channels = bytes[p++];
  const _colorspace = bytes[p++];
  if (channels !== 4) throw new Error('Only RGBA QOI is supported');

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

      if (b1 === QOI_OP_RGB) {
        px_r = bytes[p++];
        px_g = bytes[p++];
        px_b = bytes[p++];
      } else if (b1 === QOI_OP_RGBA) {
        px_r = bytes[p++];
        px_g = bytes[p++];
        px_b = bytes[p++];
        px_a = bytes[p++];
      } else {
        const tag = b1 & QOI_MASK_2;
        if (tag === QOI_OP_INDEX) {
          const idx = (b1 & 0x3f) * 4;
          px_r = index[idx];
          px_g = index[idx + 1];
          px_b = index[idx + 2];
          px_a = index[idx + 3];
        } else if (tag === QOI_OP_DIFF) {
          px_r = (px_r + ((b1 >> 4) & 0x03) - 2 + 256) & 0xff;
          px_g = (px_g + ((b1 >> 2) & 0x03) - 2 + 256) & 0xff;
          px_b = (px_b + (b1 & 0x03) - 2 + 256) & 0xff;
        } else if (tag === QOI_OP_LUMA) {
          const b2 = bytes[p++];
          const vg = (b1 & 0x3f) - 32;
          const dr = ((b2 >> 4) & 0x0f) - 8;
          const db = (b2 & 0x0f) - 8;
          px_r = (px_r + vg + dr + 256) & 0xff;
          px_g = (px_g + vg + 256) & 0xff;
          px_b = (px_b + vg + db + 256) & 0xff;
        } else if (tag === QOI_OP_RUN) {
          run = (b1 & 0x3f);
        }
      }

      const indexPos = qoiHash(px_r, px_g, px_b, px_a) * 4;
      index[indexPos] = px_r;
      index[indexPos + 1] = px_g;
      index[indexPos + 2] = px_b;
      index[indexPos + 3] = px_a;
    }

    pixels[pxPos++] = px_r;
    pixels[pxPos++] = px_g;
    pixels[pxPos++] = px_b;
    pixels[pxPos++] = px_a;
  }

  return new ImageData(pixels, width, height);
};
