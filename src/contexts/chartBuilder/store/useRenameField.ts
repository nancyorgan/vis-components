import type { Getter, Setter } from "jotai"
import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { withFreshContentHash } from "../lib/datasetDedupe"
import { effectiveDerivedName } from "../lib/derivedVariables"
import {
	fieldRenameError,
	renameDatasetField,
	renameFieldInConfigs,
	renameFieldInVisual,
	type FieldNameConfigs,
} from "../lib/renameField"
import type { Field } from "../lib/types"

import { currentDatasetViewAtom } from "./useCurrentDatasetView"

import {
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
	currentDerivedVariablesAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
	currentLabelsAtom,
	currentReshapeConfigAtom,
	currentTooltipConfigAtom,
	datasetIndexAtom,
	mutateDatasetBodyAtom,
	visualsAtom,
} from "./atoms"

export type RenameFieldResult = { ok: true } | { ok: false; error: string }

/** Rewrite every open-editor atom for a field rename: assemble the state
 * slice from the atoms, run `renameFieldInConfigs` once, and write back only
 * the pieces that changed. Shared between the Fields-panel rename (which
 * also mutates the dataset and sweeps saved visuals) and the derived-
 * variable editor's rename (per-visual scope — a derived name can only be
 * referenced by the visual that defines it, so the editor atoms are the
 * whole job). `datasetFields` decides melted-vs-standard mode, exactly as
 * in `renameFieldInConfigs`. */
export const renameFieldAcrossEditorAtoms = (
	get: Getter,
	set: Setter,
	datasetFields: Field[],
	oldName: string,
	newName: string
): void => {
	const state: Required<FieldNameConfigs> = {
		encodings: get(currentEncodingsAtom),
		dataLabelsEncodings: get(currentDataLabelsEncodingsAtom),
		fieldTypeOverrides: get(currentFieldOverridesAtom),
		fieldLevelOrders: get(currentFieldLevelOrdersAtom),
		channelConfigs: get(currentChannelConfigsAtom),
		labelsConfig: get(currentLabelsAtom),
		dataLabelsConfig: get(currentDataLabelsConfigAtom),
		tooltipConfig: get(currentTooltipConfigAtom),
		reshapeConfig: get(currentReshapeConfigAtom),
		annotationsConfig: get(currentAnnotationsAtom),
		derivedVariablesConfig: get(currentDerivedVariablesAtom),
	}
	const next = renameFieldInConfigs(state, datasetFields, oldName, newName)
	if (next === state) return
	if (next.encodings !== state.encodings)
		set(currentEncodingsAtom, next.encodings)
	if (next.dataLabelsEncodings !== state.dataLabelsEncodings)
		set(currentDataLabelsEncodingsAtom, next.dataLabelsEncodings)
	if (next.fieldTypeOverrides !== state.fieldTypeOverrides)
		set(currentFieldOverridesAtom, next.fieldTypeOverrides)
	if (next.fieldLevelOrders !== state.fieldLevelOrders)
		set(currentFieldLevelOrdersAtom, next.fieldLevelOrders)
	if (next.channelConfigs !== state.channelConfigs)
		set(currentChannelConfigsAtom, next.channelConfigs)
	if (next.labelsConfig !== state.labelsConfig)
		set(currentLabelsAtom, next.labelsConfig)
	if (next.dataLabelsConfig !== state.dataLabelsConfig)
		set(currentDataLabelsConfigAtom, next.dataLabelsConfig)
	if (next.tooltipConfig !== state.tooltipConfig)
		set(currentTooltipConfigAtom, next.tooltipConfig)
	if (next.reshapeConfig !== state.reshapeConfig)
		set(currentReshapeConfigAtom, next.reshapeConfig)
	if (next.annotationsConfig !== state.annotationsConfig)
		set(currentAnnotationsAtom, next.annotationsConfig)
	if (next.derivedVariablesConfig !== state.derivedVariablesConfig)
		set(currentDerivedVariablesAtom, next.derivedVariablesConfig)
}

/** Rename a DERIVED variable (Fields panel click-to-edit — the same inline
 * affordance dataset fields get; the ƒ pill is where the calculation itself
 * is edited). Unlike a dataset-field rename there is no dataset to mutate and
 * no sibling-visual sweep — a derived name is per-visual, so the variable's
 * own `name` plus this editor's config references are the whole job. */
