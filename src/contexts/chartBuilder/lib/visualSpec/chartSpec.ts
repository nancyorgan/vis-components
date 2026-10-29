/** Chart specs: the short, channel-based description of a chart that
 *  `composeVisual` turns into a complete Visual. A spec names fields, not
 *  configs; everything it leaves out comes from the app's own new-visual
 *  defaults and the theme.
 *
 *  This module checks a spec's SHAPE only (types, known keys, known
 *  channels, format syntax). Whether its dataset, fields and folder exist
 *  is `composeVisual`'s job, since that needs the data. */

import { formatSpecifier } from "d3-format"

import type { StackMode } from "../channelConfig"
import { CHANNELS } from "../channels"
import { LITERAL_FORMAT, parseFormatSpec, parseScaledSpec, YEAR_ENDS_FORMAT } from "../formatTick"
import { parseLocalDate } from "../localDate"
import {
	QUICK_START_CHART_TYPES,
	QUICK_START_VARIATIONS,
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

export type AxisSpec = {
	/** Axis title; absent falls back to the field name, "" is blank. */
	title?: string
	/** A number, or on a temporal axis a date ("2020-01-01") or epoch ms.
	 *  In an edit, null clears the bound. */
	min?: number | string | null
	max?: number | string | null
	/** Tick format, in the Format box's grammar (d3-format and affixes). */
	format?: string
}

export type ChartSpec = {
	datasetId: string
	/** `null` = the library root. */
	folderId: string | null
	name?: string
	/** The chart family the encodings are expected to make. */
	family?: QuickStartChartType
	/** One of the family's variations by name ("Box plot (vertical)"),
	 *  when several fit the encodings. */
	variation?: string
	/** Channel → field name. */
	encodings: Partial<Record<SpecChannel, string>>
	/** Field type overrides, as the Fields panel sets them. */
	fieldTypes?: Record<string, FieldType>
	title?: string
	subtitle?: string
	axes?: { x?: AxisSpec; y?: AxisSpec }
	stack?: StackMode
	themeId?: string
}

/** One problem with a spec: where (`encodings.x`, `axes.y.min`; "" for the
 *  whole body) and what. */
export type SpecProblem = { path: string; message: string }

/** What survived the shape checks: valid parts kept, invalid ones dropped
 *  (and reported), so the data checks can still run over the rest. */
export type ChartSpecDraft = Omit<ChartSpec, "datasetId" | "folderId" | "encodings"> & {
	datasetId?: string
	folderId?: string | null
	/** null only in an edit: unmap the channel. */
	encodings: Partial<Record<SpecChannel, string | null>>
}

/** Every key a spec takes, with what it says. GET /api/chart-spec serves
 *  this list, and a key outside it is refused. */
export const SPEC_KEYS: Readonly<Record<keyof ChartSpec, string>> = {
	datasetId: "Required. The data set to chart, checked against its latest version.",
	folderId: "Required. A folder id, or null for the library root.",
	name: "The visual's name; falls back to title, then \"Untitled\".",
	family: "The chart family the encodings are expected to make.",
	variation: "One of the family's variations by name, when several fit.",
	encodings: "Required. Channel → field name.",
	fieldTypes: "Field → type overrides, as the Fields panel sets them.",
	title: "The chart title.",
	subtitle: "The chart subtitle.",
	axes: "{x, y}, each {title, min, max, format}.",
	stack: "\"stack\", \"group\" or \"overlay\" for the hue levels.",
	themeId: "A theme by id or name; the server's default otherwise.",
}

const TOP_LEVEL_KEYS = Object.keys(SPEC_KEYS)

/** Keys only a new chart takes, with why an edit refuses each. */
const CREATE_ONLY: Readonly<Record<string, string>> = {
	datasetId: "an edit can't change the dataset; create a new chart instead",
	variation: `"variation" applies to a new chart; change encodings instead`,
	themeId: "an edit can't change the theme; change it in the editor",
}

/** The keys an edit takes. */
export const EDIT_KEYS = TOP_LEVEL_KEYS.filter((k) => !Object.hasOwn(CREATE_ONLY, k))

/** Families a spec can't make yet: maps need region detection and flows a
 *  target field, which only the editor sets. */
export const DEFERRED_FAMILIES: readonly QuickStartChartType[] = ["map", "sankey", "chord"]

export const SPEC_FAMILIES: readonly QuickStartChartType[] = QUICK_START_CHART_TYPES.filter(
	(f) => !DEFERRED_FAMILIES.includes(f)
)

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
}

