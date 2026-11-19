import { cleanup, fireEvent, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { buildDataset as buildDatasetFixture } from "../../../../../testSupport/fixtures"

import {
	DEFAULT_DATA_LABELS_CONFIG,
	EMPTY_CHANNEL_CONFIGS,
	type DataLabelsConfig,
} from "../../../lib/channelConfig"
import { DEFAULT_LABELS_CONFIG } from "../../../lib/labelsConfig"
import {
	emptyDataLabelsEncodings,
	emptyEncodings,
	type DataLabelsEncodings,
	type Dataset,
	type Encodings,
} from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { AdjustPositionGroup } from "./AdjustPositionGroup"
import { ChannelMappingRows } from "./ChannelMappingRows"
import { LabelSelectionSection } from "./LabelSelectionSection"
import { OwnLabelPositionSection } from "./OwnLabelPositionSection"
import { PositionAlignmentSection } from "./PositionAlignmentSection"
import { PrimaryPositionControls } from "./PrimaryPositionControls"
import { primaryLabelPlacement } from "./positionShared"
import {
	useDataLabelsPanelModel,
	type DataLabelsPanelModel,
} from "./useDataLabelsPanelModel"

/** The pieces `DataLabelsPanel` is assembled from, each mounted on its own
 *  over the shared panel model: it renders, and one control writes where the
 *  whole panel's did. */

const DATASET_ID = "ds-label-sections"

const buildDataset = (): Dataset =>
	buildDatasetFixture({
		id: DATASET_ID,
		name: "points",
		fields: [
			{ name: "cat", inferredType: "categorical" },
			{ name: "val", inferredType: "quantitative" },
			{ name: "other", inferredType: "quantitative" },
		],
		rows: [
			{ cat: "A", val: "10", other: "1" },
			{ cat: "B", val: "20", other: "2" },
		],
	})

/** Mounts `piece(m)` under a scatter chart (x = val, y = other). */
const mount = (
	piece: (m: DataLabelsPanelModel) => ReactNode,
	opts: {
		cfg?: Partial<DataLabelsConfig>
		/** Multi-field Value with these fields checked. */
		fields?: string[]
	} = {}
) => {
	const store = installInMemoryLocalStorage()
	const encodings: Encodings = {
		...emptyEncodings(),
		x: { field: "val" },
		y: { field: "other" },
	}
	const dataLabelsEncodings: DataLabelsEncodings = {
		...emptyDataLabelsEncodings(),
		x: { field: "val" },
		y: { field: "other" },
		value: opts.fields
			? { field: null, multiField: true, fields: opts.fields }
			: { field: "val" },
	}
	const cfg: DataLabelsConfig = {
		...DEFAULT_DATA_LABELS_CONFIG,
		...(opts.cfg ?? {}),
	}
	/* eslint-disable @vc/use-wrapped-json-functions */
	store.set(
		"vis-components:datasets",
		JSON.stringify({ [DATASET_ID]: buildDataset() })
	)
	store.set("vis-components:currentDatasetId", JSON.stringify(DATASET_ID))
	store.set("vis-components:previewVersionId", JSON.stringify(null))
	store.set("vis-components:currentEncodings", JSON.stringify(encodings))
	store.set(
		"vis-components:currentDataLabelsEncodings",
		JSON.stringify(dataLabelsEncodings)
	)
	store.set("vis-components:currentDataLabelsConfig", JSON.stringify(cfg))
	/* eslint-enable @vc/use-wrapped-json-functions */

	let snapRef: TestStore | null = null
	const init = (snap: TestStore) => {
		snapRef = snap
		snap.set(loadedDatasetsAtom, { [DATASET_ID]: buildDataset() })
		snap.set(currentDatasetIdAtom, DATASET_ID)
		snap.set(previewVersionIdAtom, null)
		snap.set(currentEncodingsAtom, encodings)
		snap.set(currentChannelConfigsAtom, EMPTY_CHANNEL_CONFIGS)
		snap.set(currentLabelsAtom, DEFAULT_LABELS_CONFIG)
		snap.set(currentDataLabelsEncodingsAtom, dataLabelsEncodings)
		snap.set(currentDataLabelsConfigAtom, cfg)
		snap.set(currentFieldOverridesAtom, {})
		snap.set(currentFieldLevelOrdersAtom, {})
	}
	const Harness = () => <>{piece(useDataLabelsPanelModel())}</>
	const { container } = render(
		<TestProvider initializeState={init}>
			<Harness />
		</TestProvider>
	)
	return {
		container,
		readCfg: () => snapRef!.get(currentDataLabelsConfigAtom),
		readEncodings: () => snapRef!.get(currentDataLabelsEncodingsAtom),
	}
}

/** The control whose <label> text is exactly `text`. */
const controlLabeled = <E extends HTMLElement>(container: HTMLElement, text: string) => {
	const label = [...container.querySelectorAll("label")].find(
		(l) => l.textContent?.trim() === text
	)
	if (!label?.htmlFor) return null
	return container.querySelector<E>(`#${CSS.escape(label.htmlFor)}`)
}

const expand = (container: HTMLElement, title: string) => {
	const header = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			b.getAttribute("aria-expanded") !== null && b.textContent?.trim() === title
	)
	expect(header).toBeDefined()
	if (header!.getAttribute("aria-expanded") !== "true") fireEvent.click(header!)
}

