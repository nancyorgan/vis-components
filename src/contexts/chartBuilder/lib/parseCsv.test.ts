// @vitest-environment node
import { describe, expect, it } from "vitest"

import { decodeUploadBytes, estimatedRowBytes, parseCsvText, parseCsvTextWithin } from "./parseCsv"

const NO_LIMIT = { maxRows: Infinity, maxCells: Infinity, maxParsedBytes: Infinity }

/** What `parseCsvText` makes of `text`, as the bounded parse reports it. */
const editorParse = (text: string) => {
	try {
		return { ok: true, ...parseCsvText(text) }
	} catch (error) {
		return { ok: false, error: (error as Error).message }
	}
}

/** A small seeded generator, so a failing case can be replayed. */
const rng = (seed: number) => () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff
	return seed / 0x7fffffff
}

const PIECES = ["a", "b", "1", "1,204", '"', '""', ",", "\n", "\r\n", " ", "x y", "é", "\t", ";", ""]

/** A CSV-ish text: mostly well-formed rows with quoted cells, plus the
 *  odd stray quote, blank line, CRLF and ragged row. */
const fuzzCsv = (next: () => number): string => {
	const cols = 1 + Math.floor(next() * 4)
	const delim = next() < 0.8 ? "," : next() < 0.5 ? "\t" : ";"
	const cell = () => {
		const parts = Array.from({ length: Math.floor(next() * 3) }, () => PIECES[Math.floor(next() * PIECES.length)])
		const raw = parts.join("")
		return next() < 0.5 ? `"${raw.replace(/"/g, '""')}"` : raw.replace(/[",\n\r\t;]/g, "")
	}
	const lines: string[] = []
	const n = Math.floor(next() * 40)
	for (let i = 0; i <= n; i++) {
		if (i > 0 && next() < 0.1) {
			lines.push("")
			continue
		}
		const width = next() < 0.05 ? cols + 1 : cols
		lines.push(Array.from({ length: width }, cell).join(delim))
	}
	const nl = next() < 0.3 ? "\r\n" : "\n"
	return (next() < 0.2 ? "﻿" : "") + lines.join(nl) + (next() < 0.5 ? nl : "")
}

describe("parseCsvTextWithin", () => {
	it("returns exactly what the editor's parse returns", () => {
		const next = rng(7)
		for (let i = 0; i < 400; i++) {
			const text = fuzzCsv(next)
			expect(parseCsvTextWithin(text, NO_LIMIT), `fuzz case ${i}`).toEqual(editorParse(text))
		}
	})

	it("returns exactly what the editor's parse returns across chunk boundaries", () => {
		const next = rng(11)
		for (const [delim, nl] of [
			[",", "\n"],
			[",", "\r\n"],
			["\t", "\n"],
			[";", "\r\n"],
		]) {
			// ~3 MB of well-formed rows (quoted cells holding delimiters,
			// quotes and line breaks; blank lines): chunks of 1 MB, the
			// smallest the parse takes, split rows and quoted cells.
			const cols = 2 + Math.floor(next() * 4)
			const cell = () => {
				const raw = Array.from({ length: 1 + Math.floor(next() * 4) }, () => PIECES[Math.floor(next() * PIECES.length)]).join("")
				return /[",;\t\r\n]/.test(raw) || next() < 0.3 ? `"${raw.replace(/"/g, '""')}"` : raw
			}
			const lines = [Array.from({ length: cols }, (_, i) => `c${i}`).join(delim)]
			let size = 0
			while (size < 3_000_000) {
				const line = next() < 0.02 ? "" : Array.from({ length: cols }, cell).join(delim)
				lines.push(line)
				size += line.length + nl.length
			}
			const text = lines.join(nl)
			const want = editorParse(text)
			expect(want.ok).toBe(true)
			expect(parseCsvTextWithin(text, NO_LIMIT, { chunkChars: 1 })).toEqual(want)
		}
		// 12 MB through two parsers: ~3 s locally, 15 s on a CI runner under
		// coverage — past the 5 s default.
	}, 60_000)

	it("matches on the upload cases: BOM, a quoted header comma, a quoted 1,204, blank lines, header order", () => {
		for (const text of [
			'﻿"Region, area",Sales\nEast,"1,204"\n\nWest,7\n\n',
			"2024,2023,Region\n1,2,East\n",
			"Only\nx\n",
			"a,b\n",
			"",
			'a,b\n1,"two\nlines"\n3,4\n',
		])
			expect(parseCsvTextWithin(text, NO_LIMIT, { chunkChars: 4 })).toEqual(editorParse(text))
		expect(parseCsvTextWithin("2024,2023,Region\n1,2,East\n", NO_LIMIT)).toMatchObject({
			fieldNames: ["2024", "2023", "Region"],
		})
	})

	it("reads a header with no data rows as the editor does: its fields, no rows", () => {
		expect(parseCsvTextWithin("a\tb\n\n", NO_LIMIT, { delimiter: "\t" })).toEqual({
			ok: true,
			fieldNames: ["a", "b"],
			rows: [],
		})
	})

	it("parses a forced tab delimiter", () => {
		expect(parseCsvTextWithin("a,1\tb\nx,2\ty\n", NO_LIMIT, { delimiter: "\t" })).toEqual({
			ok: true,
			fieldNames: ["a,1", "b"],
			rows: [{ "a,1": "x,2", b: "y" }],
		})
	})

	it("stops at the first limit passed and keeps nothing", () => {
		const text = "a,b\n" + "1,2\n".repeat(10)
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxRows: 10 })).toMatchObject({ ok: true })
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxRows: 9 })).toEqual({ ok: false, limit: "rows" })
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxCells: 20 })).toMatchObject({ ok: true })
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxCells: 19 })).toEqual({ ok: false, limit: "cells" })
		const one = estimatedRowBytes({ a: "1", b: "2" })
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxParsedBytes: one * 10 })).toMatchObject({ ok: true })
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxParsedBytes: one * 10 - 1 })).toEqual({
			ok: false,
			limit: "memory",
		})
	})

	it("stops two million rows at a million", () => {
		const text = "v\n" + "1\n".repeat(2_000_000)
		expect(parseCsvTextWithin(text, { ...NO_LIMIT, maxRows: 1_000_000 })).toEqual({ ok: false, limit: "rows" })
	})
})

describe("decodeUploadBytes", () => {
	it("reads bytes as File.text() does: UTF-8, BOM dropped", async () => {
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("é,b\n1,2\n")])
		expect(decodeUploadBytes(bytes)).toBe("é,b\n1,2\n")
		expect(decodeUploadBytes(bytes)).toBe(await new Blob([bytes]).text())
	})
})
