import { describe, expect, it } from "vitest"

import type { Visual } from "../types"
import { SETTING_CATALOG } from "./settingCatalog"

/** Every key of `Visual`, as a settings patch sees it. A key added to
 *  `Visual` fails the typecheck here until it is put on one side: a
 *  setting, or in NOT_SETTINGS (tooling/setting-catalog.js) with why not. */
const VISUAL_KEYS = {
	id: "not a setting",
	name: "not a setting",
	folderId: "not a setting",
	datasetId: "not a setting",
	createdAtVersionId: "not a setting",
	fieldTypeOverrides: "not a setting",
	encodings: "not a setting",
	channelConfigs: "setting",
	labelsConfig: "setting",
	legendConfig: "setting",
	tooltipConfig: "setting",
	mapConfig: "setting",
	reshapeConfig: "not a setting",
	derivedVariablesConfig: "not a setting",
	dataLabelsEncodings: "setting",
	dataLabelsConfig: "setting",
	themeId: "not a setting",
	fieldLevelOrders: "setting",
	fieldLevelOrderSpecs: "setting",
	fieldOrder: "setting",
	annotationsConfig: "setting",
	captionConfig: "setting",
	dataTableConfig: "setting",
	accessibilityConfig: "setting",
	thumbnail: "not a setting",
	thumbnailAt: "not a setting",
	createdAt: "not a setting",
	updatedAt: "not a setting",
	updatedBy: "not a setting",
	deletedAt: "not a setting",
} satisfies Record<keyof Visual, "setting" | "not a setting">

describe("the setting catalog", () => {
	it("has every key of Visual as a slice but the chart's identity and the spec's own keys", () => {
		const settings = Object.entries(VISUAL_KEYS)
			.filter(([, side]) => side === "setting")
			.map(([key]) => key)
			.sort()
		expect(SETTING_CATALOG.slices).toEqual(settings)
	})

	it("describes maps keyed by data as `*` entries, all the way down", () => {
		const t = SETTING_CATALOG.types
		expect(t["channelConfigs.facet.panelAxisOverrides.*.yMax"]?.kinds).toContain("number")
		expect(t["channelConfigs.colorSlots.line.hue.colors.*"]?.kinds).toEqual(["string"])
		expect(t["dataLabelsConfig.pieces.*.*.color.hue.colors.*"]?.kinds).toEqual(["string"])
		expect(t["labelsConfig.hiddenTitles.legend:hue"]?.kinds).toEqual(["boolean"])
	})

	it("walks a list's entries whole, with the fields each must have", () => {
		const t = SETTING_CATALOG.types
		expect(t["annotationsConfig.texts[].facetKeys"]?.kinds).toContain("list")
		expect(t["annotationsConfig.texts[].textAlign"]?.values).toEqual(expect.arrayContaining(["left", "right"]))
		expect(t["channelConfigs.categoricalPalette"]?.items?.kinds).toEqual(["string"])
		expect(SETTING_CATALOG.required["annotationsConfig.texts"]).toEqual(expect.arrayContaining(["id", "text"]))
	})

	it("knows the shapes an object may take, and the tag that picks each", () => {
		expect(SETTING_CATALOG.shapes["channelConfigs.colorSlots.line.hue"]).toEqual(
			expect.arrayContaining([{ must: expect.arrayContaining(["kind", "colors", "stackMode"]), tags: { kind: "categorical" } }])
		)
		expect(SETTING_CATALOG.shapes["channelConfigs.colorSlots.line"]).toEqual([{ must: ["field", "singleColor"], tags: {} }])
	})

	it("keeps each setting's doc comment", () => {
		expect(SETTING_CATALOG.docs["accessibilityConfig.description"]).toBeTruthy()
	})
})
