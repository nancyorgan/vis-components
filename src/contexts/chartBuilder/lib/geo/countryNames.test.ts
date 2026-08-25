import { describe, expect, it } from "vitest"

import { ISO_COUNTRIES } from "./isoCountries"
import {
	COUNTRY_NAME_ROWS,
	countryNameAliases,
	fullCountryName,
} from "./countryNames"
import { normalizeName } from "./resolveGeography"

describe("COUNTRY_NAME_ROWS invariants", () => {
	it("every row's numeric resolves in the ISO table (canonical feature ids)", () => {
		const isoNumerics = new Set(ISO_COUNTRIES.map((r) => r.numeric))
		for (const row of COUNTRY_NAME_ROWS) {
			expect(isoNumerics.has(row.numeric), row.atlas).toBe(true)
		}
	})

	it("atlas names match the ISO table's names verbatim (the world-atlas forms)", () => {
		const byNumeric = new Map(ISO_COUNTRIES.map((r) => [r.numeric, r.name]))
		for (const row of COUNTRY_NAME_ROWS) {
			expect(byNumeric.get(row.numeric), row.atlas).toBe(row.atlas)
		}
	})

	it("no numeric appears twice", () => {
		const numerics = COUNTRY_NAME_ROWS.map((r) => r.numeric)
		expect(new Set(numerics).size).toBe(numerics.length)
	})

	it("every normalized name form is unambiguous across ALL countries", () => {
		// A single alias claimed by two countries would make resolveGeography's
		// ambiguity guard drop the key — silently killing a legitimate join
		// (possibly a country's PRIMARY atlas name). Forms are checked across
		// the whole space: every ISO name plus every atlas/full/alias form.
		const claims = new Map<string, string>() // normalized form -> numeric
		const claim = (form: string, numeric: string) => {
			const key = normalizeName(form)
			expect(key, form).not.toBe("")
			const existing = claims.get(key)
			if (existing !== undefined) {
				expect(existing, `"${form}" claimed by ${existing} and ${numeric}`).toBe(
					numeric
				)
			}
			claims.set(key, numeric)
		}
		for (const row of ISO_COUNTRIES) claim(row.name, row.numeric)
		for (const row of COUNTRY_NAME_ROWS) {
			claim(row.atlas, row.numeric)
			if (row.full) claim(row.full, row.numeric)
			for (const alias of row.aliases ?? []) claim(alias, row.numeric)
		}
	})

	it("the two Congos share no normalized form", () => {
		const forms = (numeric: string): Set<string> => {
			const row = COUNTRY_NAME_ROWS.find((r) => r.numeric === numeric)!
			return new Set(
				[row.atlas, row.full, ...(row.aliases ?? [])]
					.filter((f): f is string => f != null)
					.map(normalizeName)
			)
		}
		const drc = forms("180")
		const congo = forms("178")
		for (const f of drc) expect(congo.has(f), f).toBe(false)
	})
})

describe("countryNameAliases", () => {
	it("returns the full form plus variants for abbreviated atlas names", () => {
		const aliases = countryNameAliases("180")!
		expect(aliases).toContain("Democratic Republic of the Congo")
		expect(aliases).toContain("DR Congo")
	})
	it("returns variants alone when the atlas name is already full", () => {
		const aliases = countryNameAliases("840")!
		expect(aliases).toContain("USA")
		expect(aliases).not.toContain("United States of America")
	})
	it("returns undefined for countries that need no aliases", () => {
		expect(countryNameAliases("250")).toBeUndefined() // France
		expect(countryNameAliases("no-such")).toBeUndefined()
	})
})

describe("fullCountryName", () => {
	it("expands abbreviated atlas short names", () => {
		expect(fullCountryName("Dem. Rep. Congo")).toBe(
			"Democratic Republic of the Congo"
		)
		expect(fullCountryName("S. Sudan")).toBe("South Sudan")
		expect(fullCountryName("Eq. Guinea")).toBe("Equatorial Guinea")
		expect(fullCountryName("Bosnia and Herz.")).toBe("Bosnia and Herzegovina")
	})
	it("keeps the two Congos distinct", () => {
		expect(fullCountryName("Congo")).toBe("Republic of the Congo")
		expect(fullCountryName("Congo-Kinshasa")).toBe(
			"Democratic Republic of the Congo"
		)
		expect(fullCountryName("Congo, Rep.")).toBe("Republic of the Congo")
		expect(fullCountryName("Congo, Dem. Rep.")).toBe(
			"Democratic Republic of the Congo"
		)
	})
	it("resolves common variants to the preferred long form", () => {
		expect(fullCountryName("USA")).toBe("United States of America")
		expect(fullCountryName("United States")).toBe("United States of America")
		expect(fullCountryName("UK")).toBe("United Kingdom")
		expect(fullCountryName("Swaziland")).toBe("Eswatini")
		expect(fullCountryName("Czechia")).toBe("Czech Republic")
		expect(fullCountryName("Ivory Coast")).toBe("Côte d'Ivoire")
		expect(fullCountryName("Burma")).toBe("Myanmar")
		expect(fullCountryName("Republic of Korea")).toBe("South Korea")
	})
	it("resolves ISO alpha and numeric codes", () => {
		expect(fullCountryName("US")).toBe("United States of America")
		expect(fullCountryName("gbr")).toBe("United Kingdom")
		expect(fullCountryName("180")).toBe("Democratic Republic of the Congo")
		expect(fullCountryName("4")).toBe("Afghanistan") // pad-tolerant
	})
	it("passes through already-full names case/diacritic-insensitively", () => {
		expect(fullCountryName("france")).toBe("France")
		expect(fullCountryName("Cote d'Ivoire")).toBe("Côte d'Ivoire")
	})
	it("returns null for unrecognized values (callers print them as-is)", () => {
		expect(fullCountryName("Atlantis")).toBeNull()
		expect(fullCountryName("Texas")).toBeNull()
		expect(fullCountryName("")).toBeNull()
		// Bare "Korea" is genuinely ambiguous — deliberately not aliased.
		expect(fullCountryName("Korea")).toBeNull()
	})
})
