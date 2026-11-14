import { describe, expect, it } from "vitest"

import { aestheticGroupEncodings, GROUP_CHANNEL_ORDER } from "./groupEncodings"

const mapped = (name: string, type: "categorical" | "quantitative" = "categorical") => ({
	field: { name, type },
})

describe("aestheticGroupEncodings", () => {
	it("lists one encoding per mapped group channel, in the slice-key order", () => {
		expect(
			aestheticGroupEncodings({
				opacity: mapped("alpha", "quantitative"),
				hue: mapped("series"),
				pattern: mapped("kind"),
			})
		).toEqual([
			{ channel: "hue", field: "series", type: "categorical" },
			{ channel: "pattern", field: "kind", type: "categorical" },
			{ channel: "opacity", field: "alpha", type: "quantitative" },
		])
	})

	it("includes the outline color, so a mark splits by its outline variable", () => {
		// The pie's own copy of this list used to leave it out.
		expect(
			aestheticGroupEncodings({ hue: mapped("series"), outlineHue: mapped("tier") })
		).toEqual([
			{ channel: "hue", field: "series", type: "categorical" },
			{ channel: "outlineHue", field: "tier", type: "categorical" },
		])
	})

	it("skips unmapped channels", () => {
		expect(aestheticGroupEncodings({})).toEqual([])
		expect(aestheticGroupEncodings({ hue: null, saturation: undefined })).toEqual([])
	})

	it("orders hue first and opacity last", () => {
		expect(GROUP_CHANNEL_ORDER[0]).toBe("hue")
		expect(GROUP_CHANNEL_ORDER[GROUP_CHANNEL_ORDER.length - 1]).toBe("opacity")
	})
})
