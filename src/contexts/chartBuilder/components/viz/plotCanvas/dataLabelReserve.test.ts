import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	type DataLabelsConfig,
} from "../../../lib/channelConfig"
import { ptToPx } from "../../../lib/fontUnit"
import { DEFAULT_MAP_CONFIG } from "../../../lib/mapConfig"
import { BASE_MARGIN } from "../../../lib/plotLayout"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type DatasetView,
	type Encodings,
} from "../../../lib/types"
import { computeDataLabelOverflow } from "./dataLabelReserve"
import { measureMaxLabelWidth } from "./measureText"

const view = (rows: Array<Record<string, string>>): DatasetView => ({
	id: "ds",
	name: "d",
	filename: "d.csv",
	fields: [
		{ name: "cat", inferredType: "categorical" },
		{ name: "val", inferredType: "quantitative" },
		{ name: "name", inferredType: "categorical" },
	],
	rows,
	createdAt: 0,
	versionCreatedAt: 0,
	versionId: "v1",
	versionIndex: 1,
	totalVersions: 1,
	isLatest: true,
})

const LONG = "A".repeat(40)
const ROWS = [
	{ cat: "a", val: "1", name: LONG },
	{ cat: "b", val: "2", name: "short" },
]

const scatterEncodings = (): Encodings => {
	const e = emptyEncodings()
	e.x = { field: "cat" }
	e.y = { field: "val" }
	return e
}

const labelsOn = (over: Partial<DataLabelsConfig> = {}): DataLabelsConfig => ({
	...DEFAULT_DATA_LABELS_CONFIG,
	...over,
})

const nameValueEncodings = () => ({
	...emptyDataLabelsEncodings(),
	value: { field: "name" },
})

const base = {
	overrides: {},
	channelConfigs: {},
	mapConfig: DEFAULT_MAP_CONFIG,
	dataLabelsEncodings: nameValueEncodings(),
}

/** The reserve math's label width, computed with the same primitives the
 *  implementation uses (canvas measure with a char-count fallback), so the
 *  expectations hold in DOM-less and canvas-capable environments alike. */
const labelPx = (text: string, dataLabels: DataLabelsConfig): number => {
	const fontPx = ptToPx(dataLabels.fontSize)
	const measured = measureMaxLabelWidth(
		[text],
		dataLabels.fontFamily,
		fontPx,
		dataLabels.fontWeight,
		dataLabels.italic,
	)
	return measured > 0 ? measured : text.length * fontPx * 0.55
}

const cap = (n: number) => Math.max(0, Math.min(400, Math.ceil(n)))

describe("computeDataLabelOverflow", () => {
	it("reserves nothing without a dataset", () => {
		expect(
			computeDataLabelOverflow({
				...base,
				dataset: undefined,
				encodings: scatterEncodings(),
				dataLabels: labelsOn(),
			}),
		).toEqual({ left: 0, right: 0 })
	})

	it("reserves nothing when neither a label value nor a length/y fallback is mapped", () => {
		expect(
			computeDataLabelOverflow({
				...base,
				dataset: view(ROWS),
				encodings: emptyEncodings(),
				dataLabels: labelsOn(),
				dataLabelsEncodings: emptyDataLabelsEncodings(),
			}),
		).toEqual({ left: 0, right: 0 })
	})

	it("left alignment reserves the full label width on the right only", () => {
		const dataLabels = labelsOn({ alignment: "left", xOffset: 0 })
		const r = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels,
		})
		expect(r.left).toBe(0)
		expect(r.right).toBe(cap(labelPx(LONG, dataLabels) - BASE_MARGIN.right))
		expect(r.right).toBeGreaterThan(0)
	})

	it("right alignment mirrors to the left, netting out the wider left base margin", () => {
		const dataLabels = labelsOn({ alignment: "right", xOffset: 0 })
		const r = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels,
		})
		expect(r.right).toBe(0)
		expect(r.left).toBe(cap(labelPx(LONG, dataLabels) - BASE_MARGIN.left))
	})

	it("center alignment splits the width half to each side", () => {
		const dataLabels = labelsOn({ alignment: "center", xOffset: 0 })
		const r = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels,
		})
		const half = labelPx(LONG, dataLabels) / 2
		expect(r.right).toBe(cap(half - BASE_MARGIN.right))
		expect(r.left).toBe(cap(half - BASE_MARGIN.left))
	})

	it("a positive xOffset shifts reserve to the right, away from the left", () => {
		const at = (xOffset: number) =>
			computeDataLabelOverflow({
				...base,
				dataset: view(ROWS),
				encodings: scatterEncodings(),
				dataLabels: labelsOn({ alignment: "left", xOffset }),
			})
		expect(at(10).right).toBe(at(0).right + 10)
		expect(at(10).left).toBe(0)
	})

	it("caps each side's reserve at 400px", () => {
		const r = computeDataLabelOverflow({
			...base,
			dataset: view([{ cat: "a", val: "1", name: "B".repeat(600) }]),
			encodings: scatterEncodings(),
			dataLabels: labelsOn({ alignment: "left" }),
		})
		expect(r.right).toBe(400)
	})

	it("uses sizeMax for the width estimate when the size channel is mapped", () => {
		const dataLabels = labelsOn({
			alignment: "left",
			sizeMax: DEFAULT_DATA_LABELS_CONFIG.fontSize * 2,
		})
		const unsized = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels,
		})
		const sized = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels,
			dataLabelsEncodings: {
				...nameValueEncodings(),
				size: { field: "val" },
			},
		})
		expect(sized.right).toBeGreaterThan(unsized.right)
	})

	it("endpoint mode reserves for the last label's own offset override", () => {
		const plain = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels: labelsOn({ alignment: "left", xOffset: 0 }),
		})
		const endpoint = computeDataLabelOverflow({
			...base,
			dataset: view(ROWS),
			encodings: scatterEncodings(),
			dataLabels: labelsOn({
				alignment: "left",
				xOffset: 0,
				labelPoints: "first-last",
				lastLabel: { xOffset: 25 },
			}),
		})
		expect(endpoint.right).toBe(plain.right + 25)
	})
})
