import { describe, expect, it } from "vitest"

import {
	DEFAULT_BRIGHTNESS_CONFIG,
	DEFAULT_OPACITY_QUANTITATIVE,
	DEFAULT_SATURATION_CONFIG,
	type ChannelConfigs,
} from "../../../lib/channelConfig"
import { writeStackMode } from "./StackModeRow"

describe("writeStackMode: saturation / brightness (phase 2)", () => {
	it("saturation: writes stackMode onto DEFAULT_SATURATION_CONFIG when the slot is absent", () => {
		const next = writeStackMode({}, "saturation", "group")
		expect(next.saturation).toEqual({
			min: DEFAULT_SATURATION_CONFIG.min,
			max: DEFAULT_SATURATION_CONFIG.max,
			stackMode: "group",
		})
	})

	it("brightness: writes stackMode onto DEFAULT_BRIGHTNESS_CONFIG when the slot is absent", () => {
		const next = writeStackMode({}, "brightness", "group")
		expect(next.brightness).toEqual({
			min: DEFAULT_BRIGHTNESS_CONFIG.min,
			max: DEFAULT_BRIGHTNESS_CONFIG.max,
			stackMode: "group",
		})
	})

	it("saturation: preserves an existing min/max while setting stackMode", () => {
		const prev = { saturation: { min: 0.3, max: 0.9 } } as ChannelConfigs
		const next = writeStackMode(prev, "saturation", "overlay")
		expect(next.saturation).toEqual({ min: 0.3, max: 0.9, stackMode: "overlay" })
	})

	it("opacity: seeds the quantitative default when the slot is absent", () => {
		const next = writeStackMode({}, "opacity", "group")
		expect(next.opacity).toEqual({
			...DEFAULT_OPACITY_QUANTITATIVE,
			stackMode: "group",
		})
	})

	it("opacity: preserves an existing categorical config (kind + overrides) while setting stackMode", () => {
		const prev = {
			opacity: { kind: "categorical", overrides: { A: 0.5 } },
		} as ChannelConfigs
		const next = writeStackMode(prev, "opacity", "overlay")
		expect(next.opacity).toEqual({
			kind: "categorical",
			overrides: { A: 0.5 },
			stackMode: "overlay",
		})
	})
})
