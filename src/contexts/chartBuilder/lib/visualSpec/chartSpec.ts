/** Chart specs: the short, channel-based description of a chart that
 *  `composeVisual` turns into a complete Visual. A spec names fields, not
 *  configs; everything it leaves out comes from the app's own new-visual
 *  defaults and the theme.
 *
 *  This module checks a spec's SHAPE only (types, known keys, known
 *  channels, color and format syntax). Whether its dataset, fields, levels
 *  and folder exist is `composeVisual`'s job, since that needs the data. */

import { formatSpecifier } from "d3-format"

import type {
	DataLabelsConfig,
	LineDashPattern,
	StackMode,
} from "../channelConfig"
import { LITERAL_FORMAT, parseFormatSpec } from "../formatTick"
import {
	QUICK_START_CHART_TYPES,
	type QuickStartChartType,
} from "../quickStartVariations"
import {
	ALL_ENCODING_CHANNELS,
	type EncodingChannel,
	type FieldType,
} from "../types"
import { CHANNELS } from "../channels"
import { didYouMean } from "./suggest"

/** Every channel except the legacy `text`, which data labels replaced. */
export type SpecChannel = Exclude<EncodingChannel, "text">

export type BarLabelPosition = NonNullable<DataLabelsConfig["barLabelPosition"]>

export type AxisSpec = {
	/** Axis title; absent falls back to the field name, "" is blank. */
	title?: string
	/** Domain bounds, quantitative or measure axes only. */
	min?: number
	max?: number
	/** Tick format, in the Format box's grammar (d3-format and affixes). */
	format?: string
}

export type DataLabelsSpec = {
	/** Number format for the label value. */
	format?: string
	/** Where a bar's label sits; bar charts only. */
	position?: BarLabelPosition
	color?: string
}

/** Order a field's levels by another field's total (or by name). */
export type SortSpec = {
	/** A quantitative or temporal field, or "alphabetical". */
	by: string
	decreasing?: boolean
}

/** Color each hue level by which side of `at` its `field` values fall. */
export type ColorThresholdSpec = {
	field: string
	at: number
	below: string
	above: string
}

/** Lines from each point along `axis` (lollipops), ending at `at` on that
 *  axis, or at the other axis's line when `at` is absent. */
export type StemsSpec = { axis: "x" | "y"; at?: number }

/** A position along an axis, in data values: a number on a quantitative
 *  axis, a level name on a categorical one. */
export type AxisValue = number | string

export type AnnotationSpec =
	| {
			kind: "band"
			x: [AxisValue, AxisValue]
			y: [AxisValue, AxisValue]
			color?: string
			opacity?: number
			label?: string
			front?: boolean
	  }
	| {
			kind: "line"
			x: [AxisValue, AxisValue]
			y: [AxisValue, AxisValue]
			color?: string
			thickness?: number
			dash?: LineDashPattern
			front?: boolean
	  }
	| {
			kind: "text"
			x: AxisValue
			y: AxisValue
			text: string
			color?: string
	  }

/** A wide-to-long reshape, as the Reshape panel stores it. */
export type ReshapeSpec = {
	idFields?: string[]
	meltFields: string[]
	variableName?: string
	valueName?: string
}

/** A derived variable, as the Fields panel stores it, without its id. */
export type DerivedVariableSpec = {
	name: string
	kind: "math" | "concat" | "rules"
	math?: { formula: string }
	concat?: { template: string }
	rules?: { rules: Array<{ condition: string; output: string }>; fallback: string }
}

export type ChartSpec = {
	datasetId: string
	/** The version whose rows the spec is checked against; absent = latest. */
	datasetVersionId?: string
	/** `null` = the library root. */
	folderId: string | null
	name?: string
	/** The chart family the encodings are expected to make. */
	family?: QuickStartChartType
	/** Channel → field name. */
	encodings: Partial<Record<SpecChannel, string>>
	/** Field type overrides, as the Fields panel sets them. */
	fieldTypes?: Record<string, FieldType>
	title?: string
	subtitle?: string
	axes?: { x?: AxisSpec; y?: AxisSpec }
	/** Hue level → color. */
	colors?: Record<string, string>
	/** Mark color when hue is unmapped. */
	fill?: string
	stack?: StackMode
	/** Field → its levels in display order. */
	order?: Record<string, string[]>
	dataLabels?: true | DataLabelsSpec
	themeId?: string
	/** Field → how to order its levels; computed once, like the Fields
	 *  panel's "Order by". */
	sort?: Record<string, SortSpec>
	colorThreshold?: ColorThresholdSpec
	stems?: StemsSpec
	annotations?: AnnotationSpec[]
	/** In an edit, null turns the reshape off. */
	reshape?: ReshapeSpec | null
	/** Added after the chart's own; in an edit, one with the same name
	 *  replaces it. */
	derivedVariables?: DerivedVariableSpec[]
}

