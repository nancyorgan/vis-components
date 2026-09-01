import type {
	ChannelConfigs,
	ColorSlotConfig,
	DataLabelsConfig,
	OpacitySlotConfig,
} from "./channelConfig"
import type { AnnotationsConfig } from "./annotationsConfig"
import type {
	DerivedVariable,
	DerivedVariablesConfig,
} from "./derivedVariables"
import type { LabelsConfig, TooltipConfig } from "./labelsConfig"
import {
	effectiveVariableName,
	presentMeltFields,
	reshapeApplies,
	type ReshapeConfig,
} from "./reshape"
import type {
	DataLabelsEncodings,
	Encodings,
	Field,
	FieldType,
	Visual,
} from "./types"

/** Renaming a variable (Fields panel) rewrites every config surface that
 * stores the field's name, in one shot, so the visual keeps rendering
 * identically under the new name. The rewrite is PURE and identity-preserving:
 * every sub-object that doesn't mention the old name comes back as the same
 * reference, so callers (and the saved-visuals sweep) can detect no-ops.
 *
 * Two rewrite modes per visual, decided by that visual's own reshape config:
 *
 *  - Standard (no reshape, or the renamed field is a kept ID column): the
 *    field's name appears wherever configs reference VIEW fields — encodings,
 *    color/opacity slots, per-field maps, templates — and each of those gets
 *    a value/key/token swap.
 *
 *  - Melted (the renamed field is a present melt column of an applying
 *    reshape): the field's name is NOT a view field there — it appears as a
 *    CELL VALUE of the minted `variableName` column instead. The view-field
 *    surfaces are deliberately left alone (a reference equal to the old name
 *    would be the minted column or a stale pointer, not this field), and the
 *    rewrite instead renames the value key in every value-keyed map driven by
 *    the `variableName` column (hue colors, per-value overrides, facet panel
 *    settings, annotation facet keys, pinned level orders). `reshapeConfig`'s
 *    membership arrays are swapped in both modes. */

/** Blocking reason a rename can't be committed, or null when it's fine.
 * `newName` is compared as-typed — trim before calling. A rename back to
 * one of the field's OWN former names is allowed (it just retires the
 * alias); colliding with any OTHER field's current or former name is not,
 * because upload matching (`diffFields`) could then resolve one CSV column
 * to two fields. */
export const fieldRenameError = (
	fields: Field[],
	oldName: string,
	newName: string
): string | null => {
	if (newName === "") return "Enter a name."
	for (const f of fields) {
		if (f.name === oldName) continue
		if (f.name === newName)
			return `Another variable is already named "${newName}".`
		if ((f.sourceNames ?? []).includes(newName))
			return `"${newName}" is a former name of "${f.name}" — pick a different name.`
	}
	return null
}

/** Apply a rename to the dataset's field list: the field takes the new name
 * and remembers the old one in `sourceNames`, so stored rows — which keep
 * their original column keys — still resolve to it, and later uploads match
 * on either name. Strictly chronological, first occurrence kept: the UPLOAD
 * original is always `sourceNames[0]` (see `originalFieldName`), which the
 * Fields panel relies on to revert an emptied name box back to the uploaded
 * column name. A name is never dropped from the list — renaming back to a
 * former name leaves it in place (a field may alias its own current name;
 * every consumer checks `name` first, so the self-entry is inert). */
export const renameDatasetField = (
	fields: Field[],
	oldName: string,
	newName: string
): Field[] =>
	fields.map((f) => {
		if (f.name !== oldName) return f
		const sourceNames = [...new Set([...(f.sourceNames ?? []), oldName])]
		return { ...f, name: newName, sourceNames }
	})

/** The name this field had when its data was first uploaded — the revert
 * target for clearing the name box. Equals `name` when never renamed (or
 * renamed back to the original). */
export const originalFieldName = (field: Field): string =>
	field.sourceNames?.[0] ?? field.name

// ---------------------------------------------------------------------------
// Identity-preserving primitives
// ---------------------------------------------------------------------------

