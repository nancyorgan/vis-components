/** Which of a data set's columns a published embed carries.
 *
 *  A published page is public (server/src/publicEmbed.ts), so it carries
 *  only the columns the chart SHOWS: drawn, labelled, listed in its data
 *  table, or readable on hover. A sheet of test scores plotted as an average
 *  per class must not hand every pupil's row of other columns to anyone who
 *  opens the page source.
 *
 *  "Shows" includes the hover tooltip, and the default tooltip lists every
 *  column of the hovered row — so a chart with the default tooltip keeps
 *  every column, exactly as its hover does. Unchecking a variable in the
 *  Tooltip panel is what takes it out of the published data. The same goes
 *  for a data table set to All variables.
 *
 *  How "uses" is decided: NOT by a second list of the places a chart can
 *  name a column. The field-rename rewrite (renameField.ts) already visits
 *  every one of them and returns the same object when a name appears
 *  nowhere, so a column is used exactly when renaming it would change the
 *  chart's settings. A new feature that stores a column's name has to teach
 *  the rename about it anyway; this follows for free.
 *
 *  The one thing a rename can't see is a column the chart picks for
 *  itself: a tree or flow diagram left on Auto finds its child / target
 *  column from the data. Those are resolved here with the renderers' own
 *  functions and kept.
 *
 *  RESULTS, NOT RECIPES. A reshape or a derived variable that the visual
 *  still applies live (visuals from before those were saved as data
 *  versions) is worked out HERE, before publishing, with the function that
 *  saves them as a version (`bakeTransforms`): the page gets the finished
 *  table, and neither the formula, the reshape settings, nor a column that
 *  only fed them. "Pass" computed from Score is published without Score.
 *  The columns are then chosen on that finished table, where a derived
 *  variable is a column like any other: kept only if the chart shows it.
 *
 *  Deliberately generous where being wrong would blank part of a published
 *  chart: a stale per-variable setting counts as a use. */

