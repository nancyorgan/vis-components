/** Stamp physical-resolution (DPI) metadata into exported raster images.
 *
 * Canvas `toBlob` output carries no resolution info, so consumers that place
 * images at physical size (PowerPoint, Word, print layouts) guess a DPI —
 * and with a 2×/3× export multiplier the guess lands at double/triple the
 * intended size (then gets shrunk-to-fit, ending up arbitrary). Writing the
 * true DPI (96 × the export multiplier) makes "6.5 in wide" insert at
 * exactly 6.5 inches.
 *
 * Hand-rolled binary patching because each format needs only one tiny,
 * fixed-shape record: PNG's 21-byte `pHYs` chunk and JFIF's 5 density bytes
 * — not worth an image-metadata library dependency. */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

// Standard CRC-32 (as used by PNG), table-driven.
const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1
		}
		table[n] = c >>> 0
	}
	return table
})()

/** Exported for the known-answer test ("123456789" → 0xcbf43926); PNG
 *  chunk CRCs are computed with this internally. */
export const crc32 = (bytes: Uint8Array): number => {
	let c = 0xff_ff_ff_ff
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
	return (c ^ 0xff_ff_ff_ff) >>> 0
}

const writeU32 = (out: Uint8Array, offset: number, value: number) => {
	out[offset] = (value >>> 24) & 0xff
	out[offset + 1] = (value >>> 16) & 0xff
	out[offset + 2] = (value >>> 8) & 0xff
	out[offset + 3] = value & 0xff
}
const readU32 = (bytes: Uint8Array, offset: number): number =>
	((bytes[offset] << 24) |
		(bytes[offset + 1] << 16) |
		(bytes[offset + 2] << 8) |
		bytes[offset + 3]) >>>
	0

/** PNG stores resolution as pixels per METER (unit flag 1). */
const dpiToPixelsPerMeter = (dpi: number): number =>
	Math.round((dpi * 1000) / 25.4)

/** Full 21-byte pHYs chunk: length(4) + "pHYs"(4) + x-ppm(4) + y-ppm(4) +
 *  unit(1, 1 = meter) + CRC(4, over type + data). */
const buildPhysChunk = (dpi: number): Uint8Array<ArrayBuffer> => {
	const ppm = dpiToPixelsPerMeter(dpi)
	const chunk = new Uint8Array(21)
	writeU32(chunk, 0, 9)
	chunk.set([0x70, 0x48, 0x59, 0x73], 4) // "pHYs"
	writeU32(chunk, 8, ppm)
	writeU32(chunk, 12, ppm)
	chunk[16] = 1
	writeU32(chunk, 17, crc32(chunk.subarray(4, 17)))
	return chunk
}

/** Return a copy of `png` carrying a pHYs chunk for `dpi` — replacing an
 *  existing pHYs, else inserted right after IHDR (the spec requires pHYs
 *  before the first IDAT). Anything that doesn't parse as expected returns
 *  the input untouched: a missing DPI stamp beats a corrupted download. */
export const withPngDpi = (
	png: Uint8Array<ArrayBuffer>,
	dpi: number
): Uint8Array<ArrayBuffer> => {
	if (png.length < 8 + 12) return png
	if (PNG_SIGNATURE.some((b, i) => png[i] !== b)) return png
	const phys = buildPhysChunk(dpi)
	let offset = 8
	let insertAt: number | null = null
	while (offset + 12 <= png.length) {
		const dataLength = readU32(png, offset)
		const type = String.fromCharCode(
			png[offset + 4],
			png[offset + 5],
			png[offset + 6],
			png[offset + 7]
		)
		const chunkEnd = offset + 12 + dataLength
		if (type === "pHYs") {
			if (dataLength !== 9) return png
			const out = png.slice()
			out.set(phys, offset)
			return out
		}
		if (type === "IHDR") insertAt = chunkEnd
		if (type === "IDAT") break
		offset = chunkEnd
	}
	if (insertAt === null || insertAt > png.length) return png
	const out = new Uint8Array(png.length + phys.length)
	out.set(png.subarray(0, insertAt))
	out.set(phys, insertAt)
	out.set(png.subarray(insertAt), insertAt + phys.length)
	return out
}

// JFIF APP0 payload layout (after the 2-byte segment length):
// "JFIF\0"(5) + version(2) + density-units(1) + x-density(2) + y-density(2)
// + thumbnail w/h(2). Density units 1 = dots per inch.
const isJfifApp0 = (jpeg: Uint8Array, payloadStart: number): boolean =>
	jpeg[payloadStart] === 0x4a && // J
	jpeg[payloadStart + 1] === 0x46 && // F
	jpeg[payloadStart + 2] === 0x49 && // I
	jpeg[payloadStart + 3] === 0x46 && // F
	jpeg[payloadStart + 4] === 0x00

const writeU16 = (out: Uint8Array, offset: number, value: number) => {
	out[offset] = (value >>> 8) & 0xff
	out[offset + 1] = value & 0xff
}

/** Return a copy of `jpeg` whose JFIF header declares `dpi` — patching the
 *  existing APP0's density fields, else inserting a fresh JFIF APP0 right
 *  after SOI. Unparseable input returns untouched (same rationale as PNG). */
export const withJpegDpi = (
	jpeg: Uint8Array<ArrayBuffer>,
	dpi: number
): Uint8Array<ArrayBuffer> => {
	if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg
	const density = Math.min(0xff_ff, Math.max(1, Math.round(dpi)))
	// Walk the leading APPn/COM segments looking for a JFIF APP0.
	let offset = 2
	while (
		offset + 4 <= jpeg.length &&
		jpeg[offset] === 0xff &&
		((jpeg[offset + 1] & 0xf0) === 0xe0 || jpeg[offset + 1] === 0xfe)
	) {
		const segmentLength = (jpeg[offset + 2] << 8) | jpeg[offset + 3]
		if (
			jpeg[offset + 1] === 0xe0 &&
			segmentLength >= 16 &&
			isJfifApp0(jpeg, offset + 4)
		) {
			const out = jpeg.slice()
			out[offset + 11] = 1 // density units: dots per inch
			writeU16(out, offset + 12, density)
			writeU16(out, offset + 14, density)
			return out
		}
		offset += 2 + segmentLength
	}
	// No JFIF header (encoder-dependent) — insert a minimal one after SOI.
	const app0 = new Uint8Array([
		0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 1, 0, 0,
		0, 0, 0x00, 0x00,
	])
	writeU16(app0, 12, density)
	writeU16(app0, 14, density)
	const out = new Uint8Array(jpeg.length + app0.length)
	out.set(jpeg.subarray(0, 2))
	out.set(app0, 2)
	out.set(jpeg.subarray(2), 2 + app0.length)
	return out
}
