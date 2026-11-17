// @vitest-environment node
// (real Blob.stream / CompressionStream / Response, as in the browser)
import { inflateSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { crc32, readPngDpi, withPngDpi } from "./imageDpi"
import { bleedTransparentColor, encodeRgbaPng, filterScanlines } from "./pngEncode"

type Png = { width: number; height: number; rgba: Uint8Array; filters: number[] }

/** Independent reader: walk chunks (checking each CRC), inflate IDAT with
 *  node's zlib, undo the per-row filters. */
const decodePng = (png: Uint8Array): Png => {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
	expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	let at = 8
	let width = 0
	let height = 0
	const idat: Uint8Array[] = []
	const types: string[] = []
	while (at < png.length) {
		const len = view.getUint32(at)
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8))
		types.push(type)
		expect(view.getUint32(at + 8 + len)).toBe(crc32(png.subarray(at + 4, at + 8 + len)))
		if (type === "IHDR") {
			width = view.getUint32(at + 8)
			height = view.getUint32(at + 12)
			expect([...png.subarray(at + 16, at + 21)]).toEqual([8, 6, 0, 0, 0])
		}
		if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + len))
		at += 12 + len
	}
	expect(types[0]).toBe("IHDR")
	expect(types.at(-1)).toBe("IEND")
	const raw = inflateSync(Buffer.concat(idat))
	const stride = width * 4
	const rgba = new Uint8Array(width * height * 4)
	const filters: number[] = []
	for (let y = 0; y < height; y++) {
		const f = raw[y * (stride + 1)]
		filters.push(f)
		for (let x = 0; x < stride; x++) {
			const v = raw[y * (stride + 1) + 1 + x]
			const a = x >= 4 ? rgba[y * stride + x - 4] : 0
			const b = y > 0 ? rgba[(y - 1) * stride + x] : 0
			const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0
			const p = a + b - c
			const paeth =
				Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c)
					? a
					: Math.abs(p - b) <= Math.abs(p - c)
						? b
						: c
			const pred = [0, a, b, (a + b) >> 1, paeth][f]
			rgba[y * stride + x] = (v + pred) & 0xff
		}
	}
	return { width, height, rgba, filters }
}

const pixel = (rgba: Uint8Array, width: number, x: number, y: number) =>
	[...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]

/** Shrink 2× by plain averaging, WITHOUT weighting color by opacity (what
 *  PowerPoint/Word do on a slide), then lay it on a white slide; returns
 *  the red channel (everything here is gray-scale). */
const naiveShrinkOnWhite = (rgba: Uint8Array, width: number, height: number) => {
	const out: number[] = []
	for (let y = 0; y + 1 < height; y += 2) {
		for (let x = 0; x + 1 < width; x += 2) {
			let r = 0
			let a = 0
			for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
				const i = ((y + dy) * width + (x + dx)) * 4
				r += rgba[i]
				a += rgba[i + 3] / 255
			}
			out.push(Math.round((r / 4) * (a / 4) + 255 * (1 - a / 4)))
		}
	}
	return out
}