/** A change to an existing chart: any spec key but `datasetId`. A channel
 *  set to null is unmapped; `annotations` are added to the chart's own. */
export type ChartEdit = Partial<Omit<ChartSpec, "datasetId" | "encodings">> & {
	encodings?: Partial<Record<SpecChannel, string | null>>
	/** Annotation kinds to remove, every one of that kind, before any
	 *  `annotations` are added. */
	removeAnnotations?: AnnotationSpec["kind"][]
}

/** One problem with a spec: where (`encodings.x`, `colors["U.S."]`; "" for
 *  the whole body) and what. */
export type SpecProblem = { path: string; message: string }

export type ParseChartSpecResult =
	| { ok: true; spec: ChartSpec }
	| { ok: false; errors: SpecProblem[] }

/** What survived the shape checks: valid parts kept, invalid ones dropped
 *  (and reported), so the data checks can still run over the rest. */
export type ChartSpecDraft = Omit<ChartSpec, "datasetId" | "folderId" | "encodings"> & {
	datasetId?: string
	folderId?: string | null
	/** null only in an edit: unmap the channel. */
	encodings: Partial<Record<SpecChannel, string | null>>
	removeAnnotations?: AnnotationSpec["kind"][]
}

const TOP_LEVEL_KEYS = [
	"datasetId",
	"datasetVersionId",
	"folderId",
	"name",
	"family",
	"encodings",
	"fieldTypes",
	"title",
	"subtitle",
	"axes",
	"colors",
	"fill",
	"stack",
	"order",
	"dataLabels",
	"themeId",
	"sort",
	"colorThreshold",
	"stems",
	"annotations",
	"reshape",
	"derivedVariables",
] as const

const TOP_LEVEL_HINTS: Record<string, string> = {
	color: `; use "colors" for per-level colors, "fill" for one color, or encodings.hue to color by a field`,
	colour: `; use "colors" for per-level colors, "fill" for one color, or encodings.hue to color by a field`,
	labels: `; did you mean "dataLabels"?`,
}

export const SPEC_CHANNELS: readonly SpecChannel[] = ALL_ENCODING_CHANNELS.filter(
	(c): c is SpecChannel => c !== "text"
)

/** A channel name folded for matching: lowercase letters and digits only. */
const fold = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Channel by its id or its label in the editor ("X position", "Color",
 *  "Facet (wrap)"), matched ignoring case, spaces and punctuation. */
const CHANNEL_BY_NAME: ReadonlyMap<string, SpecChannel> = new Map(
	SPEC_CHANNELS.flatMap((c) => [
		[fold(c), c],
		[fold(CHANNELS[c].label), c],
	])
)

export const channelFromName = (name: string): SpecChannel | undefined =>
	CHANNEL_BY_NAME.get(fold(name))

const CHANNEL_HINTS: Record<string, string> = {
	colour: `; did you mean "hue" (Color)?`,
	fill: `; did you mean "hue"?`,
	size: `; did you mean "area" or "length"?`,
	text: `; label values with "dataLabels" instead`,
}

const AXIS_KEYS = ["title", "min", "max", "format"] as const
const DATA_LABEL_KEYS = ["format", "position", "color"] as const
const FIELD_TYPES: readonly FieldType[] = [
	"quantitative",
	"categorical",
	"temporal",
	"ordinal",
]
const STACK_MODES: readonly StackMode[] = ["stack", "group", "overlay"]
const BAR_LABEL_POSITIONS: readonly BarLabelPosition[] = [
	"center",
	"inside-base",
	"inside-end",
	"outside-end",
]

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === "string" && (list as readonly string[]).includes(v)

/** A value as a message shows it: strings quoted, the rest as-is. */
const shown = (v: unknown): string =>
	typeof v === "string"
		? `"${v}"`
		: Array.isArray(v)
			? "a list"
			: isRecord(v)
				? "an object"
				: String(v)

const quoted = (list: readonly string[]): string =>
	list.map((s) => `"${s}"`).join(", ")

/** Past this many problems the list is truncated, as for library bundles:
 *  a spec that is wrong everywhere needs rewriting, not a long report. */
export const MAX_PROBLEMS = 30

