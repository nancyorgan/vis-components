/** Publishing totals instead of rows.
 *
 *  A published page is public, and it draws its chart from rows. A bar, a
 *  pie wedge or an area point that ADDS UP a measure doesn't need the rows
 *  behind it: one row per mark, with the measure already added up, draws
 *  the same chart — the embed adds up one row and gets the same total. So
 *  for those charts the rows are collapsed before publishing, and the page
 *  holds the totals the chart shows and not the records they came from.
 *
 *  The collapse must not change the picture, the hover or the labels, so it
 *  is CONSERVATIVE: it applies only where every reader of the rows is known
 *  to get the same answer from the collapsed table, and otherwise the rows
 *  are published as they are (what every publish did before this existed).
 *  `embedAggregate.smoke.test.tsx` draws every bundled example both ways.
 *
 *  How a column is carried, by how the chart reads it:
 *   - a KEY column (the category axis, a color / pattern / opacity
 *     grouping, a facet, or any column a setting other than the tooltip
 *     names): rows are merged only when they agree on every key, so each
 *     merged row still says exactly what its rows said
 *   - the MEASURE: added up. A cell that isn't a clean number (blank,
 *     text) is never folded into a sum: rows carrying one stay apart, so
 *     the embed skips or zeroes them exactly as it would have
 *   - a HOVER-ONLY column (one the chart reads nowhere but the tooltip's
 *     Fields shown): the hover prints the value from the first row behind a
 *     mark, so the merged row keeps its first row's value. This is option
 *     "follow the checkboxes" (Nancy, 2026-11-19): a ticked column is
 *     published, one value per mark; unticking it takes it out entirely
 *     (`embedColumns.ts` drops the column before this runs)
 *
 *  What stays row-level, with the reason the Publish tab shows:
 *   - every chart type that doesn't add up a measure: a bar chart that
 *     COUNTS rows (and a histogram), box / violin, scatter, lines, maps,
 *     tiles, trees, flows, and a bar + line combo (the line reads rows)
 *   - a chart with a setting that reads the measure row by row (a
 *     `{Measure} > 5` rule, a color that varies by the measure) or that
 *     adds up a column other than the measure (a second label variable)
 *   - an area chart whose hover lists the measure: a layer's hover prints
 *     its first ROW, so the line would change from a row's value to a total
 *
 *  Known difference: the data table's note counts "the underlying data" as
 *  the rows the page holds, so a collapsed publish reports the collapsed
 *  count. Sums that span several merged rows can differ from the editor's
 *  in the last binary digit (the same numbers added in another grouping).
 *
 *  Pure; `store/publishEmbed.ts` runs it after `pruneEmbedRecords`. */

import { stringifyJsonDangerous } from "../../../lib/json"
import { resolveAreaMeasureField, type GroupChannel } from "./aggregators/stacks"
import type { EncodingChannel } from "./channelNames"
import { getChartModeDef } from "./chartMode"
import { isAreaModeId, isBarModeId, isComboModeId, isPieModeId } from "./chartModes/families"
import { DEFAULT_TOOLTIP_CONFIG } from "./labelsConfig"
import { pruneEmbedRecords } from "./embedColumns"
import { applyCellConversions } from "./materializeTransforms"
import { renameFieldInConfigs, type FieldNameConfigs } from "./renameField"
import { resolveDatasetView } from "./resolveDatasetVersion"
import { parseNumericCell } from "./scales"
import type { Dataset, DatasetView, Field, FieldType, Visual } from "./types"

export type EmbedAggregation =
	| {
			aggregated: true
			/** Rows in the table the chart draws, and rows published. */
			rowsBefore: number
			rowsAfter: number
			/** The column that was added up. */
			measure: string
	  }
	| {
			aggregated: false
			/** Why a chart that adds up a measure still publishes its rows, for
			 *  the Publish tab. Null when there is nothing to say: the chart
			 *  type draws from rows, or collapsing would remove none. */
			reason: string | null
	  }

