// @vitest-environment node
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { NOT_SETTINGS, settingCatalogText } from "../../../../tooling/build-setting-catalog.js"
import catalog from "./settingCatalog.json"
import type { Visual } from "./types"

/** Every key of `Visual`, sorted into a settings slice or the script's deny
 *  list. A key added to `Visual` fails to compile here until it is placed. */
const PLACED = {
	id: "deny",
	name: "deny",
	folderId: "deny",
	datasetId: "deny",
	createdAtVersionId: "deny",
	fieldTypeOverrides: "deny",
	encodings: "deny",
	channelConfigs: "slice",
	labelsConfig: "slice",
	legendConfig: "slice",
	tooltipConfig: "slice",
	mapConfig: "slice",
	reshapeConfig: "deny",
	derivedVariablesConfig: "deny",
	dataLabelsEncodings: "slice",
	dataLabelsConfig: "slice",
	themeId: "deny",
	fieldLevelOrders: "slice",
	fieldLevelOrderSpecs: "slice",
	fieldOrder: "slice",
	annotationsConfig: "slice",
	captionConfig: "slice",
	dataTableConfig: "slice",
	accessibilityConfig: "slice",
	thumbnail: "deny",
	thumbnailAt: "deny",
	createdAt: "deny",
	updatedAt: "deny",
	updatedBy: "deny",
	deletedAt: "deny",
	template: "deny",
	templateId: "deny",
} as const satisfies Record<keyof Visual, "slice" | "deny">

const paths = catalog.paths as Record<string, { kinds?: string[]; values?: string[]; format?: boolean; color?: boolean }>

describe("settingCatalog.json", () => {
	it("is current with lib/types.ts", () => {
		const committed = readFileSync(new URL("./settingCatalog.json", import.meta.url), "utf8")
		expect(
			settingCatalogText() === committed,
			"settingCatalog.json is stale: run `pnpm settings:catalog` and commit the result"
		).toBe(true)
		// Regenerating walks lib/types.ts with the TypeScript checker: ~1.5 s
		// locally, 6.6 s on a CI runner under coverage — past the 5 s default.
	}, 60_000)

	it("places every Visual key as a slice or a NOT_SETTINGS entry", () => {
		const entries = Object.entries(PLACED)
		expect(catalog.slices).toEqual(entries.filter(([, p]) => p === "slice").map(([k]) => k).sort())
		expect(Object.keys(NOT_SETTINGS).sort()).toEqual(
			entries.filter(([, p]) => p === "deny").map(([k]) => k).sort()
		)
	})

	it("describes known paths", () => {
		expect(paths["channelConfigs.x.gridlines.enabled"]?.kinds).toEqual(["boolean"])
		expect(paths["channelConfigs.facet.shareY"]).toMatchObject({
			kinds: ["boolean", "string"],
			values: ["all", "none", "perGroup"],
		})
		expect(paths["channelConfigs.facet.panelAxisOverrides.*.yMin"]?.kinds).toEqual(["number"])
		expect(paths["annotationsConfig.texts"]?.kinds).toEqual(["list"])
		expect(paths["annotationsConfig.texts[].id"]?.kinds).toEqual(["string"])
		expect(paths["channelConfigs.x.customFormat"]?.format).toBe(true)
		expect(paths["dataLabelsConfig.fieldFormats.*"]?.format).toBe(true)
		expect(paths["channelConfigs.defaultFill"]?.color).toBe(true)
		expect(paths["channelConfigs.defaultSaturation"]?.kinds).toEqual(["null", "number"])
	})
})