/** The first MAX_PROBLEMS problems, then one saying how many were cut. */
export const capProblems = (problems: SpecProblem[]): SpecProblem[] =>
	problems.length > MAX_PROBLEMS
		? [
				...problems.slice(0, MAX_PROBLEMS),
				{ path: "", message: `…and ${problems.length - MAX_PROBLEMS} more` },
			]
		: problems

/** A name as a message quotes it: long ones cut short. */
export const named = (s: string): string =>
	s.length > 48 ? `${s.slice(0, 45)}…` : s

const ownHint = (hints: Record<string, string>, key: string): string | undefined =>
	Object.hasOwn(hints, key) ? hints[key] : undefined

/** A path from its segments: identifiers dotted, anything else bracketed. */
export const pathOf = (...segments: string[]): string =>
	segments.reduce(
		(path, s) =>
			/^[A-Za-z_$][\w$]*$/.test(s)
				? path === ""
					? s
					: `${path}.${s}`
				: `${path}["${s.replace(/["\\]/g, "\\$&")}"]`,
		""
	)

/** Why a Format-box string won't format, or null. Auto (""), `literal` and
 *  d3-time-format specs pass; anything else must be a d3-format spec. */
export const formatProblem = (raw: string): string | null => {
	const spec = parseFormatSpec(raw).spec.trim()
	if (spec === "" || spec.toLowerCase() === LITERAL_FORMAT) return null
	if (/%[a-zA-Z]/.test(spec)) return null
	try {
		formatSpecifier(spec)
		return null
	} catch {
		return `"${raw}" isn't a d3-format spec (e.g. ",.0f", ".1%", "$,.2s")`
	}
}

/** Read a spec, keeping what is well-formed and reporting the rest. `draft`
 *  is null only when the body isn't an object at all. */