type Row = Record<string, string>

const FACET_CHANNELS: readonly EncodingChannel[] = ["facet", "facetRow", "facetCol"]
/** As `plottedData.ts`: what the bar renderer stacks / groups by. */
const BAR_GROUP_CHANNELS: readonly GroupChannel[] = [
	"hue",
	"outlineHue",
	"saturation",
	"brightness",
	"pattern",
	"opacity",
]
/** Pies and areas don't split by outline color. */
const LAYER_GROUP_CHANNELS: readonly GroupChannel[] = [
	"hue",
	"saturation",
	"brightness",
	"pattern",
	"opacity",
]

/** A name no column can have: it only ever exists inside the probe. */
const PROBE_NAME = "\u0000embed-aggregate-probe"

type Plan = {
	measure: string
	/** Channels whose field is a key: rows merge only when these agree. */
	keyChannels: readonly EncodingChannel[]
	measureChannel: EncodingChannel
}

const ROWS = (reason: string | null): EmbedAggregation => ({ aggregated: false, reason })

/** Which column a sum chart adds up and which channels split it, or why
 *  this chart isn't one. */
const planFor = (
	visual: Visual,
	mode: string,
	getType: (field: string) => FieldType
): Plan | EmbedAggregation => {
	const enc = visual.encodings
	const fieldOf = (ch: EncodingChannel): string | null => enc[ch]?.field ?? null
	let categoryChannel: EncodingChannel | null
	let measureChannel: EncodingChannel
	let groups: readonly EncodingChannel[]
	if (isComboModeId(mode)) return ROWS("its line or points are drawn from individual rows")
	if (isBarModeId(mode)) {
		categoryChannel = mode === "bars-x" ? "x" : "y"
		measureChannel = "length"
		groups = BAR_GROUP_CHANNELS
		const category = fieldOf(categoryChannel)
		if (
			category &&
			visual.channelConfigs[categoryChannel]?.histogram?.enabled === true &&
			getType(category) === "quantitative"
		) {
			return ROWS("a histogram counts rows")
		}
	} else if (isAreaModeId(mode)) {
		categoryChannel = mode === "areas-x" ? "x" : "y"
		const measure = resolveAreaMeasureField(mode as "areas-x" | "areas-y", enc)
		measureChannel = measure !== null && measure === enc.length?.field ? "length" : "y"
		// An area's `connection` names its layers (what makes the chart an
		// area and not a scatter): a key like any other grouping.
		groups = [...LAYER_GROUP_CHANNELS, "connection"]
	} else if (isPieModeId(mode)) {
		categoryChannel = mode === "pies" ? null : mode === "pies-x" ? "x" : "y"
		measureChannel = "angle"
		groups = LAYER_GROUP_CHANNELS
	} else {
		return ROWS(null)
	}
	const measure = fieldOf(measureChannel)
	if (!measure || (categoryChannel !== null && !fieldOf(categoryChannel))) return ROWS(null)
	if (getType(measure) !== "quantitative") return ROWS("its marks count rows")
	const keyChannels = [
		...(categoryChannel === null ? [] : [categoryChannel]),
		...groups,
		...FACET_CHANNELS,
	]
	// A channel this plan doesn't know reads rows its own way (a size, a
	// shape, a second position): leave the rows alone.
	for (const [channel, encoding] of Object.entries(enc)) {
		if (!encoding?.field) continue
		const ch = channel as EncodingChannel
		if (ch !== measureChannel && !keyChannels.includes(ch)) {
			return ROWS(`its ${channel} setting reads individual rows`)
		}
	}
	if (keyChannels.some((ch) => fieldOf(ch) === measure)) {
		return ROWS("its measure is also used to group the marks")
	}
	// Hovering an area layer prints the layer's FIRST ROW, the measure
	// included: one row's value, not a total. From collapsed rows that line
	// would read a total instead, so the rows stay while the hover shows it.
	if (isAreaModeId(mode) && tooltipShows(visual, measure)) {
		return ROWS(
			`hovering a layer shows ${measure} from one row (untick ${measure} under Tooltips to publish totals)`
		)
	}
	return { measure, keyChannels, measureChannel }
}