/** Swap a key of a record, preserving entry order. Same reference when the
 * old key is absent. If the map somehow holds BOTH names, the later entry
 * wins (Object.fromEntries keeps the last duplicate). */
const renameKey = <V>(
	map: Record<string, V> | undefined,
	oldName: string,
	newName: string
): Record<string, V> | undefined =>
	map && oldName in map
		? Object.fromEntries(
				Object.entries(map).map(([k, v]) => [k === oldName ? newName : k, v])
			)
		: map

/** Swap a value in a string array. Same reference when absent. */
const renameInList = (
	list: string[] | undefined,
	oldName: string,
	newName: string
): string[] | undefined =>
	list?.includes(oldName)
		? list.map((v) => (v === oldName ? newName : v))
		: list

/** Swap `{Old}` tokens in a Data-Labels template (exact token match — the
 * grammar has no nesting, so a literal replace is precise). */
const renameLabelTokens = (
	template: string | undefined,
	oldName: string,
	newName: string
): string | undefined =>
	template?.includes(`{${oldName}}`)
		? template.replaceAll(`{${oldName}}`, `{${newName}}`)
		: template

/** Map over a list, returning the same reference when no element changed. */
const mapItems = <A>(items: A[], fn: (a: A) => A): A[] => {
	let changed = false
	const out = items.map((item) => {
		const next = fn(item)
		if (next !== item) changed = true
		return next
	})
	return changed ? out : items
}

/** Merge `patch` onto `base`, but return `base` itself when every patched
 * property is already the same reference — the no-op detector the whole
 * rewrite is built on. */
const patched = <T extends object>(base: T, patch: Partial<T>): T => {
	for (const [k, v] of Object.entries(patch)) {
		if ((base as Record<string, unknown>)[k] !== v) return { ...base, ...patch }
	}
	return base
}

// ---------------------------------------------------------------------------
// The per-visual rewrite
// ---------------------------------------------------------------------------

/** The slice of a visual's state the rename rewrite reads and returns. Maps
 * 1:1 onto both the editor's `current*` atoms and the corresponding `Visual`
 * properties, so one function serves the open editor and the library sweep. */
export type FieldNameConfigs = {
	encodings: Encodings
	dataLabelsEncodings?: DataLabelsEncodings
	fieldTypeOverrides: Record<string, FieldType>
	fieldLevelOrders?: Record<string, string[]>
	channelConfigs: ChannelConfigs
	labelsConfig?: LabelsConfig
	dataLabelsConfig?: DataLabelsConfig
	tooltipConfig?: TooltipConfig
	reshapeConfig?: ReshapeConfig
	annotationsConfig?: AnnotationsConfig
	derivedVariablesConfig?: DerivedVariablesConfig
}

const renameSlotField = <S extends ColorSlotConfig | OpacitySlotConfig>(
	slot: S,
	oldName: string,
	newName: string
): S => (slot.field === oldName ? { ...slot, field: newName } : slot)

/** Rename the value-key in a slot's per-value map when the slot itself is
 * driven by `drivingField` (melted-rename case). */
const renameSlotValues = <S extends ColorSlotConfig | OpacitySlotConfig>(
	slot: S,
	drivingField: string,
	oldName: string,
	newName: string
): S => {
	if (slot.field !== drivingField) return slot
	if ("hue" in slot && slot.hue?.kind === "categorical") {
		const colors = renameKey(slot.hue.colors, oldName, newName)
		if (colors !== slot.hue.colors)
			return { ...slot, hue: { ...slot.hue, colors } }
	}
	if ("opacity" in slot && slot.opacity?.kind === "categorical") {
		const overrides = renameKey(slot.opacity.overrides, oldName, newName)
		if (overrides !== slot.opacity.overrides)
			return { ...slot, opacity: { ...slot.opacity, overrides } }
	}
	return slot
}

