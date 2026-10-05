// "Which labels" resolution for the Data Labels layer.
//
// Single-field labels keep one layer-wide `labelPoints` mode. Multi-field
// labels ("Multiple variables…") give EACH selected field its own mode, and
// the modes are read as memberships in up to three label POPULATIONS:
//
//   - "all"   — every anchor (fields whose mode is "all")
//   - "first" — the first anchor per series (modes "first" / "first-last")
//   - "last"  — the last anchor per series (modes "last" / "first-last")
//
// Every population renders its OWN label at the anchors it applies to, with
// its own template / offset / alignment, so one anchor can carry several
// labels: a stacked bar's last slice shows the all-labels value AND a
// last-label series name hanging outside the bar. Pure functions — shared by
// the renderer, the margin reserve, and the sidebar panel so all three
// agree on which populations exist and what each one draws.

import {
	effectiveLabelPoints,
	type DataLabelsConfig,
	type EndpointLabelOverrides,
	type LabelPointsMode,
} from "./channelConfig"
import type { EndpointTag } from "./dataLabelsLayout"
import type { DataLabelsEncodings } from "./types"

export type LabelPopulation = "all" | "first" | "last"

/** Display order for anything that lists populations (panel blocks, template
 *  inputs): every-label text first, then the series ends. */
export const LABEL_POPULATIONS: readonly LabelPopulation[] = [
	"all",
	"first",
	"last",
]

/** The effective "Which labels" mode for one multi-field variable: its own
 *  entry, else the layer-wide mode (so a multi-field visual saved before
 *  per-field selection keeps its look, and a newly checked field follows the
 *  layer default). */
export const fieldLabelPointsMode = (
	cfg: Pick<DataLabelsConfig, "fieldLabelPoints" | "labelPoints" | "onlyLastLabel">,
	field: string
): LabelPointsMode => cfg.fieldLabelPoints?.[field] ?? effectiveLabelPoints(cfg)

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
	/** Multi-field: the fields each population shows (in check order).
	 *  Single-field: empty lists — the one mapped field is implied. */
	fields: Record<LabelPopulation, string[]>
	/** Which populations render at all. Multi-field: at least one field in
	 *  the population. Single-field: read off `labelPoints`. */
	present: Record<LabelPopulation, boolean>
	/** Two or more populations coexist → the endpoint override blocks
	 *  (`firstLabel` / `lastLabel`) apply and the panel splits its template /
	 *  position / alignment controls per population. With a single
	 *  population the layer-wide values drive it and the overrides are
	 *  ignored (stale blocks from an earlier split session must not leak). */
	split: boolean
}

type SelectionCfg = Pick<
	DataLabelsConfig,
	"fieldLabelPoints" | "labelPoints" | "onlyLastLabel"
>

/** Resolve the populations for the current Value mapping. `seriesless`
 *  (maps, layout-placed tree labels) has no series ends: every field reads
 *  as "all" so a stored endpoint mode from a previous chart can't silently
 *  drop labels there. */
export const resolveLabelSelection = (
	cfg: SelectionCfg,
	value: Pick<DataLabelsEncodings["value"], "multiField" | "fields">,
	opts?: { seriesless?: boolean }
): LabelSelection => {
	const seriesless = opts?.seriesless === true
	if (value.multiField === true) {
		const all = value.fields ?? []
		const fields: Record<LabelPopulation, string[]> = {
			all: [],
			first: [],
			last: [],
		}
		for (const f of all) {
			const mode = seriesless ? "all" : fieldLabelPointsMode(cfg, f)
			for (const pop of LABEL_POPULATIONS) {
				if (modeHasPopulation(mode, pop)) fields[pop].push(f)
			}
		}
		const present = {
			all: fields.all.length > 0,
			first: fields.first.length > 0,
			last: fields.last.length > 0,
		}
		const count = LABEL_POPULATIONS.filter((p) => present[p]).length
		return { multiField: true, fields, present, split: count >= 2 }
	}
	const mode = seriesless ? "all" : effectiveLabelPoints(cfg)
	const present = {
		all: mode === "all",
		first: mode === "first" || mode === "first-last",
		last: mode === "last" || mode === "first-last",
	}
	return {
		multiField: false,
		fields: { all: [], first: [], last: [] },
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
 *  behavior), plus the first label only when that population shows a field
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
				sel.fields.first.some((f) => !sel.fields.last.includes(f))
			) {
				out.push("first")
			}
		} else if (sel.present.first) {
			out.push("first")
		}
	}
	return out
}

