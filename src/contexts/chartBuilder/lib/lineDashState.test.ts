import { describe, expect, it } from "vitest"

import { DEFAULT_CONNECTION_CONFIG } from "./channelConfig"
import { lineDashInEffect } from "./lineDashState"

const withConnection = (patch: Record<string, unknown>) => ({
	connection: { ...DEFAULT_CONNECTION_CONFIG, ...patch },
})

describe("lineDashInEffect", () => {
	it("is false for a solid line with no Pattern variable", () => {
		expect(lineDashInEffect({}, false)).toBe(false)
		expect(lineDashInEffect(withConnection({}), false)).toBe(false)
		expect(lineDashInEffect(withConnection({ defaultDashPattern: "solid" }), false)).toBe(false)
	})

	it("is true once a dash swatch or a custom pattern is picked", () => {
		expect(lineDashInEffect(withConnection({ defaultDashPattern: "dashed" }), false)).toBe(true)
		expect(lineDashInEffect(withConnection({ customDashPattern: "4,2" }), false)).toBe(true)
		// "Blank" is a dash pick too (it leaves a gap inside a range).
		expect(lineDashInEffect(withConnection({ defaultDashPattern: "blank" }), false)).toBe(true)
	})

	it("is true with a Pattern variable mapped, whose categories take dashes from the cycle", () => {
		expect(lineDashInEffect({}, true)).toBe(true)
	})

	it("ignores gap and range settings left behind on a solid line", () => {
		expect(
			lineDashInEffect(
				withConnection({ dashGapFill: true, dashRange: { enabled: true, min: 1, max: 2 } }),
				false
			)
		).toBe(false)
	})
})
