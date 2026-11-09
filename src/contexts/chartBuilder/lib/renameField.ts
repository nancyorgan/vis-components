import type {
	ChannelConfigs,
	ColorSlotConfig,
	DataLabelsConfig,
	LabelPieceStyle,
	ModulationSlotConfig,
	OpacitySlotConfig,
} from "./channelConfig"
import type { AnnotationsConfig } from "./annotationsConfig"
import type { FacetPanelRef } from "./facetPanelRef"
import type {
	DerivedVariable,
	DerivedVariablesConfig,
} from "./derivedVariables"
import type { LabelsConfig, TooltipConfig } from "./labelsConfig"
import type { PivotConfig, PivotGroup } from "./pivot"
import {
	meltVariableNameOf,
	reshapeApplies,
	type ReshapeConfig,
	type ReshapeGroup,
} from "./reshape"
import type {
	DataLabelsEncodings,
	Encodings,
	Field,
	FieldLevelOrderSpec,
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

/** Rename inside the split-piece map (label id → variable → style): a
 *  default label's id IS the variable's name, so the outer key moves with
 *  the field; the inner key is the variable itself; and a piece's color
 *  slot can vary by the renamed field. Same reference when nothing
 *  matches. */
const renamePieces = (
	pieces: Record<string, Record<string, LabelPieceStyle>> | undefined,
	oldName: string,
	newName: string
): Record<string, Record<string, LabelPieceStyle>> | undefined => {
	if (!pieces) return pieces
	let changed = false
	const out: Record<string, Record<string, LabelPieceStyle>> = {}
	for (const [labelId, byField] of Object.entries(pieces)) {
		const nextByField: Record<string, LabelPieceStyle> = {}
		for (const [field, style] of Object.entries(byField)) {
			const color = style.color
				? renameSlotField(style.color, oldName, newName)
				: style.color
			const nextStyle = patched(style, {
				color,
				colorRules: renameRuleTokens(style.colorRules, oldName, newName),
			})
			const nextField = field === oldName ? newName : field
			if (nextStyle !== style || nextField !== field) changed = true
			nextByField[nextField] = nextStyle
		}
		const nextId = labelId === oldName ? newName : labelId
		if (nextId !== labelId) changed = true
		out[nextId] = nextByField
	}
	return changed ? out : pieces
}

/** Swap a value in a string array. Same reference when absent. */
const renameInList = (
	list: string[] | undefined,
	oldName: string,
	newName: string
): string[] | undefined =>
	list?.includes(oldName)
		? list.map((v) => (v === oldName ? newName : v))
		: list

/** Rewrite the "Order by" picker memories for a field rename: the map key
 * (the field whose levels were ordered) plus the variable references inside
 * each spec — the ordered-by field and the scope variable. Passing
 * `meltedVariable` switches to the melted case: the old name is a cell value
 * of that column, so only a scope LEVEL scoped to it moves. Same reference when
 * nothing mentions the old name. */
const renameOrderSpecs = (
	specs: Record<string, FieldLevelOrderSpec> | undefined,
	oldName: string,
	newName: string,
	meltedVariable?: string
): Record<string, FieldLevelOrderSpec> | undefined => {
	if (!specs) return specs
	// Keys are FIELD names, so they only move in the column-rename case; in
	// the melted case the old name is a cell value and a same-named key is a
	// coincidence, not a reference.
	const keyed = meltedVariable
		? specs
		: (renameKey(specs, oldName, newName) ?? specs)
	let changed = keyed !== specs
	const next: Record<string, FieldLevelOrderSpec> = {}
	for (const [key, spec] of Object.entries(keyed)) {
		const patch: FieldLevelOrderSpec = { ...spec }
		if (meltedVariable === undefined) {
			if (spec.byField === oldName) patch.byField = newName
			if (spec.scopeField === oldName) patch.scopeField = newName
		} else if (
			spec.scopeField === meltedVariable &&
			spec.scopeLevel === oldName
		) {
			patch.scopeLevel = newName
		}
		const touched =
			patch.byField !== spec.byField ||
			patch.scopeField !== spec.scopeField ||
			patch.scopeLevel !== spec.scopeLevel
		changed = changed || touched
		next[key] = touched ? patch : spec
	}
	return changed ? next : specs
}

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

/** Swap `{Old}` tokens in a conditional-rule list's conditions (text-color,
 * position, outline-color rules — `{Region} == West`). Same reference when
 * no condition mentions the old name. */
const renameRuleTokens = <R extends { condition: string }>(
	rules: R[] | undefined,
	oldName: string,
	newName: string
): R[] | undefined =>
	rules &&
	mapItems(rules, (r) => {
		const condition = renameLabelTokens(r.condition, oldName, newName)
		return condition === r.condition || condition === undefined
			? r
			: { ...r, condition }
	})

/** Merge `patch` onto `base`, but return `base` itself when every patched
 * property is already the same reference — the no-op detector the whole
 * rewrite is built on. */
const patched = <T extends object>(base: T, patch: Partial<T>): T => {
	for (const [k, v] of Object.entries(patch)) {
		if ((base as Record<string, unknown>)[k] !== v) return { ...base, ...patch }
	}
	return base
}

/** Swap `{Old}` tokens inside one derived variable — its Math formula,
 * Combine-text template, and If/else conditions, outputs and fallback. The
 * variable's own NAME is left alone (renaming the variable is the caller's
 * decision). Same reference when nothing mentions the old name. */
export const renameDerivedVariableTokens = (
	v: DerivedVariable,
	oldName: string,
	newName: string
): DerivedVariable =>
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
							output:
								renameLabelTokens(r.output, oldName, newName) ?? r.output,
						})
					),
					fallback:
						renameLabelTokens(v.rules.fallback, oldName, newName) ??
						v.rules.fallback,
				})
			: v.rules,
	})

