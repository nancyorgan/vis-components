// "Which labels" resolution and the composed-label model for the Data Labels
// layer.
//
// Single-field labels keep one layer-wide `labelPoints` mode, read as
// memberships in up to three label POPULATIONS:
//
//   - "all"   — every anchor
//   - "first" — the first anchor per series
//   - "last"  — the last anchor per series
//
// Multi-field labels ("Multiple variables…") are a LIST of composed labels
// (`DataLabelsConfig.composedLabels`): every text box under Value → Compose
// labels is one label, composing its `{Field}` template at every anchor its
// own "Which labels" (`fieldLabelPoints[id]`) names. One anchor can carry
// several labels — a stacked bar's last slice shows the `{value}` label AND
// a `{series}` label hanging outside the bar. Pure functions — shared by the
// renderer, the margin reserve, and the sidebar panel so all three agree on
// which labels exist and where each one draws.

import {
	effectiveLabelPoints,
	type ComposedLabel,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type LabelPieceSection,
	type LabelPointsMode,
	type LabelPointsScope,
	type DataLabelAlignment,
} from "./channelConfig"
import type { EndpointTag } from "./dataLabelsLayout"
import type { FacetPanelRef } from "./facetPanelRef"
import { pieceKey } from "./labelPieces"
import type { DataLabelsEncodings } from "./types"

// The in-memory piece key and its accessors live in `lib/labelPieces.ts`;
// re-exported so the sidebar and renderer keep one import for label keys.
export { labelEntry, pieceKey } from "./labelPieces"

export type LabelPopulation = "all" | "first" | "last"

/** Display order for anything that lists populations: every-label first,
 *  then the series ends. */
const LABEL_POPULATIONS: readonly LabelPopulation[] = [
	"all",
	"first",
	"last",
]

/** The effective "Which labels" mode for one composed label (by id): its
 *  own entry, else the layer-wide mode (so a label added later follows the
 *  layer default). */
export const fieldLabelPointsMode = (
	cfg: Pick<DataLabelsConfig, "fieldLabelPoints" | "labelPoints" | "onlyLastLabel">,
	key: string
): LabelPointsMode => cfg.fieldLabelPoints?.[key] ?? effectiveLabelPoints(cfg)

/** The effective "Of each" scope for one composed label (by id): its own
 *  entry, else the layer-wide scope. `null` (the single-field label) always
 *  takes the layer-wide one. A scope whose channel isn't mapped still reads
 *  as "series" downstream — `labelSeriesResolver` owns that fallback. */
export const labelScopeFor = (
	cfg: Pick<DataLabelsConfig, "fieldLabelPointsScope" | "labelPointsScope">,
	key: string | null
): LabelPointsScope =>
	(key === null ? undefined : cfg.fieldLabelPointsScope?.[key]) ??
	cfg.labelPointsScope ??
	"series"

/** The facet scope for one composed label (by id): its own entry when it has
 *  one — including an explicit `null`, which means "every panel" and so
 *  OVERRIDES a layer-wide list — else the layer-wide `facetKeys`. `null`
 *  (the single-field label) always takes the layer-wide one. */
export const labelFacetKeysFor = (
	cfg: Pick<DataLabelsConfig, "fieldFacetKeys" | "facetKeys">,
	key: string | null
): FacetPanelRef[] | null | undefined => {
	const own = key === null ? undefined : cfg.fieldFacetKeys?.[key]
	return own !== undefined ? own : cfg.facetKeys
}

const modeHasPopulation = (
	mode: LabelPointsMode,
	pop: LabelPopulation
): boolean =>
	pop === "all"
		? mode === "all"
		: pop === "first"
			? mode === "first" || mode === "first-last"
			: mode === "last" || mode === "first-last"

export type LabelSelection = {
	multiField: boolean
	/** Multi-field: the composed-label ids each population shows (in list
	 *  order). Single-field: empty lists — the one mapped field is implied. */
	labels: Record<LabelPopulation, string[]>
	/** Which populations render at all. Multi-field: at least one label in
	 *  the population. Single-field: read off `labelPoints`. */
	present: Record<LabelPopulation, boolean>
	/** Single-field only: first AND last present → the endpoint override
	 *  blocks (`firstLabel` / `lastLabel`) apply and the panel splits its
	 *  position / alignment controls per population. Multi-field labels
	 *  never split — each composed label carries its own settings. */
	split: boolean
}

