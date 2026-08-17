import { render } from "@testing-library/react"
import { TestProvider, type TestStore } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_DATA_LABELS_CONFIG,
	DEFAULT_SHAPE_CONFIG,
	type CustomGlyph,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { CUSTOM_GLYPH_BASE } from "../../lib/customGlyphs"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type Dataset,
	type Encodings,
} from "../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../store/atoms"

import { ScatterPlot } from "./ScatterPlot"

/** Custom shape glyphs on chart marks: a shape index past the built-in
 *  palette resolves into `shape.customGlyphs` and renders as a `<text>`
 *  (typed characters) or `<image>` (uploaded picture) instead of a symbol
 *  path — and degrades to the circle when the slot was deleted. */

const DATASET_ID = "ds-custom-glyph"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "test",
		filename: "test.csv",
		fields: [
			{ name: "xv", inferredType: "quantitative" },
			{ name: "yv", inferredType: "quantitative" },
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			{ xv: "1", yv: "10", region: "north" },
			{ xv: "2", yv: "20", region: "north" },
			{ xv: "3", yv: "30", region: "south" },
			{ xv: "4", yv: "40", region: "south" },
		],
	})

const mount = (opts: {
	shapeField?: string
	customGlyphs: Array<CustomGlyph | null>
	defaultShape?: number
	overrides?: Record<string, number>
}) => {
	installInMemoryLocalStorage()
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "xv" },
		y: { field: "yv" },
		...(opts.shapeField ? { shape: { field: opts.shapeField } } : {}),
	}
	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsConfigAtom, DEFAULT_DATA_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, emptyDataLabelsEncodings())
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
		snap.set(currentChannelConfigsAtom, (prev) => ({
			...prev,
			...(opts.defaultShape != null
				? { defaultShape: opts.defaultShape }
				: {}),
			shape: {
				...DEFAULT_SHAPE_CONFIG,
				...prev.shape,
				customGlyphs: opts.customGlyphs,
				...(opts.overrides ? { overrides: opts.overrides } : {}),
			},
		}))
	}
	const { container } = render(
		<TestProvider initializeState={init}>
			<div style={{ width: 600, height: 400 }}>
				<ScatterPlot />
			</div>
		</TestProvider>
	)
	return container
}

const glyphTexts = (container: HTMLElement, text: string) =>
	[...container.querySelectorAll("text")].filter(
		(t) => t.textContent === text
	)

describe("ScatterPlot — custom shape glyphs", () => {
	it("a text custom glyph as the default shape renders every mark as <text>", () => {
		const container = mount({
			customGlyphs: [{ kind: "text", text: "Rx" }],
			defaultShape: CUSTOM_GLYPH_BASE,
		})
		expect(glyphTexts(container, "Rx").length).toBe(4)
		expect(container.querySelectorAll("image").length).toBe(0)
	})

	it("an image custom glyph picked per category renders <image> marks for that category only", () => {
		const HREF = "data:image/png;base64,iVBORw0KGgo="
		const container = mount({
			shapeField: "region",
			customGlyphs: [{ kind: "image", href: HREF, aspect: 2 }],
			overrides: { south: CUSTOM_GLYPH_BASE },
		})
		const images = [...container.querySelectorAll("image")]
		expect(images.length).toBe(2)
		expect(images[0]!.getAttribute("href")).toBe(HREF)
		// Wider-than-tall (aspect 2): width spans the 2r box, height halves.
		const w = Number(images[0]!.getAttribute("width"))
		const h = Number(images[0]!.getAttribute("height"))
		expect(w).toBeCloseTo(2 * h)
	})

	it("a tombstoned (deleted) glyph reference degrades to the circle symbol", () => {
		const container = mount({
			customGlyphs: [null],
			defaultShape: CUSTOM_GLYPH_BASE,
		})
		expect(container.querySelectorAll("image").length).toBe(0)
		// Marks still draw — as symbol paths translated into the plot.
		const markPaths = [...container.querySelectorAll("path")].filter((p) =>
			(p.getAttribute("transform") ?? "").startsWith("translate(")
		)
		expect(markPaths.length).toBe(4)
	})
})