/** Swap a column in a reshape's ID / Combine membership lists — every
 * group's. Same reference when none lists the old name. */
export const renameReshapeFields = (
	rc: ReshapeConfig,
	oldName: string,
	newName: string
): ReshapeConfig => {
	let extraGroups = rc.extraGroups
	if (extraGroups) {
		let changed = false
		const next = extraGroups.map((g): ReshapeGroup => {
			const out = patched(g, {
				meltFields: renameInList(g.meltFields, oldName, newName) ?? g.meltFields,
			})
			if (out !== g) changed = true
			return out
		})
		if (changed) extraGroups = next
	}
	return patched(rc, {
		idFields: renameInList(rc.idFields, oldName, newName) ?? rc.idFields,
		meltFields: renameInList(rc.meltFields, oldName, newName) ?? rc.meltFields,
		...(extraGroups !== rc.extraGroups ? { extraGroups } : {}),
	})
}

/** Swap a column in a long→wide pivot's ID / Split-out / Value lists —
 * every group's. Same reference when none lists the old name. The minted
 * column names are data values, not config — they don't rename. */
export const renamePivotFields = (
	pc: PivotConfig,
	oldName: string,
	newName: string
): PivotConfig => {
	let extraGroups = pc.extraGroups
	if (extraGroups) {
		let changed = false
		const next = extraGroups.map((g): PivotGroup => {
			const out = patched(g, {
				keyFields: renameInList(g.keyFields, oldName, newName) ?? g.keyFields,
				valueFields: renameInList(g.valueFields, oldName, newName) ?? g.valueFields,
			})
			if (out !== g) changed = true
			return out
		})
		if (changed) extraGroups = next
	}
	return patched(pc, {
		idFields: renameInList(pc.idFields, oldName, newName) ?? pc.idFields,
		keyFields: renameInList(pc.keyFields, oldName, newName) ?? pc.keyFields,
		valueFields: renameInList(pc.valueFields, oldName, newName) ?? pc.valueFields,
		...(extraGroups !== pc.extraGroups ? { extraGroups } : {}),
	})
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
	fieldLevelOrderSpecs?: Record<string, FieldLevelOrderSpec>
	fieldOrder?: string[]
	channelConfigs: ChannelConfigs
	labelsConfig?: LabelsConfig
	dataLabelsConfig?: DataLabelsConfig
	tooltipConfig?: TooltipConfig
	reshapeConfig?: ReshapeConfig
	annotationsConfig?: AnnotationsConfig
	derivedVariablesConfig?: DerivedVariablesConfig
}

