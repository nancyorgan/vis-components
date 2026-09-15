import { describe, expect, it, vi } from "vitest"
import { DEFAULT_DATA_LABELS_CONFIG } from "../../../lib/channelConfig"
import { DEFAULT_MAP_CONFIG } from "../../../lib/mapConfig"
import { BASE_MARGIN } from "../../../lib/plotLayout"
import type { DatasetView, Encodings } from "../../../lib/types"
import {
	LABEL_RESERVE_PAD_PX,
	computeDataLabelOverflow,
} from "./dataLabelReserve"

/** Fake measurer with a two-width glyph table: "W" is 10px, anything else
 *  2px (font size ignored). Makes "widest" and "longest" disagree so the
 *  reserve's candidate choice is observable regardless of whether the test
 *  environment has a canvas. */
vi.mock("./measureText", () => ({
	measureMaxLabelWidth: (labels: readonly string[]) =>
		Math.max(
			0,
			...labels.map((l) =>
				[...l].reduce((w, ch) => w + (ch === "W" ? 10 : 2), 0),
			),
		),
}))

const view = (rows: Array<Record<string, string>>): DatasetView =>
	({
		id: "ds",
		name: "ds",
		fields: [
			{ name: "x", inferredType: "quantitative" },
			{ name: "y", inferredType: "quantitative" },
			{ name: "name", inferredType: "categorical" },
		],
		rows,
	}) as unknown as DatasetView

const encodings = {
	x: { field: "x" },
	y: { field: "y" },
} as unknown as Encodings

const base = {
	encodings,
	overrides: {},
	channelConfigs: {},
	mapConfig: DEFAULT_MAP_CONFIG,
	dataLabels: {
		...DEFAULT_DATA_LABELS_CONFIG,
		alignment: "left" as const,
		xOffset: 0,
	},
	dataLabelsEncodings: {
		x: { field: "x" },
		y: { field: "y" },
		angle: { field: null },
		r: { field: null },
		hue: { field: null },
		size: { field: null },
		value: { field: "name" },
	},
}

describe("computeDataLabelOverflow — widest candidate, not longest", () => {
	it("reserves for the label that MEASURES widest even when a longer string exists", () => {
		// 15 narrow glyphs = 30px; 5 wide glyphs = 50px.
		const narrowLong = "iiiiiiiiiiiiiii"
		const wideShort = "WWWWW"
		const r = computeDataLabelOverflow({
			...base,
			dataset: view([
				{ x: "1", y: "1", name: narrowLong },
				{ x: "2", y: "2", name: wideShort },
			]),
		})
		expect(r.right).toBe(
			Math.ceil(50 + LABEL_RESERVE_PAD_PX - BASE_MARGIN.right),
		)
	})

	it("measures each distinct string once (duplicates don't change the answer)", () => {
		const rows = Array.from({ length: 50 }, (_, i) => ({
			x: String(i),
			y: String(i),
			name: i % 2 ? "WW" : "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii",
		}))
		const r = computeDataLabelOverflow({ ...base, dataset: view(rows) })
		// 40 narrow glyphs = 80px beats 2 wide = 20px.
		expect(r.right).toBe(
			Math.ceil(80 + LABEL_RESERVE_PAD_PX - BASE_MARGIN.right),
		)
	})
})
