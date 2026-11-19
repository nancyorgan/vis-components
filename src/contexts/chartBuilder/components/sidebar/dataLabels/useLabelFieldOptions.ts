import { useMemo } from "react"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import { hierarchyNameField } from "../../../lib/hierarchyLabels"
import {
	flowLabelFieldNames,
	flowRedundantLabelFields,
} from "../../../lib/flowNodeLabels"
import { seedLabelTextPalette } from "../../../lib/dataLabelsHue"
import { BAR_TOTAL_SEED, valueFieldsPatch } from "../../../lib/dataLabelsValueFields"
import { effectiveType } from "../../../lib/fieldType"
import {
	PACKED_DERIVED_LABELS,
	PACKED_MEASURE_OPTION_VALUE,
	hierarchyDepthLevels,
	packedSourceForOptionValue,
	topLevelGroupNames,
} from "../../../lib/packedMeasure"
import {
	DATA_LABEL_POSITION_CHANNELS,
	withBarLabelPosition,
} from "../../../lib/dataLabelsPosition"
import type { DataLabelsChannel } from "./shared"
import {
	DATA_LABELS_MULTI_VALUE,
} from "./panelOptions"
import type { DataLabelsPanelModel } from "./useDataLabelsPanelModel"

/** The channel rows' variable lists and setters: which fields each row
 *  offers (flow / tree / heatmap narrowing, derived sources), what an unset
 *  Value shows, and the writes a pick makes. */