/** Whether the hover prints `field`: ticked under Fields shown (nothing
 *  unticked = every column), or named by a custom template. */
const tooltipShows = (visual: Visual, field: string): boolean => {
	const tooltip = { ...DEFAULT_TOOLTIP_CONFIG, ...visual.tooltipConfig }
	if (!tooltip.enabled) return false
	if (tooltip.useCustomHtml && tooltip.customHtml.trim() !== "") {
		return [...tooltip.customHtml.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].some(
			(m) => (m[1] ?? "").trim() === field
		)
	}
	return tooltip.visibleFields.length === 0 || tooltip.visibleFields.includes(field)
}

/** Every `condition` string in a settings tree (`{Region} == West`): the
 *  conditional rules, which test a mark's rows one by one. */
const conditionsIn = (value: unknown, out: string[] = []): string[] => {
	if (Array.isArray(value)) {
		for (const item of value) conditionsIn(item, out)
	} else if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			if (key === "condition" && typeof child === "string") out.push(child)
			else conditionsIn(child, out)
		}
	}
	return out
}

/** Whether a settings tree holds a slot driven by `name` (`field: name`):
 *  a color, opacity or modulation that varies by that column. */
const hasSlotFor = (value: unknown, name: string): boolean => {
	if (Array.isArray(value)) return value.some((item) => hasSlotFor(item, name))
	if (typeof value !== "object" || value === null) return false
	for (const [key, child] of Object.entries(value)) {
		if (key === "field" && child === name) return true
		if (hasSlotFor(child, name)) return true
	}
	return false
}

/** A cell that reads as the same number however it is parsed: the bar
 *  aggregation reads `Number(cell)`, the labels and orderings read
 *  `parseNumericCell(cell)`. */
const cleanNumber = (cell: unknown): number | null => {
	const parsed = parseNumericCell(cell)
	if (parsed === null) return null
	const n = Number(cell)
	return Number.isFinite(n) && n === parsed ? n : null
}

/** The published records with a sum chart's rows collapsed to one per mark
 *  (see the file header), or the same records and why not. `visual` and
 *  `dataset` are the records as `pruneEmbedRecords` leaves them: one
 *  version, only the columns the chart shows, reshape and derived variables
 *  already worked out. */
