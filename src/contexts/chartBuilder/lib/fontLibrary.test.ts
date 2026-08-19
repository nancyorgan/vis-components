import { describe, expect, it } from "vitest"

import {
	fontStackFor,
	userFontFamilyOptions,
	userFontId,
	userFontWeightsByStack,
	type UserFont,
} from "./fontLibrary"

describe("fontStackFor", () => {
	it("routes mono-named families to a monospace fallback", () => {
		expect(fontStackFor("Space Mono")).toBe(
			"'Space Mono', ui-monospace, monospace"
		)
	})

	it("routes serif/slab-named families to a serif fallback", () => {
		expect(fontStackFor("Roboto Slab")).toBe("'Roboto Slab', Georgia, serif")
		expect(fontStackFor("IBM Plex Serif")).toBe(
			"'IBM Plex Serif', Georgia, serif"
		)
	})

	it("defaults to sans — including sans-serif-named families", () => {
		expect(fontStackFor("Inter")).toBe("'Inter', system-ui, sans-serif")
		// "sans-serif" contains "serif": the sans check must win.
		expect(fontStackFor("Open Sans")).toBe(
			"'Open Sans', system-ui, sans-serif"
		)
	})
})

describe("userFontId", () => {
	it("slugs the family name", () => {
		expect(userFontId("Roboto Slab")).toBe("gf-roboto-slab")
		expect(userFontId("  IBM Plex Sans ")).toBe("gf-ibm-plex-sans")
	})
})

const font = (family: string, weights: number[]): UserFont => ({
	id: userFontId(family),
	family,
	stack: fontStackFor(family),
	weights,
	hasItalic: false,
	faces: [],
	addedAt: "2026-08-19T00:00:00.000Z",
})

describe("picker derivations", () => {
	it("maps fonts to family options labeled by family, valued by stack", () => {
		expect(userFontFamilyOptions([font("Lora", [400, 700])])).toEqual([
			{ label: "Lora", value: "'Lora', system-ui, sans-serif" },
		])
	})

	it("keys weight lists by stack for fontWeightOptionsFor", () => {
		expect(userFontWeightsByStack([font("Lora", [400, 700])])).toEqual({
			"'Lora', system-ui, sans-serif": [400, 700],
		})
	})
})