export const readChartSpec = (
	input: unknown,
	mode: "create" | "edit" = "create"
): { draft: ChartSpecDraft | null; errors: SpecProblem[] } => {
	const edit = mode === "edit"
	const errors: SpecProblem[] = []
	const problem = (path: string, message: string) => {
		errors.push({ path, message })
	}
	/** A did-you-mean hint, skipped once the report is past its cap. */
	const hint = (name: string, candidates: readonly string[]): string =>
		errors.length < MAX_PROBLEMS ? didYouMean(name, candidates) : ""
	/** `__proto__` can't be stored as a plain-object key. */
	const reservedKey = (parent: string) =>
		problem(pathOf(parent, "__proto__"), `"__proto__" can't be used as a key`)
	if (!isRecord(input)) {
		problem("", edit ? "a chart edit must be a JSON object" : "a chart spec must be a JSON object")
		return { draft: null, errors }
	}

	if (edit && Object.keys(input).length === 0) {
		problem("", "an edit must name at least one setting to change")
	}
	for (const key of Object.keys(input)) {
		if (edit && key === "datasetId") {
			problem("datasetId", "an edit can't change the dataset; create a new chart instead")
			continue
		}
		if (edit && (key === "themeId" || key === "datasetVersionId")) {
			problem(
				key,
				key === "themeId"
					? "an edit can't change the theme; change it in the editor"
					: "an edit is checked against the dataset's latest version"
			)
			continue
		}
		if ((TOP_LEVEL_KEYS as readonly string[]).includes(key)) continue
		if (edit && key === "removeAnnotations") continue
		problem(
			pathOf(key),
			`unknown key "${named(key)}"${ownHint(TOP_LEVEL_HINTS, key) ?? hint(key, TOP_LEVEL_KEYS)}`
		)
	}

	const draft: ChartSpecDraft = { encodings: {} }

	const text = (key: "name" | "title" | "subtitle" | "themeId" | "datasetVersionId") => {
		const v = input[key]
		if (v === undefined) return
		if (typeof v === "string") draft[key] = v
		else problem(key, `"${key}" must be a string`)
	}

	if (edit) {
		// The chart's own dataset.
	} else if (input.datasetId === undefined) {
		problem("datasetId", `"datasetId" is required`)
	} else if (typeof input.datasetId !== "string" || input.datasetId === "") {
		problem("datasetId", `"datasetId" must be a non-empty string`)
	} else {
		draft.datasetId = input.datasetId
	}

	if (input.folderId === undefined) {
		if (!edit) problem("folderId", `"folderId" is required (null for the library root)`)
	} else if (
		input.folderId !== null &&
		(typeof input.folderId !== "string" || input.folderId.trim() === "")
	) {
		problem("folderId", `"folderId" must be a folder id or null`)
	} else {
		draft.folderId = input.folderId
	}

	text("datasetVersionId")
	text("name")
	text("title")
	text("subtitle")
	text("themeId")

	if (input.family !== undefined) {
		if (isOneOf(QUICK_START_CHART_TYPES, input.family)) draft.family = input.family
		else {
			const name = String(input.family)
			problem(
				"family",
				`unknown family "${named(name)}"${hint(name, QUICK_START_CHART_TYPES)} (families: ${quoted(QUICK_START_CHART_TYPES)})`
			)
		}
	}

	const encodings = input.encodings
	if (encodings === undefined) {
		if (!edit) problem("encodings", `"encodings" is required: channel → field name`)
	} else if (!isRecord(encodings)) {
		problem("encodings", `"encodings" must be an object of channel → field name`)
	} else {
		if (!edit && Object.keys(encodings).length === 0) {
			problem("encodings", "map at least one channel")
		}
		const seen = new Map<SpecChannel, string>()
		for (const [name, field] of Object.entries(encodings)) {
			const path = pathOf("encodings", name)
			const channel = channelFromName(name)
			const twin = channel ? seen.get(channel) : undefined
			if (channel) seen.set(channel, name)
			if (!channel) {
				problem(
					path,
					`unknown channel "${named(name)}"${ownHint(CHANNEL_HINTS, name) ?? hint(name, [...SPEC_CHANNELS, ...SPEC_CHANNELS.map((c) => CHANNELS[c].label)])}`
				)
			} else if (twin !== undefined) {
				problem(path, `"${name}" and "${twin}" are the same channel ("${channel}")`)
			} else if (edit && field === null) {
				draft.encodings[channel] = null
			} else if (typeof field !== "string" || field === "") {
				problem(
					path,
					edit
						? `"${channel}" must name a field, or be null to unmap it`
						: `"${channel}" must name a field, as a string`
				)
			} else {
				draft.encodings[channel] = field
			}
		}
	}

	if (input.fieldTypes !== undefined) {
		if (!isRecord(input.fieldTypes)) {
			problem("fieldTypes", `"fieldTypes" must be an object of field → type`)
		} else {
			const fieldTypes: Record<string, FieldType> = {}
			for (const [field, type] of Object.entries(input.fieldTypes)) {
				if (field === "__proto__") reservedKey("fieldTypes")
				else if (isOneOf(FIELD_TYPES, type)) fieldTypes[field] = type
				else {
					problem(
						pathOf("fieldTypes", field),
						`unknown field type ${shown(type)}; types are ${quoted(FIELD_TYPES)}`
					)
				}
			}
			draft.fieldTypes = fieldTypes
		}
	}

	if (input.axes !== undefined) {
		if (!isRecord(input.axes)) {
			problem("axes", `"axes" must be an object with "x" and/or "y"`)
		} else {
			const axes: NonNullable<ChartSpec["axes"]> = {}
			for (const [axis, raw] of Object.entries(input.axes)) {
				const path = pathOf("axes", axis)
				if (axis !== "x" && axis !== "y") {
					problem(path, `unknown axis "${axis}"; axes are "x" and "y"`)
					continue
				}
				if (!isRecord(raw)) {
					problem(path, `axis "${axis}" must be an object`)
					continue
				}
				const spec: AxisSpec = {}
				for (const key of Object.keys(raw)) {
					if ((AXIS_KEYS as readonly string[]).includes(key)) continue
					problem(
						pathOf("axes", axis, key),
						`unknown axis key "${named(key)}"${hint(key, AXIS_KEYS)}`
					)
				}
				if (raw.title !== undefined) {
					if (typeof raw.title === "string") spec.title = raw.title
					else problem(pathOf("axes", axis, "title"), "an axis title must be a string")
				}
				for (const bound of ["min", "max"] as const) {
					const v = raw[bound]
					if (v === undefined) continue
					if (typeof v === "number" && Number.isFinite(v)) spec[bound] = v
					else problem(pathOf("axes", axis, bound), `"${bound}" must be a finite number`)
				}
				if (spec.min !== undefined && spec.max !== undefined && spec.min >= spec.max) {
					problem(path, `"min" (${spec.min}) must be below "max" (${spec.max})`)
				}
				if (raw.format !== undefined) {
					const formatPath = pathOf("axes", axis, "format")
					if (typeof raw.format !== "string") {
						problem(formatPath, "a format must be a string")
					} else {
						const bad = formatProblem(raw.format)
						if (bad) problem(formatPath, bad)
						else spec.format = raw.format
					}
				}
				axes[axis] = spec
			}
			draft.axes = axes
		}
	}

	if (input.colors !== undefined) {
		if (!isRecord(input.colors)) {
			problem("colors", `"colors" must be an object of level → color`)
		} else {
			const colors: Record<string, string> = {}
			for (const [level, color] of Object.entries(input.colors)) {
				if (level === "__proto__") reservedKey("colors")
				else if (typeof color === "string" && HEX_COLOR.test(color)) colors[level] = color
				else {
					problem(
						pathOf("colors", level),
						`${shown(color)} isn't a color; use #rgb or #rrggbb`
					)
				}
			}
			draft.colors = colors
		}
	}

	if (input.fill !== undefined) {
		if (typeof input.fill === "string" && HEX_COLOR.test(input.fill)) draft.fill = input.fill
		else problem("fill", `"fill" must be a #rgb or #rrggbb color`)
	}

	if (input.stack !== undefined) {
		if (isOneOf(STACK_MODES, input.stack)) draft.stack = input.stack
		else problem("stack", `"stack" must be one of ${quoted(STACK_MODES)}`)
	}

	if (input.order !== undefined) {
		if (!isRecord(input.order)) {
			problem("order", `"order" must be an object of field → levels`)
		} else {
			const order: Record<string, string[]> = {}
			for (const [field, levels] of Object.entries(input.order)) {
				const path = pathOf("order", field)
				if (field === "__proto__") {
					reservedKey("order")
				} else if (
					!Array.isArray(levels) ||
					levels.length === 0 ||
					!levels.every((l): l is string => typeof l === "string")
				) {
					problem(path, "an order must be a non-empty list of level names")
				} else if (new Set(levels).size !== levels.length) {
					problem(path, "an order lists each level once")
				} else {
					order[field] = levels
				}
			}
			draft.order = order
		}
	}

	if (input.dataLabels !== undefined) {
		const raw = input.dataLabels
		if (raw === true) {
			draft.dataLabels = true
		} else if (!isRecord(raw)) {
			problem("dataLabels", `"dataLabels" must be true or an object`)
		} else {
			const labels: DataLabelsSpec = {}
			for (const key of Object.keys(raw)) {
				if ((DATA_LABEL_KEYS as readonly string[]).includes(key)) continue
				problem(
					pathOf("dataLabels", key),
					`unknown data-label key "${named(key)}"${hint(key, DATA_LABEL_KEYS)}`
				)
			}
			if (raw.format !== undefined) {
				if (typeof raw.format !== "string") {
					problem("dataLabels.format", "a format must be a string")
				} else {
					const bad = formatProblem(raw.format)
					if (bad) problem("dataLabels.format", bad)
					else labels.format = raw.format
				}
			}
			if (raw.position !== undefined) {
				if (isOneOf(BAR_LABEL_POSITIONS, raw.position)) labels.position = raw.position
				else {
					problem(
						"dataLabels.position",
						`"position" must be one of ${quoted(BAR_LABEL_POSITIONS)}`
					)
				}
			}
			if (raw.color !== undefined) {
				if (typeof raw.color === "string" && HEX_COLOR.test(raw.color)) {
					labels.color = raw.color
				} else {
					problem("dataLabels.color", `"color" must be a #rgb or #rrggbb color`)
				}
			}
			draft.dataLabels = labels
		}
	}

	readExtras(input, draft, problem, hint, () => errors.length)

	if (edit && input.removeAnnotations !== undefined) {
		const kinds = input.removeAnnotations
		if (
			Array.isArray(kinds) &&
			kinds.length > 0 &&
			kinds.every((k) => isOneOf(ANNOTATION_KINDS, k))
		) {
			draft.removeAnnotations = [...new Set(kinds)] as AnnotationSpec["kind"][]
		} else {
			problem(
				"removeAnnotations",
				`"removeAnnotations" must be a list of kinds: ${quoted(ANNOTATION_KINDS)}`
			)
		}
	}

	return { draft, errors }
}

