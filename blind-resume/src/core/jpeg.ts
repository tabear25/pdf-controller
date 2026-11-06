export interface JpegInspection {
  readonly valid: boolean;
  readonly markers: readonly number[];
  readonly metadataMarkers: readonly string[];
}

const STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

function markerName(marker: number): string {
  if (marker === 0xfe) return "COM";
  if (marker >= 0xe0 && marker <= 0xef) return `APP${marker - 0xe0}`;
  return `0x${marker.toString(16)}`;
}

export function inspectJpeg(bytes: Uint8Array): JpegInspection {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { valid: false, markers: [], metadataMarkers: [] };
  const markers: number[] = [0xd8];
  const metadata: string[] = [];
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return { valid: false, markers, metadataMarkers: metadata };
    let marker = bytes[i + 1]!;
    while (marker === 0xff && i + 2 < bytes.length) {
      i += 1;
      marker = bytes[i + 1]!;
    }
    markers.push(marker);
    if (STANDALONE.has(marker)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2) return { valid: false, markers, metadataMarkers: metadata };
    if (marker === 0xfe || (marker >= 0xe1 && marker <= 0xef)) metadata.push(markerName(marker));
    if (marker === 0xe0) {
      const id = String.fromCharCode(...bytes.subarray(i + 4, i + 9));
      if (id !== "JFIF\0") metadata.push("APP0（JFIF 以外）");
    }
    if (marker === 0xda) return { valid: true, markers, metadataMarkers: metadata };
    i += 2 + length;
  }
  return { valid: false, markers, metadataMarkers: metadata };
}

const KEEP_BEFORE_SCAN = new Set([0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd]);

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("JPEG ではありません。");
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error("JPEG の構造を読めません。");
    const marker = bytes[i + 1]!;
    if (STANDALONE.has(marker)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker === 0xda) {
      parts.push(bytes.subarray(i));
      break;
    }
    const isJfif = marker === 0xe0 && String.fromCharCode(...bytes.subarray(i + 4, i + 9)) === "JFIF\0";
    if (isJfif || KEEP_BEFORE_SCAN.has(marker)) parts.push(bytes.subarray(i, i + 2 + length));
    else if (!(marker === 0xfe || (marker >= 0xe0 && marker <= 0xef))) throw new Error(`想定外の JPEG のマーカーです（0x${marker.toString(16)}）。`);
    i += 2 + length;
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