describe("bleedTransparentColor", () => {
	it("colors invisible pixels from their visible neighbors, leaving opacity alone", () => {
		// [clear, clear, white, clear, blue]
		const rgba = new Uint8Array([
			0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 255, 255,
		])
		bleedTransparentColor(rgba, 5, 1)
		expect(pixel(rgba, 5, 0, 0)).toEqual([255, 255, 255, 0])
		expect(pixel(rgba, 5, 1, 0)).toEqual([255, 255, 255, 0])
		// between white and blue: their average
		expect(pixel(rgba, 5, 3, 0)).toEqual([128, 128, 255, 0])
		// visible pixels untouched
		expect(pixel(rgba, 5, 2, 0)).toEqual([255, 255, 255, 255])
		expect(pixel(rgba, 5, 4, 0)).toEqual([0, 0, 255, 255])
	})

	it("weights the first ring by the edge pixels' opacity", () => {
		// a barely-visible black pixel beside an opaque white one
		const rgba = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 255, 255, 255, 255])
		bleedTransparentColor(rgba, 3, 1)
		expect(pixel(rgba, 3, 1, 0)).toEqual([254, 254, 254, 0])
	})

	it("reaches every invisible pixel, however far from the visible ones", () => {
		const w = 41
		const rgba = new Uint8Array(w * w * 4)
		rgba.set([200, 100, 50, 255], (20 * w + 20) * 4)
		bleedTransparentColor(rgba, w, w)
		for (const [x, y] of [[0, 0], [40, 0], [0, 40], [40, 40], [20, 3]]) {
			expect(pixel(rgba, w, x, y)).toEqual([200, 100, 50, 0])
		}
	})

	it("leaves a fully invisible or fully opaque picture alone", () => {
		const empty = new Uint8Array(4 * 4 * 4)
		bleedTransparentColor(empty, 4, 4)
		expect(empty.every((v) => v === 0)).toBe(true)
		const solid = new Uint8Array(2 * 2 * 4).fill(255)
		bleedTransparentColor(solid, 2, 2)
		expect(solid.every((v) => v === 255)).toBe(true)
	})

	it("keeps a naive 2× shrink from graying a white edge on a white slide", () => {
		// A white bar starting at an odd column, so each shrunk pixel at its
		// edge averages one white pixel with one transparent one.
		const w = 8
		const h = 2
		const rgba = new Uint8Array(w * h * 4)
		for (let y = 0; y < h; y++) {
			for (let x = 3; x < 7; x++) rgba.set([255, 255, 255, 255], (y * w + x) * 4)
		}
		// As canvas.toBlob writes it: hidden black under the clear pixels.
		expect(Math.min(...naiveShrinkOnWhite(rgba, w, h))).toBeLessThan(255)
		bleedTransparentColor(rgba, w, h)
		expect(naiveShrinkOnWhite(rgba, w, h)).toEqual([255, 255, 255, 255])
	})
})

describe("encodeRgbaPng", () => {
	// A picture that makes every row filter worth picking somewhere: flat
	// runs, horizontal and vertical gradients, noise, and clear pixels
	// carrying a color.
	const w = 37
	const h = 23
	const picture = () => {
		const rgba = new Uint8Array(w * h * 4)
		let seed = 7
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4
				seed = (seed * 1_103_515_245 + 12_345) & 0x7f_ff_ff_ff
				const band = y % 4
				rgba[i] = band === 0 ? 40 : band === 1 ? x * 6 : band === 2 ? y * 9 : seed & 0xff
				rgba[i + 1] = (x * y) & 0xff
				rgba[i + 2] = 255 - x * 3
				rgba[i + 3] = x < 5 ? 0 : x < 8 ? 128 : 255
			}
		}
		return rgba
	}

	it("round-trips every byte, including colors under zero opacity", async () => {
		const rgba = picture()
		const decoded = decodePng(await encodeRgbaPng(rgba, w, h))
		expect(decoded.width).toBe(w)
		expect(decoded.height).toBe(h)
		expect(decoded.rgba).toEqual(rgba)
		// the clear column still carries its color
		expect(pixel(decoded.rgba, w, 0, 0)).toEqual([40, 0, 255, 0])
		expect(new Set(decoded.filters).size).toBeGreaterThan(1)
	})

	it("takes the DPI stamp the export adds", async () => {
		const png = withPngDpi(await encodeRgbaPng(picture(), w, h), 384)
		expect(readPngDpi(png)).toBeCloseTo(384, 0)
		expect(decodePng(png).rgba).toEqual(picture())
	})
})

describe("filterScanlines", () => {
	it("prefixes each row with the filter that leaves the least to compress", () => {
		// identical rows → "Up" (all zeros) wins from row 2 on
		const rgba = new Uint8Array(4 * 3 * 4)
		for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 0xff
		for (let y = 1; y < 3; y++) rgba.copyWithin(y * 16, 0, 16)
		const out = filterScanlines(rgba, 4, 3)
		expect(out.length).toBe(3 * (16 + 1))
		expect(out[17]).toBe(2)
		expect([...out.subarray(18, 34)].every((v) => v === 0)).toBe(true)
	})
})
