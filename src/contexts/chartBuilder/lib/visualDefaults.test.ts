import { describe, expect, it } from "vitest"

import { DEFAULT_ACCESSIBILITY_CONFIG } from "./accessibilityConfig"
import { DEFAULT_ANNOTATIONS_CONFIG } from "./annotationsConfig"
import { DEFAULT_CAPTION_CONFIG } from "./captionConfig"
import { DEFAULT_DATA_LABELS_CONFIG, EMPTY_CHANNEL_CONFIGS } from "./channelConfig"
import { DEFAULT_DATA_TABLE_CONFIG } from "./dataTableConfig"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "./derivedVariables"
import {
	DEFAULT_LABELS_CONFIG,
	DEFAULT_LEGEND_CONFIG,
	DEFAULT_TOOLTIP_CONFIG,
} from "./labelsConfig"
import { DEFAULT_MAP_CONFIG } from "./mapConfig"
import { DEFAULT_RESHAPE_CONFIG } from "./reshape"
import { SYSTEM_DARK_THEME, themeOf } from "./systemThemes"
import {
	captionConfigFromTheme,
	configsFromTheme,
	dataLabelsConfigFromTheme,
	labelsFromTheme,
	legendConfigFromTheme,
} from "./themeConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Visual,
} from "./types"
import { hydrateVisual, newVisualDraft } from "./visualDefaults"

const theme = themeOf(SYSTEM_DARK_THEME)

/** A visual saved before most per-visual slices existed. */
const legacy = (): Visual => ({
	id: "vs-old",
	name: "Old",
	folderId: null,
	datasetId: "ds-1",
	createdAtVersionId: null,
	fieldTypeOverrides: {},
	encodings: { x: { field: "a" } } as Visual["encodings"],
	channelConfigs: EMPTY_CHANNEL_CONFIGS,
	labelsConfig: DEFAULT_LABELS_CONFIG,
	thumbnail: null,
	createdAt: 1,
	updatedAt: 1,
})

describe("newVisualDraft", () => {
	it("seeds every theme-driven slice from the theme", () => {
		const draft = newVisualDraft(theme)
		expect(draft.channelConfigs).toEqual(configsFromTheme(theme))
		expect(draft.labelsConfig).toEqual(labelsFromTheme(theme))
		expect(draft.legendConfig).toEqual(legendConfigFromTheme(theme))
		expect(draft.dataLabelsConfig).toEqual(dataLabelsConfigFromTheme(theme))
		expect(draft.captionConfig).toEqual(captionConfigFromTheme(theme))
	})

	it("starts every other slice empty", () => {
		const draft = newVisualDraft(theme)
		expect(draft.encodings).toEqual(emptyEncodings())
		expect(draft.dataLabelsEncodings).toEqual(emptyDataLabelsEncodings())
		expect(draft.fieldTypeOverrides).toEqual({})
		expect(draft.fieldLevelOrders).toEqual({})
		expect(draft.fieldLevelOrderSpecs).toEqual({})
		expect(draft.tooltipConfig).toBe(DEFAULT_TOOLTIP_CONFIG)
		expect(draft.annotationsConfig).toBe(DEFAULT_ANNOTATIONS_CONFIG)
		expect(draft.dataTableConfig).toBe(DEFAULT_DATA_TABLE_CONFIG)
		expect(draft.accessibilityConfig).toBe(DEFAULT_ACCESSIBILITY_CONFIG)
		expect(draft.mapConfig).toBe(DEFAULT_MAP_CONFIG)
		expect(draft.reshapeConfig).toBe(DEFAULT_RESHAPE_CONFIG)
		expect(draft.derivedVariablesConfig).toBe(DEFAULT_DERIVED_VARIABLES_CONFIG)
	})
})

describe("hydrateVisual", () => {
	it("fills every slice a legacy visual lacks with its default", () => {
		const v = hydrateVisual(legacy())
		expect(v.encodings).toEqual({ ...emptyEncodings(), x: { field: "a" } })
		expect(v.legendConfig).toEqual(DEFAULT_LEGEND_CONFIG)
		expect(v.tooltipConfig).toEqual(DEFAULT_TOOLTIP_CONFIG)
		expect(v.dataLabelsEncodings).toEqual(emptyDataLabelsEncodings())
		expect(v.dataLabelsConfig).toEqual(DEFAULT_DATA_LABELS_CONFIG)
		expect(v.fieldLevelOrders).toEqual({})
		expect(v.fieldLevelOrderSpecs).toEqual({})
		expect(v.annotationsConfig).toEqual(DEFAULT_ANNOTATIONS_CONFIG)
		expect(v.captionConfig).toEqual(DEFAULT_CAPTION_CONFIG)
		expect(v.dataTableConfig).toEqual(DEFAULT_DATA_TABLE_CONFIG)
		expect(v.accessibilityConfig).toEqual(DEFAULT_ACCESSIBILITY_CONFIG)
		expect(v.mapConfig).toEqual(DEFAULT_MAP_CONFIG)
		expect(v.reshapeConfig).toEqual(DEFAULT_RESHAPE_CONFIG)
		expect(v.derivedVariablesConfig).toEqual(DEFAULT_DERIVED_VARIABLES_CONFIG)
	})

	it("keeps identity fields and what the visual already carries", () => {
		const v = hydrateVisual({
			...legacy(),
			themeId: "t-1",
			mapConfig: { ...DEFAULT_MAP_CONFIG, coordSystem: "geographic" },
		})
		expect(v.id).toBe("vs-old")
		expect(v.themeId).toBe("t-1")
		expect(v.mapConfig?.coordSystem).toBe("geographic")
	})

	it("is idempotent", () => {
		const once = hydrateVisual(legacy())
		expect(hydrateVisual(once)).toEqual(once)
	})

	it("changes nothing on a visual built from a fresh draft", () => {
		const v: Visual = {
			...legacy(),
			...newVisualDraft(theme),
		}
		expect(hydrateVisual(v)).toEqual(v)
	})
})
