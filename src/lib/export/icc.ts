// Minimal ICC v4 Display P3 profile (matrix/TRC), built at runtime so the app
// ships no third-party profile. Values are the standard D50-adapted P3 primaries
// and the sRGB transfer curve.

const s15 = (v: number) => Math.round(v * 65536);

function mluc(text: string): Uint8Array {
  const utf16 = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    utf16[i * 2] = text.charCodeAt(i) >> 8;
    utf16[i * 2 + 1] = text.charCodeAt(i) & 0xff;
  }
  const out = new Uint8Array(28 + utf16.length);
  const v = new DataView(out.buffer);
  out.set([0x6d, 0x6c, 0x75, 0x63]); // 'mluc'
  v.setUint32(8, 1); v.setUint32(12, 12);
  out.set([0x65, 0x6e, 0x55, 0x53], 16); // enUS
  v.setUint32(20, utf16.length); v.setUint32(24, 28);
  out.set(utf16, 28);
  return out;
}

function xyz(x: number, y: number, z: number): Uint8Array {
  const out = new Uint8Array(20);
  const v = new DataView(out.buffer);
  out.set([0x58, 0x59, 0x5a, 0x20]); // 'XYZ '
  v.setInt32(8, s15(x)); v.setInt32(12, s15(y)); v.setInt32(16, s15(z));
  return out;
}

function sf32(m: number[]): Uint8Array {
  const out = new Uint8Array(8 + m.length * 4);
  const v = new DataView(out.buffer);
  out.set([0x73, 0x66, 0x33, 0x32]); // 'sf32'
  m.forEach((n, i) => v.setInt32(8 + i * 4, s15(n)));
  return out;
}

function srgbCurve(): Uint8Array {
  // parametricCurveType, function 3: Y = (aX+b)^g for X >= d, else cX
  const params = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
  const out = new Uint8Array(12 + params.length * 4);
  const v = new DataView(out.buffer);
  out.set([0x70, 0x61, 0x72, 0x61]); // 'para'
  v.setUint16(8, 3);
  params.forEach((n, i) => v.setInt32(12 + i * 4, s15(n)));
  return out;
}

const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function displayP3Profile(): Uint8Array<ArrayBuffer> {
  const curve = srgbCurve();
  const tags: [string, Uint8Array][] = [
    ['desc', mluc('Display P3')],
    ['cprt', mluc('No copyright, use freely')],
    ['wtpt', xyz(0.9642, 1.0, 0.8249)],
    ['rXYZ', xyz(0.515121, 0.241196, -0.001053)],
    ['gXYZ', xyz(0.291977, 0.692245, 0.041885)],
    ['bXYZ', xyz(0.157104, 0.066574, 0.784073)],
    ['rTRC', curve], ['gTRC', curve], ['bTRC', curve],
    ['chad', sf32([1.047882, 0.022919, -0.050201, 0.029587, 0.990479, -0.017059, -0.009232, 0.015076, 0.751678])],
  ];
  const pad4 = (n: number) => (n + 3) & ~3;
  const tableSize = 4 + tags.length * 12;
  let offset = 128 + tableSize;
  const placed: { sig: string; off: number; data: Uint8Array }[] = [];
  const seen = new Map<Uint8Array, number>();
  for (const [sig, data] of tags) {
    const prev = seen.get(data);
    if (prev !== undefined) { placed.push({ sig, off: prev, data }); continue; }
    seen.set(data, offset);
    placed.push({ sig, off: offset, data });
    offset = pad4(offset + data.length);
  }
  const size = offset;
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  v.setUint32(0, size);
  out.set([0x00, 0x00, 0x00, 0x00], 4);      // preferred CMM: none
  v.setUint32(8, 0x04300000);                 // version 4.3
  out.set(tag('mntr'), 12);
  out.set(tag('RGB '), 16);
  out.set(tag('XYZ '), 20);
  v.setUint16(24, 2024); v.setUint16(26, 1); v.setUint16(28, 1); // date
  out.set(tag('acsp'), 36);
  v.setUint32(64, 0);                         // rendering intent: perceptual
  v.setInt32(68, s15(0.9642)); v.setInt32(72, s15(1.0)); v.setInt32(76, s15(0.8249)); // PCS illuminant
  v.setUint32(128, tags.length);
  placed.forEach((t, i) => {
    out.set(tag(t.sig), 132 + i * 12);
    v.setUint32(136 + i * 12, t.off);
    v.setUint32(140 + i * 12, t.data.length);
    if (seen.get(t.data) === t.off) out.set(t.data, t.off);
  });
  return out;
}

/** Insert an ICC profile into a JPEG as an APP2 segment (after SOI/APP0). */
export function embedIcc(jpeg: Uint8Array, icc: Uint8Array): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode('ICC_PROFILE\0');
  const segLen = 2 + header.length + 2 + icc.length;
  if (segLen > 0xffff) throw new Error('ICC profile too large');
  let at = 2;
  // Skip a JFIF APP0 if present so readers see it first.
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const seg = new Uint8Array(2 + segLen);
  seg[0] = 0xff; seg[1] = 0xe2; seg[2] = segLen >> 8; seg[3] = segLen & 0xff;
  seg.set(header, 4);
  seg[4 + header.length] = 1; seg[5 + header.length] = 1;
  seg.set(icc, 6 + header.length);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, at));
  out.set(seg, at);
  out.set(jpeg.subarray(at), at + seg.length);
  return out;
}