/** Fields joined as `{A}, {B}` — the pre-filled arrangement a population
 *  starts from. */
export const joinFieldTokens = (fields: readonly string[]): string =>
	fields.map((f) => `{${f}}`).join(", ")

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((f) => b.includes(f))

/** The arrangement the shared "Label text" box (`labelTemplate`) pre-fills
 *  with for this selection. Split: just the all-labels fields (the series
 *  ends have their own boxes). Not split: every selected field, whichever
 *  single population they form. The panel keeps `labelTemplate` in sync
 *  with this value until the user hand-edits it. */
export const defaultSharedTemplate = (
	sel: LabelSelection,
	allFields: readonly string[]
): string => joinFieldTokens(sel.split ? sel.fields.all : allFields)

const overrideBlock = (
	cfg: Pick<DataLabelsConfig, "firstLabel" | "lastLabel">,
	pop: LabelPopulation
): EndpointLabelOverrides | undefined =>
	pop === "first" ? cfg.firstLabel : pop === "last" ? cfg.lastLabel : undefined

/** The endpoint override block that applies to a population: its own block
 *  when the selection is split, nothing otherwise (the layer-wide values
 *  drive a lone population). The all-labels population never has one. */
export const populationOverrides = (
	cfg: Pick<DataLabelsConfig, "firstLabel" | "lastLabel">,
	sel: LabelSelection,
	pop: LabelPopulation
): EndpointLabelOverrides =>
	sel.split ? (overrideBlock(cfg, pop) ?? {}) : {}

type TemplateCfg = Pick<
	DataLabelsConfig,
	"labelTemplate" | "firstLabel" | "lastLabel"
>

/** What a population's template box shows as its placeholder — the
 *  arrangement used when its own box is empty:
 *   - all-labels: the shared `labelTemplate`, else its fields joined.
 *   - a series end: the shared `labelTemplate` when NO all-labels population
 *     is using it and it covers exactly this population's fields (the
 *     legacy first-and-last inheritance — e.g. `{value}` on firsts with a
 *     `{value} {series}` last override); otherwise its own fields joined, so
 *     an all=value / last=series split prefills `{series}` on the last
 *     labels rather than borrowing the value-only text. */
export const populationTemplateFallback = (
	cfg: Pick<DataLabelsConfig, "labelTemplate">,
	sel: LabelSelection,
	pop: LabelPopulation
): string => {
	const shared = cfg.labelTemplate?.trim() ? cfg.labelTemplate : ""
	if (pop === "all") return shared || joinFieldTokens(sel.fields.all)
	const allFields = LABEL_POPULATIONS.flatMap((p) => sel.fields[p]).filter(
		(f, i, arr) => arr.indexOf(f) === i
	)
	if (shared && !sel.present.all && sameSet(sel.fields[pop], allFields)) {
		return shared
	}
	return joinFieldTokens(sel.fields[pop])
}

/** The template a population composes its labels with (multi-field mode):
 *  its own override box when the selection is split and the box is
 *  non-empty, else the fallback above. Single-field callers don't need a
 *  template (one field, no arrangement). */
export const populationTemplate = (
	cfg: TemplateCfg,
	sel: LabelSelection,
	pop: LabelPopulation
): string => {
	const own = populationOverrides(cfg, sel, pop).labelTemplate
	return own?.trim() ? own : populationTemplateFallback(cfg, sel, pop)
}

/** Sidebar captions for a population's split controls. */
export const POPULATION_LABEL: Record<LabelPopulation, string> = {
	all: "All labels",
	first: "First label",
	last: "Last label",
}

/** Captions for the per-population template boxes under Value. */
export const POPULATION_TEMPLATE_LABEL: Record<LabelPopulation, string> = {
	all: "Label text",
	first: "First label text",
	last: "Last label text",
}
