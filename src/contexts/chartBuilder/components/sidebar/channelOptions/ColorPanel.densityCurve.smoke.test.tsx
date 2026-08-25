import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type ChannelConfigs,
} from "../../../lib/channelConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	datasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { ColorPanel } from "./ColorPanel"

/** Visibility rules for the density-related Color subheaders:
 *  - PURE density curve (standalone "Density" display, no bars): only the
 *    Density Curve groups — the mark Fill / Outline groups are hidden because
 *    the renderer suppresses the points while the curve is on.
 *  - Histogram WITH the density overlay: all four groups (bars still render).
 *  - "Fill under curve" unchecked: no Density Curve Fill group (an unfilled
 *    curve has no fill to color); the outline group stays with the curve.
 *  - Plain histogram (no curve): only the mark Fill / Outline groups. */

const ID = "ds-color-density"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: ID,
		name: "density",
		filename: "density.csv",
		fields: [
			{ name: "score", inferredType: "quantitative" },
			{ name: "grp", inferredType: "categorical" },
		],
		rows: [
			{ score: "1", grp: "A" },
			{ score: "2", grp: "A" },
			{ score: "3", grp: "B" },
		],
	})

const mount = (encodings: Encodings, configs: ChannelConfigs) => {
	const store = installInMemoryLocalStorage()
	/* eslint-disable @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => store.set(k, JSON.stringify(v))
	set("vis-components:datasets", { [ID]: buildDataset() })
	set("vis-components:currentDatasetId", ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	set("vis-components:currentChannelConfigs", configs)
	/* eslint-enable @th/use-wrapped-json-functions */
	const init = (snap: TestStore) => {
		snap.set(datasetsAtom, { [ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, configs)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	return render(
		<TestProvider initializeState={init}>
			<ColorPanel />
		</TestProvider>
	)
}

/** Titles of the collapsible subheaders, in document order. */
const subheaders = (c: HTMLElement): string[] =>
	[...c.querySelectorAll("button[aria-expanded]")].map(
		(b) => b.textContent?.trim() ?? ""
	)

const loneScoreEncodings: Encodings = {
	...emptyEncodings(),
	x: { field: "score" },
}

/** Standalone "Density" display on a lone quantitative x. `densityFill` lives
 * on the histogram config even for the standalone curve (shared flag). */
const pureDensityConfigs = (densityFill: boolean): ChannelConfigs => ({
	...EMPTY_CHANNEL_CONFIGS,
	x: {
		...DEFAULT_AXIS_CONFIG,
		distributionOverlay: {
			...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
			showDensityCurve: true,
		},
		histogram: {
			enabled: false,
			binCount: 8,
			mode: "count",
			labelMode: "range",
			showRug: false,
			rugColor: "#475569",
			densityFill,
		},
	},
})

/** Histogram bars on a lone quantitative x, with or without the KDE overlay. */
const histogramConfigs = (opts: {
	showDensity: boolean
	densityFill?: boolean
}): ChannelConfigs => ({
	...EMPTY_CHANNEL_CONFIGS,
	x: {
		...DEFAULT_AXIS_CONFIG,
		histogram: {
			enabled: true,
			binCount: 8,
			mode: "count",
			labelMode: "range",
			showRug: false,
			rugColor: "#475569",
			showDensity: opts.showDensity,
			densityFill: opts.densityFill,
		},
	},
})

describe("ColorPanel — density-curve group visibility", () => {
	it("pure density curve: only the Density Curve groups (no mark Fill / Outline)", () => {
		const { container } = mount(loneScoreEncodings, pureDensityConfigs(true))
		const headers = subheaders(container)
		expect(headers).not.toContain("Fill")
		expect(headers).not.toContain("Outline")
		expect(headers).toContain("Density Curve Fill")
		expect(headers).toContain("Density Curve Outline")
	})

	it("pure density curve without 'Fill under curve': outline group only", () => {
		const { container } = mount(loneScoreEncodings, pureDensityConfigs(false))
		const headers = subheaders(container)
		expect(headers).not.toContain("Fill")
		expect(headers).not.toContain("Outline")
		expect(headers).not.toContain("Density Curve Fill")
		expect(headers).toContain("Density Curve Outline")
	})

	it("histogram with the density overlay + fill: all four groups", () => {
		const { container } = mount(
			loneScoreEncodings,
			histogramConfigs({ showDensity: true, densityFill: true })
		)
		const headers = subheaders(container)
		expect(headers).toContain("Fill")
		expect(headers).toContain("Outline")
		expect(headers).toContain("Density Curve Fill")
		expect(headers).toContain("Density Curve Outline")
	})

	it("histogram with an UNFILLED density overlay: no Density Curve Fill group", () => {
		const { container } = mount(
			loneScoreEncodings,
			histogramConfigs({ showDensity: true })
		)
		const headers = subheaders(container)
		expect(headers).toContain("Fill")
		expect(headers).toContain("Outline")
		expect(headers).not.toContain("Density Curve Fill")
		expect(headers).toContain("Density Curve Outline")
	})

	it("plain histogram (no curve): only the mark Fill / Outline groups", () => {
		const { container } = mount(
			loneScoreEncodings,
			histogramConfigs({ showDensity: false })
		)
		const headers = subheaders(container)
		expect(headers).toContain("Fill")
		expect(headers).toContain("Outline")
		expect(headers).not.toContain("Density Curve Fill")
		expect(headers).not.toContain("Density Curve Outline")
	})

	it("regular scatter (both axes mapped) keeps Fill / Outline even with a stale curve flag", () => {
		// A leftover showDensityCurve=true from a lone-axis session must not hide
		// the mark groups once a second axis is mapped — the points render again.
		const { container } = mount(
			{ ...emptyEncodings(), x: { field: "score" }, y: { field: "score" } },
			pureDensityConfigs(true)
		)
		const headers = subheaders(container)
		expect(headers).toContain("Fill")
		expect(headers).toContain("Outline")
	})
})
