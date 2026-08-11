import { describe, expect, it } from "vitest"
import { crc32, withJpegDpi, withPngDpi } from "./imageDpi"

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

const pngChunk = (type: string, data: number[]): number[] => {
	const typeBytes = [...type].map((c) => c.codePointAt(0) ?? 0)
	const length = data.length
	const body = new Uint8Array([...typeBytes, ...data])
	const crc = crc32(body)
	return [
		(length >>> 24) & 0xff,
		(length >>> 16) & 0xff,
		(length >>> 8) & 0xff,
		length & 0xff,
		...typeBytes,
		...data,
		(crc >>> 24) & 0xff,
		(crc >>> 16) & 0xff,
		(crc >>> 8) & 0xff,
		crc & 0xff,
	]
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IHDR_DATA = Array.from({ length: 13 }, () => 0)

/** Minimal structurally-valid PNG: signature + IHDR + IDAT + IEND, with an
 *  optional extra chunk list spliced between IHDR and IDAT. */
const makePng = (between: number[][] = []): Uint8Array<ArrayBuffer> =>
	new Uint8Array([
		...PNG_SIG,
		...pngChunk("IHDR", IHDR_DATA),
		...between.flat(),
		...pngChunk("IDAT", [0x00]),
		...pngChunk("IEND", []),
	])

/** Parse a PNG's chunk list into (type, dataOffset, dataLength) triples. */
const listChunks = (
	png: Uint8Array
): Array<{ type: string; dataOffset: number; dataLength: number }> => {
	const chunks: Array<{
		type: string
		dataOffset: number
		dataLength: number
	}> = []
	let offset = 8
	while (offset + 12 <= png.length) {
		const dataLength =
			((png[offset] << 24) |
				(png[offset + 1] << 16) |
				(png[offset + 2] << 8) |
				png[offset + 3]) >>>
			0
		const type = String.fromCharCode(
			png[offset + 4],
			png[offset + 5],
			png[offset + 6],
			png[offset + 7]
		)
		chunks.push({ type, dataOffset: offset + 8, dataLength })
		offset += 12 + dataLength
	}
	return chunks
}

const readU32 = (bytes: Uint8Array, offset: number): number =>
	((bytes[offset] << 24) |
		(bytes[offset + 1] << 16) |
		(bytes[offset + 2] << 8) |
		bytes[offset + 3]) >>>
	0

/** Minimal JPEG: SOI + JFIF APP0 (aspect-ratio density, like encoders emit)
 *  + a dummy SOS-ish tail. */
const makeJfifJpeg = (): Uint8Array<ArrayBuffer> =>
	new Uint8Array([
		0xff, 0xd8, // SOI
		0xff, 0xe0, 0x00, 0x10, // APP0, length 16
		0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
		0x01, 0x01, // version 1.1
		0x00, 0x00, 0x01, 0x00, 0x01, // units 0 (aspect), density 1×1
		0x00, 0x00, // no thumbnail
		0xff, 0xda, 0x00, 0x02, // SOS
	])

// ---------------------------------------------------------------------------

describe("crc32", () => {
	it("matches the standard check value", () => {
		const bytes = new Uint8Array([...`123456789`].map((c) => c.codePointAt(0) ?? 0))
		expect(crc32(bytes)).toBe(0xcb_f4_39_26)
	})
})

describe("withPngDpi", () => {
	it("inserts a pHYs chunk between IHDR and IDAT", () => {
		const out = withPngDpi(makePng(), 192)
		const chunks = listChunks(out)
		expect(chunks.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"])
		const phys = chunks[1]
		expect(phys.dataLength).toBe(9)
		// 192 dpi → 7559 pixels per meter, unit flag 1 (meter).
		expect(readU32(out, phys.dataOffset)).toBe(7559)
		expect(readU32(out, phys.dataOffset + 4)).toBe(7559)
		expect(out[phys.dataOffset + 8]).toBe(1)
	})

	it("writes a valid CRC for the inserted chunk", () => {
		const out = withPngDpi(makePng(), 96)
		const phys = listChunks(out).find((c) => c.type === "pHYs")
		if (!phys) throw new Error("pHYs not inserted")
		const body = out.subarray(phys.dataOffset - 4, phys.dataOffset + 9)
		expect(readU32(out, phys.dataOffset + 9)).toBe(crc32(body))
	})

	it("replaces an existing pHYs in place instead of adding a second", () => {
		const stale = pngChunk("pHYs", [0, 0, 0, 1, 0, 0, 0, 1, 0])
		const out = withPngDpi(makePng([stale]), 288)
		const chunks = listChunks(out)
		expect(chunks.filter((c) => c.type === "pHYs")).toHaveLength(1)
		const phys = chunks.find((c) => c.type === "pHYs")
		if (!phys) throw new Error("pHYs missing")
		// 288 dpi → 11339 pixels per meter.
		expect(readU32(out, phys.dataOffset)).toBe(11_339)
		expect(out.length).toBe(makePng([stale]).length)
	})

	it("returns non-PNG input untouched", () => {
		const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
		expect(withPngDpi(junk, 96)).toBe(junk)
	})
})

describe("withJpegDpi", () => {
	it("patches an existing JFIF APP0's density to dots-per-inch", () => {
		const out = withJpegDpi(makeJfifJpeg(), 192)
		expect(out.length).toBe(makeJfifJpeg().length)
		expect(out[13]).toBe(1) // units: dpi
		expect((out[14] << 8) | out[15]).toBe(192)
		expect((out[16] << 8) | out[17]).toBe(192)
	})

	it("inserts a JFIF APP0 after SOI when none exists", () => {
		const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])
		const out = withJpegDpi(bare, 96)
		expect(out.length).toBe(bare.length + 18)
		expect([...out.subarray(0, 2)]).toEqual([0xff, 0xd8])
		expect([...out.subarray(2, 4)]).toEqual([0xff, 0xe0])
		expect([...out.subarray(6, 11)]).toEqual([0x4a, 0x46, 0x49, 0x46, 0x00])
		expect(out[13]).toBe(1)
		expect((out[14] << 8) | out[15]).toBe(96)
		// Original stream continues after the inserted segment.
		expect([...out.subarray(20, 22)]).toEqual([0xff, 0xda])
	})

	it("returns non-JPEG input untouched", () => {
		const junk = new Uint8Array([1, 2, 3, 4])
		expect(withJpegDpi(junk, 96)).toBe(junk)
	})
})