const RESHAPE_KEYS = ["idFields", "meltFields", "variableName", "valueName"] as const
const DERIVED_KEYS = ["name", "kind", "math", "concat", "rules"] as const
const DERIVED_KINDS = ["math", "concat", "rules"] as const
const SORT_KEYS = ["by", "decreasing"] as const
const THRESHOLD_KEYS = ["field", "at", "below", "above"] as const
const STEM_KEYS = ["axis", "at"] as const
const ANNOTATION_KINDS = ["band", "line", "text"] as const
const ANNOTATION_KEYS: Record<(typeof ANNOTATION_KINDS)[number], readonly string[]> = {
	band: ["kind", "x", "y", "color", "opacity", "label", "front"],
	line: ["kind", "x", "y", "color", "thickness", "dash", "front"],
	text: ["kind", "x", "y", "text", "color"],
}
const DASHES: readonly LineDashPattern[] = ["solid", "dashed", "dotted", "dash-dot"]
/** More than this many annotations from one spec is a drawing, not a chart. */
export const MAX_SPEC_ANNOTATIONS = 20

const isFiniteNumber = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v)

const isAxisValue = (v: unknown): v is AxisValue =>
	isFiniteNumber(v) || (typeof v === "string" && v !== "")

/** Reports keys of `raw` outside `allowed`. */
const unknownKeys = (
	raw: Record<string, unknown>,
	allowed: readonly string[],
	path: (key: string) => string,
	what: string,
	problem: (path: string, message: string) => void,
	hint: (name: string, candidates: readonly string[]) => string
) => {
	for (const key of Object.keys(raw)) {
		if (allowed.includes(key)) continue
		problem(path(key), `unknown ${what} key "${named(key)}"${hint(key, allowed)}`)
	}
}

