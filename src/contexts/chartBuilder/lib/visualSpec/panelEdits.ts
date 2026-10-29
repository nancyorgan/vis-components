/** What the editor's panels do beyond storing the value a control shows,
 *  done the same way for a settings patch:
 *
 *  - Annotations: a new entry (no `id`) starts from the kind's factory
 *    with the theme's style and the next default name, as the Annotations
 *    panel's Add buttons make one, then takes what the patch says.
 *  - Data labels: picking a field, or checking several, switches the
 *    Value mode, and the composed labels follow the checklist, as the
 *    Data Labels panel does.
 *  - Level orders: an Order-by choice (`fieldLevelOrderSpecs.<field>`)
 *    computes the order the Fields panel pins (`fieldLevelOrders.<field>`);
 *    an order set by hand clears the choice, as the panel's arrows do.
 *
 *  The patch changes before it is checked, so what is stored is checked
 *  whole; `finish` does what only the applied visual can tell. */

import {
	newAnnotationId,
	newCircle,
	newLineSegment,
	newRectangle,
	newTextAnnotation,
	nextAnnotationName,
} from "../annotationsConfig"
import { barTotalFieldName } from "../barTotalLabel"
import { DEFAULT_DATA_LABELS_CONFIG, type DataLabelsConfig } from "../channelConfig"
import {
	composedLabelForField,
	normalizeComposedLabels,
} from "../dataLabelsSelection"
import { alphabeticalLevelOrder, orderLevelsByField } from "../orderLevelsByField"
import {
	boxAnnotationStyleFromTheme,
	lineAnnotationStyleFromTheme,
	rectangleStyleFromTheme,
	textAnnotationStyleFromTheme,
} from "../themeConfig"
import type { FieldLevelOrderSpec, FieldType, Theme, Visual } from "../types"
import { uniqueFieldValues } from "../uniqueFieldValues"
import { named, pathOf, type SpecProblem } from "./chartSpec"
import type { SettingsPatch } from "./settings"

export type PanelContext = {
	/** The visual the patch lands on. */
	visual: Visual
	theme: Theme
	/** The rows as the editor shows them (reshape and derived variables
	 *  applied), and their fields. */
	rows: ReadonlyArray<Record<string, string>>
	fieldNames: readonly string[]
	typeOf: (field: string) => FieldType
}

export type PanelEdits = {
	patch: SettingsPatch
	problems: SpecProblem[]
	/** The applied visual, finished as the panels finish it, with what
	 *  finishing it found wrong. */
	finish: (visual: Visual) => { visual: Visual; problems: SpecProblem[] }
	/** An id for a new entry of the list at `path`, as the panel adding it
	 *  makes one; undefined leaves it to the settings default. */
	newId: (path: string) => string | undefined
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

/** Each annotation list's Add button: the factory, styled by the theme,
 *  its default name and its id. */
const NEW_ANNOTATION = {
	rectangles: { name: "Rectangle", id: "rect", make: (t: Theme) => newRectangle("", rectangleStyleFromTheme(t)) },
	circles: { name: "Circle", id: "circle", make: (t: Theme) => newCircle("", boxAnnotationStyleFromTheme(t)) },
	lineSegments: { name: "Line", id: "line", make: (t: Theme) => newLineSegment("", lineAnnotationStyleFromTheme(t)) },
	texts: { name: "Text", id: "text", make: (t: Theme) => newTextAnnotation("", textAnnotationStyleFromTheme(t)) },
} as const

type AnnotationKind = keyof typeof NEW_ANNOTATION

const isAnnotationKind = (k: string): k is AnnotationKind => Object.hasOwn(NEW_ANNOTATION, k)

/** New entries (no `id`) of each annotation list, as Add makes them, then
 *  the patch's own fields; the id comes when the patch is applied. */
const withNewAnnotations = (lists: Record<string, unknown>, theme: Theme): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(lists).map(([kind, list]) => {
			if (!isAnnotationKind(kind) || !Array.isArray(list)) return [kind, list]
			const add = NEW_ANNOTATION[kind]
			const out: unknown[] = []
			for (const entry of list) {
				if (!isRecord(entry) || entry.id !== undefined) {
					out.push(entry)
					continue
				}
				const { id: _id, ...made } = add.make(theme)
				const before = out.map((e) => ({ name: isRecord(e) && typeof e.name === "string" ? e.name : "" }))
				out.push({ ...made, name: nextAnnotationName(add.name, before), ...entry })
			}
			return [kind, out]
		})
	)

/** One field's entry of a per-field data labels map. */
type Entry<K extends "fieldLabelPoints" | "fieldLabelPointsScope" | "fieldBarPlacements"> = NonNullable<
	DataLabelsConfig[K]
>[string]