type SelectionCfg = Pick<
	DataLabelsConfig,
	| "fieldLabelPoints"
	| "labelPoints"
	| "onlyLastLabel"
	| "composedLabels"
	| "combineVariables"
	| "labelTemplate"
	| "firstLabel"
	| "lastLabel"
>

/** Resolve the populations for the current Value mapping. `seriesless`
 *  (maps, layout-placed tree labels) has no series ends: every label reads
 *  as "all" so a stored endpoint mode from a previous chart can't silently
 *  drop labels there. */
export const resolveLabelSelection = (
	cfg: SelectionCfg,
	value: Pick<DataLabelsEncodings["value"], "multiField" | "fields">,
	opts?: { seriesless?: boolean }
): LabelSelection => {
	const seriesless = opts?.seriesless === true
	if (value.multiField === true) {
		const norm = normalizeComposedLabels(cfg, value.fields ?? [])
		const labels: Record<LabelPopulation, string[]> = {
			all: [],
			first: [],
			last: [],
		}
		for (const l of norm.composedLabels ?? []) {
			const mode = seriesless ? "all" : fieldLabelPointsMode(norm, l.id)
			for (const pop of LABEL_POPULATIONS) {
				if (modeHasPopulation(mode, pop)) labels[pop].push(l.id)
			}
		}
		return {
			multiField: true,
			labels,
			present: {
				all: labels.all.length > 0,
				first: labels.first.length > 0,
				last: labels.last.length > 0,
			},
			split: false,
		}
	}
	const mode = seriesless ? "all" : effectiveLabelPoints(cfg)
	const present = {
		all: mode === "all",
		first: mode === "first" || mode === "first-last",
		last: mode === "last" || mode === "first-last",
	}
	return {
		multiField: false,
		labels: { all: [], first: [], last: [] },
		present,
		split: present.first && present.last,
	}
}

/** Populations present in display order. */
export const presentPopulations = (sel: LabelSelection): LabelPopulation[] =>
	LABEL_POPULATIONS.filter((p) => sel.present[p])

/** Which populations an anchor carries a label for, given its endpoint tag
 *  (`undefined` = interior anchor). A single-anchor series tags "both": it
 *  takes the last label (direct-labeling intent, matching the single-field
 *  behavior), plus the first label only when that population shows a label
 *  the last one doesn't — otherwise the two would print the same text on top
 *  of each other. */
export const populationsAtTag = (
	sel: LabelSelection,
	tag: EndpointTag | undefined
): LabelPopulation[] => {
	const out: LabelPopulation[] = []
	if (sel.present.all) out.push("all")
	if (tag === "first" && sel.present.first) out.push("first")
	if (tag === "last" && sel.present.last) out.push("last")
	if (tag === "both") {
		if (sel.present.last) {
			out.push("last")
			if (
				sel.present.first &&
				sel.labels.first.some((f) => !sel.labels.last.includes(f))
			) {
				out.push("first")
			}
		} else if (sel.present.first) {
			out.push("first")
		}
	}
	return out
}

const overrideBlock = (
	cfg: Pick<DataLabelsConfig, "firstLabel" | "lastLabel">,
	pop: LabelPopulation
): EndpointLabelOverrides | undefined =>
	pop === "first" ? cfg.firstLabel : pop === "last" ? cfg.lastLabel : undefined

/** The endpoint override block that applies to a population: its own block
 *  when the selection is split (single-field, first and last), nothing
 *  otherwise. The all-labels population never has one. */
export const populationOverrides = (
	cfg: Pick<DataLabelsConfig, "firstLabel" | "lastLabel">,
	sel: LabelSelection,
	pop: LabelPopulation
): EndpointLabelOverrides =>
	sel.split ? (overrideBlock(cfg, pop) ?? {}) : {}

/** Sidebar captions for a population's split controls. */
export const POPULATION_LABEL: Record<LabelPopulation, string> = {
	all: "All labels",
	first: "First label",
	last: "Last label",
}

// ---------------------------------------------------------------------------
// Composed labels — the list of labels and the keys the sidebar sections
// and the layer iterate.
// ---------------------------------------------------------------------------

/** Fields joined as `{A}, {B}`. */
const joinFieldTokens = (fields: readonly string[]): string =>
	fields.map((f) => `{${f}}`).join(", ")

/** `{Field}` tokens in template order, kept to the checked fields, deduped. */
export const templateFields = (
	template: string,
	fields: readonly string[]
): string[] => {
	const out: string[] = []
	for (const m of template.matchAll(/\{([^{}]+)\}/g)) {
		const name = m[1] ?? ""
		if (fields.includes(name) && !out.includes(name)) out.push(name)
	}
	return out
}