export const useRenameDerivedVariable = () => {
	return useAtomCallback(
		useCallback(
			(
				get,
				set,
				id: string,
				rawNewName: string
			): RenameFieldResult => {
				const newName = rawNewName.trim()
				if (newName === "") return { ok: false, error: "Enter a name." }
				const config = get(currentDerivedVariablesAtom)
				const index = config.variables.findIndex((v) => v.id === id)
				if (index === -1)
					return { ok: false, error: "This derived variable no longer exists." }
				const oldName = effectiveDerivedName(config.variables[index], index)
				if (newName === oldName) return { ok: true }
				// Collision check against everything visible: the final view's
				// columns (dataset + reshape-minted + applied derived) plus every
				// other derived variable's name, applied or not.
				const taken = new Set(
					get(currentDatasetViewAtom)?.fields.map((f) => f.name) ?? []
				)
				config.variables.forEach((v, i) => {
					if (i !== index) taken.add(effectiveDerivedName(v, i))
				})
				taken.delete(oldName)
				if (taken.has(newName))
					return {
						ok: false,
						error: `Another variable is already named "${newName}".`,
					}
				set(currentDerivedVariablesAtom, {
					variables: config.variables.map((v, i) =>
						i === index ? { ...v, name: newName } : v
					),
				})
				const datasetId = get(currentDatasetIdAtom)
				const fields = datasetId
					? (get(datasetIndexAtom)[datasetId]?.fields ?? [])
					: []
				renameFieldAcrossEditorAtoms(get, set, fields, oldName, newName)
				return { ok: true }
			},
			[]
		)
	)
}

/** Rename a variable of the CURRENT dataset (Fields panel click-to-edit).
 *
 * One action, three writes:
 *  1. The dataset: the field takes the new name and remembers the old one in
 *     `sourceNames` (stored rows are never rewritten — `resolveDatasetView`
 *     remaps old row keys at view time, and `diffFields` matches later
 *     uploads on either name). Content hash refreshed, like every fields
 *     mutation.
 *  2. The open editor's atoms, through `renameFieldInConfigs` — encodings,
 *     per-field maps, templates, reshape membership, melted value keys.
 *  3. Every SAVED visual bound to this dataset, through the same rewrite —
 *     a rename is a property of the dataset, so sibling visuals must not be
 *     left pointing at a name that no longer exists. Skipped entirely when
 *     no visual mentions the old name. */
export const useRenameField = () => {
	return useAtomCallback(
		useCallback(
			async (get, set, oldName: string, rawNewName: string): Promise<RenameFieldResult> => {
				const newName = rawNewName.trim()
				if (newName === oldName) return { ok: true }
				const datasetId = get(currentDatasetIdAtom)
				if (!datasetId) return { ok: false, error: "No data set is bound." }
				// The INDEX has every dataset's fields without loading rows —
				// and we need the PRE-rename list below, so snapshot it first.
				const fields: Field[] = get(datasetIndexAtom)[datasetId]?.fields ?? []
				if (!fields.some((f) => f.name === oldName))
					return { ok: false, error: `No variable named "${oldName}".` }
				const error = fieldRenameError(fields, oldName, newName)
				if (error) return { ok: false, error }

				const applied = await set(mutateDatasetBodyAtom, datasetId, (d) =>
					withFreshContentHash({
						...d,
						fields: renameDatasetField(d.fields, oldName, newName),
					})
				)
				if (!applied)
					return {
						ok: false,
						error:
							"Couldn't load the data set to rename the variable. Check your connection and try again.",
					}

				// 2. The open editor — assemble, rewrite once, write back diffs.
				renameFieldAcrossEditorAtoms(get, set, fields, oldName, newName)

				// 3. Sibling saved visuals on the same dataset.
				const visuals = get(visualsAtom)
				let anyChanged = false
				const nextVisuals = visuals.map((v) => {
					if (v.datasetId !== datasetId) return v
					const rewritten = renameFieldInVisual(v, fields, oldName, newName)
					if (rewritten !== v) anyChanged = true
					return rewritten
				})
				if (anyChanged) set(visualsAtom, nextVisuals)

				return { ok: true }
			},
			[]
		)
	)
}