/** Where a patch's own data labels config places field `f`'s labels. */
const sentPlacement = (sent: Record<string, unknown>, f: string) => {
	const at = (key: string) => {
		const map = sent[key]
		return isRecord(map) ? map[f] : undefined
	}
	const placement = at("fieldBarPlacements")
	return {
		points: at("fieldLabelPoints") as Entry<"fieldLabelPoints"> | undefined,
		scope: at("fieldLabelPointsScope") as Entry<"fieldLabelPointsScope"> | undefined,
		position: (isRecord(placement) ? placement.position : undefined) as Entry<"fieldBarPlacements">["position"],
	}
}

/** The sparse spec the Order-by picker stores for a choice. */
const pickerSpec = (s: FieldLevelOrderSpec): FieldLevelOrderSpec => {
	const spec: FieldLevelOrderSpec =
		s.by === "alphabetical" ? { by: "alphabetical" } : { by: "field", byField: s.byField ?? "" }
	if (s.scopeField !== undefined) spec.scopeField = s.scopeField
	if (s.scopeField !== undefined && s.scopeLevel !== undefined) spec.scopeLevel = s.scopeLevel
	if (s.decreasing) spec.decreasing = true
	return spec
}

export const panelEdits = (patch: SettingsPatch, ctx: PanelContext): PanelEdits => {
	const problems: SpecProblem[] = []
	const out: Record<string, unknown> = { ...patch }
	const finishers: Array<(v: Visual) => Visual> = []
	const finishProblems: SpecProblem[] = []

	if (isRecord(out.annotationsConfig)) {
		out.annotationsConfig = withNewAnnotations(out.annotationsConfig, ctx.theme)
	}

	// Data labels: the Value row's pick, or the "Multiple variables…"
	// checklist.
	const labels = isRecord(out.dataLabelsEncodings) ? out.dataLabelsEncodings : undefined
	const value = labels && isRecord(labels.value) ? labels.value : undefined
	const sentConfig = isRecord(out.dataLabelsConfig) ? out.dataLabelsConfig : {}
	const barTotal = barTotalFieldName(ctx.fieldNames)
	if (labels && value) {
		const fields = Array.isArray(value.fields) && value.fields.every((f) => typeof f === "string") ? (value.fields as string[]) : undefined
		// A field checked twice would add its `{Field}` label twice, under
		// one id the Value panel edits and removes both by.
		fields?.forEach((f, i) => {
			const first = fields.indexOf(f)
			if (first !== i) {
				problems.push({
					path: `${pathOf("settings", "dataLabelsEncodings", "value", "fields")}[${i}]`,
					message: `"${named(f)}" is checked twice (fields[${first}] too); check each field once`,
				})
			}
		})
		if (fields && (value.multiField === true || (value.multiField === undefined && (value.field ?? null) === null))) {
			out.dataLabelsEncodings = { ...labels, value: { field: null, multiField: true, ...value } }
			const prevFields = ctx.visual.dataLabelsEncodings?.value.fields ?? []
			const prevConfig = ctx.visual.dataLabelsConfig
			finishers.push((v) => {
				if (sentConfig.composedLabels !== undefined) return v
				// The labels follow the checklist: a checked variable adds its
				// own `{Field}` label; an unchecked one takes the labels that
				// compose just it.
				const current = normalizeComposedLabels({ ...DEFAULT_DATA_LABELS_CONFIG, ...prevConfig }, prevFields).composedLabels ?? []
				const added = fields.filter((f) => !prevFields.includes(f))
				const removed = prevFields.filter((f) => !fields.includes(f))
				const total = barTotal !== null && added.includes(barTotal) ? barTotal : null
				const cfg: DataLabelsConfig = v.dataLabelsConfig ?? { ...DEFAULT_DATA_LABELS_CONFIG }
				const sent = sentPlacement(sentConfig, total ?? "")
				const composedLabels = [
					...current.filter((l) => !removed.some((f) => l.template.trim() === `{${f}}`)),
					...added.filter((f) => !current.some((l) => l.id === f)).map(composedLabelForField),
				]
				const ids = composedLabels.map((l) => l.id)
				const twice = ids.find((id, i) => ids.indexOf(id) !== i)
				if (twice !== undefined) {
					finishProblems.push({
						path: pathOf("settings", "dataLabelsConfig", "composedLabels"),
						message: `the composed labels would have the id "${named(twice)}" twice; send "composedLabels" with each id once`,
					})
				}
				return {
					...v,
					dataLabelsConfig: {
						...cfg,
						composedLabels,
						// A newly checked Bar total reads as the bar's: the last
						// layer of each stack, outside its end, unless the patch
						// places it itself.
						...(total !== null
							? {
									fieldLabelPoints: { ...cfg.fieldLabelPoints, [total]: sent.points ?? "last" },
									fieldLabelPointsScope: { ...cfg.fieldLabelPointsScope, [total]: sent.scope ?? "stack" },
									fieldBarPlacements: {
										...cfg.fieldBarPlacements,
										[total]: { ...cfg.fieldBarPlacements?.[total], position: sent.position ?? "outside-end" },
									},
								}
							: {}),
					},
				}
			})
		} else if (value.field !== undefined && fields === undefined && value.multiField === undefined) {
			out.dataLabelsEncodings = { ...labels, value: { ...value, multiField: false } }
			if (barTotal !== null && value.field === barTotal) {
				// A fresh Bar total starts on the last layer of each stack,
				// outside its end.
				const seed = { labelPoints: "last", labelPointsScope: "stack", barLabelPosition: "outside-end" }
				out.dataLabelsConfig = { ...seed, ...sentConfig }
			}
		}
	}

	// Level orders: the Order-by picker computes; a hand order clears it.
	const specs = isRecord(out.fieldLevelOrderSpecs) ? out.fieldLevelOrderSpecs : {}
	const orders = isRecord(out.fieldLevelOrders) ? { ...out.fieldLevelOrders } : {}
	const exact: Record<string, FieldLevelOrderSpec> = {}
	for (const [field, raw] of Object.entries(specs)) {
		if (!isRecord(raw) || (raw.by !== "alphabetical" && raw.by !== "field")) continue
		const spec = raw as FieldLevelOrderSpec
		const at = pathOf("settings", "fieldLevelOrderSpecs", field)
		if (Object.hasOwn(orders, field)) {
			// Both sent, as a copy of a chart sends them: kept as they are.
			exact[field] = spec
			continue
		}
		if (!ctx.fieldNames.includes(field)) {
			problems.push({ path: at, message: `no field "${named(field)}" in the data` })
			continue
		}
		const type = ctx.typeOf(field)
		if (type !== "categorical" && type !== "ordinal") {
			problems.push({ path: at, message: `"${named(field)}" is ${type}; levels are ordered for a categorical or ordinal field` })
			continue
		}
		const scope =
			spec.scopeField !== undefined && spec.scopeLevel !== undefined
				? { field: spec.scopeField, value: spec.scopeLevel }
				: undefined
		if (scope && ctx.fieldNames.includes(scope.field) && !ctx.rows.some((r) => String(r[scope.field]) === scope.value)) {
			problems.push({ path: pathOf("settings", "fieldLevelOrderSpecs", field, "scopeLevel"), message: `no "${named(scope.value)}" in "${named(scope.field)}"` })
			continue
		}
		if (spec.by === "alphabetical") {
			orders[field] = alphabeticalLevelOrder(uniqueFieldValues(ctx.rows, field, { skipBlank: true }), spec.decreasing ?? false)
		} else {
			if (typeof spec.byField !== "string" || spec.byField === "") {
				problems.push({ path: at, message: `{"by": "field"} needs "byField", the quantitative or temporal field to order by` })
				continue
			}
			const byField = spec.byField
			// A field the data lacks is reported by the settings check.
			const byType = ctx.fieldNames.includes(byField) ? ctx.typeOf(byField) : undefined
			if (byType === undefined) continue
			if (byType !== "quantitative" && byType !== "temporal") {
				problems.push({
					path: pathOf("settings", "fieldLevelOrderSpecs", field, "byField"),
					message: `"${named(byField)}" is ${byType}; order by a quantitative or temporal field`,
				})
				continue
			}
			orders[field] = orderLevelsByField(ctx.rows, field, type, byField, byType, spec.decreasing ?? false, scope)
		}
		exact[field] = pickerSpec(spec)
	}
	const handOrders = Object.keys(isRecord(patch.fieldLevelOrders) ? patch.fieldLevelOrders : {}).filter(
		(field) => !Object.hasOwn(specs, field)
	)
	if (Object.keys(orders).length > 0) out.fieldLevelOrders = orders
	if (Object.keys(exact).length > 0 || handOrders.length > 0) {
		finishers.push((v) => {
			// A choice replaces the one before it whole, as the picker does;
			// a hand order leaves no choice behind.
			const next: Record<string, FieldLevelOrderSpec> = { ...v.fieldLevelOrderSpecs, ...exact }
			for (const field of handOrders) delete next[field]
			return { ...v, fieldLevelOrderSpecs: next }
		})
	}

	return {
		patch: out as SettingsPatch,
		problems,
		finish: (visual) => ({ visual: finishers.reduce((v, f) => f(v), visual), problems: finishProblems }),
		newId: (path) => {
			const kind = path.startsWith("annotationsConfig.") ? path.slice("annotationsConfig.".length) : ""
			return isAnnotationKind(kind) ? newAnnotationId(NEW_ANNOTATION[kind].id) : undefined
		},
	}
}
