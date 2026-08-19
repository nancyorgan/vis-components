import { describe, expect, it } from "vitest"
import type { GeometryBundle } from "../../lib/geo/loadGeometry"

import { buildGeoLabelAnchors } from "./geoLabelAnchors"

// Minimal two-state bundle. `features` is unused by the builder (the join
// goes through `table`, placement through `centroids`).
const bundle: GeometryBundle = {
	features: [],
	table: [
		{ featureId: "48", keys: { fips: "48", abbrev: "TX", name: "Texas" } },
		{ featureId: "06", keys: { fips: "06", abbrev: "CA", name: "California" } },
	],
	centroids: new Map([
		["48", [-99, 31]],
		["06", [-119, 37]],
	]),
}

// Deterministic fake projection: [lon, lat] -> [lon + 200, lat + 100].
const project = (lonlat: [number, number]): [number, number] | null => [
	lonlat[0] + 200,
	lonlat[1] + 100,
]
const always = () => true

const base = {
	geographyField: "state",
	value: { field: "rate" as string | null },
	cfg: { decimals: null, labelTemplate: undefined, fieldFormats: {} },
	hueField: null,
	sizeField: null,
	bundle,
	keyType: "auto" as const,
	project,
	inClip: always,
}

describe("buildGeoLabelAnchors", () => {
	it("emits one anchor per matched region at its projected centroid", () => {
		const anchors = buildGeoLabelAnchors({
			...base,
			rows: [
				{ state: "TX", rate: 5 },
				{ state: "CA", rate: 7 },
			],
		})
		expect(anchors).toHaveLength(2)
		const tx = anchors.find((a) => a.key === "48")
		expect(tx).toMatchObject({ cx: 101, cy: 131, label: "5", labelValue: 5 })
		const ca = anchors.find((a) => a.key === "06")
		expect(ca).toMatchObject({ cx: 81, cy: 137, label: "7" })
	})

	it("drops values that don't join and rows with no label text", () => {
		const anchors = buildGeoLabelAnchors({
			...base,
			rows: [
				{ state: "Atlantis", rate: 9 },
				{ state: "TX", rate: null },
			],
		})
		expect(anchors).toHaveLength(0)
	})

	it("picks the FIRST row per region whose composed text is non-null", () => {
		// County-rows-with-a-state-average-column shape: the first TX row is
		// blank, a later one carries the value — the region still labels.
		const anchors = buildGeoLabelAnchors({
			...base,
			rows: [
				{ state: "TX", rate: null },
				{ state: "TX", rate: 5 },
				{ state: "TX", rate: 6 },
			],
		})
		expect(anchors).toHaveLength(1)
		expect(anchors[0]).toMatchObject({ key: "48", label: "5" })
	})

	it("collapses several raw forms of the same region into one label", () => {
		const anchors = buildGeoLabelAnchors({
			...base,
			rows: [
				{ state: "TX", rate: 5 },
				{ state: "Texas", rate: 6 },
			],
		})
		expect(anchors).toHaveLength(1)
		expect(anchors[0]?.label).toBe("5")
	})

	it("drops regions the projection clips or the focus box excludes", () => {
		const clipCA = buildGeoLabelAnchors({
			...base,
			rows: [
				{ state: "TX", rate: 5 },
				{ state: "CA", rate: 7 },
			],
			project: (ll) => (ll[0] === -119 ? null : project(ll)),
		})
		expect(clipCA.map((a) => a.key)).toEqual(["48"])
		const outOfBox = buildGeoLabelAnchors({
			...base,
			rows: [{ state: "TX", rate: 5 }],
			inClip: () => false,
		})
		expect(outOfBox).toHaveLength(0)
	})

	it("formats single-field labels via the field's format spec", () => {
		const anchors = buildGeoLabelAnchors({
			...base,
			cfg: { ...base.cfg, fieldFormats: { rate: ".0%" } },
			rows: [{ state: "TX", rate: 0.5 }],
		})
		expect(anchors[0]?.label).toBe("50%")
	})

	it("composes multi-field labels from the template", () => {
		const anchors = buildGeoLabelAnchors({
			...base,
			value: { field: null, multiField: true, fields: ["state", "rate"] },
			cfg: { ...base.cfg, labelTemplate: "{state}: {rate}" },
			rows: [{ state: "TX", rate: 5 }],
		})
		expect(anchors[0]?.label).toBe("TX: 5")
		// No single backing value in multi mode (text-color rules don't apply).
		expect(anchors[0]?.labelValue).toBeUndefined()
	})

	it("carries hue / size values from the representative row", () => {
		const anchors = buildGeoLabelAnchors({
			...base,
			hueField: "region",
			sizeField: "pop",
			rows: [{ state: "TX", rate: 5, region: "South", pop: 30 }],
		})
		expect(anchors[0]).toMatchObject({ hueValue: "South", sizeValue: 30 })
	})
})
