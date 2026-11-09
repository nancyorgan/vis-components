import type { AnnotationsConfig } from "../annotationsConfig"
import type {
	AxisConfig,
	ChannelConfigs,
	ColorSlotConfig,
	DashRangeConfig,
	DataLabelsConfig,
	FacetConfig,
	HueConfig,
} from "../channelConfig"
import { DEFAULT_FACET_CONFIG } from "../channelConfig"
import type { DataTableConfig } from "../dataTableConfig"
import { DEFAULT_DERIVED_VARIABLES_CONFIG } from "../derivedVariables"
import { foldFlowNodeTitles } from "../foldFlowNodeTitles"
import type {
	LabelsConfig,
	LegendChannelConfig,
	LegendConfig,
} from "../labelsConfig"
import { DEFAULT_RESHAPE_CONFIG } from "../reshape"
import { structureVisualKeys } from "../savedKeyStructure"
import type { Field, TemplateMeta, Visual } from "../types"
import { sourceFieldsFrom } from "./dataKind"
import { collectFormatMemory } from "./formatSurfaces"

/** A template's design: everything a visual row carries except its
 * identity / library bookkeeping and the template metadata itself. */
export type TemplateBody = Omit<
	Visual,
	| "id"
	| "name"
	| "folderId"
	| "thumbnail"
	| "thumbnailAt"
	| "createdAt"
	| "updatedAt"
	| "updatedBy"
	| "deletedAt"
	| "template"
	| "templateId"
>

/** What `buildTemplateBody` accepts: a full `Visual`, or the draft shape
 * `useSaveVisual` assembles (identity / bookkeeping keys optional — they
 * are dropped either way). */
export type TemplateDraft = TemplateBody & Partial<Visual>

/** Placeholder chart title / subtitle a template carries (decision 7). */
export const TEMPLATE_TITLE_PLACEHOLDER = "Title"
export const TEMPLATE_SUBTITLE_PLACEHOLDER = "Subtitle"

// --- data-value strips (decision 2) ---------------------------------------

const stripDashRange = <T extends DashRangeConfig | undefined>(d: T): T =>
	d && (d.min !== null || d.max !== null) ? { ...d, min: null, max: null } : d

/** Axis min / max / breaks, gridline breaks, mirrored-axis maxima and
 * breaks, and the regression line's dash range — all pinned to values. */
const stripAxis = (a: AxisConfig | undefined): AxisConfig | undefined => {
	if (!a) return a
	const { min: _min, max: _max, breaks: _breaks, ...rest } = a
	const next: AxisConfig = { ...rest }
	if (a.gridlines?.breaks !== undefined) {
		const { breaks: _gb, ...gridlines } = a.gridlines
		next.gridlines = gridlines
	}
	if (a.mirror) {
		const {
			negativeMax: _n,
			positiveMax: _p,
			breaks: _mb,
			...mirror
		} = a.mirror
		next.mirror = mirror
	}
	if (a.regression)
		next.regression = {
			...a.regression,
			dashRange: stripDashRange(a.regression.dashRange),
		}
	return next
}

/** Gradient stop VALUES go; the colors stay. Categorical hues (value-keyed
 * colors) are kept whole. */
const stripQuantHue = <T extends HueConfig | undefined>(h: T): T => {
	if (!h || h.kind !== "quantitative") return h
	return {
		...h,
		lowValue: null,
		midValue: null,
		highValue: null,
		...(h.customStops
			? { customStops: h.customStops.map((s) => ({ ...s, value: null })) }
			: {}),
	}
}

const stripSlotHues = <T extends Partial<Record<string, ColorSlotConfig>>>(
	slots: T,
): T => {
	const out: Partial<Record<string, ColorSlotConfig>> = {}
	for (const [k, slot] of Object.entries(slots))
		out[k] = slot?.hue ? { ...slot, hue: stripQuantHue(slot.hue) } : slot
	return out as T
}

/** Facet panel order and every per-panel / per-row / per-column / overall
 * axis override (all keyed by or pinned to data values). */
const stripFacet = (f: FacetConfig | undefined): FacetConfig | undefined => {
	if (!f) return f
	const {
		gridPanelAxisOverrides: _g,
		rowRAxisOverrides: _rr,
		colRAxisOverrides: _cr,
		panelRAxisOverrides: _pr,
		overallRRange: _or,
		...rest
	} = f
	return {
		...rest,
		panelAxisOverrides: {},
		rowAxisOverrides: {},
		colAxisOverrides: {},
		panelOrder: {},
		overallXRange: DEFAULT_FACET_CONFIG.overallXRange,
		overallYRange: DEFAULT_FACET_CONFIG.overallYRange,
	}
}

const stripChannelConfigs = (cc: ChannelConfigs): ChannelConfigs => {
	const next: ChannelConfigs = { ...cc }
	for (const ch of ["x", "y", "r"] as const)
		if (cc[ch]) next[ch] = stripAxis(cc[ch])
	if (cc.facet) next.facet = stripFacet(cc.facet)
	if (cc.hue) next.hue = stripQuantHue(cc.hue)
	if (cc.outlineHue) next.outlineHue = stripQuantHue(cc.outlineHue)
	if (cc.hueQuantStash) next.hueQuantStash = stripQuantHue(cc.hueQuantStash)
	if (cc.colorSlots) next.colorSlots = stripSlotHues(cc.colorSlots)
	if (cc.connection) {
		const {
			axisStemCustomX: _stemX,
			axisStemCustomY: _stemY,
			...connection
		} = cc.connection
		// Custom threshold stems are data values (decision 2); the dash
		// range's min/max likewise.
		next.connection = connection.dashRange
			? { ...connection, dashRange: stripDashRange(connection.dashRange) }
			: connection
	}
	return next
}

