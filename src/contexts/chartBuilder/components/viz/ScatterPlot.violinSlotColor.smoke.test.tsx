import { render } from "@testing-library/react"
import { TestProvider } from "../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../testSupport/fixtures"
import { describe, expect, it } from "vitest"
import {
	DEFAULT_AXIS_CONFIG,
	DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
	type ColorSlots,
} from "../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../lib/labelsConfig"
import { emptyEncodings, type Dataset, type Encodings } from "../../lib/types"

import { ChartCanvas } from "./ChartCanvas"

/** Violin color slots resolve against a representative data row per category,
 *  so "Vary by" works for any field that's constant within a category (e.g. a
 *  facet field, constant across the whole panel) — not just the category-axis
 *  field itself. */

const DATASET_ID = "ds-violin-slot-color"

const PALETTE = ["#e11d48", "#2563eb"]

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "clinics",
		filename: "clinics.csv",
		fields: [
			{ name: "proc", inferredType: "categorical" },
			{ name: "value", inferredType: "quantitative" },
			// Constant within each `proc` category (like a facet field is constant
			// within a panel), but NOT the category-axis field.
			{ name: "region", inferredType: "categorical" },
		],
		rows: [
			...Array.from({ length: 12 }, (_, i) => ({
				proc: "A",
				value: String(i + 1),
				region: "East",
			})),
			...Array.from({ length: 12 }, (_, i) => ({
				proc: "B",
				value: String(i + 5),
				region: "West",
			})),
		],
	})

const seed = (encodings: Encodings, colorSlots: ColorSlots) => {
	installInMemoryLocalStorage()
	/* eslint-disable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
	const set = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v))
	set("vis-components:datasets", { [DATASET_ID]: buildDataset() })
	set("vis-components:currentDatasetId", DATASET_ID)
	set("vis-components:previewVersionId", null)
	set("vis-components:currentEncodings", encodings)
	// The overlay lives on the VALUE axis config (y here; x for single-var).
	set("vis-components:currentChannelConfigs", {
		y: {
			...DEFAULT_AXIS_CONFIG,
			distributionOverlay: {
				...DEFAULT_DISTRIBUTION_OVERLAY_CONFIG,
				showDensityViolin: true,
				showPoints: false,
			},
		},
		colorSlots,
	})
	set("vis-components:currentLabels", { _v: 1, data: DEFAULT_LABELS_CONFIG })
	/* eslint-enable no-restricted-globals, @th/no-storage-outside-try, @th/use-wrapped-json-functions */
}

const mount = () =>
	render(
		<TestProvider>
			<div style={{ width: 800, height: 600 }}>
				<ChartCanvas />
			</div>
		</TestProvider>
	)

const paletteFills = (container: HTMLElement): string[] =>
	[...container.querySelectorAll("path")]
		.map((p) => p.getAttribute("fill"))
		.filter((f): f is string => f !== null && PALETTE.includes(f))

describe("violin fill color slot mapped to a non-category field", () => {
	it("varies fill by a field that is constant within each category", () => {
		seed(
			{ ...emptyEncodings(), x: { field: "proc" }, y: { field: "value" } },
			{
				violinFill: {
					field: "region",
					singleColor: "#000000",
					palette: PALETTE,
				},
			}
		)
		const { container } = mount()
		const fills = paletteFills(container)
		// One violin per proc (A→East, B→West), each filled with its region's
		// palette color — not the single-color fallback.
		expect(new Set(fills)).toEqual(new Set(PALETTE))
	})

	it("still varies fill by the category-axis field itself", () => {
		seed(
			{ ...emptyEncodings(), x: { field: "proc" }, y: { field: "value" } },
			{
				violinFill: {
					field: "proc",
					singleColor: "#000000",
					palette: PALETTE,
				},
			}
		)
		const { container } = mount()
		expect(new Set(paletteFills(container))).toEqual(new Set(PALETTE))
	})

	it("resolves a single-variable violin's fill from the panel's first row", () => {
		// Only Y is mapped → the single-group render path (empty category
		// field). The slot field resolves from the panel's first row — the
		// faceted case, where each panel holds one facet value.
		seed({ ...emptyEncodings(), y: { field: "value" } }, {
			violinFill: {
				field: "region",
				singleColor: "#000000",
				palette: PALETTE,
			},
		})
		const { container } = mount()
		// All rows reach one violin; the first row's region is East → PALETTE[0].
		expect(paletteFills(container)).toContain(PALETTE[0])
	})
})