const AXIS_KEYS = ["title", "min", "max", "format"] as const
const FIELD_TYPES: readonly FieldType[] = [
	"quantitative",
	"categorical",
	"temporal",
	"ordinal",
]
const STACK_MODES: readonly StackMode[] = ["stack", "group", "overlay"]

/** 2020, 2020-03, 2020-03-01, optionally with a time. */
const ISO_DATE = /^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/

/** A spec date as epoch ms the way the editor's date boxes read it: a
 *  bare year or month is its first day, a date is local midnight, an
 *  impossible day (2024-02-31) is NaN. */
export const specDateMs = (raw: string): number => {
	if (!ISO_DATE.test(raw)) return Number.NaN
	const day = /^\d{4}$/.test(raw)
		? `${raw}-01-01`
		: /^\d{4}-\d{2}$/.test(raw)
			? `${raw}-01`
			: raw
	return parseLocalDate(day)
}

/** Below this a number on a temporal axis is surely a year, not epoch ms. */
export const MIN_EPOCH_MS = 1e11

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

/** Why a Format-box string won't format, or null. Auto (""), `literal`,
 *  `year-ends` and d3-time-format specs pass; anything else must be a
 *  d3-format spec, optionally ending in a fixed-scale K, M or B. */
export const formatProblem = (raw: string): string | null => {
	const spec = parseFormatSpec(raw).spec.trim()
	const lower = spec.toLowerCase()
	if (spec === "" || lower === LITERAL_FORMAT || lower === YEAR_ENDS_FORMAT) return null
	if (/%[a-zA-Z]/.test(spec)) return null
	try {
		formatSpecifier(parseScaledSpec(spec)?.base ?? spec)
		return null
	} catch {
		return `"${raw}" isn't a d3-format spec (e.g. ",.0f", ".1%", "$,.2s")`
	}
}

const familyProblem = (raw: unknown, hint: (name: string, c: readonly string[]) => string) => {
	const name = String(raw)
	const wanted = name.trim().toLowerCase()
	if (isOneOf(DEFERRED_FAMILIES, raw)) {
		return `a "${name}" chart can't be made from a spec yet; build it in the editor`
	}
	const family = SPEC_FAMILIES.find((f) =>
		QUICK_START_VARIATIONS[f].some((v) => v.name.toLowerCase() === wanted)
	)
	const variation =
		family && QUICK_START_VARIATIONS[family].find((v) => v.name.toLowerCase() === wanted)
	return family && variation
		? `unknown family "${named(name)}"; "${variation.name}" is a variation: send family "${family}", variation "${variation.name}"`
		: `unknown family "${named(name)}"${hint(name, SPEC_FAMILIES)} (families: ${quoted(SPEC_FAMILIES)})`
}