const mapRecordValues = <V>(
	record: Record<string, V | undefined> | undefined,
	fn: (v: V) => V
): Record<string, V | undefined> | undefined => {
	if (!record) return record
	let changed = false
	const out: Record<string, V | undefined> = {}
	for (const [k, v] of Object.entries(record)) {
		const next = v === undefined ? v : fn(v)
		if (next !== v) changed = true
		out[k] = next
	}
	return changed ? out : record
}

/** `ColorSlots` / `OpacitySlots` are keyed by their specific slot-key unions,
 * which don't unify with a string index signature — one widening cast here
 * instead of one per call site. */
const slotsAsRecord = <S>(
	slots: Partial<Record<string, S>> | undefined
): Record<string, S | undefined> | undefined =>
	slots as Record<string, S | undefined> | undefined

/** Standard-mode rewrite: swap every VIEW-field reference. */
const renameViewFieldRefs = <T extends FieldNameConfigs>(
	state: T,
	oldName: string,
	newName: string
): T => {
	const swapEnc = <E extends { field: string | null }>(e: E): E =>
		e.field === oldName ? { ...e, field: newName } : e

	const encodings = (() => {
		let changed = false
		const out = {} as Encodings
		for (const [ch, e] of Object.entries(state.encodings)) {
			const next = swapEnc(e)
			if (next !== e) changed = true
			out[ch as keyof Encodings] = next
		}
		return changed ? out : state.encodings
	})()

	const dle = state.dataLabelsEncodings
	const dataLabelsEncodings = dle
		? patched(dle, {
				x: swapEnc(dle.x),
				y: swapEnc(dle.y),
				angle: swapEnc(dle.angle),
				r: swapEnc(dle.r),
				hue: swapEnc(dle.hue),
				size: swapEnc(dle.size),
				value: patched(swapEnc(dle.value), {
					fields: renameInList(dle.value.fields, oldName, newName),
				}),
				geography: dle.geography ? swapEnc(dle.geography) : dle.geography,
			})
		: dle

	const cc = state.channelConfigs
	const swapAxis = (axis: ChannelConfigs["x"]): ChannelConfigs["x"] =>
		axis?.regression && axis.regression.groupField === oldName
			? {
					...axis,
					regression: { ...axis.regression, groupField: newName },
				}
			: axis
	const channelConfigs = patched(cc, {
		x: swapAxis(cc.x),
		y: swapAxis(cc.y),
		r: swapAxis(cc.r),
		connection: cc.connection
			? patched(cc.connection, {
					stemColorField:
						cc.connection.stemColorField === oldName
							? newName
							: cc.connection.stemColorField,
					hierarchyIdField:
						cc.connection.hierarchyIdField === oldName
							? newName
							: cc.connection.hierarchyIdField,
					flowTargetField:
						cc.connection.flowTargetField === oldName
							? newName
							: cc.connection.flowTargetField,
				})
			: cc.connection,
		drawOrder:
			cc.drawOrder && cc.drawOrder.field === oldName
				? { ...cc.drawOrder, field: newName }
				: cc.drawOrder,
		colorSlots: mapRecordValues(slotsAsRecord(cc.colorSlots), (s) =>
			renameSlotField(s, oldName, newName)
		) as ChannelConfigs["colorSlots"],
		opacitySlots: mapRecordValues(slotsAsRecord(cc.opacitySlots), (s) =>
			renameSlotField(s, oldName, newName)
		) as ChannelConfigs["opacitySlots"],
	})

	const dlc = state.dataLabelsConfig
	const dataLabelsConfig = dlc
		? patched(dlc, {
				labelTemplate: renameLabelTokens(dlc.labelTemplate, oldName, newName),
				fieldFormats: renameKey(dlc.fieldFormats, oldName, newName),
				fieldColors: mapRecordValues(
					renameKey(dlc.fieldColors, oldName, newName),
					(s) => renameSlotField(s, oldName, newName)
				) as Record<string, ColorSlotConfig> | undefined,
				firstLabel: dlc.firstLabel
					? patched(dlc.firstLabel, {
							labelTemplate: renameLabelTokens(
								dlc.firstLabel.labelTemplate,
								oldName,
								newName
							),
						})
					: dlc.firstLabel,
				lastLabel: dlc.lastLabel
					? patched(dlc.lastLabel, {
							labelTemplate: renameLabelTokens(
								dlc.lastLabel.labelTemplate,
								oldName,
								newName
							),
						})
					: dlc.lastLabel,
			})
		: dlc

	// Derived-variable expressions reference view fields through the same
	// {Field} token grammar as the label templates, so the token swap covers
	// math formulas, concat templates, and rule conditions alike. (In melted
	// mode this is deliberately NOT run — like every other view-field surface;
	// a melt column's name only appears in expressions as a string literal,
	// and literals are never rewritten anywhere.)
	const swapDerivedTokens = (v: DerivedVariable): DerivedVariable =>
		patched(v, {
			math: v.math
				? patched(v.math, {
						formula:
							renameLabelTokens(v.math.formula, oldName, newName) ??
							v.math.formula,
					})
				: v.math,
			concat: v.concat
				? patched(v.concat, {
						template:
							renameLabelTokens(v.concat.template, oldName, newName) ??
							v.concat.template,
					})
				: v.concat,
			rules: v.rules
				? patched(v.rules, {
						rules: mapItems(v.rules.rules, (r) =>
							patched(r, {
								condition:
									renameLabelTokens(r.condition, oldName, newName) ??
									r.condition,
							})
						),
					})
				: v.rules,
		})
	const dv = state.derivedVariablesConfig
	const derivedVariablesConfig = dv
		? patched(dv, { variables: mapItems(dv.variables, swapDerivedTokens) })
		: dv

	const tc = state.tooltipConfig
	const tooltipConfig = tc
		? patched(tc, {
				visibleFields:
					renameInList(tc.visibleFields, oldName, newName) ??
					tc.visibleFields,
				customHtml: tc.customHtml.includes(`{{${oldName}}}`)
					? tc.customHtml.replaceAll(`{{${oldName}}}`, `{{${newName}}}`)
					: tc.customHtml,
			})
		: tc

	return patched(state, {
		encodings,
		dataLabelsEncodings,
		fieldTypeOverrides: renameKey(
			state.fieldTypeOverrides,
			oldName,
			newName
		) as Record<string, FieldType>,
		fieldLevelOrders: renameKey(state.fieldLevelOrders, oldName, newName),
		channelConfigs,
		dataLabelsConfig,
		tooltipConfig,
		derivedVariablesConfig,
	} as Partial<T>)
}

