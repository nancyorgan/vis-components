import { describe, expect, it } from "vitest"

import { DEFAULT_AXIS_CONFIG, type ChannelConfigs } from "./channelConfig"
import {
	DOLLAR_FORMAT_SPEC,
	applyDollarDefaultsToChannelConfigs,
	applyDollarDefaultsToDataLabels,
	applyDollarDefaultsToLegendConfig,
	dollarFieldSet,
} from "./dollarFormatDefaults"
import type { LegendConfig } from "./labelsConfig"
import { emptyEncodings } from "./types"

const encodingsWith = (channel: "x" | "y" | "hue" | "area", field: string) => {
	const e = emptyEncodings()
	e[channel] = { field }
	return e
}

describe("dollarFieldSet", () => {
	it("collects only dollar-hinted fields", () => {
		const set = dollarFieldSet({
			id: "d",
			name: "n",
			filename: "f",
			fields: [
				{ name: "Revenue", inferredType: "quantitative", formatHint: "dollar" },
				{ name: "Count", inferredType: "quantitative" },
			],
			rows: [],
			createdAt: 0,
			versionId: "v",
			versionIndex: 1,
			totalVersions: 1,
			isLatest: true,
			versionCreatedAt: 0,
		})
		expect([...set]).toEqual(["Revenue"])
		expect([...dollarFieldSet(undefined)]).toEqual([])
	})
})

describe("applyDollarDefaultsToChannelConfigs", () => {
	const dollar = new Set(["Revenue"])

	it("injects the dollar spec into an Auto axis mapped to a dollar field", () => {
		const configs: ChannelConfigs = { y: { ...DEFAULT_AXIS_CONFIG } }
		const out = applyDollarDefaultsToChannelConfigs(
			configs,
			encodingsWith("y", "Revenue"),
			dollar
		)
		expect(out.y?.customFormat).toBe(DOLLAR_FORMAT_SPEC)
		// stored configs untouched
		expect(configs.y?.customFormat).toBe("")
	})

	it("creates the axis config when none exists yet", () => {
		const out = applyDollarDefaultsToChannelConfigs(
			{},
			encodingsWith("x", "Revenue"),
			dollar
		)
		expect(out.x?.customFormat).toBe(DOLLAR_FORMAT_SPEC)
		expect(out.x?.tickCount).toBe(DEFAULT_AXIS_CONFIG.tickCount)
	})

	it("falls back to the length field for an unmapped measure axis (bar charts)", () => {
		// Vertical bars: x = category, measure on `length`, y unmapped — the
		// rendered y axis shows the length values, so it takes the default.
		const e = emptyEncodings()
		e.x = { field: "Region" }
		e.length = { field: "Revenue" }
		const out = applyDollarDefaultsToChannelConfigs(
			{ x: { ...DEFAULT_AXIS_CONFIG }, y: { ...DEFAULT_AXIS_CONFIG } },
			e,
			dollar
		)
		expect(out.y?.customFormat).toBe(DOLLAR_FORMAT_SPEC)
		// the category axis has its own (non-dollar) field — untouched
		expect(out.x?.customFormat).toBe("")
	})

	it("never overrides a user-picked format", () => {
		const configs: ChannelConfigs = {
			y: { ...DEFAULT_AXIS_CONFIG, customFormat: ".3s" },
		}
		const out = applyDollarDefaultsToChannelConfigs(
			configs,
			encodingsWith("y", "Revenue"),
			dollar
		)
		expect(out).toBe(configs)
	})

	it("is identity when the mapped field is not dollar-hinted", () => {
		const configs: ChannelConfigs = { y: { ...DEFAULT_AXIS_CONFIG } }
		expect(
			applyDollarDefaultsToChannelConfigs(
				configs,
				encodingsWith("y", "Count"),
				dollar
			)
		).toBe(configs)
		expect(
			applyDollarDefaultsToChannelConfigs(
				configs,
				encodingsWith("y", "Revenue"),
				new Set()
			)
		).toBe(configs)
	})
})

describe("applyDollarDefaultsToLegendConfig", () => {
	const dollar = new Set(["Revenue"])

	it("injects the dollar spec into an Auto quantitative-legend channel", () => {
		const cfg: Pick<Partial<LegendConfig>, "channels"> = { channels: {} }
		const out = applyDollarDefaultsToLegendConfig(
			cfg,
			encodingsWith("hue", "Revenue"),
			dollar
		)
		expect(out.channels?.hue?.format).toBe(DOLLAR_FORMAT_SPEC)
		expect(cfg.channels).toEqual({})
	})

	it("leaves an explicit legend format alone", () => {
		const cfg = {
			channels: { area: { format: ".0f", breakCount: 5, breaks: [] } },
		}
		expect(
			applyDollarDefaultsToLegendConfig(
				cfg,
				encodingsWith("area", "Revenue"),
				dollar
			)
		).toBe(cfg)
	})
})

describe("applyDollarDefaultsToDataLabels", () => {
	const dollar = new Set(["Revenue"])

	it("injects a per-field format for dollar fields without one", () => {
		const cfg = { fieldFormats: { Other: ".1%" } }
		const out = applyDollarDefaultsToDataLabels(cfg, dollar)
		expect(out.fieldFormats).toEqual({
			Other: ".1%",
			Revenue: DOLLAR_FORMAT_SPEC,
		})
	})

	it("leaves an explicit per-field format alone", () => {
		const cfg = { fieldFormats: { Revenue: ",.0f" } }
		expect(applyDollarDefaultsToDataLabels(cfg, dollar)).toBe(cfg)
	})
})