const stripLegend = (l: LegendConfig | undefined): LegendConfig | undefined => {
	if (!l?.channels) return l
	const channels: Record<string, LegendChannelConfig | undefined> = {}
	for (const [ch, cfg] of Object.entries(l.channels))
		channels[ch] = cfg ? { ...cfg, breaks: [] } : cfg
	return { ...l, channels: channels as LegendConfig["channels"] }
}

/** Annotations placed at data values go, text annotations go (custom
 * prose), survivors lose their panel scope (`facetKeys`, panel values) and
 * any typed text. Images STAY (minus value-mode placements, like the
 * shapes): a logo in the corner is format, the thing a template is for. */
const stripAnnotations = (
	a: AnnotationsConfig | undefined,
): AnnotationsConfig | undefined => {
	if (!a) return a
	const keep = <T extends { coordSystem: string; facetKeys?: unknown }>(
		items: T[] | undefined,
	): T[] =>
		(items ?? [])
			.filter((i) => i.coordSystem !== "values")
			.map((i) => {
				const { facetKeys: _fk, ...rest } = i
				return rest as T
			})
	return {
		rectangles: keep(a.rectangles).map((r) =>
			r.text !== undefined ? { ...r, text: "" } : r,
		),
		circles: keep(a.circles),
		lineSegments: keep(a.lineSegments),
		texts: [],
		images: keep(a.images),
	}
}

const stripDataLabels = (
	d: DataLabelsConfig | undefined,
): DataLabelsConfig | undefined => {
	if (!d) return d
	const { facetKeys: _fk, ...rest } = d
	const next: DataLabelsConfig = { ...rest, fieldFacetKeys: {} }
	if (d.fieldColors) next.fieldColors = stripSlotHues(d.fieldColors)
	return next
}

const stripDataTable = (
	t: DataTableConfig | undefined,
): DataTableConfig | undefined =>
	t && {
		...t,
		selectedColumns: [],
		hiddenPlottedColumns: [],
		columnAlign: {},
		// The data table's own title / caption are custom prose (decision 7).
		title: null,
		caption: null,
	}

// --- custom text (decision 7) ---------------------------------------------

const stripLabelsText = (l: LabelsConfig): LabelsConfig => {
	const next: LabelsConfig = {
		...l,
		title: TEMPLATE_TITLE_PLACEHOLDER,
		subtitle: TEMPLATE_SUBTITLE_PLACEHOLDER,
		legendTitles: {},
	}
	// `undefined` = automatic (the bound field's name), so after a snap the
	// axis titles read the new fields.
	delete next.xAxisTitle
	delete next.yAxisTitle
	if (l.titlePrefix) next.titlePrefix = { ...l.titlePrefix, text: "" }
	return next
}

/** A visual's design with everything tied to its data stripped (decision
 * 2) and its custom text replaced by placeholders (decision 7). Per-
 * category styling keyed by value (hue colors, shapes, dashes, facet-title
 * colors…) is KEPT, as are fonts, positions, theme, type overrides, the
 * tooltip template and data-label templates. */
export const buildTemplateBody = (draft: TemplateDraft): TemplateBody => {
	const {
		id: _id,
		name: _name,
		folderId: _folderId,
		thumbnail: _thumbnail,
		thumbnailAt: _thumbnailAt,
		createdAt: _createdAt,
		updatedAt: _updatedAt,
		updatedBy: _updatedBy,
		deletedAt: _deletedAt,
		template: _template,
		templateId: _templateId,
		fieldOrder: _fieldOrder,
		...rest
	} = draft
	const body: TemplateBody = {
		...rest,
		datasetId: null,
		createdAtVersionId: null,
		reshapeConfig: DEFAULT_RESHAPE_CONFIG,
		derivedVariablesConfig: DEFAULT_DERIVED_VARIABLES_CONFIG,
		fieldLevelOrders: {},
		fieldLevelOrderSpecs: {},
		channelConfigs: stripChannelConfigs(rest.channelConfigs),
		labelsConfig: stripLabelsText(rest.labelsConfig),
	}
	if (rest.legendConfig) body.legendConfig = stripLegend(rest.legendConfig)
	if (rest.annotationsConfig)
		body.annotationsConfig = stripAnnotations(rest.annotationsConfig)
	if (rest.dataLabelsConfig)
		body.dataLabelsConfig = stripDataLabels(rest.dataLabelsConfig)
	if (rest.dataTableConfig)
		body.dataTableConfig = stripDataTable(rest.dataTableConfig)
	if (rest.captionConfig)
		body.captionConfig = { ...rest.captionConfig, text: "" }
	// Same intake normalization a save runs. No data set → no rendered
	// panels, so only the certain readings are taken (facet-keyed state was
	// stripped above anyway).
	return foldFlowNodeTitles(structureVisualKeys(body))
}

/** The template metadata for a draft: the fields it was authored against
 * (the current view's fields) and its non-Auto formats per data kind. */
export const buildTemplateMeta = (
	draft: TemplateDraft,
	viewFields: readonly Field[],
): TemplateMeta => {
	const sourceFields = sourceFieldsFrom(viewFields, draft.fieldTypeOverrides)
	return { sourceFields, formatMemory: collectFormatMemory(draft, sourceFields) }
}
