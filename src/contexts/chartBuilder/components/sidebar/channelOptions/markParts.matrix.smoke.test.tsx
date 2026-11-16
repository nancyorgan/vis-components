import { act, cleanup, render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { buildDataset } from "../../../../../testSupport/fixtures"
import { installInMemoryLocalStorage } from "../../../../../testSupport/localStorageShim"
import { expandSubsections, scanControls } from "../../../../../testSupport/scanControls"
import { SWEEP_CHARTS, type SweepChart } from "../../../../../testSupport/sweepCharts"
import {
	levelNormalizer,
	SWEEP_DATASETS,
	type SweepDataset,
} from "../../../../../testSupport/sweepDatasets"
import { TestProvider, type TestStore } from "../../../../../testSupport/TestProvider"
import { composeVisual } from "../../../lib/chartSpec"
import { DEFAULT_MAP_CONFIG } from "../../../lib/mapConfig"
import { partsContext } from "../../../lib/markParts"
import { isHierarchyModeId, packedSourceOf } from "../../../lib/packedMeasure"
import { patternMenu } from "../../../lib/patternMenu"
import { LIGHT_THEME_BASE } from "../../../lib/systemThemes"
import type { EncodingChannel, Visual } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentDatasetIdAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentMapConfigAtom,
	loadedDatasetsAtom,
	previewVersionIdAtom,
} from "../../../store/atoms"

import { CHANNEL_PANELS } from "./channelPanels"

/** The options matrix: for one chart of every type, what each mark-styling
 *  row's options panel offers — its subsections (the PARTS, in order) and the
 *  controls in each.
 *
 *  This is a record of what is shown, not a judgement of it. Its job is to
 *  make any change to "which chart offers which option, under what name, in
 *  what order" a visible diff in review:
 *    - a refactor of the part registries must leave it byte-identical;
 *    - a deliberate change (a renamed part, a control gated off a chart
 *      that cannot use it, a new option) shows up as exactly that line.
 *  Whether each control DOES anything is the browser sweep's question
 *  (`e2e/sweep/options.sweep.ts`), which drives the same charts. */

const MARK_ROWS: readonly EncodingChannel[] = [
	"hue",
	"opacity",
	"saturation",
	"brightness",
	"pattern",
	"shape",
	"area",
	"connection",
	"length",
	"angle",
]

const ROW_LABEL: Partial<Record<EncodingChannel, string>> = {
	hue: "Color",
	opacity: "Opacity",
	saturation: "Saturation",
	brightness: "Brightness",
	pattern: "Pattern",
	shape: "Shape",
	area: "Size",
	connection: "Connection",
	length: "Length",
	angle: "Angle",
}

const compose = (chart: SweepChart, dataset: SweepDataset): Visual => {
	const { visual, problems } = composeVisual(
		{
			datasetId: dataset.id,
			folderId: null,
			name: chart.label,
			title: chart.label,
			variation: chart.variation,
			encodings: chart.encodings,
			settings: chart.settings,
		},
		{
			fields: dataset.fields.map((f) => ({ name: f.name, type: f.inferredType })),
			theme: LIGHT_THEME_BASE,
			latestVersionId: "v1",
			rows: dataset.rows,
			now: 1000,
		}
	)
	expect(problems, `${chart.id} should compose`).toEqual([])
	return visual
}

const describePanel = (
	visual: Visual,
	dataset: SweepDataset,
	channel: EncodingChannel,
	/** Per-category controls ("Color for North") are recorded as "Color for
	 *  ‹level›" and a run of them collapsed, keeping the snapshot about the
	 *  panel's shape rather than about the dummy data. */
	normalize: (label: string) => string
): { parts: string[]; controls: string[] } => {
	const built = buildDataset({
		id: dataset.id,
		name: dataset.name,
		filename: `${dataset.name}.csv`,
		fields: dataset.fields,
		rows: dataset.rows,
	})
	installInMemoryLocalStorage()
	const init = (store: TestStore) => {
		store.set(loadedDatasetsAtom, { [dataset.id]: built })
		store.set(currentDatasetIdAtom, dataset.id)
		store.set(previewVersionIdAtom, null)
		store.set(currentEncodingsAtom, visual.encodings)
		store.set(currentChannelConfigsAtom, visual.channelConfigs)
		store.set(currentMapConfigAtom, visual.mapConfig ?? DEFAULT_MAP_CONFIG)
		store.set(currentFieldOverridesAtom, visual.fieldTypeOverrides ?? {})
		store.set(currentFieldLevelOrdersAtom, {})
	}
	const Panel = CHANNEL_PANELS[channel]
	render(
		<TestProvider initializeState={init}>
			<div data-matrix-root>
				<Panel />
			</div>
		</TestProvider>
	)
	const root = "[data-matrix-root]"
	for (let pass = 0; pass < 8; pass++) {
		let opened = 0
		act(() => {
			opened = expandSubsections(root)
		})
		if (opened === 0) break
	}
	const scan = scanControls(root)
	const lines: string[] = []
	for (const control of scan.controls) {
		// Spinner arrows, swatches and palette pickers repeat the control they
		// belong to; "action" covers them and the add / reset buttons.
		if (control.kind === "action") continue
		const label = normalize(control.label)
		const line = `${control.section || "(top)"} · ${label} [${control.kind}${control.disabled ? ", disabled" : ""}]`
		if (lines[lines.length - 1] !== line) lines.push(line)
	}
	cleanup()
	return { parts: scan.sections, controls: lines }
}

describe("options matrix — what each mark-styling panel offers, per chart type", () => {
	it.each(SWEEP_CHARTS.map((chart) => [chart.id, chart] as const))("%s", (_id, chart) => {
		const dataset = SWEEP_DATASETS[chart.dataset]
		const visual = compose(chart, dataset)
		const normalize = levelNormalizer(dataset)
		const matrix: Record<string, { parts: string[]; controls: string[] }> = {}
		for (const channel of MARK_ROWS)
			matrix[ROW_LABEL[channel] ?? channel] = describePanel(visual, dataset, channel, normalize)
		expect(matrix).toMatchSnapshot()
	})

	/** The Pattern panel renders the sections `patternMenu` (lib/patternMenu)
	 *  returns: the headers it shows are that list's titled sections, in its
	 *  order. So the pure function can be asked what the menu offers — by
	 *  the "edited" dots, by tests — and be right about the panel. */
	it.each(SWEEP_CHARTS.map((chart) => [chart.id, chart] as const))(
		"%s: the Pattern panel shows what patternMenu lists",
		(_id, chart) => {
			const dataset = SWEEP_DATASETS[chart.dataset]
			const visual = compose(chart, dataset)
			const ctx = partsContext({
				encodings: visual.encodings,
				configs: visual.channelConfigs,
				mapConfig: visual.mapConfig ?? DEFAULT_MAP_CONFIG,
				getType: (name) => dataset.fields.find((f) => f.name === name)?.inferredType,
			})
			// A variable drives Pattern: a field, or a hierarchy's derived source.
			const patternMapped =
				!!visual.encodings.pattern?.field ||
				(isHierarchyModeId(ctx.modeDef.id) && !!packedSourceOf(visual.encodings.pattern))
			const shown = describePanel(visual, dataset, "pattern", levelNormalizer(dataset)).parts
			expect(shown).toEqual(
				patternMenu(ctx, patternMapped)
					.sections.filter((s) => s.titled)
					.map((s) => s.title)
			)
		}
	)
})
