import { useAtomCallback } from "jotai/utils"
import { useCallback } from "react"
import { withFreshContentHash } from "../lib/datasetDedupe"
import {
	fieldRenameError,
	renameDatasetField,
	renameFieldInConfigs,
	renameFieldInVisual,
	type FieldNameConfigs,
} from "../lib/renameField"
import type { Field } from "../lib/types"

import {
	currentAnnotationsAtom,
	currentChannelConfigsAtom,
	currentDataLabelsConfigAtom,
	currentDataLabelsEncodingsAtom,
	currentDatasetIdAtom,
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

				// 2. The open editor. Assemble the state slice from the atoms,
				// rewrite once, and write back only the pieces that changed.
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
				}
				const next = renameFieldInConfigs(state, fields, oldName, newName)
				if (next !== state) {
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
				}

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
