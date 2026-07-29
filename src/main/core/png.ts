import { inflateSync } from 'node:zlib'

/**
 * A minimal PNG reader, for averaging block textures (#127).
 *
 * In `main/` rather than `shared/` for one reason: it needs `node:zlib`, and a
 * shared module is fair game for the renderer to import — where a `node:` import
 * is a broken bundle. It is still pure (bytes in, pixels out) and the smoke runs
 * in the main process, so nothing about testing it is harder here.
 *
 * Deliberately small: it reads the PNGs Mojang ships and nothing else, and says
 * so by returning null rather than guessing whenever it meets something it does
 * not know. A null costs one block its averaged colour and falls back to the
 * table — a wrong guess would put the wrong colour on the map and look like a
 * rendering bug.
 *
 * What "the PNGs Mojang ships" means was measured, not assumed. Of the 1039
 * block textures in 1.21.4: 626 are 4-bit palette, 155 are 8-bit RGBA, 146 are
 * 8-bit palette, 35 are 2-bit palette, 18 are 8-bit RGB and 7 are greyscale.
 * The first version of this handled only depth 8 and silently skipped two
 * thirds of them.
 */

export interface Bitmap {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array
}

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Channels per pixel for each PNG colour type. Palette is one index. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export function decodePng(buf: Buffer): Bitmap | null {
  if (buf.length < 8) return null
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return null

  let width = 0
  let height = 0
  let depth = 0
  let colour = 0
  let interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []

  let off = 8
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const start = off + 8
    // A truncated file must not read past the end of the buffer.
    if (start + len > buf.length) return null
    if (type === 'IHDR') {
      if (len < 13) return null
      width = buf.readUInt32BE(start)
      height = buf.readUInt32BE(start + 4)
      depth = buf[start + 8]
      colour = buf[start + 9]
      interlace = buf[start + 12]
    } else if (type === 'PLTE') palette = buf.subarray(start, start + len)
    else if (type === 'tRNS') trns = buf.subarray(start, start + len)
    else if (type === 'IDAT') idat.push(buf.subarray(start, start + len))
    else if (type === 'IEND') break
    off = start + len + 4 // + CRC
  }

  // Non-interlaced, one of the five colour types, and a bit depth this reads.
  //
  // Depth 8 was the first version's only case, and measuring the real jar said
  // 626 of 1039 block textures are 4-bit palette and 35 are 2-bit — two thirds
  // of them, silently skipped. Sub-byte depths are palette-only in practice and
  // that is all that is handled here.
  if (!width || !height || interlace !== 0) return null
  if (depth !== 8 && !(colour === 3 && (depth === 1 || depth === 2 || depth === 4))) return null
  if (width > 4096 || height > 4096) return null
  const ch = CHANNELS[colour]
  if (!ch) return null
  if (colour === 3 && !palette) return null
  if (!idat.length) return null

  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }

  // Bytes per scanline, rounded up: at depth 4 two pixels share a byte.
  const stride = Math.ceil((width * ch * depth) / 8)
  if (raw.length < (stride + 1) * height) return null
  // Filtering works on whole bytes, so the step back to the "left" pixel is one
  // byte when several pixels share one.
  const fstep = Math.max(1, Math.floor((ch * depth) / 8))

  // Unfilter in place, row by row. Each row is prefixed with its filter type.
  const lines = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    const up = dst - stride
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x]
      const a = x >= fstep ? lines[dst + x - fstep] : 0
      const b = y > 0 ? lines[up + x] : 0
      const c = x >= fstep && y > 0 ? lines[up + x - fstep] : 0
      let out: number
      if (ft === 0) out = v
      else if (ft === 1) out = v + a
      else if (ft === 2) out = v + b
      else if (ft === 3) out = v + ((a + b) >> 1)
      else if (ft === 4) out = v + paeth(a, b, c)
      else return null
      lines[dst + x] = out & 255
    }
  }

  /** One sample, whatever the bit depth. */
  const sample = (row: number, index: number): number => {
    if (depth === 8) return lines[row * stride + index]
    const per = 8 / depth
    const byte = lines[row * stride + Math.floor(index / per)]
    const shift = 8 - depth * ((index % per) + 1)
    return (byte >> shift) & ((1 << depth) - 1)
  }

  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const row = Math.floor(i / width)
    const col = i % width
    const s = i * ch
    const d = i * 4
    if (colour === 0) {
      data[d] = data[d + 1] = data[d + 2] = lines[s]
      data[d + 3] = 255
    } else if (colour === 2) {
      data[d] = lines[s]
      data[d + 1] = lines[s + 1]
      data[d + 2] = lines[s + 2]
      data[d + 3] = 255
    } else if (colour === 3) {
      const idx = sample(row, col)
      const p = idx * 3
      const pal = palette as Buffer
      if (p + 2 >= pal.length) return null
      data[d] = pal[p]
      data[d + 1] = pal[p + 1]
      data[d + 2] = pal[p + 2]
      // tRNS on a palette image is a per-entry alpha table; entries past its
      // end are opaque. Without this, a cut-out texture averages its
      // background in and a sapling comes out the colour of nothing.
      data[d + 3] = trns && sample(row, col) < trns.length ? trns[sample(row, col)] : 255
    } else if (colour === 4) {
      data[d] = data[d + 1] = data[d + 2] = lines[s]
      data[d + 3] = lines[s + 1]
    } else {
      data[d] = lines[s]
      data[d + 1] = lines[s + 1]
      data[d + 2] = lines[s + 2]
      data[d + 3] = lines[s + 3]
    }
  }
  return { width, height, data }
}

/**
 * The colour a block reads as on the map.
 *
 * Transparent pixels are skipped rather than averaged as black — half of a
 * sapling or a ladder is empty space, and counting it drags every cut-out
 * texture towards a dark smudge. Partly transparent pixels count in proportion
 * to how solid they are, which is what makes glass come out pale rather than
 * the colour of its frame.
 *
 * Returns null when there is nothing solid enough to average, so the caller
 * keeps whatever it had rather than painting a block black.
 */
export function averageColour(bm: Bitmap): number | null {
  let r = 0
  let g = 0
  let b = 0
  let w = 0
  const n = bm.width * bm.height
  for (let i = 0; i < n; i++) {
    const a = bm.data[i * 4 + 3]
    if (a < 16) continue
    const f = a / 255
    r += bm.data[i * 4] * f
    g += bm.data[i * 4 + 1] * f
    b += bm.data[i * 4 + 2] * f
    w += f
  }
  if (w < 1) return null
  return ((Math.round(r / w) << 16) | (Math.round(g / w) << 8) | Math.round(b / w)) >>> 0
}

/**
 * The first frame of an animated texture.
 *
 * Minecraft ships water, lava, fire and the portal as a vertical strip of frames
 * in one png — `water_still` is 16x512, thirty-two frames of 16x16. Averaging
 * the whole strip is averaging every frame at once, and drawing it as an icon
 * squashes thirty-two pictures into one square.
 *
 * A texture is animated when it is taller than it is wide, which is how every
 * loader has always told: the `.mcmeta` beside it says how to play it, not that
 * it exists.
 */
export function firstFrame(bm: Bitmap): Bitmap {
  if (bm.height <= bm.width) return bm
  const n = bm.width * bm.width * 4
  return { width: bm.width, height: bm.width, data: bm.data.subarray(0, n) }
}

/** Dimensions from the header alone, without decoding the pixels. */
export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 26) return null
  for (let i = 0; i < 8; i++) if (buf[i] !== SIG[i]) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}