/** Read a spec, or with `mode` "edit" a chart edit, keeping what is
 *  well-formed and reporting the rest. `draft` is null only when the body
 *  isn't an object at all. */
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
	if (!isRecord(input)) {
		problem("", edit ? "a chart edit must be a JSON object" : "a chart spec must be a JSON object")
		return { draft: null, errors }
	}

	if (edit && Object.keys(input).length === 0) {
		problem("", "an edit must name at least one setting to change")
	}
	for (const key of Object.keys(input)) {
		if (edit && Object.hasOwn(CREATE_ONLY, key)) {
			problem(key, CREATE_ONLY[key] ?? "")
			continue
		}
		if (Object.hasOwn(SPEC_KEYS, key)) continue
		problem(pathOf(key), `unknown key "${named(key)}"${hint(key, TOP_LEVEL_KEYS)}`)
	}

	const draft: ChartSpecDraft = { encodings: {} }

	const text = (key: "name" | "title" | "subtitle" | "themeId") => {
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

	text("name")
	text("title")
	text("subtitle")
	if (!edit) text("themeId")

	if (input.family !== undefined) {
		if (isOneOf(SPEC_FAMILIES, input.family)) draft.family = input.family
		else problem("family", familyProblem(input.family, hint))
	}
	if (input.variation !== undefined && !edit) {
		if (typeof input.variation !== "string") {
			problem("variation", `"variation" must be a string`)
		} else if (input.family === undefined) {
			problem("variation", `"variation" needs "family"`)
		} else {
			draft.variation = input.variation
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
				const lower = name.toLowerCase()
				const candidates = [...SPEC_CHANNELS, ...SPEC_CHANNELS.map((c) => CHANNELS[c].label)]
				const near = Object.hasOwn(CHANNEL_HINTS, lower)
					? CHANNEL_HINTS[lower]
					: hint(name, candidates)
				problem(path, `unknown channel "${named(name)}"${near}`)
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
				if (field === "__proto__") {
					problem(pathOf("fieldTypes", field), `"__proto__" can't be used as a key`)
				} else if (isOneOf(FIELD_TYPES, type)) {
					fieldTypes[field] = type
				} else {
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
					problem(path, `unknown axis "${named(axis)}"; axes are "x" and "y"`)
				} else if (!isRecord(raw)) {
					problem(path, `axis "${axis}" must be an object`)
				} else {
					axes[axis] = readAxis(axis, raw, edit, problem, hint)
				}
			}
			draft.axes = axes
		}
	}

	if (input.stack !== undefined) {
		if (isOneOf(STACK_MODES, input.stack)) draft.stack = input.stack
		else problem("stack", `"stack" must be one of ${quoted(STACK_MODES)}`)
	}

	return { draft, errors }
}

const readAxis = (
	axis: "x" | "y",
	raw: Record<string, unknown>,
	edit: boolean,
	problem: (path: string, message: string) => void,
	hint: (name: string, candidates: readonly string[]) => string
): AxisSpec => {
	const spec: AxisSpec = {}
	for (const key of Object.keys(raw)) {
		if ((AXIS_KEYS as readonly string[]).includes(key)) continue
		problem(pathOf("axes", axis, key), `unknown axis key "${named(key)}"${hint(key, AXIS_KEYS)}`)
	}
	if (raw.title !== undefined) {
		if (typeof raw.title === "string") spec.title = raw.title
		else problem(pathOf("axes", axis, "title"), "an axis title must be a string")
	}
	for (const bound of ["min", "max"] as const) {
		const v = raw[bound]
		if (v === undefined) continue
		if (typeof v === "number" && Number.isFinite(v)) spec[bound] = v
		else if (typeof v === "string" && !Number.isNaN(specDateMs(v))) spec[bound] = v
		else if (edit && v === null) spec[bound] = null
		else {
			problem(
				pathOf("axes", axis, bound),
				`"${bound}" must be a finite number, or a date like "2020-01-01" on a temporal axis`
			)
		}
	}
	const asNumber = (b: number | string | null | undefined) =>
		typeof b === "string" ? specDateMs(b) : (b ?? undefined)
	const lo = asNumber(spec.min)
	const hi = asNumber(spec.max)
	if (lo !== undefined && hi !== undefined && lo >= hi) {
		problem(pathOf("axes", axis), `"min" (${spec.min}) must be below "max" (${spec.max})`)
	}
	if (raw.format !== undefined) {
		const path = pathOf("axes", axis, "format")
		if (typeof raw.format !== "string") {
			problem(path, "a format must be a string")
		} else {
			const bad = formatProblem(raw.format)
			if (bad) problem(path, bad)
			else spec.format = raw.format
		}
	}
	return spec
}