const renameSlotField = <S extends ColorSlotConfig | OpacitySlotConfig | ModulationSlotConfig>(
	slot: S,
	oldName: string,
	newName: string
): S => (slot.field === oldName ? { ...slot, field: newName } : slot)

/** A color slot's `{Variable}` rule tokens follow the rename too (the Line
 * slot's color rules). Identity-preserving when nothing changes. */
const renameColorSlot = (
	slot: ColorSlotConfig,
	oldName: string,
	newName: string
): ColorSlotConfig => {
	const moved = renameSlotField(slot, oldName, newName)
	const colorRules = renameRuleTokens(moved.colorRules, oldName, newName)
	return colorRules === moved.colorRules ? moved : { ...moved, colorRules }
}

/** Rename the value-key in a slot's per-value map when the slot itself is
 * driven by `drivingField` (melted-rename case). */
const renameSlotValues = <S extends ColorSlotConfig | OpacitySlotConfig | ModulationSlotConfig>(
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
	if ("range" in slot && slot.range?.overrides) {
		const overrides = renameKey(slot.range.overrides, oldName, newName)
		if (overrides !== slot.range.overrides)
			return { ...slot, range: { ...slot.range, overrides } }
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
				hue: swapEnc(dle.hue),
				size: swapEnc(dle.size),
				value: patched(swapEnc(dle.value), {
					fields: renameInList(dle.value.fields, oldName, newName),
				}),
				geography: dle.geography ? swapEnc(dle.geography) : dle.geography,
			})
		: dle

	const cc = state.channelConfigs
	// Axis-level field references: the regression's per-group split and the
	// mirrored axis's two-level direction field.
	const swapAxis = (axis: ChannelConfigs["x"]): ChannelConfigs["x"] =>
		axis
			? patched(axis, {
					regression:
						axis.regression?.groupField === oldName
							? { ...axis.regression, groupField: newName }
							: axis.regression,
					mirror:
						axis.mirror?.directionField === oldName
							? { ...axis.mirror, directionField: newName }
							: axis.mirror,
					tickLabelColorRules: renameRuleTokens(
						axis.tickLabelColorRules,
						oldName,
						newName
					),
				})
			: axis
	const channelConfigs = patched(cc, {
		x: swapAxis(cc.x),
		y: swapAxis(cc.y),
		r: swapAxis(cc.r),
		fillColorRules: renameRuleTokens(cc.fillColorRules, oldName, newName),
		connection: cc.connection
			? patched(cc.connection, {
					hierarchyIdField:
						cc.connection.hierarchyIdField === oldName
							? newName
							: cc.connection.hierarchyIdField,
					flowTargetField:
						cc.connection.flowTargetField === oldName
							? newName
							: cc.connection.flowTargetField,
					thicknessField:
						cc.connection.thicknessField === oldName
							? newName
							: cc.connection.thicknessField,
				})
			: cc.connection,
		// Segment "Vary by" field. Its `segmentThicknessByValue` map (like
		// `connection.thicknessByValue`) is keyed by the field's VALUES, which
		// a column rename doesn't touch.
		length:
			cc.length && cc.length.segmentThicknessField === oldName
				? { ...cc.length, segmentThicknessField: newName }
				: cc.length,
		shape: cc.shape
			? patched(cc.shape, {
					outlineColorRules: renameRuleTokens(
						cc.shape.outlineColorRules,
						oldName,
						newName
					),
				})
			: cc.shape,
		drawOrder:
			cc.drawOrder && cc.drawOrder.field === oldName
				? { ...cc.drawOrder, field: newName }
				: cc.drawOrder,
		colorSlots: mapRecordValues(slotsAsRecord(cc.colorSlots), (s) =>
			renameColorSlot(s, oldName, newName)
		) as ChannelConfigs["colorSlots"],
		opacitySlots: mapRecordValues(slotsAsRecord(cc.opacitySlots), (s) =>
			renameSlotField(s, oldName, newName)
		) as ChannelConfigs["opacitySlots"],
		saturationSlots: mapRecordValues(slotsAsRecord(cc.saturationSlots), (s) =>
			renameSlotField(s, oldName, newName)
		) as ChannelConfigs["saturationSlots"],
		brightnessSlots: mapRecordValues(slotsAsRecord(cc.brightnessSlots), (s) =>
			renameSlotField(s, oldName, newName)
		) as ChannelConfigs["brightnessSlots"],
	})

	const dlc = state.dataLabelsConfig
	const dataLabelsConfig = dlc
		? patched(dlc, {
				labelTemplate: renameLabelTokens(dlc.labelTemplate, oldName, newName),
				fieldFormats: renameKey(dlc.fieldFormats, oldName, newName),
				fieldLabelPoints: renameKey(dlc.fieldLabelPoints, oldName, newName),
				fieldLabelPointsScope: renameKey(
					dlc.fieldLabelPointsScope,
					oldName,
					newName
				),
				// Keyed by the composed label's id; the VALUES are facet panel
				// keys (facet values), which a field rename doesn't touch.
				fieldFacetKeys: renameKey(dlc.fieldFacetKeys, oldName, newName),
				pieceSplits: renameKey(dlc.pieceSplits, oldName, newName),
				fieldColors: mapRecordValues(
					renameKey(dlc.fieldColors, oldName, newName),
					(s) => renameSlotField(s, oldName, newName)
				) as Record<string, ColorSlotConfig> | undefined,
				fieldColorRules: mapRecordValues(
					renameKey(dlc.fieldColorRules, oldName, newName),
					(rules) => renameRuleTokens(rules, oldName, newName) ?? rules
				) as DataLabelsConfig["fieldColorRules"],
				textColorRules: renameRuleTokens(dlc.textColorRules, oldName, newName),
				positionRules: renameRuleTokens(dlc.positionRules, oldName, newName),
				fieldSizes: renameKey(dlc.fieldSizes, oldName, newName),
				fieldFonts: renameKey(dlc.fieldFonts, oldName, newName),
				fieldBackgrounds: renameKey(dlc.fieldBackgrounds, oldName, newName),
				pieces: renamePieces(dlc.pieces, oldName, newName),
				fieldAlignments: renameKey(dlc.fieldAlignments, oldName, newName),
				fieldOffsets: renameKey(dlc.fieldOffsets, oldName, newName),
				fieldBarPlacements: renameKey(dlc.fieldBarPlacements, oldName, newName),
				fieldPolarPlacements: renameKey(dlc.fieldPolarPlacements, oldName, newName),
				fieldLayouts: renameKey(dlc.fieldLayouts, oldName, newName),
				fieldLayers: renameKey(dlc.fieldLayers, oldName, newName),
				// A default label's id IS the variable's name, so the key moves
				// with the field; every template swaps its tokens.
				composedLabels:
					dlc.composedLabels &&
					mapItems(dlc.composedLabels, (l) =>
						patched(l, {
							id: l.id === oldName ? newName : l.id,
							template:
								renameLabelTokens(l.template, oldName, newName) ?? l.template,
						})
					),
				fieldPositionRules: mapRecordValues(
					renameKey(dlc.fieldPositionRules, oldName, newName),
					(rules) => renameRuleTokens(rules, oldName, newName) ?? rules
				) as DataLabelsConfig["fieldPositionRules"],
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
	// math formulas, concat templates, rule conditions, and the rule
	// outputs/fallback templates alike. (In melted
	// mode this is deliberately NOT run — like every other view-field surface;
	// a melt column's name only appears in expressions as a string literal,
	// and literals are never rewritten anywhere.)
	const dv = state.derivedVariablesConfig
	const derivedVariablesConfig = dv
		? patched(dv, {
				variables: mapItems(dv.variables, (v) =>
					renameDerivedVariableTokens(v, oldName, newName)
				),
			})
		: dv

	const tc = state.tooltipConfig
	const tooltipConfig = tc
		? patched(tc, {
				visibleFields:
					renameInList(tc.visibleFields, oldName, newName) ??
					tc.visibleFields,
				// `customHtml` is optional on partial / pre-default stored
				// configs; a missing template has nothing to rename.
				customHtml: tc.customHtml?.includes(`{{${oldName}}}`)
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
		fieldOrder: renameInList(state.fieldOrder, oldName, newName) ?? state.fieldOrder,
		fieldLevelOrderSpecs: renameOrderSpecs(
			state.fieldLevelOrderSpecs,
			oldName,
			newName
		),
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
						scales: renameKey(cc.pattern.scales, oldName, newName),
						polygonOverrides: renameKey(
							cc.pattern.polygonOverrides,
							oldName,
							newName
						),
						polygonInkColors: renameKey(
							cc.pattern.polygonInkColors,
							oldName,
							newName
						),
						polygonScales: renameKey(cc.pattern.polygonScales, oldName, newName),
						violinOverrides: renameKey(
							cc.pattern.violinOverrides,
							oldName,
							newName
						),
						violinInkColors: renameKey(
							cc.pattern.violinInkColors,
							oldName,
							newName
						),
						violinScales: renameKey(cc.pattern.violinScales, oldName, newName),
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
		connection: cc.connection
			? patched(cc.connection, {
					...(drives(enc.connection)
						? {
								lineColors:
									renameKey(cc.connection.lineColors, oldName, newName) ??
									cc.connection.lineColors,
								dashPatterns:
									renameKey(cc.connection.dashPatterns, oldName, newName) ??
									cc.connection.dashPatterns,
								dashAlternateColors:
									renameKey(cc.connection.dashAlternateColors, oldName, newName) ??
									cc.connection.dashAlternateColors,
							}
						: {}),
					// The thickness map is keyed by the Vary-by field's values when
					// one is set, else by the connection field's — whichever drives
					// it decides whether this melted rename touches its keys.
					...((cc.connection.thicknessField ?? enc.connection?.field) === variableName
						? {
								thicknessByValue: renameKey(
									cc.connection.thicknessByValue,
									oldName,
									newName
								),
							}
						: {}),
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
								// Grid per-panel bounds: row value is the outer key.
								gridPanelAxisOverrides: renameKey(
									cc.facet.gridPanelAxisOverrides,
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
								// Grid per-panel bounds: column value is the inner key.
								gridPanelAxisOverrides: mapRecordValues(
									cc.facet.gridPanelAxisOverrides,
									(byCol) => renameKey(byCol, oldName, newName) ?? byCol
								) as NonNullable<
									ChannelConfigs["facet"]
								>["gridPanelAxisOverrides"],
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
		saturationSlots: mapRecordValues(slotsAsRecord(cc.saturationSlots), (s) =>
			renameSlotValues(s, variableName, oldName, newName)
		) as ChannelConfigs["saturationSlots"],
		brightnessSlots: mapRecordValues(slotsAsRecord(cc.brightnessSlots), (s) =>
			renameSlotValues(s, variableName, oldName, newName)
		) as ChannelConfigs["brightnessSlots"],
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
	// A facet scope names panels by facet VALUE: a wrap value as a string,
	// a grid panel as its row / column pair — each side moves only when its
	// own facet field is the renamed (melted) variable.
	const swapRef = (ref: FacetPanelRef): FacetPanelRef => {
		if (typeof ref === "string") return ref === oldName ? newName : ref
		const row = drives(enc.facetRow) && ref.row === oldName ? newName : ref.row
		const col = drives(enc.facetCol) && ref.col === oldName ? newName : ref.col
		return row === ref.row && col === ref.col ? ref : { row, col }
	}
	const swapFacetKeys = <A extends { facetKeys?: FacetPanelRef[] | null }>(
		items: A[] | undefined
	): A[] | undefined => {
		if (!items) return items
		let changed = false
		const next = items.map((a) => {
			const own = a.facetKeys
			if (!own) return a
			const keys = own.map(swapRef)
			if (!keys.some((k, i) => k !== own[i])) return a
			changed = true
			return { ...a, facetKeys: keys }
		})
		return changed ? next : items
	}
	const annotationsConfig =
		anyFacetDriven && ac
			? patched(ac, {
					rectangles: swapFacetKeys(ac.rectangles) ?? ac.rectangles,
					circles: swapFacetKeys(ac.circles),
					lineSegments: swapFacetKeys(ac.lineSegments),
					texts: swapFacetKeys(ac.texts),
					images: swapFacetKeys(ac.images),
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
		// A renamed melted VALUE can also be the scope level a level order was
		// computed "in" — the picker memory has to follow it or the restored
		// controls point at a level that no longer exists.
		fieldLevelOrderSpecs: renameOrderSpecs(
			state.fieldLevelOrderSpecs,
			oldName,
			newName,
			variableName
		),
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
	// The variable column the renamed field's NAME lands in, when the field
	// is a melted column of an applying reshape (its combining group's).
	const meltedInto =
		rc !== undefined && reshapeApplies(datasetFields, rc)
			? meltVariableNameOf(datasetFields, rc, oldName)
			: undefined

	const reshapeConfig = rc ? renameReshapeFields(rc, oldName, newName) : rc

	const base = patched(state, { reshapeConfig } as Partial<T>)
	return meltedInto !== undefined
		? renameMeltedValueRefs(base, meltedInto, oldName, newName)
		: renameViewFieldRefs(base, oldName, newName)
}

/** Prefix of the scratch names `remapFieldsInConfigs` routes every pair
 * through. Never observable in its result. */
const REMAP_TEMP_PREFIX = "__remap_"

/** Apply a whole field-name mapping (`old → new`) to one visual-state slice
 * at once — every pair SIMULTANEOUSLY, so `{ A: "B", B: "A" }` swaps cleanly
 * and rotations work. Used to re-bind a visual's fields onto a different data
 * set. Identity pairs are skipped; an empty / all-identity mapping returns
 * `state` itself.
 *
 * Done as two `renameFieldInConfigs` passes through collision-free temporary
 * names (old → temp, then temp → new), with the `datasetFields` list renamed
 * in lockstep so the standard/melted mode decision and the melt lookups see
 * the names the state currently holds. `datasetFields` must be the field
 * list the state's CURRENT names refer to (the mapping's keys). A target
 * that is already some OTHER field's name (and isn't itself remapped away)
 * merges onto it — callers pick collision-free targets. Throws if any
 * dataset-field or mapping name already contains the temporary prefix. */
export const remapFieldsInConfigs = <T extends FieldNameConfigs>(
	state: T,
	datasetFields: Field[],
	mapping: Record<string, string>
): T => {
	const pairs = Object.entries(mapping).filter(([from, to]) => from !== to)
	if (pairs.length === 0) return state

	const clash = [...datasetFields.map((f) => f.name), ...pairs.flat()].find(
		(n) => n.includes(REMAP_TEMP_PREFIX)
	)
	if (clash !== undefined)
		throw new Error(
			`remapFieldsInConfigs: name "${clash}" collides with the temporary-name prefix "${REMAP_TEMP_PREFIX}".`
		)

	// Plain name swap for the lockstep list — no `sourceNames` bookkeeping
	// (unlike `renameDatasetField`), so temporary names never leak into a
	// field's alias history.
	const renameFields = (fields: Field[], from: string, to: string): Field[] =>
		fields.map((f) => (f.name === from ? { ...f, name: to } : f))

	const temps = pairs.map((_, i) => `${REMAP_TEMP_PREFIX}${i}__`)
	let out = state
	let fields = datasetFields
	pairs.forEach(([from], i) => {
		out = renameFieldInConfigs(out, fields, from, temps[i])
		fields = renameFields(fields, from, temps[i])
	})
	pairs.forEach(([, to], i) => {
		out = renameFieldInConfigs(out, fields, temps[i], to)
		fields = renameFields(fields, temps[i], to)
	})
	return out
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
