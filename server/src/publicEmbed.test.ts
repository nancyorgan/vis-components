// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import {
	PUBLIC_DATASET_KEYS,
	PUBLIC_FIELD_KEYS,
	PUBLIC_FONT_KEYS,
	PUBLIC_PAYLOAD_KEYS,
	PUBLIC_THEME_KEYS,
	PUBLIC_THEME_STYLE_KEYS,
	PUBLIC_VERSION_KEYS,
	PUBLIC_VISUAL_KEYS,
	toPublicPayload,
	validatePublicPayload,
} from "./publicEmbed.js"

/** The public boundary for published embeds. A published page is on the
 *  public internet: these lists are everything it may hold. */

describe("the publish dir", () => {
	// Everything written under the publish dir is public. These are the
	// modules that know where it is: config and main (the setting and the
	// startup wiring), routes (passes it on), and the three that write —
	// embedFiles (an embed's pages and pictures), embedRuntimeFiles (the
	// shared app, the startup conversion) and addinFiles (the add-in). A new
	// one means a new way for something to become public: decide it here.
	it("is touched only by the modules that own it", () => {
		const dir = dirname(fileURLToPath(import.meta.url))
		const touching = readdirSync(dir)
			.filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
			.filter((name) => readFileSync(join(dir, name), "utf-8").includes("publishDir"))
		expect(touching.sort()).toEqual([
			"addinFiles.ts",
			"config.ts",
			"embedFiles.ts",
			"embedRuntimeFiles.ts",
			"main.ts",
			"routes.ts",
		])
	})
})

describe("the allowlists", () => {
	// Deliberately a second copy: publishing a new field takes an edit here
	// too, with the reason the embed needs it to draw.
	it("are exactly these fields", () => {
		expect(PUBLIC_PAYLOAD_KEYS).toEqual(["visual", "dataset", "theme", "fonts", "zctaTopology"])
		expect(PUBLIC_VISUAL_KEYS).toEqual([
			"id",
			"name",
			"datasetId",
			"themeId",
			"fieldTypeOverrides",
			"encodings",
			"channelConfigs",
			"labelsConfig",
			"legendConfig",
			"tooltipConfig",
			"mapConfig",
			"reshapeConfig",
			"derivedVariablesConfig",
			"dataLabelsEncodings",
			"dataLabelsConfig",
			"fieldLevelOrders",
			"fieldLevelOrderSpecs",
			"fieldOrder",
			"annotationsConfig",
			"captionConfig",
			"dataTableConfig",
			"accessibilityConfig",
		])
		expect(PUBLIC_DATASET_KEYS).toEqual(["id", "fields", "versions", "latestVersionId"])
		expect(PUBLIC_VERSION_KEYS).toEqual(["id", "rows", "fields", "keyAliases"])
		expect(PUBLIC_FIELD_KEYS).toEqual([
			"name",
			"inferredType",
			"sourceNames",
			"formatHint",
			"displayCells",
			"derived",
		])
		expect(PUBLIC_FONT_KEYS).toEqual(["family", "weight", "style", "woff2Base64", "unicodeRange"])
	})

	// The theme's style values are too many to repeat here (the typecheck
	// pins them to the app's Theme type, src/embedRuntime/payload.ts); what
	// must never join them is anything that says whose theme it is.
	it("hold no theme identity", () => {
		expect(PUBLIC_THEME_KEYS).toEqual(["id", ...PUBLIC_THEME_STYLE_KEYS])
		expect(PUBLIC_THEME_STYLE_KEYS).toHaveLength(235)
		for (const key of PUBLIC_THEME_STYLE_KEYS) {
			expect(key).not.toMatch(/^(id|name|isSystem|managed)$|By$|At$|user|email|folder/i)
		}
	})
})

const stored = () => ({
	visual: {
		id: "vis-1",
		name: "Sales",
		folderId: "fl-1",
		datasetId: "ds-1",
		themeId: "th-1",
		encodings: { x: "Region" },
		updatedBy: { id: "u-1", name: "someone@example.com" },
		sentinel: 1,
	},
	dataset: {
		id: "ds-1",
		name: "Numbers",
		fields: [{ name: "Region", inferredType: "categorical", sentinel: 1 }],
		versions: [
			{ id: "dv-1", filename: "old.csv", rows: [{ Region: "S" }] },
			{
				id: "dv-2",
				filename: "new.csv",
				note: "n",
				rows: [{ Region: "N" }],
				keyAliases: { Region: "region" },
				fields: [{ name: "Region", inferredType: "categorical", sentinel: 1 }],
			},
		],
		latestVersionId: "dv-2",
		createdAt: 5,
	},
	theme: { id: "th-1", name: "House", isSystem: false, defaultFill: "#111111", sentinel: 1 },
	fonts: [{ family: "F", weight: "400", style: "normal", woff2Base64: "AA==", url: "x" }],
	zctaTopology: { type: "Topology" },
	sentinel: 1,
})

