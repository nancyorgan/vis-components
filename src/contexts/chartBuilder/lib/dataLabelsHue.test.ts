import { describe, expect, it } from "vitest"

import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "./channelConfig"
import { buildLabelHueConfig } from "./dataLabelsHue"

const baseCfg: DataLabelsConfig = { ...DEFAULT_DATA_LABELS_CONFIG }

describe("buildLabelHueConfig", () => {
	describe("categorical fields", () => {
		it("returns null when no palette is selected", () => {
			expect(buildLabelHueConfig(baseCfg, "categorical")).toBeNull()
			expect(buildLabelHueConfig(baseCfg, "ordinal")).toBeNull()
		})

		it("returns a categorical HueConfig when a palette has colors", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				paletteId: "p1",
				palette: ["#a", "#b", "#c"],
			}
			const result = buildLabelHueConfig(cfg, "categorical")
			expect(result).toEqual({
				kind: "categorical",
				colors: {},
				stackMode: "stack",
			})
		})

		it("treats ordinal fields the same as categorical", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				paletteId: "p1",
				palette: ["#a", "#b"],
			}
			const result = buildLabelHueConfig(cfg, "ordinal")
			expect(result?.kind).toBe("categorical")
		})
	})

	describe("quantitative fields", () => {
		it("returns null when no gradient is selected", () => {
			expect(buildLabelHueConfig(baseCfg, "quantitative")).toBeNull()
			expect(buildLabelHueConfig(baseCfg, "temporal")).toBeNull()
		})

		it("emits a preset HueConfig when gradientId is a d3 preset name", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				gradientId: "viridis",
				gradientColors: null,
			}
			const result = buildLabelHueConfig(cfg, "quantitative")
			expect(result).toMatchObject({
				kind: "quantitative",
				palette: "viridis",
			})
		})

		it("emits a customLinear HueConfig when gradientColors has only low/high", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				gradientId: "my-linear",
				gradientColors: { low: "#000", mid: null, high: "#fff" },
			}
			const result = buildLabelHueConfig(cfg, "quantitative")
			expect(result).toMatchObject({
				kind: "quantitative",
				palette: "customLinear",
				lowColor: "#000",
				midColor: null,
				highColor: "#fff",
			})
		})

		it("emits a customDiverging HueConfig when gradientColors has a mid stop", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				gradientId: "my-diverging",
				gradientColors: { low: "#f00", mid: "#fff", high: "#0f0" },
			}
			const result = buildLabelHueConfig(cfg, "quantitative")
			expect(result).toMatchObject({
				kind: "quantitative",
				palette: "customDiverging",
				lowColor: "#f00",
				midColor: "#fff",
				highColor: "#0f0",
			})
		})

		it("treats temporal fields the same as quantitative", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				gradientId: "plasma",
			}
			const result = buildLabelHueConfig(cfg, "temporal")
			expect(result?.kind).toBe("quantitative")
		})
	})

	describe("type / palette mismatches", () => {
		it("ignores `palette` for quantitative fields (gradient required, not categorical palette)", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				palette: ["#a", "#b"],
				paletteId: "p1",
			}
			expect(buildLabelHueConfig(cfg, "quantitative")).toBeNull()
		})

		it("ignores `gradientId` for categorical fields", () => {
			const cfg: DataLabelsConfig = {
				...baseCfg,
				gradientId: "viridis",
			}
			expect(buildLabelHueConfig(cfg, "categorical")).toBeNull()
		})
	})
})
