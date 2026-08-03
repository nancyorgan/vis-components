import { describe, expect, it } from "vitest"
import type { Encodings } from "../../../lib/types"
import { shouldShowStackToggle } from "./StackModeRow"

const enc = (m: Record<string, string>): Encodings =>
	Object.fromEntries(Object.entries(m).map(([k, f]) => [k, { field: f }])) as Encodings

describe("shouldShowStackToggle", () => {
	it("shows on every mapped channel when 2+ are mapped to different vars", () => {
		const e = enc({ hue: "region", pattern: "year" })
		expect(shouldShowStackToggle("hue", e)).toBe(true)
		expect(shouldShowStackToggle("pattern", e)).toBe(true)
	})

	it("shows on the channel when a single channel is mapped", () => {
		const e = enc({ hue: "region" })
		expect(shouldShowStackToggle("hue", e)).toBe(true)
		expect(shouldShowStackToggle("pattern", e)).toBe(false)
	})

	it("same variable on two channels → BOTH still get a toggle (no distinct-var constraint)", () => {
		const e = enc({ hue: "region", pattern: "region" })
		expect(shouldShowStackToggle("hue", e)).toBe(true)
		expect(shouldShowStackToggle("pattern", e)).toBe(true)
	})

	it("shows for saturation / brightness / opacity too when mapped", () => {
		const e = enc({ hue: "region", saturation: "region", opacity: "pop" })
		expect(shouldShowStackToggle("saturation", e)).toBe(true)
		expect(shouldShowStackToggle("opacity", e)).toBe(true)
		expect(shouldShowStackToggle("brightness", e)).toBe(false) // unmapped
	})

	it("hides when the channel isn't mapped", () => {
		expect(shouldShowStackToggle("pattern", enc({ hue: "region" }))).toBe(false)
	})

	it("regression: single channel unchanged — only the mapped channel gets a toggle", () => {
		// With just hue mapped, the pre-refactor behavior is a single toggle on
		// hue and no second toggle anywhere; the multi-channel engine stays
		// invisible to the common single-channel case.
		const e = enc({ hue: "region" })
		expect(shouldShowStackToggle("hue", e)).toBe(true)
		expect(shouldShowStackToggle("pattern", e)).toBe(false)
	})
})