import { inferHierarchyIdField, resolveHierarchyIdField } from "./buildHierarchy"
import { resolveFlowTargetField } from "./buildFlowGraph"
import { getChartModeDef } from "./chartMode"
import { isFlowModeId } from "./chartModes/families"
import { migrateDataTableConfig } from "./dataTableConfig"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "./derivedVariables"
import { DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import { renameFieldInConfigs, type FieldNameConfigs } from "./renameField"
import { bakeTransforms } from "./materializeTransforms"
import { DEFAULT_RESHAPE_CONFIG, reshapeGroups } from "./reshape"
import { resolveDatasetView } from "./resolveDatasetVersion"
import type { Dataset, DatasetView, Field, Visual } from "./types"

/** Why every column is public, when one setting alone makes it so. */
export type AllColumnsReason = "tooltip" | "dataTable"

export type EmbedColumns = {
	/** The columns the embed carries, in the data set's order. */
	kept: string[]
	/** The columns left out of the published page. */
	dropped: string[]
	/** Set when one setting shows every column, so none can be dropped. */
	allBecause: AllColumnsReason | null
}

/** A name no column can have: it only ever exists inside the probe. */
const PROBE_NAME = "\u0000embed-column-probe"

/** The setting that shows every column of a row, if one does. */
const showsEveryColumn = (visual: Visual): AllColumnsReason | null => {
	const table = migrateDataTableConfig(visual.dataTableConfig)
	if (table.enabled && table.columns === "all") return "dataTable"
	const tooltip = { ...DEFAULT_TOOLTIP_CONFIG, ...visual.tooltipConfig }
	const template = !!tooltip.useCustomHtml && tooltip.customHtml.trim() !== ""
	// The checkbox list with nothing unchecked: the hover prints the row.
	if (tooltip.enabled && !template && tooltip.visibleFields.length === 0) return "tooltip"
	return null
}

type Table = { fields: readonly Field[]; rows: ReadonlyArray<Record<string, string>> }

/** The visual with its live reshape and derived variables already worked
 *  out: the finished table, and the visual without the settings that made
 *  it (see the header). The same objects back when the visual applies
 *  neither. */
const baked = (visual: Visual, view: DatasetView): { visual: Visual; table: Table } => {
	const reshape = visual.reshapeConfig
	const derived = visual.derivedVariablesConfig
	const reshapes = reshape !== undefined && reshapeGroups(reshape).some((g) => g.meltFields.length > 0)
	const derives = (derived?.variables.length ?? 0) > 0
	if (!reshapes && !derives) return { visual, table: view }
	const table = bakeTransforms(
		view,
		visual.fieldTypeOverrides,
		reshape ?? DEFAULT_RESHAPE_CONFIG,
		derived ?? DEFAULT_DERIVED_VARIABLES_CONFIG
	)
	const {
		reshapeConfig: _reshape,
		derivedVariablesConfig: _derived,
		...withoutRecipes
	} = visual
	return { visual: withoutRecipes, table: { fields: table.fields, rows: table.rows } }
}

/** Which columns a publish of `visual` carries, of the table it draws
 *  (`view`: the data as stored, before the visual's own reshape and derived
 *  variables). What the Publish tab lists. */
export const embedColumns = (visual: Visual, view: DatasetView): EmbedColumns => {
	const result = baked(visual, view)
	return columnsShown(result.visual, result.table.fields, result.table.rows)
}

/** The columns `visual` shows, of a finished table. */
const columnsShown = (
	visual: Visual,
	fields: readonly Field[],
	rows: ReadonlyArray<Record<string, string>>
): EmbedColumns => {
	const names = fields.map((f) => f.name)
	const allBecause = showsEveryColumn(visual)
	if (allBecause !== null) return { kept: names, dropped: [], allBecause }

	const isColumn = new Set(names)
	const kept = new Set<string>()
	const keep = (name: string | undefined) => {
		if (name !== undefined && isColumn.has(name)) kept.add(name)
	}

	// The settings a rename rewrites, minus the per-variable bookkeeping
	// (type overrides, level orders, the Fields panel's order): those name
	// every column the author ever touched, used or not. They are trimmed to
	// the kept columns afterwards instead (`pruneEmbedRecords`).
	const probed: FieldNameConfigs = {
		encodings: visual.encodings,
		dataLabelsEncodings: visual.dataLabelsEncodings,
		fieldTypeOverrides: {},
		channelConfigs: visual.channelConfigs,
		labelsConfig: visual.labelsConfig,
		dataLabelsConfig: visual.dataLabelsConfig,
		tooltipConfig: visual.tooltipConfig,
		annotationsConfig: visual.annotationsConfig,
	}
	const fieldList = [...fields]
	const slices = Object.keys(probed) as Array<keyof FieldNameConfigs>
	for (const name of names) {
		const renamed = renameFieldInConfigs(probed, fieldList, name, PROBE_NAME)
		if (slices.some((key) => renamed[key] !== probed[key])) kept.add(name)
	}

	// Columns the chart picks for itself (see the header). A column whose
	// values repeat the connection column's is what a tree nests by and what
	// a flow shares its node names with; a flow with no such column falls
	// back to its first categorical one. Removing other columns can't change
	// either pick, so the embed resolves the same column from what's kept.
	const connection = visual.encodings.connection?.field
	if (connection) {
		const typed = fields.map((f) => ({
			...f,
			inferredType: visual.fieldTypeOverrides?.[f.name] ?? f.inferredType,
		}))
		const value = visual.encodings.area?.field ?? null
		const config = visual.channelConfigs.connection
		keep(
			resolveHierarchyIdField(config?.hierarchyIdField, rows, names, connection, value) ??
				undefined
		)
		const mode = getChartModeDef(
			visual.encodings,
			(name) => typed.find((f) => f.name === name)?.inferredType,
			visual.channelConfigs,
			visual.mapConfig
		)
		keep(
			(isFlowModeId(mode.id)
				? resolveFlowTargetField(config?.flowTargetField, rows, typed, connection, value)
				: inferHierarchyIdField(
						rows,
						names.filter((n) => n !== connection && n !== value),
						connection
					)) ?? undefined
		)
	}

	const table = migrateDataTableConfig(visual.dataTableConfig)
	if (table.enabled && table.columns === "select") table.selectedColumns.forEach(keep)

	// "Order by another variable": a kept variable's order reads that other
	// column (and its scope column). Repeat until nothing is added.
	const specs = Object.entries(visual.fieldLevelOrderSpecs ?? {})
	for (let size = -1; size !== kept.size; ) {
		size = kept.size
		for (const [name, spec] of specs) {
			if (isColumn.has(name) && !kept.has(name)) continue
			keep(spec.byField)
			keep(spec.scopeField)
		}
	}

	return {
		kept: names.filter((name) => kept.has(name)),
		dropped: names.filter((name) => !kept.has(name)),
		allBecause: null,
	}
}

const withoutKeys = <V>(
	record: Record<string, V> | undefined,
	dropped: ReadonlySet<string>
): Record<string, V> | undefined => {
	if (record === undefined) return record
	const out: Record<string, V> = {}
	for (const [key, value] of Object.entries(record)) {
		if (!dropped.has(key)) out[key] = value
	}
	return out
}

/** The visual and its one-version data set as they are published: a live
 *  reshape and derived variables worked out into the table, then the
 *  dropped columns gone from the rows, from the column lists, and from the
 *  per-variable settings that named them (so not even a dropped column's
 *  name, or the list of its values, goes out). Returns the records
 *  untouched when there is nothing to work out and nothing to drop. */
export const pruneEmbedRecords = (
	source: Visual,
	stored: Dataset
): { visual: Visual; dataset: Dataset; columns: EmbedColumns } => {
	const view = resolveDatasetView(stored, null)
	const result = view ? baked(source, view) : null
	// A worked-out table is already under its columns' current names, so it
	// replaces the version's own column list and name aliases.
	const dataset: Dataset =
		result && view && result.table !== view
			? {
					...stored,
					fields: [...result.table.fields],
					versions: stored.versions.map(({ keyAliases: _aliases, ...v }) => ({
						...v,
						fields: [...result.table.fields],
						rows: [...result.table.rows],
					})),
				}
			: stored
	const visual = result?.visual ?? source
	const version = dataset.versions[0]
	const columns = result
		? columnsShown(visual, result.table.fields, result.table.rows)
		: columnsShown(visual, dataset.fields, [])
	if (columns.dropped.length === 0) return { visual, dataset, columns }
	const dropped = new Set(columns.dropped)

	// A row is keyed by the name each column had when its version was
	// uploaded, so a kept column's cells may sit under an earlier name.
	const keepField = (field: Field) => !dropped.has(field.name)
	const rowKeys = new Set<string>()
	for (const field of [...dataset.fields, ...(version?.fields ?? [])].filter(keepField)) {
		rowKeys.add(field.name)
		for (const former of field.sourceNames ?? []) rowKeys.add(former)
	}
	for (const [name, key] of Object.entries(version?.keyAliases ?? {})) {
		if (!dropped.has(name)) rowKeys.add(key)
	}
	const keys = [...rowKeys]

	const prunedDataset: Dataset = {
		...dataset,
		fields: dataset.fields.filter(keepField),
		versions: dataset.versions.map((v) => ({
			...v,
			...(v.fields ? { fields: v.fields.filter(keepField) } : {}),
			...(v.keyAliases ? { keyAliases: withoutKeys(v.keyAliases, dropped) } : {}),
			rows: v.rows.map((row) => {
				const out: Record<string, string> = {}
				for (const key of keys) {
					const cell = row[key]
					if (cell !== undefined) out[key] = cell
				}
				return out
			}),
		})),
	}

	const table = visual.dataTableConfig
	const prunedVisual: Visual = {
		...visual,
		fieldTypeOverrides: withoutKeys(visual.fieldTypeOverrides, dropped) ?? {},
		fieldLevelOrders: withoutKeys(visual.fieldLevelOrders, dropped),
		fieldLevelOrderSpecs: withoutKeys(visual.fieldLevelOrderSpecs, dropped),
		fieldOrder: visual.fieldOrder?.filter((name) => !dropped.has(name)),
		dataTableConfig: table && {
			...table,
			...(table.selectedColumns
				? { selectedColumns: table.selectedColumns.filter((name) => !dropped.has(name)) }
				: {}),
			...(table.hiddenPlottedColumns
				? {
						hiddenPlottedColumns: table.hiddenPlottedColumns.filter(
							(name) => !dropped.has(name)
						),
					}
				: {}),
		},
	}
	return { visual: prunedVisual, dataset: prunedDataset, columns }
}