export const useLabelFieldOptions = (m: DataLabelsPanelModel) => {
	const {
		encodings,
		setEncodings,
		chartEncodings,
		merged,
		updateCfg,
		theme,
		overrides,
		chartConfigs,
		dataset,
		hueSource,
		isTreeMode,
		isFlowMode,
		barTotalName,
		chartXField,
		chartYField,
		positionLocked,
		flowEndpoints,
	} = m

	// Coloring labels BY a categorical variable starts from the theme's
	// designated TEXT palette rather than the chart's mark palette: these are
	// words on the canvas, and the mark palette's lighter slots don't survive
	// at text size. Only seeds when no palette has been picked for this
	// layer — a palette already chosen (including "Match chart colors") is
	// the user's, and re-mapping Color never overwrites it. The dropdown
	// below re-picks, "Match chart colors" included.
	const seedTextPalette = () => {
		const seeded = seedLabelTextPalette(merged, theme)
		if (seeded) updateCfg(seeded)
	}

	const setField = (channel: DataLabelsChannel, fieldName: string) => {
		// Reserved option values = the hierarchy-derived sources. Writing
		// the slot fresh clears the other member (field ↔ measureSource
		// mutual exclusivity, like the main shelf).
		const derived = packedSourceForOptionValue(fieldName)
		if (derived) {
			setEncodings((prev) => ({
				...prev,
				[channel]: { field: null, measureSource: derived },
			}))
			// "Top-level group" names are categorical; "Nesting depth" is
			// ordinal and keeps its ordered ramp.
			if (channel === "hue" && derived === "rootGroup") seedTextPalette()
			return
		}
		const newField = fieldName === "" ? null : fieldName
		if (
			channel === "hue" &&
			newField !== null &&
			dataset &&
			effectiveType(dataset, newField, overrides) === "categorical"
		) {
			seedTextPalette()
		}
		// Position rows inherit the chart's mapping when unset, so "— none —"
		// there is recorded as `none` — an unset slot would inherit again.
		const isPosition = (DATA_LABEL_POSITION_CHANNELS as readonly string[]).includes(
			channel,
		)
		setEncodings((prev) => ({
			...prev,
			[channel]:
				isPosition && newField === null
					? { field: null, none: true }
					: { field: newField },
		}))
	}

	// The Value row is special: besides picking a single field it can switch
	// into multi-field mode (the "Multiple variables…" sentinel), which keeps
	// `value.field` null and drives the label off `value.fields` + template.
	const setValueField = (v: string) => {
		if (v === DATA_LABELS_MULTI_VALUE) {
			// Flows and trees label their nodes by name by default: an empty
			// checklist begins with the name column, as if the user had
			// checked it.
			if (
				defaultValueField &&
				(encodings.value.fields ?? []).length === 0
			) {
				setValueFields([defaultValueField])
				return
			}
			setEncodings((prev) => ({
				...prev,
				value: { field: null, multiField: true, fields: prev.value?.fields ?? [] },
			}))
			return
		}
		// On bars, a Value with no value-axis position sits each label on
		// its bar: the position takes the Length variable (lib).
		setEncodings((prev) =>
			withBarLabelPosition(
				{
					...prev,
					value: {
						field: v === "" ? null : v,
						multiField: false,
						fields: prev.value?.fields ?? [],
						// Flows and trees: "— none —" is a deliberate "no labels",
						// distinct from the unset default (the node names).
						...(defaultValueField && v === "" ? { none: true } : {}),
					},
				},
				chartEncodings
			)
		)
		// A total reads as the bar's once per bar, past its end: a fresh Bar
		// total starts on the last layer of each stack, outside its end —
		// movable like any label.
		if (barTotalName !== null && v === barTotalName) updateCfg(BAR_TOTAL_SEED)
	}
	const setValueFields = (fields: string[]) => {
		const prev = encodings.value.fields ?? []
		setEncodings((p) =>
			withBarLabelPosition(
				{ ...p, value: { field: null, multiField: true, fields } },
				chartEncodings
			)
		)
		// The labels follow the checklist (and a newly checked Bar total seeds
		// its placement): see `valueFieldsPatch`. This persists the list on
		// the first change, legacy-derived or not.
		updateCfg(valueFieldsPatch(merged, prev, fields, barTotalName))
	}

	const allEligible = dataset?.fields ?? []
	// Flow diagrams: an unset Value is the source column (the node names),
	// shown selected so its Label format is right there; "— none —" is the
	// explicit `none` (no node labels).
	const flowSourceField = flowEndpoints?.sourceField ?? null
	// The target and weight columns only repeat the names / Flow out on a
	// node, so the Value and Size lists leave them out (unless picked).
	const flowRedundant = flowEndpoints
		? flowRedundantLabelFields(flowEndpoints, [
				encodings.value.field,
				encodings.size.field,
				...(encodings.value.fields ?? []),
			])
		: new Set<string>()
	const labelTextEligible = allEligible.filter((f) => !flowRedundant.has(f.name))
	// Tree layouts (packed circles / treemap / sunburst) likewise: an unset
	// Value is the column that names the nodes — the id column when the
	// tree nests by id, else the connection column (see
	// `lib/hierarchyLabels.ts`, which the renderers use too).
	const treeNameField = useMemo(() => {
		if (!isTreeMode || !dataset) return null
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			chartEncodings.area?.field ?? null
		)
		return hierarchyNameField(parentField, idField)
	}, [isTreeMode, dataset, chartEncodings, chartConfigs.connection])
	/** What an unset Value shows: the node names on flows and trees. */
	const defaultValueField = isFlowMode
		? flowSourceField
		: isTreeMode
			? treeNameField
			: null
	const valueFieldShown: string | null =
		encodings.value.field ??
		(!encodings.value.multiField && encodings.value.none !== true
			? defaultValueField
			: null)
	// Flow-only values (Flow in / Flow out / Node total) listed with the
	// dataset's variables under Value and Size; a column already using one
	// of the names keeps it.
	const flowFieldOptions = isFlowMode
		? flowLabelFieldNames(allEligible.map((f) => f.name)).map((name) => ({
				value: name,
				label: name,
			}))
		: []
	const tileXEligible = chartXField
		? allEligible.filter((f) => f.name === chartXField)
		: []
	const tileYEligible = chartYField
		? allEligible.filter((f) => f.name === chartYField)
		: []
	const xEligible = positionLocked ? tileXEligible : allEligible
	const yEligible = positionLocked ? tileYEligible : allEligible

	// Derived options for the Color / Size dropdowns — tree layouts with a
	// mapped connection only (a flat pack is uniformly depth 1, and there
	// are no groups to derive). Size offers depth only: group names are
	// categorical, and a font size needs an ordered value.
	const connectionMapped = !!chartEncodings.connection?.field
	const labelDerivedHueOptions =
		isTreeMode && connectionMapped
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE.rootGroup,
						label: PACKED_DERIVED_LABELS.rootGroup,
					},
					{
						value: PACKED_MEASURE_OPTION_VALUE.depth,
						label: PACKED_DERIVED_LABELS.depth,
					},
				]
			: []
	const labelDerivedSizeOptions =
		isTreeMode && connectionMapped
			? [
					{
						value: PACKED_MEASURE_OPTION_VALUE.depth,
						label: PACKED_DERIVED_LABELS.depth,
					},
				]
			: []
	// Override-swatch values for a derived Color: group names / depth
	// levels from the same tree the renderer builds (id column resolved
	// identically), so the swatch list matches the drawn labels.
	const derivedHueValues = (() => {
		if (!hueSource || !dataset || !isTreeMode) return undefined
		const parentField = chartEncodings.connection?.field ?? null
		if (!parentField) return undefined
		const areaField = chartEncodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			chartConfigs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		return hueSource === "rootGroup"
			? topLevelGroupNames(dataset.rows, parentField, idField, areaField)
			: hierarchyDepthLevels(dataset.rows, parentField, idField, areaField)
	})()

	return {
		setField,
		setValueField,
		setValueFields,
		allEligible,
		labelTextEligible,
		valueFieldShown,
		flowFieldOptions,
		xEligible,
		yEligible,
		labelDerivedHueOptions,
		labelDerivedSizeOptions,
		derivedHueValues,
	}
}
