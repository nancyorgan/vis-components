import { deepEqual } from "../../../../lib/deepEqual"
import type { ChannelConfigs } from "../channelConfig"
import { CHANNELS } from "../channels"
import type { EncodingChannel } from "../channelNames"
import { remapFieldsInConfigs, renameFieldInConfigs } from "../renameField"
import type {
	DataKind,
	DataLabelsEncodings,
	Encodings,
	Field,
	FormatSurfaceKey,
	TemplateMeta,
	TemplateSourceField,
	Visual,
} from "../types"
import type { TemplateBody } from "./buildTemplateBody"
import { formatSurfacesFor, type FormatConfigs } from "./formatSurfaces"
import {
	BODY_KEY_SECTIONS,
	CHANNEL_CONFIG_SECTIONS,
	TEMPLATE_SECTIONS,
	formatSurfaceLabel,
	formatSurfaceSection,
	templateSectionLabel,
	type TemplateSectionId,
} from "./templateSections"

/** What "Update template" compares and splices: a template body plus the
 * metadata describing the fields it was authored against. */
export type TemplateSide = { body: TemplateBody; meta: TemplateMeta }

/** Keys of maps keyed by a CATEGORY VALUE (hue colors, per-value shape /
 * pattern / opacity overrides, facet-title colors…). When a section is
 * applied these UNION — the visual's entries win, the template's other
 * entries stay — so pushing a visual whose data lacks "Other" doesn't
 * forget the template's color for it. Maps keyed by FIELD name (`pieces`,
 * `fieldFormats`, `fieldColors`) are not listed: they replace. */
const PER_VALUE_MAP_KEYS: ReadonlySet<string> = new Set([
	"colors",
	"overrides",
	"fillOverrides",
	"strokeOverrides",
	"dashOverrides",
	"customDashOverrides",
	"inkColors",
	"polygonOverrides",
	"polygonInkColors",
	"scales",
	"polygonScales",
	"violinOverrides",
	"violinInkColors",
	"violinScales",
	"areaPointOverrides",
	"areaPointInkColors",
	"areaPointScales",
	"segmentThicknessByValue",
	"lineColors",
	"thicknessByValue",
	"dashPatterns",
	"dashAlternateColors",
	"colorOverrides",
	"fillColorOverrides",
	"facetTitleColors",
])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

// --- field matching ---------------------------------------------------------

/** Encoding channels, most restrictive first (the narrowest accepted-type
 * list), ties in declaration order — the order `rebindTemplate` matches
 * in, so slot correspondence prefers the slots a rebind pinned first. */
const SLOT_ORDER: readonly EncodingChannel[] = (
	Object.keys(CHANNELS) as EncodingChannel[]
).sort((a, b) => CHANNELS[a].accepts.length - CHANNELS[b].accepts.length)

type Slot = { field: string | null }

/** Every field-bearing slot of a side, in matching order: the encoding
 * channels, then the data-label slots. */
const slotsOf = (
	encodings: Encodings,
	dle: DataLabelsEncodings | undefined,
): Array<string | null> => [
	...SLOT_ORDER.map((ch) => (encodings[ch] as Slot | undefined)?.field ?? null),
	...(dle
		? [
				dle.x.field,
				dle.y.field,
				dle.angle.field,
				dle.hue.field,
				dle.size.field,
				dle.value.field,
				...(dle.value.fields ?? []),
				dle.geography?.field ?? null,
			]
		: []),
]

/** Pair each template field with the visual field that took its place:
 * (1) same name, (2) a former name either side remembers, (3) whatever sits
 * in the same encoding / data-label slot (one-to-one, most restrictive
 * slot first). Identity pairs are included, so the result's keys are the
 * MATCHED template fields; `remapFieldsInConfigs` ignores identity. */
export const matchTemplateFields = (
	template: TemplateSide,
	visual: TemplateSide,
): Record<string, string> => {
	const mapping: Record<string, string> = {}
	const used = new Set<string>()
	const assign = (from: string, to: string) => {
		mapping[from] = to
		used.add(to)
	}
	const tpl = template.meta.sourceFields
	const vis = visual.meta.sourceFields
	const open = (src: TemplateSourceField, f: TemplateSourceField) =>
		mapping[src.name] === undefined && !used.has(f.name)

	for (const src of tpl) {
		const hit = vis.find((f) => open(src, f) && f.name === src.name)
		if (hit) assign(src.name, hit.name)
	}
	for (const src of tpl) {
		const aliases = src.sourceNames ?? []
		const hit = vis.find(
			(f) =>
				open(src, f) &&
				(aliases.includes(f.name) ||
					(f.sourceNames ?? []).includes(src.name) ||
					(f.sourceNames ?? []).some((n) => aliases.includes(n))),
		)
		if (hit) assign(src.name, hit.name)
	}
	const tplNames = new Set(tpl.map((f) => f.name))
	const visNames = new Set(vis.map((f) => f.name))
	const a = slotsOf(template.body.encodings, template.body.dataLabelsEncodings)
	const b = slotsOf(visual.body.encodings, visual.body.dataLabelsEncodings)
	for (let i = 0; i < a.length; i++) {
		const from = a[i]
		const to = b[i]
		if (from === null || to === null) continue
		if (!tplNames.has(from) || !visNames.has(to)) continue
		if (mapping[from] !== undefined || used.has(to)) continue
		assign(from, to)
	}
	return mapping
}