/** Melted-mode rewrite: the old name is a CELL VALUE of the minted
 * `variableName` column, so swap the value key in every value-keyed map
 * whose driving channel maps that column. */
const renameMeltedValueRefs = <T extends FieldNameConfigs>(
	state: T,
	variableName: string,
	oldName: string,
	newName: string
): T => {
	// Saved visuals from before a channel existed lack its encoding entry
	// (the empty-encodings merge happens on LOAD, not in storage), so every
	// channel read here goes through this null-safe accessor.
	const enc = state.encodings as Partial<Encodings>
	const drives = (e: { field: string | null } | undefined): boolean =>
		e?.field === variableName

	const cc = state.channelConfigs
	const swapHue = (
		hue: ChannelConfigs["hue"],
		when: boolean
	): ChannelConfigs["hue"] =>
		when && hue?.kind === "categorical"
			? patched(hue, { colors: renameKey(hue.colors, oldName, newName) ?? hue.colors })
			: hue
	const channelConfigs = patched(cc, {
		hue: swapHue(cc.hue, drives(enc.hue)),
		hueCategoricalStash: swapHue(
			cc.hueCategoricalStash,
			drives(enc.hue)
		) as ChannelConfigs["hueCategoricalStash"],
		outlineHue: swapHue(cc.outlineHue, drives(enc.outlineHue)),
		saturation:
			drives(enc.saturation) && cc.saturation
				? patched(cc.saturation, {
						overrides: renameKey(cc.saturation.overrides, oldName, newName),
					})
				: cc.saturation,
		brightness:
			drives(enc.brightness) && cc.brightness
				? patched(cc.brightness, {
						overrides: renameKey(cc.brightness.overrides, oldName, newName),
					})
				: cc.brightness,
		area:
			drives(enc.area) && cc.area
				? patched(cc.area, {
						overrides: renameKey(cc.area.overrides, oldName, newName),
					})
				: cc.area,
		opacity:
			drives(enc.opacity) && cc.opacity?.kind === "categorical"
				? patched(cc.opacity, {
						overrides:
							renameKey(cc.opacity.overrides, oldName, newName) ??
							cc.opacity.overrides,
					})
				: cc.opacity,
		pattern:
			drives(enc.pattern) && cc.pattern
				? patched(cc.pattern, {
						overrides:
							renameKey(cc.pattern.overrides, oldName, newName) ??
							cc.pattern.overrides,
						dashOverrides: renameKey(cc.pattern.dashOverrides, oldName, newName),
						customDashOverrides: renameKey(
							cc.pattern.customDashOverrides,
							oldName,
							newName
						),
						inkColors:
							renameKey(cc.pattern.inkColors, oldName, newName) ??
							cc.pattern.inkColors,
					})
				: cc.pattern,
		shape:
			drives(enc.shape) && cc.shape
				? patched(cc.shape, {
						overrides:
							renameKey(cc.shape.overrides, oldName, newName) ??
							cc.shape.overrides,
						fillOverrides: renameKey(cc.shape.fillOverrides, oldName, newName),
						strokeOverrides: renameKey(
							cc.shape.strokeOverrides,
							oldName,
							newName
						),
					})
				: cc.shape,
		connection:
			drives(enc.connection) && cc.connection
				? patched(cc.connection, {
						lineColors:
							renameKey(cc.connection.lineColors, oldName, newName) ??
							cc.connection.lineColors,
						thicknessByValue: renameKey(
							cc.connection.thicknessByValue,
							oldName,
							newName
						),
						dashPatterns:
							renameKey(cc.connection.dashPatterns, oldName, newName) ??
							cc.connection.dashPatterns,
						dashAlternateColors:
							renameKey(cc.connection.dashAlternateColors, oldName, newName) ??
							cc.connection.dashAlternateColors,
					})
				: cc.connection,
		text:
			drives(enc.text) && cc.text
				? patched(cc.text, {
						colorOverrides:
							renameKey(cc.text.colorOverrides, oldName, newName) ??
							cc.text.colorOverrides,
					})
				: cc.text,
		facet: cc.facet
			? patched(cc.facet, {
					...(drives(enc.facet)
						? {
								panelAxisOverrides:
									renameKey(cc.facet.panelAxisOverrides, oldName, newName) ??
									cc.facet.panelAxisOverrides,
								panelRAxisOverrides: renameKey(
									cc.facet.panelRAxisOverrides,
									oldName,
									newName
								),
								panelOrder:
									renameKey(cc.facet.panelOrder, oldName, newName) ??
									cc.facet.panelOrder,
							}
						: {}),
					...(drives(enc.facetRow)
						? {
								rowAxisOverrides: renameKey(
									cc.facet.rowAxisOverrides,
									oldName,
									newName
								),
								rowRAxisOverrides: renameKey(
									cc.facet.rowRAxisOverrides,
									oldName,
									newName
								),
							}
						: {}),
					...(drives(enc.facetCol)
						? {
								colAxisOverrides: renameKey(
									cc.facet.colAxisOverrides,
									oldName,
									newName
								),
								colRAxisOverrides: renameKey(
									cc.facet.colRAxisOverrides,
									oldName,
									newName
								),
							}
						: {}),
				})
			: cc.facet,
		colorSlots: mapRecordValues(slotsAsRecord(cc.colorSlots), (s) =>
			renameSlotValues(s, variableName, oldName, newName)
		) as ChannelConfigs["colorSlots"],
		opacitySlots: mapRecordValues(slotsAsRecord(cc.opacitySlots), (s) =>
			renameSlotValues(s, variableName, oldName, newName)
		) as ChannelConfigs["opacitySlots"],
	})

	const anyFacetDriven =
		drives(enc.facet) ||
		drives(enc.facetRow) ||
		drives(enc.facetCol)

	const labelsConfig =
		anyFacetDriven && state.labelsConfig
			? patched(state.labelsConfig, {
					facetTitleColors: renameKey(
						state.labelsConfig.facetTitleColors,
						oldName,
						newName
					),
				})
			: state.labelsConfig

	const ac = state.annotationsConfig
	const swapFacetKeys = <A extends { facetKeys?: string[] | null }>(
		items: A[] | undefined
	): A[] | undefined =>
		items &&
		(items.some((a) => a.facetKeys?.includes(oldName))
			? items.map((a) =>
					a.facetKeys?.includes(oldName)
						? {
								...a,
								facetKeys: a.facetKeys.map((k) =>
									k === oldName ? newName : k
								),
							}
						: a
				)
			: items)
	const annotationsConfig =
		anyFacetDriven && ac
			? patched(ac, {
					rectangles: swapFacetKeys(ac.rectangles) ?? ac.rectangles,
					circles: swapFacetKeys(ac.circles),
					lineSegments: swapFacetKeys(ac.lineSegments),
					texts: swapFacetKeys(ac.texts),
				})
			: ac

	const dle = state.dataLabelsEncodings
	const dlc = state.dataLabelsConfig
	const dataLabelsConfig =
		dle && drives(dle.hue) && dlc
			? patched(dlc, {
					colorOverrides:
						renameKey(dlc.colorOverrides, oldName, newName) ??
						dlc.colorOverrides,
				})
			: dlc

	const levelOrder = state.fieldLevelOrders?.[variableName]
	const fieldLevelOrders =
		levelOrder?.includes(oldName) && state.fieldLevelOrders
			? {
					...state.fieldLevelOrders,
					[variableName]: levelOrder.map((v) =>
						v === oldName ? newName : v
					),
				}
			: state.fieldLevelOrders

	return patched(state, {
		channelConfigs,
		labelsConfig,
		annotationsConfig,
		dataLabelsConfig,
		fieldLevelOrders,
	} as Partial<T>)
}

