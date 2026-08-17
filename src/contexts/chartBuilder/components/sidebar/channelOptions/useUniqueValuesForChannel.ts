import { useAtomValue } from "jotai"

import {
	flowNodeNames,
	resolveFlowEndpoints,
} from "../../../lib/buildFlowGraph"
import { resolveHierarchyIdField } from "../../../lib/buildHierarchy"
import {
	hierarchyDepthLevels,
	isFlowModeId,
	isHierarchyModeId,
	packedSourceOf,
	topLevelGroupNames,
} from "../../../lib/packedMeasure"
import { parseValue } from "../../../lib/scales"
import type { FieldType } from "../../../lib/types"
import {
	currentChannelConfigsAtom,
	currentEncodingsAtom,
	currentFieldLevelOrdersAtom,
	currentFieldOverridesAtom,
} from "../../../store/atoms"
import { useChartModeDef } from "../../../store/useChartModeDef"
import { useCurrentDatasetView } from "../../../store/useCurrentDatasetView"

export const useUniqueValuesForChannel = (
	channel: "shape" | "pattern" | "hue"
): {
	values: string[]
	type: FieldType
	labels?: string[]
	/** User-pinned level order for the backing field (Fields reorder UI).
	 *  Undefined for derived / flow sources — those have no single backing
	 *  field, so their rows stay in the renderer's discovery/union order. */
	order?: readonly string[]
} | null => {
	const overrides = useAtomValue(currentFieldOverridesAtom)
	const encodings = useAtomValue(currentEncodingsAtom)
	const configs = useAtomValue(currentChannelConfigsAtom)
	const levelOrders = useAtomValue(currentFieldLevelOrdersAtom)
	const modeDef = useChartModeDef()
	const dataset = useCurrentDatasetView()
	const fieldName = encodings[channel].field
	// Hierarchy-DERIVED pattern sources (Top-level group / Nesting depth):
	// category rows come from the tree, not a column — the same stable
	// dataset-order lists the renderer's derived pattern domain uses.
	const derived =
		channel === "pattern" && isHierarchyModeId(modeDef.id)
			? packedSourceOf(encodings.pattern)
			: null
	if (dataset && derived) {
		const parentField = encodings.connection?.field ?? null
		if (!parentField) return null
		const areaField = encodings.area?.field ?? null
		const idField = resolveHierarchyIdField(
			configs.connection?.hierarchyIdField ?? null,
			dataset.rows,
			dataset.fields.map((f) => f.name),
			parentField,
			areaField
		)
		if (derived === "rootGroup") {
			return {
				values: topLevelGroupNames(dataset.rows, parentField, idField, areaField),
				type: "categorical",
			}
		}
		const levels = hierarchyDepthLevels(
			dataset.rows,
			parentField,
			idField,
			areaField
		)
		return {
			values: levels,
			type: "ordinal",
			labels: levels.map((l) => `Level ${l}`),
		}
	}
	if (!dataset || !fieldName) return null
	const field = dataset.fields.find((f) => f.name === fieldName)
	const type: FieldType =
		overrides[fieldName] ?? field?.inferredType ?? "categorical"
	// Flow diagrams (chord / sankey) pattern by NODE over the source∪target
	// UNION domain (see useFlowScaffold) — pattern indices assign by position
	// in that union, so the per-category rows must list the same union in the
	// same order or the glyph shown drifts from the drawn pattern. Mirrors
	// the hue panel's `flowNodeValues` override.
	if (channel === "pattern" && isFlowModeId(modeDef.id)) {
		const { sourceField, targetField } = resolveFlowEndpoints(
			encodings,
			configs.connection,
			dataset
		)
		if (
			sourceField &&
			targetField &&
			(fieldName === sourceField || fieldName === targetField)
		) {
			return {
				values: flowNodeNames(dataset.rows, sourceField, targetField),
				type,
			}
		}
	}
	const values = [
		...new Set(
			dataset.rows
				.map((r) => parseValue(r[fieldName], type))
				.filter((v) => v !== null)
				.map(String)
		),
	]
	return { values, type, order: levelOrders[fieldName] }
}