const readExtras = (
	input: Record<string, unknown>,
	draft: ChartSpecDraft,
	problem: (path: string, message: string) => void,
	hint: (name: string, candidates: readonly string[]) => string,
	count: () => number
) => {
	const color = (path: string, v: unknown): string | undefined => {
		if (typeof v === "string" && HEX_COLOR.test(v)) return v
		problem(path, `${shown(v)} isn't a color; use #rgb or #rrggbb`)
		return undefined
	}

	if (input.sort !== undefined) {
		if (!isRecord(input.sort)) {
			problem("sort", `"sort" must be an object of field → { by, decreasing }`)
		} else {
			const sort: Record<string, SortSpec> = {}
			for (const [field, raw] of Object.entries(input.sort)) {
				const path = pathOf("sort", field)
				if (field === "__proto__") {
					problem(pathOf("sort", "__proto__"), `"__proto__" can't be used as a key`)
					continue
				}
				if (!isRecord(raw)) {
					problem(path, `a sort must be an object like { "by": "<field>", "decreasing": true }`)
					continue
				}
				unknownKeys(raw, SORT_KEYS, (k) => pathOf("sort", field, k), "sort", problem, hint)
				if (typeof raw.by !== "string" || raw.by === "") {
					problem(pathOf("sort", field, "by"), `"by" must name a field, or be "alphabetical"`)
					continue
				}
				if (raw.decreasing !== undefined && typeof raw.decreasing !== "boolean") {
					problem(pathOf("sort", field, "decreasing"), `"decreasing" must be true or false`)
					continue
				}
				sort[field] = { by: raw.by, ...(raw.decreasing ? { decreasing: true } : {}) }
			}
			draft.sort = sort
		}
	}

	if (input.colorThreshold !== undefined) {
		const raw = input.colorThreshold
		if (!isRecord(raw)) {
			problem("colorThreshold", `"colorThreshold" must be an object { field, at, below, above }`)
		} else {
			unknownKeys(raw, THRESHOLD_KEYS, (k) => pathOf("colorThreshold", k), "colorThreshold", problem, hint)
			let ok = true
			if (typeof raw.field !== "string" || raw.field === "") {
				problem("colorThreshold.field", `"field" must name a quantitative field`)
				ok = false
			}
			if (!isFiniteNumber(raw.at)) {
				problem("colorThreshold.at", `"at" must be a finite number`)
				ok = false
			}
			const below = color("colorThreshold.below", raw.below)
			const above = color("colorThreshold.above", raw.above)
			if (ok && below && above) {
				draft.colorThreshold = {
					field: raw.field as string,
					at: raw.at as number,
					below,
					above,
				}
			}
		}
	}

	if (input.stems !== undefined) {
		const raw = input.stems
		if (!isRecord(raw)) {
			problem("stems", `"stems" must be an object { axis, at? }`)
		} else {
			unknownKeys(raw, STEM_KEYS, (k) => pathOf("stems", k), "stems", problem, hint)
			if (raw.axis !== "x" && raw.axis !== "y") {
				problem("stems.axis", `"axis" must be "x" or "y": the axis the stems run along`)
			} else if (raw.at !== undefined && !isFiniteNumber(raw.at)) {
				problem("stems.at", `"at" must be a finite number`)
			} else {
				draft.stems = { axis: raw.axis, ...(raw.at !== undefined ? { at: raw.at as number } : {}) }
			}
		}
	}

	const stringList = (path: string, v: unknown, nonEmpty: boolean): string[] | undefined => {
		if (Array.isArray(v) && v.every((x): x is string => typeof x === "string" && x !== "") && (!nonEmpty || v.length > 0))
			return v
		problem(path, `"${path.split(".").at(-1)}" must be a ${nonEmpty ? "non-empty " : ""}list of field names`)
		return undefined
	}

	if (input.reshape !== undefined) {
		const raw = input.reshape
		if (raw === null) {
			draft.reshape = null
		} else if (!isRecord(raw)) {
			problem("reshape", `"reshape" must be an object { idFields, meltFields, variableName, valueName }`)
		} else {
			unknownKeys(raw, RESHAPE_KEYS, (k) => pathOf("reshape", k), "reshape", problem, hint)
			const before = count()
			const meltFields = stringList("reshape.meltFields", raw.meltFields, true)
			const idFields = raw.idFields === undefined ? [] : stringList("reshape.idFields", raw.idFields, false)
			for (const k of ["variableName", "valueName"] as const) {
				if (raw[k] !== undefined && (typeof raw[k] !== "string" || raw[k].trim() === ""))
					problem(pathOf("reshape", k), `"${k}" must be a non-empty string`)
			}
			if (meltFields && idFields && count() === before) {
				draft.reshape = {
					idFields,
					meltFields,
					...(raw.variableName !== undefined ? { variableName: raw.variableName as string } : {}),
					...(raw.valueName !== undefined ? { valueName: raw.valueName as string } : {}),
				}
			}
		}
	}

	if (input.derivedVariables !== undefined) {
		const list = input.derivedVariables
		if (!Array.isArray(list) || list.length === 0) {
			problem("derivedVariables", `"derivedVariables" must be a non-empty list`)
		} else {
			const out: DerivedVariableSpec[] = []
			const names = new Set<string>()
			list.forEach((raw, i) => {
				const at = (k?: string) => (k ? `derivedVariables[${i}].${k}` : `derivedVariables[${i}]`)
				if (!isRecord(raw)) {
					problem(at(), "a derived variable must be an object")
					return
				}
				unknownKeys(raw, DERIVED_KEYS, (k) => at(k), "derived variable", problem, hint)
				const before = count()
				if (typeof raw.name !== "string" || raw.name.trim() === "") problem(at("name"), `"name" must be a non-empty string`)
				else if (names.has(raw.name.trim())) problem(at("name"), `"${raw.name}" is named twice`)
				else names.add(raw.name.trim())
				if (!isOneOf(DERIVED_KINDS, raw.kind)) {
					problem(at("kind"), `"kind" must be one of ${quoted(DERIVED_KINDS)}`)
					return
				}
				const kind = raw.kind
				if (kind === "math") {
					if (!isRecord(raw.math) || typeof raw.math.formula !== "string")
						problem(at("math"), `a math variable needs "math": { "formula": "{A} + {B}" }`)
				} else if (kind === "concat") {
					if (!isRecord(raw.concat) || typeof raw.concat.template !== "string")
						problem(at("concat"), `a concat variable needs "concat": { "template": "CPT {code}" }`)
				} else {
					const r = raw.rules
					const ok =
						isRecord(r) &&
						Array.isArray(r.rules) &&
						r.rules.every((x) => isRecord(x) && typeof x.condition === "string" && typeof x.output === "string") &&
						typeof r.fallback === "string"
					if (!ok)
						problem(at("rules"), `a rules variable needs "rules": { "rules": [{ "condition": "{A} == 1", "output": "One" }], "fallback": "Other" }`)
				}
				if (count() !== before) return
				out.push({
					name: (raw.name as string).trim(),
					kind,
					...(kind === "math" ? { math: { formula: (raw.math as { formula: string }).formula } } : {}),
					...(kind === "concat" ? { concat: { template: (raw.concat as { template: string }).template } } : {}),
					...(kind === "rules" ? { rules: raw.rules as DerivedVariableSpec["rules"] } : {}),
				})
			})
			draft.derivedVariables = out
		}
	}

	if (input.annotations !== undefined) {
		const list = input.annotations
		if (!Array.isArray(list)) {
			problem("annotations", `"annotations" must be a list`)
		} else if (list.length > MAX_SPEC_ANNOTATIONS) {
			problem("annotations", `at most ${MAX_SPEC_ANNOTATIONS} annotations at a time`)
		} else {
			const out: AnnotationSpec[] = []
			list.forEach((raw, i) => {
				const at = (k?: string) => (k ? `annotations[${i}].${k}` : `annotations[${i}]`)
				if (!isRecord(raw)) {
					problem(at(), "an annotation must be an object")
					return
				}
				if (!isOneOf(ANNOTATION_KINDS, raw.kind)) {
					problem(at("kind"), `"kind" must be one of ${quoted(ANNOTATION_KINDS)}`)
					return
				}
				const kind = raw.kind
				unknownKeys(raw, ANNOTATION_KEYS[kind], (k) => at(k), `${kind} annotation`, problem, hint)
				const before = count()
				const pair = (k: "x" | "y"): [AxisValue, AxisValue] | undefined => {
					const v = raw[k]
					if (Array.isArray(v) && v.length === 2 && v.every(isAxisValue)) {
						return [v[0] as AxisValue, v[1] as AxisValue]
					}
					problem(at(k), `"${k}" must be [from, to]: numbers on a quantitative axis, level names on a categorical one`)
					return undefined
				}
				const single = (k: "x" | "y"): AxisValue | undefined => {
					if (isAxisValue(raw[k])) return raw[k] as AxisValue
					problem(at(k), `"${k}" must be a number, or a level name on a categorical axis`)
					return undefined
				}
				const optColor = raw.color === undefined ? undefined : color(at("color"), raw.color)
				const front = raw.front
				if (front !== undefined && typeof front !== "boolean") problem(at("front"), `"front" must be true or false`)
				if (kind === "band") {
					const x = pair("x")
					const y = pair("y")
					const opacity = raw.opacity
					if (opacity !== undefined && !(isFiniteNumber(opacity) && opacity >= 0 && opacity <= 1)) {
						problem(at("opacity"), `"opacity" must be a number from 0 to 1`)
					}
					if (raw.label !== undefined && typeof raw.label !== "string") problem(at("label"), `"label" must be a string`)
					if (x && y && count() === before) {
						out.push({
							kind,
							x,
							y,
							...(optColor ? { color: optColor } : {}),
							...(opacity !== undefined ? { opacity: opacity as number } : {}),
							...(typeof raw.label === "string" ? { label: raw.label } : {}),
							...(front ? { front: true } : {}),
						})
					}
				} else if (kind === "line") {
					const x = pair("x")
					const y = pair("y")
					const thickness = raw.thickness
					if (thickness !== undefined && !(isFiniteNumber(thickness) && thickness > 0 && thickness <= 20)) {
						problem(at("thickness"), `"thickness" must be a number above 0, up to 20`)
					}
					if (raw.dash !== undefined && !isOneOf(DASHES, raw.dash)) {
						problem(at("dash"), `"dash" must be one of ${quoted(DASHES)}`)
					}
					if (x && y && count() === before) {
						out.push({
							kind,
							x,
							y,
							...(optColor ? { color: optColor } : {}),
							...(thickness !== undefined ? { thickness: thickness as number } : {}),
							...(raw.dash !== undefined ? { dash: raw.dash as LineDashPattern } : {}),
							...(front ? { front: true } : {}),
						})
					}
				} else {
					const x = single("x")
					const y = single("y")
					if (typeof raw.text !== "string" || raw.text.trim() === "") {
						problem(at("text"), `"text" must be a non-empty string`)
					}
					if (x !== undefined && y !== undefined && count() === before) {
						out.push({ kind, x, y, text: raw.text as string, ...(optColor ? { color: optColor } : {}) })
					}
				}
			})
			draft.annotations = out
		}
	}
}

/** Check a spec's shape. Every problem is collected, not just the first, so
 *  a spec can be fixed in one pass (up to MAX_PROBLEMS reported). */
export const parseChartSpec = (input: unknown): ParseChartSpecResult => {
	const { draft, errors } = readChartSpec(input)
	if (!draft || errors.length > 0) return { ok: false, errors: capProblems(errors) }
	const { datasetId, folderId } = draft
	if (datasetId === undefined || folderId === undefined) {
		return { ok: false, errors: capProblems(errors) }
	}
	// Create mode never reads a null channel.
	const encodings = draft.encodings as ChartSpec["encodings"]
	return { ok: true, spec: { ...draft, datasetId, folderId, encodings } }
}

export type ParseChartEditResult =
	| { ok: true; edit: ChartEdit }
	| { ok: false; errors: SpecProblem[] }

/** Check an edit's shape. */
export const parseChartEdit = (input: unknown): ParseChartEditResult => {
	const { draft, errors } = readChartSpec(input, "edit")
	if (!draft || errors.length > 0) return { ok: false, errors: capProblems(errors) }
	const { datasetId: _datasetId, ...edit } = draft
	return { ok: true, edit }
}