const subsectionTitles = (container: HTMLElement) =>
	[...container.querySelectorAll<HTMLButtonElement>("button")]
		.filter((b) => b.getAttribute("aria-expanded") !== null)
		.map((b) => b.textContent?.trim())

afterEach(() => cleanup())

describe("ChannelMappingRows", () => {
	it("lists the position, Value, Color and Size rows of a cartesian chart", () => {
		const { container } = mount((m) => <ChannelMappingRows m={m} />)
		for (const row of ["X position", "Y position", "Value", "Color", "Size"]) {
			expect(controlLabeled(container, row)).not.toBeNull()
		}
		expect(controlLabeled(container, "Angle")).toBeNull()
		expect(controlLabeled(container, "Geography")).toBeNull()
	})

	it("switches Value into multi-field mode from the dropdown", () => {
		const { container, readEncodings } = mount((m) => <ChannelMappingRows m={m} />)
		const value = controlLabeled<HTMLSelectElement>(container, "Value")!
		expect(value.value).toBe("val")
		fireEvent.change(value, { target: { value: "__multiple__" } })
		expect(readEncodings().value.multiField).toBe(true)
		expect(readEncodings().value.field).toBeNull()
	})

	it("records an emptied position row as none, so it does not inherit again", () => {
		const { container, readEncodings } = mount((m) => <ChannelMappingRows m={m} />)
		fireEvent.change(controlLabeled<HTMLSelectElement>(container, "X position")!, {
			target: { value: "" },
		})
		expect(readEncodings().x).toEqual({ field: null, none: true })
	})
})

describe("LabelSelectionSection", () => {
	it("writes the layer-wide Which labels for a single-field label", () => {
		const { container, readCfg } = mount((m) => <LabelSelectionSection m={m} />)
		expand(container, "Label selection")
		const which = controlLabeled<HTMLSelectElement>(container, "Which labels")!
		fireEvent.change(which, { target: { value: "last" } })
		expect(readCfg().labelPoints).toBe("last")
		// Unfaceted, ungrouped chart: no scope select and no facet picker.
		expect(controlLabeled(container, "Of each")).toBeNull()
		expect(container.textContent).not.toContain("Apply to all facets")
	})

	it("gives each composed label its own block, keyed by the label", () => {
		const { container, readCfg } = mount((m) => <LabelSelectionSection m={m} />, {
			fields: ["val", "other"],
			cfg: { combineVariables: false },
		})
		expand(container, "Label selection")
		expect(subsectionTitles(container)).toEqual(
			expect.arrayContaining(["val", "other"])
		)
		expand(container, "other")
		const which = controlLabeled<HTMLSelectElement>(container, "Which labels")!
		fireEvent.change(which, { target: { value: "first" } })
		expect(readCfg().fieldLabelPoints).toEqual({ other: "first" })
		expect(readCfg().labelPoints ?? "all").toBe("all")
	})
})