export const aggregateEmbedRecords = (
	visual: Visual,
	dataset: Dataset
): { dataset: Dataset; aggregation: EmbedAggregation } => {
	const keep = (aggregation: EmbedAggregation) => ({ dataset, aggregation })
	const view = resolveDatasetView(dataset, null)
	const version = dataset.versions.find((v) => v.id === view?.versionId)
	if (!view || !version || dataset.versions.length !== 1) return keep(ROWS(null))
	const overrides = visual.fieldTypeOverrides ?? {}
	// The table as the chart reads it: "14%" as 0.14, "$1,234" as 1234.
	const converted = applyCellConversions(view, overrides) ?? view
	const typeOf = new Map(converted.fields.map((f) => [f.name, overrides[f.name] ?? f.inferredType]))
	const getType = (field: string): FieldType => typeOf.get(field) ?? "categorical"
	const mode = getChartModeDef(
		visual.encodings,
		(name) => typeOf.get(name),
		visual.channelConfigs,
		visual.mapConfig
	).id
	const plan = planFor(visual, mode, getType)
	if ("aggregated" in plan) return keep(plan)
	const { measure } = plan

	const names = view.fields.map((f) => f.name)
	if (!names.includes(measure)) return keep(ROWS(null))
	const encoded = new Set<string>()
	for (const ch of plan.keyChannels) {
		const field = visual.encodings[ch]?.field
		if (field && names.includes(field)) encoded.add(field)
	}

	// ── Who else reads each column ─────────────────────────────────────────
	// The rename rewrite visits every setting that stores a column's name
	// (as `embedColumns.ts` uses it): a slice it changes names the column.
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
	const fieldList = [...view.fields]
	const slices = Object.keys(probed) as Array<keyof FieldNameConfigs>
	const namedIn = (name: string): Set<keyof FieldNameConfigs> => {
		const renamed = renameFieldInConfigs(probed, fieldList, name, PROBE_NAME)
		return new Set(slices.filter((key) => renamed[key] !== probed[key]))
	}
	const conditions = conditionsIn([
		visual.channelConfigs,
		visual.labelsConfig,
		visual.dataLabelsConfig,
		visual.annotationsConfig,
	])
	const inCondition = (name: string) => conditions.some((c) => c.includes(`{${name}}`))

	// The measure: only read as a total. A rule that tests it row by row, or
	// a color / opacity that varies by it, reads the rows.
	const measureIn = namedIn(measure)
	if (
		inCondition(measure) ||
		measureIn.has("channelConfigs") ||
		measureIn.has("labelsConfig") ||
		measureIn.has("annotationsConfig") ||
		hasSlotFor(visual.dataLabelsConfig, measure)
	) {
		return keep(ROWS(`a setting reads ${measure} row by row`))
	}

	// "Order by another variable": by the measure's total is a sum of sums;
	// by anything else is that column added up or compared across rows. A
	// scope column is a key.
	const keys = new Set(encoded)
	for (const [name, spec] of Object.entries(visual.fieldLevelOrderSpecs ?? {})) {
		if (!names.includes(name)) continue
		if (spec.byField !== undefined && spec.byField !== measure && names.includes(spec.byField)) {
			return keep(ROWS(`${name} is ordered by ${spec.byField}, which is read row by row`))
		}
		if (spec.scopeField !== undefined && names.includes(spec.scopeField)) {
			if (spec.scopeField === measure) return keep(ROWS(`a setting reads ${measure} row by row`))
			keys.add(spec.scopeField)
		}
	}

	// Every other column is hover-only when nothing but the tooltip names
	// it, and a key otherwise.
	const hoverOnly: string[] = []
	const labelRead = new Set<string>()
	for (const name of names) {
		if (name === measure) continue
		const where = namedIn(name)
		if (where.has("dataLabelsConfig")) labelRead.add(name)
		if (keys.has(name)) continue
		const beyondTooltip = [...where].some((slice) => slice !== "tooltipConfig")
		if (beyondTooltip || inCondition(name)) keys.add(name)
		else hoverOnly.push(name)
	}

	// A label adds a column up over a mark's rows when its cells are
	// numbers. Added up, a key column would count once per merged row
	// instead of once per row, so a label may read only the measure or a
	// key with no numbers in it. (The label's own x / y / angle slots place
	// it; they add nothing up.)
	const labels = visual.dataLabelsEncodings
	for (const name of [
		labels?.value?.field,
		...(labels?.value?.fields ?? []),
		labels?.hue?.field,
		labels?.size?.field,
	]) {
		if (typeof name === "string" && name !== measure) labelRead.add(name)
	}
	for (const name of labelRead) {
		if (name === measure || !names.includes(name)) continue
		if (!keys.has(name)) keys.add(name)
		const index = hoverOnly.indexOf(name)
		if (index !== -1) hoverOnly.splice(index, 1)
		const numeric =
			getType(name) === "quantitative" ||
			converted.rows.some((row) => parseNumericCell(row[name]) !== null)
		if (numeric) return keep(ROWS(`a label adds up ${name} as well`))
	}

	// ── Collapse ───────────────────────────────────────────────────────────
	// Keys are compared as the cells the chart reads (converted), so "14%"
	// and "14.0%" on a key column merge exactly when the chart treats them
	// as one value; the published cell is the first row's own text.
	const keyNames = names.filter((name) => keys.has(name))
	type Group = { first: Row; sum: number | null }
	const groups = new Map<string, Group>()
	const order: Group[] = []
	for (let i = 0; i < view.rows.length; i++) {
		const row = view.rows[i]
		const read = converted.rows[i] ?? row
		if (!row) continue
		const cell = read[measure]
		const n = cleanNumber(cell)
		if (n === null) {
			// Not a clean number. Blank and text contribute nothing however
			// many rows carry them, so equal ones can share a row; a cell one
			// parser reads as a number and the other doesn't can't be merged.
			const asNumber = Number(cell)
			if (parseNumericCell(cell) !== null || (Number.isFinite(asNumber) && asNumber !== 0)) {
				return keep(ROWS(`${measure} holds a value that can't be added up safely`))
			}
		}
		const parts = keyNames.map((name) => {
			const value: unknown = read[name]
			return value === undefined ? "\u0000" : String(value)
		})
		// The measure's own cell joins the key when it isn't summed.
		parts.push(n === null ? `t${cell === undefined ? "\u0000" : String(cell)}` : "n")
		const key = stringifyJsonDangerous(parts)
		const group = groups.get(key)
		if (!group) {
			const fresh: Group = { first: row, sum: n }
			groups.set(key, fresh)
			order.push(fresh)
		} else if (n !== null && group.sum !== null) {
			group.sum += n
		}
	}
	if (order.length >= view.rows.length) return keep(ROWS(null))

	const rows: Row[] = []
	for (const group of order) {
		const out: Row = {}
		for (const name of names) {
			const cell = group.first[name]
			if (name === measure && group.sum !== null) {
				const text = String(group.sum)
				// The total must read back as itself, by both parsers.
				if (Number(text) !== group.sum || parseNumericCell(text) !== group.sum) {
					return keep(ROWS(`${measure} adds up to a value that can't be stored exactly`))
				}
				out[name] = text
			} else if (cell !== undefined) {
				out[name] = cell
			}
		}
		rows.push(out)
	}

	// The measure's cells are plain numbers now, so the "this column was
	// typed as percents / dollars" cue the embed reads off the cells is
	// gone: carry it on the column instead (the embed keeps a hint a
	// column arrives with). Its cell-text map described cells that no
	// longer exist.
	const hint = converted.fields.find((f) => f.name === measure)?.formatHint
	const publishField = (field: Field): Field => {
		if (field.name !== measure) return field
		const { displayCells: _cells, ...rest } = field
		return hint ? { ...rest, formatHint: hint } : rest
	}
	// A table under its columns' current names (as a worked-out table is in
	// `pruneEmbedRecords`): it replaces the version's column list and aliases.
	const fields = (version.fields ?? dataset.fields).map(publishField)
	const { keyAliases: _aliases, ...versionRest } = version
	return {
		dataset: {
			...dataset,
			fields: dataset.fields.map(publishField),
			versions: [{ ...versionRest, fields, rows }],
		},
		aggregation: {
			aggregated: true,
			rowsBefore: view.rows.length,
			rowsAfter: rows.length,
			measure,
		},
	}
}

/** What a publish of `visual` would do with the rows of the table it draws
 *  (`view`: the data as stored, before the visual's own reshape and derived
 *  variables), for the Publish tab: the same two steps a publish runs, on a
 *  one-version data set made from the view. */
export const embedAggregationFor = (visual: Visual, view: DatasetView): EmbedAggregation => {
	const dataset: Dataset = {
		id: view.id,
		name: view.name,
		fields: view.fields,
		versions: [
			{
				id: view.versionId,
				filename: view.filename,
				rows: view.rows,
				createdAt: view.versionCreatedAt,
			},
		],
		latestVersionId: view.versionId,
		createdAt: view.createdAt,
	}
	const pruned = pruneEmbedRecords(visual, dataset)
	return aggregateEmbedRecords(pruned.visual, pruned.dataset).aggregation
}
