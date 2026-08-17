import { cleanup, render, within } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_AXIS_CONFIG } from "../../lib/channelConfig"
import { emptyEncodings, type Dataset } from "../../lib/types"

import { LegendPanel } from "./LegendPanel"

/** When Fill color varies by the histogram measure (Count/Density), the Legend
 *  panel must surface the same gradient-legend controls it shows for a mapped
 *  quantitative hue field — the "Color" hide toggle, the gradient style toggle,
 *  and the break/format editor — even though there's no backing field. */

const DATASET_ID = "ds-legendpanel-measure"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "scores",
		filename: "scores.csv",
		fields: [{ name: "score", inferredType: "quantitative" }],
		rows: Array.from({ length: 20 }, (_, i) => ({ score: String(i + 1) })),
	})

const seed = (hue: Record<string, unknown> | undefined, histogram: boolean) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	store.set("vis-components:datasets", JSON.stringify({ [DATASET_ID]: buildDataset() }))
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set(
		"vis-components:currentEncodings",
		JSON.stringify({
			...emptyEncodings(),
			x: { field: "score" },
			...(hue ? { hue } : {}),
		})
	)
	store.set(
		"vis-components:currentChannelConfigs",
		JSON.stringify({
			x: {
				...DEFAULT_AXIS_CONFIG,
				histogram: { enabled: histogram, binCount: 4, mode: "count" },
			},
		})
	)
	/* eslint-enable @th/use-wrapped-json-functions */
}

afterEach(cleanup)

const mount = () =>
	render(
		<TestProvider>
			<LegendPanel />
		</TestProvider>
	)

const hasText = (container: HTMLElement, text: string) =>
	within(container)
		.queryAllByText(text, { exact: false })
		.length > 0

describe("LegendPanel — histogram measure (Count/Density)", () => {
	it("surfaces the gradient style toggle + label formatting for color-by-count", () => {
		seed({ field: null, measureSource: "count" }, true)
		const { container } = mount()
		// Subsection titles render even while collapsed. The gradient-style
		// section only appears for a (quantitative) hue legend...
		expect(hasText(container, "Gradient legend style")).toBe(true)
		// ...and Label formatting appears solely because of the measure group
		// (no data field is mapped to a legend channel here).
		expect(hasText(container, "Label formatting")).toBe(true)
	})

	it("shows no gradient style toggle when there's no measure source", () => {
		// Lone histogram, Fill not varied → no hue legend, no gradient controls.
		seed(undefined, true)
		const { container } = mount()
		expect(hasText(container, "Gradient legend style")).toBe(false)
	})

	it("does not offer measure controls when the histogram is off", () => {
		// measureSource lingering but histogram disabled → no measure legend, so
		// the panel must not surface its controls.
		seed({ field: null, measureSource: "count" }, false)
		const { container } = mount()
		expect(hasText(container, "Gradient legend style")).toBe(false)
		expect(hasText(container, "Count legend formatting")).toBe(false)
	})
})
