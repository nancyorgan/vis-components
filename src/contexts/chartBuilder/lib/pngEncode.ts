/** Encode transparent export PNGs ourselves, so invisible pixels can carry
 *  a color.
 *
 *  A browser canvas stores premultiplied pixels, so `toBlob` writes every
 *  fully transparent pixel as black at 0% opacity (0,0,0,0), whatever was
 *  drawn. Programs that shrink a picture by averaging colors WITHOUT
 *  weighting them by opacity (PowerPoint and Word, at the zoom a slide is
 *  normally viewed at) mix that hidden black into every anti-aliased edge:
 *  white point outlines and white legend boxes on a transparent chart get a
 *  gray, slightly 3-D fringe that disappears when you zoom in (less
 *  shrinking) and never shows in the browser (which weights by opacity).
 *
 *  The fix is the one game engines use for texture atlases ("alpha
 *  bleeding"): give each invisible pixel the color of the nearest visible
 *  one. Opacity is untouched, so the picture looks identical wherever it's
 *  composited correctly; a naive resampler now averages white with white.
 *
 *  Hand-rolled, like `imageDpi.ts` and the PDF writer: a PNG of one RGBA
 *  image is four chunks, and `CompressionStream("deflate")` emits exactly
 *  the zlib stream IDAT wants — not worth an encoder dependency. */

import { crc32 } from "./imageDpi"

/** In place: give every fully transparent pixel the color of its nearest
 *  visible pixels, leaving opacity alone. Grows outward from the visible
 *  pixels one ring at a time (8-connected); each ring takes the average of
 *  the already-colored neighbors, the first ring weighting edge pixels by
 *  their opacity (a nearly invisible edge pixel's color is the least
 *  precise — the canvas stores it premultiplied). Every transparent pixel
 *  gets a color, so a viewer shrinking the picture many-fold still never
 *  reaches the hidden black. A picture with nothing visible is left as is. */
export const bleedTransparentColor = (
	rgba: Uint8Array | Uint8ClampedArray,
	width: number,
	height: number
): void => {
	const n = width * height
	// 0 = transparent, not reached yet; 1 = in the ring being colored;
	// 2 = has its color (visible, or colored by an earlier ring).
	const state = new Uint8Array(n)
	let visible = 0
	for (let i = 0; i < n; i++) {
		if (rgba[i * 4 + 3] > 0) {
			state[i] = 2
			visible++
		}
	}
	if (visible === 0 || visible === n) return

	// Each pixel enters the queue at most once, so one array holds every ring.
	const queue = new Int32Array(n - visible)
	let tail = 0
	const enqueueNeighbors = (i: number) => {
		const x = i % width
		const y = (i - x) / width
		for (let dy = -1; dy <= 1; dy++) {
			const ny = y + dy
			if (ny < 0 || ny >= height) continue
			for (let dx = -1; dx <= 1; dx++) {
				const nx = x + dx
				if (nx < 0 || nx >= width) continue
				const j = ny * width + nx
				if (state[j] === 0) {
					state[j] = 1
					queue[tail++] = j
				}
			}
		}
	}
	for (let i = 0; i < n; i++) if (state[i] === 2) enqueueNeighbors(i)

	let head = 0
	while (head < tail) {
		const ringEnd = tail
		for (let q = head; q < ringEnd; q++) {
			const i = queue[q]
			const x = i % width
			const y = (i - x) / width
			let r = 0
			let g = 0
			let b = 0
			let weight = 0
			for (let dy = -1; dy <= 1; dy++) {
				const ny = y + dy
				if (ny < 0 || ny >= height) continue
				for (let dx = -1; dx <= 1; dx++) {
					const nx = x + dx
					if (nx < 0 || nx >= width) continue
					const j = ny * width + nx
					if (state[j] !== 2) continue
					// The first ring's neighbors are all visible (weight =
					// opacity); later rings' are all colored-in (weight 1).
					const a = rgba[j * 4 + 3]
					const w = a > 0 ? a : 1
					r += rgba[j * 4] * w
					g += rgba[j * 4 + 1] * w
					b += rgba[j * 4 + 2] * w
					weight += w
				}
			}
			// Reached from a colored neighbor, so weight is never 0.
			rgba[i * 4] = Math.round(r / weight)
			rgba[i * 4 + 1] = Math.round(g / weight)
			rgba[i * 4 + 2] = Math.round(b / weight)
		}
		// Colors are read only from state-2 pixels, so a ring never reads its
		// own half-written members; it joins them once it's complete.
		for (let q = head; q < ringEnd; q++) state[queue[q]] = 2
		for (let q = head; q < ringEnd; q++) enqueueNeighbors(queue[q])
		head = ringEnd
	}
}

