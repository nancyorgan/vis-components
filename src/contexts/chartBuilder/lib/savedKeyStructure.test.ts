import { describe, expect, it } from "vitest"

import { stringifyJsonDangerous } from "../../../lib/json"
import { pieceKey } from "./labelPieces"
import {
	isGridFaceted,
	structureAnnotationKeys,
	structureChannelConfigKeys,
	structureDataLabelsKeys,
	structureFacetConfigKeys,
	structureVisualKeys,
} from "./savedKeyStructure"

/** The two shapes the hosting firewall flagged, as a saved col-only grid
 *  chart would carry them: a control character inside a setting name, and a
 *  `__all__|Type of System` panel key. */
const legacyGridVisual = () => ({
	id: "vs-1",
	encodings: { x: { field: "Year" }, facetCol: { field: "System" } },
	channelConfigs: {
		facet: {
			shareY: "none",
			panelAxisOverrides: {
				"__all__|Type of System": { yMin: 0, yMax: 10 },
				"__all__|Other": { yMax: 5 },
			},
		},
	},
	dataLabelsConfig: {
		facetKeys: ["__all__|Type of System"],
		fieldFacetKeys: { Revenue: ["__all__|Other"], Region: null },
		fieldSizes: { Revenue: 12, [pieceKey("lbl-1", "Region")]: 9 },
		fieldFonts: { [pieceKey("lbl-1", "Region")]: { fontWeight: 700 } },
	},
	annotationsConfig: {
		rectangles: [{ id: "r1", facetKeys: ["__all__|Type of System"] }],
		circles: [{ id: "c1" }],
		lineSegments: [{ id: "l1", facetKeys: null }],
		texts: [{ id: "t1", facetKeys: ["__all__|Other", "__all__|Type of System"] }],
	},
})

/** Every saved key and string value, flattened. */
const walkStrings = (v: unknown, out: string[] = []): string[] => {
	if (typeof v === "string") out.push(v)
	else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out))
	else if (v && typeof v === "object")
		for (const [k, x] of Object.entries(v)) {
			out.push(k)
			walkStrings(x, out)
		}
	return out
}