/** How a composed label is titled in the sidebar sections: its variables
 *  joined with " + " (`A` for a one-variable label, `A + B` for a
 *  combination), or "Label N" while it names none. */
export const composedLabelTitle = (
	l: ComposedLabel,
	fields: readonly string[],
	index: number
): string => {
	const used = templateFields(l.template, fields)
	return used.length > 0 ? used.join(" + ") : `Label ${index + 1}`
}

/** The labels a fresh multi-variable mapping starts with: one per checked
 *  variable, composing just that variable, keyed by its name. */
export const defaultComposedLabels = (
	fields: readonly string[]
): ComposedLabel[] => fields.map((f) => ({ id: f, template: `{${f}}` }))

/** The default label for one variable (what checking a field adds). */
export const composedLabelForField = (field: string): ComposedLabel => ({
	id: field,
	template: `{${field}}`,
})

/** A fresh id for a label added by hand — unique enough for a per-visual
 *  list, and never a field name. */
export const newComposedLabelId = (): string =>
	`lbl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** Ids of the labels derived from a legacy combined mapping. */
export const LEGACY_ARRANGED_ID: Record<LabelPopulation, string> = {
	all: "arranged",
	first: "arranged-first",
	last: "arranged-last",
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((f) => b.includes(f))

/** Derive composed labels from the pre-composed-labels state of a saved
 *  visual. Variables SEPARATE (`combineVariables === false`): one label per
 *  field, keyed by its name — exactly what the default list is, so every
 *  per-field entry (color, which-labels, offsets, …) keeps keying its label.
 *  Variables COMBINED: the legacy populations — each field's "Which labels"
 *  put it in all / first / last, and each present population arranged its
 *  fields with the shared Label text (its own First / Last label text when
 *  split) — become one label per present population (`LEGACY_ARRANGED_ID`),
 *  whose "Which labels" is that population and whose series-end override
 *  block (alignment / X / Y) becomes its own entry. */
const legacyComposedLabels = (
	cfg: SelectionCfg,
	fields: readonly string[]
): {
	labels: ComposedLabel[]
	labelPoints: Record<string, LabelPointsMode>
	alignments: Record<string, DataLabelAlignment>
	offsets: Record<string, { xOffset?: number; yOffset?: number }>
} => {
	if (cfg.combineVariables === false) {
		return {
			labels: defaultComposedLabels(fields),
			labelPoints: {},
			alignments: {},
			offsets: {},
		}
	}
	const byPop: Record<LabelPopulation, string[]> = { all: [], first: [], last: [] }
	for (const f of fields) {
		const mode = fieldLabelPointsMode(cfg, f)
		for (const pop of LABEL_POPULATIONS) {
			if (modeHasPopulation(mode, pop)) byPop[pop].push(f)
		}
	}
	const present = LABEL_POPULATIONS.filter((p) => byPop[p].length > 0)
	const split = present.length >= 2
	const shared = cfg.labelTemplate?.trim() ? cfg.labelTemplate : ""
	const allFields = LABEL_POPULATIONS.flatMap((p) => byPop[p]).filter(
		(f, i, arr) => arr.indexOf(f) === i
	)
	const fallback = (pop: LabelPopulation): string => {
		if (pop === "all") return shared || joinFieldTokens(byPop.all)
		// Legacy first-and-last inheritance: the shared text applies to a
		// series end when no all-labels population uses it and it covers
		// exactly that end's fields.
		if (shared && byPop.all.length === 0 && sameSet(byPop[pop], allFields)) {
			return shared
		}
		return joinFieldTokens(byPop[pop])
	}
	const labels: ComposedLabel[] = []
	const labelPoints: Record<string, LabelPointsMode> = {}
	const alignments: Record<string, DataLabelAlignment> = {}
	const offsets: Record<string, { xOffset?: number; yOffset?: number }> = {}
	for (const pop of present) {
		const id = LEGACY_ARRANGED_ID[pop]
		const block = split ? overrideBlock(cfg, pop) : undefined
		const own = block?.labelTemplate?.trim() ? block.labelTemplate : ""
		labels.push({ id, template: own || fallback(pop) })
		labelPoints[id] = pop
		if (block?.alignment) alignments[id] = block.alignment
		if (block?.xOffset != null || block?.yOffset != null) {
			offsets[id] = {
				...(block.xOffset != null ? { xOffset: block.xOffset } : {}),
				...(block.yOffset != null ? { yOffset: block.yOffset } : {}),
			}
		}
	}
	return { labels, labelPoints, alignments, offsets }
}

/** The config with `composedLabels` guaranteed: the stored list, or — for a
 *  visual saved before composed labels — the list derived from its legacy
 *  state, with the derived labels' "Which labels" and series-end overrides
 *  folded into the per-label maps. Identity when already stored. Every
 *  reader (layer, reserve, panel) goes through this so they agree. */
export const normalizeComposedLabels = <T extends SelectionCfg>(
	cfg: T & Pick<DataLabelsConfig, "fieldAlignments" | "fieldOffsets">,
	fields: readonly string[]
): T &
	Pick<
		DataLabelsConfig,
		"composedLabels" | "fieldLabelPoints" | "fieldAlignments" | "fieldOffsets"
	> => {
	if (cfg.composedLabels) return cfg
	const legacy = legacyComposedLabels(cfg, fields)
	return {
		...cfg,
		composedLabels: legacy.labels,
		fieldLabelPoints: { ...legacy.labelPoints, ...(cfg.fieldLabelPoints ?? {}) },
		fieldAlignments: { ...legacy.alignments, ...(cfg.fieldAlignments ?? {}) },
		fieldOffsets: { ...legacy.offsets, ...(cfg.fieldOffsets ?? {}) },
	}
}

/** The composed labels in effect (stored, else derived). */
export const effectiveComposedLabels = (
	cfg: SelectionCfg,
	fields: readonly string[]
): ComposedLabel[] => normalizeComposedLabels(cfg, fields).composedLabels ?? []

// ---------------------------------------------------------------------------
// Label PIECES — the variables inside one composed label, when its Color /
// Size / Text properties section is split per variable. The piece KEY
// (`pieceKey`, in-memory only) and the entry accessors are in
// `lib/labelPieces.ts`.
// ---------------------------------------------------------------------------

/** The variables one composed label names, in template order — what its
 *  split sections list. Fewer than two means there's nothing to split (the
 *  one variable IS the label). */
export const labelPieceFields = (
	l: ComposedLabel,
	fields: readonly string[]
): string[] => templateFields(l.template, fields)

/** Is this label's section styled per variable? `null` (the single-field
 *  label) and labels with no entry style as one. */
export const labelPieceSplit = (
	cfg: Pick<DataLabelsConfig, "pieceSplits">,
	labelId: string | null,
	section: LabelPieceSection
): boolean =>
	labelId !== null && cfg.pieceSplits?.[labelId]?.[section] === true

/** The keys a section's controls (and the renderer) use for one label: its
 *  pieces when split — and it has two or more variables — else the label
 *  itself. */
export const sectionKeysFor = (
	cfg: Pick<DataLabelsConfig, "pieceSplits">,
	labelId: string,
	pieces: readonly string[],
	section: LabelPieceSection
): string[] =>
	pieces.length > 1 && labelPieceSplit(cfg, labelId, section)
		? pieces.map((f) => pieceKey(labelId, f))
		: [labelId]

/** The keys the per-label sidebar sections (Color, Size, Text properties,
 *  Text background, Label selection, Adjust position) and the layer's
 *  per-label maps iterate for a multi-field Value mapping: one per composed
 *  label, in list order, with the title each is shown under. `pieces` lists
 *  the variables inside each label (template order) so a split section can
 *  expand into one block per variable; `titles` names those piece keys too
 *  (by the variable). Empty for a single-field mapping. */
export type LabelKeys = {
	labels: ComposedLabel[]
	keys: string[]
	pieces: Record<string, string[]>
	titles: Record<string, string>
}

export const labelKeysFor = (
	cfg: SelectionCfg,
	value: Pick<DataLabelsEncodings["value"], "multiField" | "fields">
): LabelKeys => {
	if (value.multiField !== true)
		return { labels: [], keys: [], pieces: {}, titles: {} }
	const fields = value.fields ?? []
	const labels = effectiveComposedLabels(cfg, fields)
	const titles: Record<string, string> = {}
	const pieces: Record<string, string[]> = {}
	labels.forEach((l, i) => {
		titles[l.id] = composedLabelTitle(l, fields, i)
		pieces[l.id] = labelPieceFields(l, fields)
		for (const f of pieces[l.id]) titles[pieceKey(l.id, f)] = f
	})
	return { labels, keys: labels.map((l) => l.id), pieces, titles }
}