describe("PrimaryPositionControls", () => {
	const piece = (m: DataLabelsPanelModel) => (
		<PrimaryPositionControls m={m} p={primaryLabelPlacement(m)} />
	)

	it("shows the wrap width only while Wrap text is on", () => {
		const { container, readCfg } = mount(piece)
		expect(controlLabeled(container, "Characters")).toBeNull()
		fireEvent.click(controlLabeled<HTMLInputElement>(container, "Wrap text")!)
		expect(readCfg().wrapText).toBe(true)
		expect(controlLabeled(container, "Characters")).not.toBeNull()
	})

	it("writes overlap avoidance and leaves the bar-only groups out of a scatter", () => {
		const { container, readCfg } = mount(piece)
		fireEvent.click(
			controlLabeled<HTMLInputElement>(container, "Avoid overlapping labels")!
		)
		expect(readCfg().avoidOverlaps).toBe(true)
		expect(container.textContent).toContain("Align")
		expect(container.textContent).not.toContain("Placement")
		expect(controlLabeled(container, "Layer position")).toBeNull()
		expect(container.textContent).not.toContain("Show on")
	})
})

describe("AdjustPositionGroup", () => {
	const piece = (m: DataLabelsPanelModel) => (
		<AdjustPositionGroup m={m} p={primaryLabelPlacement(m)} />
	)

	it("offers the X / Y nudge without the polar pair on a cartesian chart", () => {
		const { container } = mount(piece)
		expect(container.textContent).toContain("Adjust position")
		expect(controlLabeled(container, "X")).not.toBeNull()
		expect(controlLabeled(container, "Y")).not.toBeNull()
		expect(controlLabeled(container, "R")).toBeNull()
	})

	it("shows Y as positive-up and resets a nudge to 0", () => {
		const { container, readCfg } = mount(piece, { cfg: { xOffset: 7, yOffset: -4 } })
		expect(controlLabeled<HTMLInputElement>(container, "Y")!.value).toBe("4")
		const resets = [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
			(b) => b.textContent?.trim() === "reset"
		)
		expect(resets).toHaveLength(2)
		fireEvent.click(resets[0])
		expect(readCfg().xOffset).toBe(0)
		expect(readCfg().yOffset).toBe(-4)
	})

	it("stands down when every label has its own block", () => {
		const { container } = mount(piece, {
			fields: ["val", "other"],
			cfg: { combineVariables: false },
		})
		expect(container.textContent).toBe("")
	})
})

describe("OwnLabelPositionSection", () => {
	it("writes one label's layout to its own entry, not the layer's", () => {
		const { container, readCfg } = mount(
			(m) => <OwnLabelPositionSection m={m} name="other" />,
			{ fields: ["val", "other"], cfg: { combineVariables: false } }
		)
		expand(container, "other")
		fireEvent.click(
			controlLabeled<HTMLInputElement>(container, "Avoid overlapping labels")!
		)
		expect(readCfg().fieldLayouts).toEqual({ other: { avoidOverlaps: true } })
		expect(readCfg().avoidOverlaps ?? false).toBe(false)
		expect(container.textContent).toContain("Adjust position")
	})
})

describe("PositionAlignmentSection", () => {
	it("holds the layer-wide controls for a single label", () => {
		const { container } = mount((m) => <PositionAlignmentSection m={m} />)
		expand(container, "Position and alignment")
		expect(subsectionTitles(container)).toEqual(["Position and alignment"])
		expect(controlLabeled(container, "Wrap text")).not.toBeNull()
		expect(container.textContent).toContain("Adjust position")
	})

	it("swaps them for one block per label when several are composed", () => {
		const { container } = mount((m) => <PositionAlignmentSection m={m} />, {
			fields: ["val", "other"],
			cfg: { combineVariables: false },
		})
		expand(container, "Position and alignment")
		expect(subsectionTitles(container)).toEqual([
			"Position and alignment",
			"val",
			"other",
		])
		// The per-label blocks start collapsed, and the layer-wide rows are gone.
		expect(controlLabeled(container, "Wrap text")).toBeNull()
	})
})
