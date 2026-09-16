import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { COUNTRY_NAME_FORMAT } from "../../lib/geo/countryNames"
import { LITERAL_FORMAT } from "../../lib/formatTick"
import { FORMAT_PRESET_AUTO, formatPresetSelection } from "../../lib/formatPresets"
import { FormatPresetOptions } from "./FormatPresetOptions"

/** One preset list feeds every format dropdown (axis ticks, chord ring axis,
 *  data labels, legend). These pin the entries that had drifted between the
 *  per-panel copies before they were unified. */

afterEach(cleanup)

const optionValues = (countryNames?: boolean) => {
	const { container } = render(
		<select>
			<FormatPresetOptions countryNames={countryNames} />
		</select>
	)
	return Array.from(container.querySelectorAll("option")).map((o) => ({
		value: o.getAttribute("value"),
		text: o.textContent ?? "",
	}))
}

describe("FormatPresetOptions", () => {
	it("offers Whole numbers, Literal, and the full numeric + temporal set", () => {
		const opts = optionValues()
		const values = opts.map((o) => o.value)
		expect(values).toContain(",.0f")
		expect(opts.find((o) => o.value === ",.0f")?.text).toMatch(/Whole numbers/)
		expect(values).toContain(LITERAL_FORMAT)
		expect(values).toContain(FORMAT_PRESET_AUTO)
		for (const v of [",", ".2f", ".0%", ".1%", ".2e", "$,.0f", "$,.2f", ".3s"]) {
			expect(values).toContain(v)
		}
		for (const v of ["%Y-%m-%d", "%b %Y", "%Y", "%b %d", "%H:%M"]) {
			expect(values).toContain(v)
		}
	})

	it("adds the Geography group only when countryNames is set", () => {
		expect(optionValues().map((o) => o.value)).not.toContain(COUNTRY_NAME_FORMAT)
		expect(optionValues(true).map((o) => o.value)).toContain(COUNTRY_NAME_FORMAT)
	})
})

describe("formatPresetSelection", () => {
	it("maps Auto to the empty spec, the placeholder to a no-op, and presets verbatim", () => {
		expect(formatPresetSelection(FORMAT_PRESET_AUTO)).toBe("")
		expect(formatPresetSelection("")).toBeNull()
		expect(formatPresetSelection(",.0f")).toBe(",.0f")
		expect(formatPresetSelection(LITERAL_FORMAT)).toBe(LITERAL_FORMAT)
	})
})