/** Rewrite one visual-state slice for a dataset-field rename. `datasetFields`
 * must be the PRE-rename field list (the old name still present) — it decides,
 * together with this state's own reshape config, whether the renamed field is
 * a melted column here. Returns the same reference when nothing changed. */
export const renameFieldInConfigs = <T extends FieldNameConfigs>(
	state: T,
	datasetFields: Field[],
	oldName: string,
	newName: string
): T => {
	const rc = state.reshapeConfig
	const melted =
		rc !== undefined &&
		reshapeApplies(datasetFields, rc) &&
		presentMeltFields(datasetFields, rc).some((f) => f.name === oldName)

	const reshapeConfig = rc
		? patched(rc, {
				idFields: renameInList(rc.idFields, oldName, newName) ?? rc.idFields,
				meltFields:
					renameInList(rc.meltFields, oldName, newName) ?? rc.meltFields,
			})
		: rc

	const base = patched(state, { reshapeConfig } as Partial<T>)
	return melted
		? renameMeltedValueRefs(
				base,
				effectiveVariableName(rc),
				oldName,
				newName
			)
		: renameViewFieldRefs(base, oldName, newName)
}

/** `renameFieldInConfigs` over a saved Visual. Same reference when nothing
 * in the visual mentions the old name (so the library sweep can skip the
 * write entirely when no visual changed). Timestamps are left alone — a
 * rename is a consistency rewrite, not an edit of the visual. */
export const renameFieldInVisual = (
	visual: Visual,
	datasetFields: Field[],
	oldName: string,
	newName: string
): Visual => renameFieldInConfigs(visual, datasetFields, oldName, newName)
