import { useMemo } from "react"
import { useAtomValue } from "jotai"

import { resolveFlowEndpoints } from "../lib/buildFlowGraph"
import { isFlowModeId } from "../lib/chartModes/families"
import { currentChannelConfigsAtom, currentEncodingsAtom } from "./atoms"
import { useChartModeDef } from "./useChartModeDef"
import { useCurrentDatasetView } from "./useCurrentDatasetView"

const ANY = (): boolean => true

/** Which variables a part's "Vary by" can use on the chart being edited.
 *
 *  Everywhere but one family: any variable (each list still filters by the
 *  types its channel accepts). On a FLOW diagram a node is not a dataset
 *  row — it is every row that names it at either end — so only the two
 *  endpoint columns have one value per node. Those vary "by node", the way
 *  Color does; any other column would be offered and do nothing.
 *
 *  Returns `(fieldName, current) => boolean`. Pass the list's current pick
 *  as `current`: it always stays listed, so a variable chosen on another
 *  chart type still shows and can be cleared. */
export const useVaryByFieldFilter = (): ((
	name: string,
	current?: string | null
) => boolean) => {
	const modeDef = useChartModeDef()
	const encodings = useAtomValue(currentEncodingsAtom)
	const connection = useAtomValue(currentChannelConfigsAtom).connection
	const dataset = useCurrentDatasetView()
	return useMemo(() => {
		if (!isFlowModeId(modeDef.id)) return ANY
		const { sourceField, targetField } = resolveFlowEndpoints(
			encodings,
			connection,
			dataset
		)
		return (name, current) =>
			name === sourceField || name === targetField || name === current
	}, [modeDef.id, encodings, connection, dataset])
}