const asFields = (fields: readonly TemplateSourceField[]): Field[] =>
	fields.map((f) => ({
		name: f.name,
		inferredType: f.type,
		...(f.sourceNames ? { sourceNames: f.sourceNames } : {}),
	}))

/** The template body with its matched fields renamed to the visual's
 * names, so the two bodies can be compared and spliced in one namespace. */
const normalizeTemplate = (
	template: TemplateSide,
	mapping: Record<string, string>,
): TemplateBody =>
	remapFieldsInConfigs(
		template.body,
		asFields(template.meta.sourceFields),
		mapping,
	)

/** Every bound format surface set to Auto — formats are compared through
 * format memory (per data kind), not through the strings the body holds. */
const blankFormats = <T extends FormatConfigs>(configs: T): T => {
	let out = configs
	for (const s of formatSurfacesFor(
		configs.encodings,
		configs.dataLabelsEncodings,
	))
		out = s.write(out, "")
	return out
}

// --- diff -------------------------------------------------------------------

/** Changed leaf paths under `a` → `b`, arrays compared whole. */
const diffPaths = (a: unknown, b: unknown, prefix: string[]): string[][] => {
	if (deepEqual(a, b)) return []
	if (!isPlainObject(a) || !isPlainObject(b)) return [prefix]
	const keys = new Set([...Object.keys(a), ...Object.keys(b)])
	const out: string[][] = []
	for (const k of keys) for (const p of diffPaths(a[k], b[k], [...prefix, k])) out.push(p)
	return out
}

const humanizeSegment = (s: string): string =>
	/^\d+$/.test(s)
		? `#${Number(s) + 1}`
		: s
				.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
				.replace(/_/g, " ")
				.toLowerCase()

/** "gridlines › color" — the path relative to the section root, with the
 * root itself named only when a section spans several roots. */
const describePath = (path: string[], root: string, multiRoot: boolean) => {
	const rel = path.map(humanizeSegment)
	const head = multiRoot ? [humanizeRoot(root)] : []
	return [...head, ...rel].join(" › ")
}

const humanizeRoot = (root: string): string => {
	const ch = CHANNELS[root as EncodingChannel]
	return ch ? ch.label.toLowerCase() : humanizeSegment(root)
}

/** The roots a section diffs: top-level body keys, and `channelConfigs`
 * keys ("channelConfigs.x" is rooted at `x`). */
type Root = { key: keyof TemplateBody; sub?: keyof ChannelConfigs }

const sectionRoots = (id: TemplateSectionId): Root[] => {
	const roots: Root[] = []
	for (const [key, section] of Object.entries(BODY_KEY_SECTIONS) as Array<
		[keyof TemplateBody, TemplateSectionId | "channelConfigs" | null]
	>)
		if (section === id) roots.push({ key })
	for (const [sub, section] of Object.entries(CHANNEL_CONFIG_SECTIONS) as Array<
		[keyof ChannelConfigs, TemplateSectionId]
	>)
		if (section === id) roots.push({ key: "channelConfigs", sub })
	return roots
}

const readRoot = (body: TemplateBody, root: Root): unknown =>
	root.sub ? body.channelConfigs[root.sub] : body[root.key]

const rootName = (root: Root): string => root.sub ?? root.key

export type TemplateSectionDiff = {
	id: TemplateSectionId
	label: string
	/** Humanized setting paths that differ, in no particular order. */
	changes: string[]
	/** Format-memory sentences: "Learns the percent format for Y axis (.0%)". */
	formats: string[]
}

export type TemplateDiff = {
	mapping: Record<string, string>
	/** Only the sections with at least one change or format to learn. */
	sections: TemplateSectionDiff[]
}

const KIND_WORD: Record<DataKind, string> = {
	dollar: "dollar",
	percent: "percent",
	number: "number",
	date: "date",
	category: "category",
	ordinal: "ordinal",
}

/** Format-memory changes per section: a kind the template doesn't know
 * yet is "learned", a different string for a known kind "changes" it. */
const formatChanges = (
	existing: TemplateMeta["formatMemory"],
	incoming: TemplateMeta["formatMemory"],
): Partial<Record<TemplateSectionId, string[]>> => {
	const out: Partial<Record<TemplateSectionId, string[]>> = {}
	for (const [key, kinds] of Object.entries(incoming)) {
		for (const [kind, format] of Object.entries(kinds) as Array<
			[DataKind, string | undefined]
		>) {
			if (format === undefined) continue
			const had = existing[key]?.[kind]
			if (had === format) continue
			const section = formatSurfaceSection(key)
			const verb = had === undefined ? "Learns" : "Changes"
			;(out[section] ??= []).push(
				`${verb} the ${KIND_WORD[kind]} format for the ${formatSurfaceLabel(key)} (${format})`,
			)
		}
	}
	return out
}