const abs8 = (v: number) => (v < 128 ? v : 256 - v)

/** PNG scanlines, each prefixed with its filter byte. Per row, keeps the
 *  filter (None/Sub/Up/Average/Paeth) whose output has the smallest sum of
 *  absolute signed bytes — the heuristic the PNG spec recommends. */
export const filterScanlines = (
	rgba: Uint8Array | Uint8ClampedArray,
	width: number,
	height: number
): Uint8Array<ArrayBuffer> => {
	const stride = width * 4
	const out = new Uint8Array(height * (stride + 1))
	const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride))
	const zeroRow = new Uint8Array(stride)
	const sums = [0, 0, 0, 0, 0]
	for (let y = 0; y < height; y++) {
		const row = rgba.subarray(y * stride, (y + 1) * stride)
		const prev = y > 0 ? rgba.subarray((y - 1) * stride, y * stride) : zeroRow
		sums.fill(0)
		for (let x = 0; x < stride; x++) {
			const v = row[x]
			const a = x >= 4 ? row[x - 4] : 0
			const b = prev[x]
			const c = x >= 4 ? prev[x - 4] : 0
			const p = a + b - c
			const pa = Math.abs(p - a)
			const pb = Math.abs(p - b)
			const pc = Math.abs(p - c)
			const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
			const f1 = (v - a) & 0xff
			const f2 = (v - b) & 0xff
			const f3 = (v - ((a + b) >> 1)) & 0xff
			const f4 = (v - paeth) & 0xff
			candidates[0][x] = v
			candidates[1][x] = f1
			candidates[2][x] = f2
			candidates[3][x] = f3
			candidates[4][x] = f4
			sums[0] += abs8(v)
			sums[1] += abs8(f1)
			sums[2] += abs8(f2)
			sums[3] += abs8(f3)
			sums[4] += abs8(f4)
		}
		let best = 0
		for (let f = 1; f < 5; f++) if (sums[f] < sums[best]) best = f
		out[y * (stride + 1)] = best
		out.set(candidates[best], y * (stride + 1) + 1)
	}
	return out
}

const writeU32 = (out: Uint8Array, offset: number, value: number) => {
	out[offset] = (value >>> 24) & 0xff
	out[offset + 1] = (value >>> 16) & 0xff
	out[offset + 2] = (value >>> 8) & 0xff
	out[offset + 3] = value & 0xff
}

const pngChunk = (type: string, data: Uint8Array): Uint8Array<ArrayBuffer> => {
	const out = new Uint8Array(12 + data.length)
	writeU32(out, 0, data.length)
	for (let k = 0; k < 4; k++) out[4 + k] = type.charCodeAt(k)
	out.set(data, 8)
	writeU32(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)))
	return out
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Whether this browser can run `encodeRgbaPng` (CompressionStream:
 *  Chrome 80, Safari 16.4, Firefox 113). Without it, callers keep the
 *  canvas's own encoder. */
export const canEncodePng = (): boolean => typeof CompressionStream !== "undefined"

/** An 8-bit RGBA PNG (no DPI stamp — `withPngDpi` adds one) of straight,
 *  un-premultiplied pixels, written as given: unlike `canvas.toBlob`, a
 *  transparent pixel keeps whatever color it carries. */
export const encodeRgbaPng = async (
	rgba: Uint8Array | Uint8ClampedArray,
	width: number,
	height: number
): Promise<Uint8Array<ArrayBuffer>> => {
	const ihdr = new Uint8Array(13)
	writeU32(ihdr, 0, width)
	writeU32(ihdr, 4, height)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // color type: RGBA
	// compression, filter method, interlace: all 0
	const scanlines = filterScanlines(rgba, width, height)
	const stream = new Blob([scanlines])
		.stream()
		.pipeThrough(new CompressionStream("deflate"))
	const idat = new Uint8Array(await new Response(stream).arrayBuffer())
	const parts = [
		PNG_SIGNATURE,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", idat),
		pngChunk("IEND", new Uint8Array(0)),
	]
	let length = 0
	for (const p of parts) length += p.length
	const out = new Uint8Array(length)
	let at = 0
	for (const p of parts) {
		out.set(p, at)
		at += p.length
	}
	return out
}
