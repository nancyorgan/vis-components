// Saved keys and values are STRUCTURED, never joined.
//
// Two places used to build a saved string by joining user values with a
// delimiter: a split composed label's per-variable styling keyed
// `labelId + U+001F + field`, and a grid facet panel keyed `row|col` — in
// facet scopes (`facetKeys` on annotations and data labels) and in the
// per-panel axis bounds. Anything that inspects stored content judges such
// a string on its face (the hosting firewall flags a control character in a
// setting name, and read `__all__|Type of System` as a shell pipe), and a
// facet value containing the joiner makes the key ambiguous. The structured
// shapes: `DataLabelsConfig.pieces[labelId][field]`, `FacetPanelRef` pairs,
// and `FacetConfig.gridPanelAxisOverrides[row][col]`.
//
// `structureVisualKeys` rewrites a visual from the joined shapes to the
// structured ones. It is the visuals v6→v7 storage migration, and it also
// runs on EVERY other intake — opening a visual (editor and embed), saving
// one, importing a bundle, seeding examples — so a visual written in the
// old shape by a tab still running an older build, or restored from an old
// export, keeps loading and is rewritten structurally on its next save.
// Idempotent, tolerant of sparse / partial / pre-typed records, and the
// same reference when there is nothing to change, so a current visual is
// never re-saved for nothing. A pre-pair grid key is split only where the
// split is certain (`structureFacetPanelRef`); the editor's save passes
// the rendered panels (`panels`) so an uncertain one is resolved against
// the data instead of guessed.

import {
	structureFacetPanelRef,
	structureFacetPanelRefs,
	type FacetPanelRef,
	type KnownFacetPanels,
} from "./facetPanelRef"
import { structureLabelPieces } from "./labelPieces"

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const fieldOf = (enc: unknown): string | null =>
	isRecord(enc) && typeof enc.field === "string" ? enc.field : null

/** Whether a visual's encodings put it in GRID facet mode (a facet row or
 *  column is mapped) — where every joined `row|col` string in a facet
 *  scope or a per-panel bound names a grid panel. */
export const isGridFaceted = (encodings: unknown): boolean =>
	isRecord(encodings) &&
	(fieldOf(encodings.facetRow) !== null || fieldOf(encodings.facetCol) !== null)

/** The per-annotation facet scopes of an annotations config, structured.
 *  `grid` — see `structureFacetPanelRef`; `false` when unknown (a draft
 *  slice loaded on its own), which still structures the unambiguous
 *  row-only / col-only keys. */
export const structureAnnotationKeys = <T>(
	config: T,
	grid: boolean,
	panels?: KnownFacetPanels
): T => {
	if (!isRecord(config)) return config
	let next: Record<string, unknown> | null = null
	for (const list of ["rectangles", "circles", "lineSegments", "texts", "images"]) {
		const items = config[list]
		if (!Array.isArray(items)) continue
		let changed = false
		const out = items.map((item: unknown) => {
			if (!isRecord(item) || !Array.isArray(item.facetKeys)) return item
			const keys = structureFacetPanelRefs(
				item.facetKeys as FacetPanelRef[],
				grid,
				panels
			)
			if (keys === item.facetKeys) return item
			changed = true
			return { ...item, facetKeys: keys }
		})
		if (changed) next = { ...(next ?? config), [list]: out }
	}
	return (next ?? config) as T
}

/** A Data Labels config structured: piece entries under `pieces`, the
 *  layer's and each composed label's facet scope as references. */
export const structureDataLabelsKeys = <T>(
	config: T,
	grid: boolean,
	panels?: KnownFacetPanels
): T => {
	if (!isRecord(config)) return config
	let next: Record<string, unknown> = structureLabelPieces(config)
	if (Array.isArray(next.facetKeys)) {
		const keys = structureFacetPanelRefs(
			next.facetKeys as FacetPanelRef[],
			grid,
			panels
		)
		if (keys !== next.facetKeys) next = { ...next, facetKeys: keys }
	}
	if (isRecord(next.fieldFacetKeys)) {
		let changed = false
		const out: Record<string, unknown> = {}
		for (const [id, list] of Object.entries(next.fieldFacetKeys)) {
			const keys = Array.isArray(list)
				? structureFacetPanelRefs(list as FacetPanelRef[], grid, panels)
				: list
			if (keys !== list) changed = true
			out[id] = keys
		}
		if (changed) next = { ...next, fieldFacetKeys: out }
	}
	return (next === config ? config : next) as T
}

/** A facet config structured: every grid panel's bounds moved from the
 *  joined-key `panelAxisOverrides` entry to `gridPanelAxisOverrides[row]
 *  [col]` (an entry already there wins). Wrap entries — keyed by the facet
 *  value — stay where they are. */
export const structureFacetConfigKeys = <T>(
	facet: T,
	grid: boolean,
	panels?: KnownFacetPanels
): T => {
	if (!isRecord(facet) || !isRecord(facet.panelAxisOverrides)) return facet
	const flat = { ...facet.panelAxisOverrides }
	const nested: Record<string, Record<string, unknown>> = Object.fromEntries(
		Object.entries(
			isRecord(facet.gridPanelAxisOverrides) ? facet.gridPanelAxisOverrides : {}
		).map(([row, byCol]) => [row, { ...(isRecord(byCol) ? byCol : {}) }])
	)
	let moved = false
	for (const key of Object.keys(flat)) {
		const ref = structureFacetPanelRef(key, grid, panels)
		if (typeof ref === "string") continue
		const bounds = flat[key]
		delete flat[key]
		moved = true
		const byCol = (nested[ref.row] ??= {})
		if (!(ref.col in byCol)) byCol[ref.col] = bounds
	}
	if (!moved) return facet
	return {
		...facet,
		panelAxisOverrides: flat,
		gridPanelAxisOverrides: nested,
	} as T
}

/** A channel-configs record structured (its `facet` entry). */
export const structureChannelConfigKeys = <T>(
	configs: T,
	grid: boolean,
	panels?: KnownFacetPanels
): T => {
	if (!isRecord(configs) || !isRecord(configs.facet)) return configs
	const facet = structureFacetConfigKeys(configs.facet, grid, panels)
	return (facet === configs.facet ? configs : { ...configs, facet }) as T
}

/** A visual-shaped record with every saved key structured — see the module
 *  comment. Reads the grid / wrap mode off the visual's own encodings;
 *  `panels` (the rendered grid panels by key, when the caller has the
 *  data) resolves pre-pair keys exactly instead of by their shape. */
export const structureVisualKeys = <T>(visual: T, panels?: KnownFacetPanels): T => {
	if (!isRecord(visual)) return visual
	const grid = isGridFaceted(visual.encodings)
	const channelConfigs = structureChannelConfigKeys(visual.channelConfigs, grid, panels)
	const dataLabelsConfig = structureDataLabelsKeys(visual.dataLabelsConfig, grid, panels)
	const annotationsConfig = structureAnnotationKeys(
		visual.annotationsConfig,
		grid,
		panels
	)
	if (
		channelConfigs === visual.channelConfigs &&
		dataLabelsConfig === visual.dataLabelsConfig &&
		annotationsConfig === visual.annotationsConfig
	)
		return visual
	const next: Record<string, unknown> = { ...visual }
	if (channelConfigs !== visual.channelConfigs) next.channelConfigs = channelConfigs
	if (dataLabelsConfig !== visual.dataLabelsConfig)
		next.dataLabelsConfig = dataLabelsConfig
	if (annotationsConfig !== visual.annotationsConfig)
		next.annotationsConfig = annotationsConfig
	return next as T
}