/** What pushing `visual` into `template` would change, by section. The
 * template is first brought into the visual's field names (`mapping`), and
 * format strings are set aside (they are reported through format memory),
 * so a snap's renames and per-kind formats never show up as changes. */
export const diffTemplate = (
	template: TemplateSide,
	visual: TemplateSide,
): TemplateDiff => {
	const mapping = matchTemplateFields(template, visual)
	const base = blankFormats(normalizeTemplate(template, mapping))
	const next = blankFormats(visual.body)
	const formats = formatChanges(template.meta.formatMemory, visual.meta.formatMemory)
	const sections: TemplateSectionDiff[] = []
	for (const { id, label } of TEMPLATE_SECTIONS) {
		const roots = sectionRoots(id)
		const multiRoot = roots.length > 1
		const changes: string[] = []
		for (const root of roots) {
			for (const path of diffPaths(readRoot(base, root), readRoot(next, root), []))
				changes.push(describePath(path, rootName(root), multiRoot))
		}
		const learned = formats[id] ?? []
		if (changes.length === 0 && learned.length === 0) continue
		sections.push({ id, label, changes: [...new Set(changes)], formats: learned })
	}
	return { mapping, sections }
}

// --- apply ------------------------------------------------------------------

/** `next` over `base`, with per-value maps unioned at every depth. */
const spliceValue = (base: unknown, next: unknown, key?: string): unknown => {
	if (!isPlainObject(base) || !isPlainObject(next)) return next
	if (key !== undefined && PER_VALUE_MAP_KEYS.has(key)) {
		const out: Record<string, unknown> = { ...base }
		for (const [k, v] of Object.entries(next)) out[k] = v
		return out
	}
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(next)) out[k] = spliceValue(base[k], v, k)
	return out
}

/** The probe name `rebindTemplate` uses; never observable. */
const PROBE_NAME = "__rebind_probe__"

export type TemplateUpdate = {
	body: TemplateBody
	meta: TemplateMeta
}

/** Splice the chosen sections of `visual` into `template` (APPLICATION.md
 * §2.5 "Updating one"): the template is renamed into the visual's field
 * names, each chosen section's slice is replaced (per-value maps unioned),
 * the chosen sections' format memory is merged per kind, and the source
 * fields become the visual's plus any template field a kept section still
 * references. With every section chosen this is a full update. */
export const applyTemplateUpdate = (
	template: TemplateSide,
	visual: TemplateSide,
	sections: ReadonlySet<TemplateSectionId>,
): TemplateUpdate => {
	const mapping = matchTemplateFields(template, visual)
	const base = normalizeTemplate(template, mapping)
	const chosen = (section: TemplateSectionId | "channelConfigs" | null) =>
		section !== null && section !== "channelConfigs" && sections.has(section)

	const body = { ...base } as Record<string, unknown>
	for (const [key, section] of Object.entries(BODY_KEY_SECTIONS) as Array<
		[keyof TemplateBody, TemplateSectionId | "channelConfigs" | null]
	>) {
		if (key === "channelConfigs") continue
		// Constants (section null) are the same on both sides; the visual's
		// copy is as good as the template's and keeps the body current.
		if (section === null || chosen(section)) {
			const v = spliceValue(base[key], visual.body[key])
			if (v === undefined) delete body[key]
			else body[key] = v
		}
	}
	const channelConfigs = { ...base.channelConfigs } as Record<string, unknown>
	for (const [sub, section] of Object.entries(CHANNEL_CONFIG_SECTIONS) as Array<
		[keyof ChannelConfigs, TemplateSectionId]
	>) {
		if (!sections.has(section)) continue
		const v = spliceValue(base.channelConfigs[sub], visual.body.channelConfigs[sub], sub)
		if (v === undefined) delete channelConfigs[sub]
		else channelConfigs[sub] = v
	}
	body.channelConfigs = channelConfigs
	const out = body as unknown as TemplateBody

	const formatMemory: TemplateMeta["formatMemory"] = {
		...template.meta.formatMemory,
	}
	for (const [key, kinds] of Object.entries(visual.meta.formatMemory)) {
		if (!sections.has(formatSurfaceSection(key as FormatSurfaceKey))) continue
		formatMemory[key] = { ...(formatMemory[key] ?? {}), ...kinds }
	}

	// Source fields: the visual's, plus unmatched template fields a kept
	// section still mentions (the rename engine is the reference test).
	const visualNames = new Set(visual.meta.sourceFields.map((f) => f.name))
	const kept = template.meta.sourceFields.filter(
		(f) =>
			mapping[f.name] === undefined &&
			!visualNames.has(f.name) &&
			renameFieldInConfigs(
				out,
				asFields(template.meta.sourceFields),
				f.name,
				PROBE_NAME,
			) !== out,
	)
	return {
		body: out,
		meta: { sourceFields: [...visual.meta.sourceFields, ...kept], formatMemory },
	}
}

/** The comparable side of a stored template row. */
export const templateSideOf = (row: Visual): TemplateSide => {
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
		template,
		templateId: _templateId,
		...body
	} = row
	return {
		body,
		meta: template ?? { sourceFields: [], formatMemory: {} },
	}
}

export { templateSectionLabel }
