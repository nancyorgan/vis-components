/** Chart specs: the short, channel-based description of a chart that
 *  `composeVisual` turns into a complete Visual. A spec names fields, not
 *  configs; everything it leaves out comes from the app's own new-visual
 *  defaults and the theme.
 *
 *  This module checks a spec's SHAPE only (types, known keys, known
 *  channels, color and format syntax). Whether its dataset, fields, levels
 *  and folder exist is `composeVisual`'s job, since that needs the data. */

import { formatSpecifier } from "d3-format"

import type { DataLabelsConfig, StackMode } from "../channelConfig"
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
}

/** One problem with a spec: where (`encodings.x`, `colors["U.S."]`; "" for
 *  the whole body) and what. */
export type SpecProblem = { path: string; message: string }

export type ParseChartSpecResult =
	| { ok: true; spec: ChartSpec }
	| { ok: false; errors: SpecProblem[] }

/** What survived the shape checks: valid parts kept, invalid ones dropped
 *  (and reported), so the data checks can still run over the rest. */
export type ChartSpecDraft = Omit<ChartSpec, "datasetId" | "folderId"> & {
	datasetId?: string
	folderId?: string | null
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
] as const

const TOP_LEVEL_HINTS: Record<string, string> = {
	color: `; use "colors" for per-level colors, "fill" for one color, or encodings.hue to color by a field`,
	colour: `; use "colors" for per-level colors, "fill" for one color, or encodings.hue to color by a field`,
	labels: `; did you mean "dataLabels"?`,
}

export const SPEC_CHANNELS: readonly SpecChannel[] = ALL_ENCODING_CHANNELS.filter(
	(c): c is SpecChannel => c !== "text"
)

const CHANNEL_HINTS: Record<string, string> = {
	color: `; did you mean "hue"?`,
	colour: `; did you mean "hue"?`,
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
	input: unknown
): { draft: ChartSpecDraft | null; errors: SpecProblem[] } => {
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
		problem("", "a chart spec must be a JSON object")
		return { draft: null, errors }
	}

	for (const key of Object.keys(input)) {
		if ((TOP_LEVEL_KEYS as readonly string[]).includes(key)) continue
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

	if (input.datasetId === undefined) {
		problem("datasetId", `"datasetId" is required`)
	} else if (typeof input.datasetId !== "string" || input.datasetId === "") {
		problem("datasetId", `"datasetId" must be a non-empty string`)
	} else {
		draft.datasetId = input.datasetId
	}

	if (input.folderId === undefined) {
		problem("folderId", `"folderId" is required (null for the library root)`)
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
		problem("encodings", `"encodings" is required: channel → field name`)
	} else if (!isRecord(encodings)) {
		problem("encodings", `"encodings" must be an object of channel → field name`)
	} else {
		if (Object.keys(encodings).length === 0) {
			problem("encodings", "map at least one channel")
		}
		for (const [channel, field] of Object.entries(encodings)) {
			const path = pathOf("encodings", channel)
			if (!isOneOf(SPEC_CHANNELS, channel)) {
				problem(
					path,
					`unknown channel "${named(channel)}"${ownHint(CHANNEL_HINTS, channel) ?? hint(channel, SPEC_CHANNELS)}`
				)
			} else if (typeof field !== "string" || field === "") {
				problem(path, `"${channel}" must name a field, as a string`)
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

	return { draft, errors }
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
	return { ok: true, spec: { ...draft, datasetId, folderId } }
}