describe("structureVisualKeys", () => {
	it("rewrites both flagged shapes into structure, and nothing else", () => {
		const out = structureVisualKeys(legacyGridVisual())
		expect(out.channelConfigs.facet).toEqual({
			shareY: "none",
			panelAxisOverrides: {},
			gridPanelAxisOverrides: {
				__all__: { "Type of System": { yMin: 0, yMax: 10 }, Other: { yMax: 5 } },
			},
		})
		expect(out.dataLabelsConfig).toEqual({
			facetKeys: [{ row: "__all__", col: "Type of System" }],
			fieldFacetKeys: { Revenue: [{ row: "__all__", col: "Other" }], Region: null },
			fieldSizes: { Revenue: 12 },
			fieldFonts: {},
			pieces: { "lbl-1": { Region: { size: 9, font: { fontWeight: 700 } } } },
		})
		expect(out.annotationsConfig).toEqual({
			rectangles: [{ id: "r1", facetKeys: [{ row: "__all__", col: "Type of System" }] }],
			circles: [{ id: "c1" }],
			lineSegments: [{ id: "l1", facetKeys: null }],
			texts: [
				{
					id: "t1",
					facetKeys: [
						{ row: "__all__", col: "Other" },
						{ row: "__all__", col: "Type of System" },
					],
				},
			],
		})
		// Untouched slices keep their references.
		expect(out.encodings).toBe(out.encodings)
		expect(out.id).toBe("vs-1")
	})

	it("leaves no control character and no joined grid key anywhere in what gets saved", () => {
		const out = structureVisualKeys(legacyGridVisual())
		const strings = walkStrings(JSON.parse(stringifyJsonDangerous(out)))
		// eslint-disable-next-line no-control-regex
		expect(strings.filter((s) => /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s))).toEqual([])
		expect(strings.filter((s) => s.includes("__all__|"))).toEqual([])
	})

	it("is idempotent, and the same reference once structured", () => {
		const once = structureVisualKeys(legacyGridVisual())
		expect(structureVisualKeys(once)).toBe(once)
		expect(structureVisualKeys(once)).toEqual(once)
	})

	it("a full grid splits a joined key with exactly one pipe; one with more stays until a save can see the panels", () => {
		const visual = {
			encodings: { facetRow: { field: "r" }, facetCol: { field: "c" } },
			annotationsConfig: { rectangles: [{ facetKeys: ["North|2024", "a|b|x"] }] },
			channelConfigs: {
				facet: { panelAxisOverrides: { "North|2024": { xMin: 1 }, "a|b|x": { xMin: 2 } } },
			},
		}
		const out = structureVisualKeys(visual)
		expect(out.annotationsConfig.rectangles[0].facetKeys).toEqual([
			{ row: "North", col: "2024" },
			"a|b|x",
		])
		expect(out.channelConfigs.facet).toEqual({
			panelAxisOverrides: { "a|b|x": { xMin: 2 } },
			gridPanelAxisOverrides: { North: { 2024: { xMin: 1 } } },
		})
		// With the rendered panels (the editor's save) the ambiguous key is
		// resolved against the data, not guessed.
		const resolved = structureVisualKeys(
			visual,
			new Map([["a|b|x", { row: "a|b", col: "x" }]])
		)
		expect(resolved.annotationsConfig.rectangles[0].facetKeys).toEqual([
			{ row: "North", col: "2024" },
			{ row: "a|b", col: "x" },
		])
		expect(
			(resolved.channelConfigs.facet as Record<string, unknown>).gridPanelAxisOverrides
		).toEqual({
			North: { 2024: { xMin: 1 } },
			"a|b": { x: { xMin: 2 } },
		})
	})

	it("a wrap chart keeps its facet values verbatim — a pipe inside one is the user's", () => {
		const visual = {
			encodings: { facet: { field: "f" } },
			channelConfigs: { facet: { panelAxisOverrides: { "a|b": { yMin: 0 } } } },
			dataLabelsConfig: { facetKeys: ["a|b", "c"] },
			annotationsConfig: { texts: [{ facetKeys: ["a|b"] }] },
		}
		expect(structureVisualKeys(visual)).toBe(visual)
	})

	it("a grid leftover on a wrap chart still moves: the placeholder marks it", () => {
		const out = structureVisualKeys({
			encodings: { facet: { field: "f" } },
			dataLabelsConfig: { facetKeys: ["__all__|x", "wrapValue"] },
		})
		expect(out.dataLabelsConfig.facetKeys).toEqual([
			{ row: "__all__", col: "x" },
			"wrapValue",
		])
	})

	it("an entry already in the nested map wins over the joined one", () => {
		const out = structureFacetConfigKeys(
			{
				panelAxisOverrides: { "a|x": { yMin: 1 }, keep: { yMin: 2 } },
				gridPanelAxisOverrides: { a: { x: { yMin: 9 } } },
			},
			true
		)
		expect(out).toEqual({
			panelAxisOverrides: { keep: { yMin: 2 } },
			gridPanelAxisOverrides: { a: { x: { yMin: 9 } } },
		})
	})

	it("a panel named like an inherited property never writes onto every object", () => {
		// As a saved or imported chart would carry it: JSON.parse makes
		// "__proto__" an ordinary own key.
		const facet = JSON.parse(
			'{"panelAxisOverrides":{"__proto__|polluted":{"yMin":1},"constructor|polluted":{"yMin":2},"a|__proto__":{"yMin":3}}}'
		) as Record<string, unknown>
		const out = structureFacetConfigKeys(facet, true) as {
			gridPanelAxisOverrides: Record<string, unknown>
		}
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
		expect((Object as unknown as Record<string, unknown>).polluted).toBeUndefined()
		// "constructor" is a real, if odd, facet value: kept as an own entry.
		expect(Object.hasOwn(out.gridPanelAxisOverrides, "constructor")).toBe(true)
		expect(out.gridPanelAxisOverrides.constructor).toEqual({ polluted: { yMin: 2 } })
	})

	it("tolerates sparse, partial and non-object input", () => {
		expect(structureVisualKeys(null)).toBeNull()
		expect(structureVisualKeys("x")).toBe("x")
		const bare = { id: "b" }
		expect(structureVisualKeys(bare)).toBe(bare)
		expect(structureAnnotationKeys({ rectangles: "junk" }, true)).toEqual({
			rectangles: "junk",
		})
		expect(structureDataLabelsKeys(7, true)).toBe(7)
		expect(structureChannelConfigKeys({ x: {} }, true)).toEqual({ x: {} })
	})

	it("reads grid mode off either facet axis", () => {
		expect(isGridFaceted({ facetRow: { field: "r" } })).toBe(true)
		expect(isGridFaceted({ facetCol: { field: "c" } })).toBe(true)
		expect(isGridFaceted({ facet: { field: "f" }, facetRow: { field: null } })).toBe(false)
		expect(isGridFaceted(undefined)).toBe(false)
	})
})