describe("toPublicPayload", () => {
	it("picks the public fields and swaps every id for its placeholder", () => {
		expect(toPublicPayload(stored())).toEqual({
			visual: {
				id: "embed",
				name: "Sales",
				datasetId: "embed-data",
				themeId: "embed-theme",
				encodings: { x: "Region" },
			},
			dataset: {
				id: "embed-data",
				fields: [{ name: "Region", inferredType: "categorical" }],
				versions: [
					{
						id: "embed-version",
						rows: [{ Region: "N" }],
						keyAliases: { Region: "region" },
						fields: [{ name: "Region", inferredType: "categorical" }],
					},
				],
				latestVersionId: "embed-version",
			},
			theme: { id: "embed-theme", defaultFill: "#111111" },
			fonts: [{ family: "F", weight: "400", style: "normal", woff2Base64: "AA==" }],
			zctaTopology: { type: "Topology" },
		})
	})

	it("builds a payload the validator accepts, and is stable on its own output", () => {
		const payload = toPublicPayload(stored())
		expect(validatePublicPayload(payload)).toBeNull()
		expect(toPublicPayload(payload)).toEqual(payload)
	})

	it("handles a visual with no data set or theme", () => {
		const payload = toPublicPayload({ visual: { id: "v", name: "N" }, dataset: null, fonts: [] })
		expect(payload).toEqual({
			visual: { id: "embed", name: "N", datasetId: null, themeId: null },
			dataset: null,
			theme: null,
			fonts: [],
		})
		expect(validatePublicPayload(payload)).toBeNull()
	})

	it("returns null without a visual", () => {
		expect(toPublicPayload({})).toBeNull()
		expect(toPublicPayload(null)).toBeNull()
	})
})

describe("validatePublicPayload", () => {
	const valid = () => toPublicPayload(stored()) as {
		visual: Record<string, unknown>
		dataset: { fields: Record<string, unknown>[]; versions: Record<string, unknown>[] } & Record<string, unknown>
		theme: Record<string, unknown>
		fonts: Record<string, unknown>[]
	} & Record<string, unknown>

	it("refuses the stored records", () => {
		expect(validatePublicPayload(stored())).toContain("isn't public")
	})

	it("refuses an unlisted field wherever it sits", () => {
		const cases: Array<(p: ReturnType<typeof valid>) => void> = [
			(p) => (p.extra = 1),
			(p) => (p.visual.updatedBy = { name: "someone@example.com" }),
			(p) => (p.dataset.name = "Numbers"),
			(p) => (p.dataset.fields[0]!.extra = 1),
			(p) => (p.dataset.versions[0]!.filename = "f.csv"),
			(p) => ((p.dataset.versions[0]!.fields as Record<string, unknown>[])[0]!.extra = 1),
			(p) => (p.theme.name = "House"),
			(p) => (p.fonts[0]!.url = "x"),
		]
		for (const change of cases) {
			const payload = valid()
			change(payload)
			expect(validatePublicPayload(payload)).toContain("isn't public")
		}
	})

	it("refuses real ids and extra versions", () => {
		const cases: Array<(p: ReturnType<typeof valid>) => void> = [
			(p) => (p.visual.id = "vis-1"),
			(p) => (p.visual.datasetId = "ds-1"),
			(p) => (p.visual.themeId = "th-1"),
			(p) => (p.dataset.id = "ds-1"),
			(p) => (p.dataset.latestVersionId = "dv-2"),
			(p) => (p.dataset.versions[0]!.id = "dv-2"),
			(p) => p.dataset.versions.push({ ...p.dataset.versions[0]! }),
			(p) => (p.theme.id = "th-1"),
		]
		for (const change of cases) {
			const payload = valid()
			change(payload)
			expect(validatePublicPayload(payload)).not.toBeNull()
		}
	})
})
