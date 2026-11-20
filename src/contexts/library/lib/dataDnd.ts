/** Drag payload for data sets dragged from the Data tab's list or tree onto
 *  a folder of its rail. Its own MIME type, so a visual's folder never
 *  takes a data set and a data folder never takes a visual. */
import { stringifyJsonDangerous } from "../../../lib/json"

export const DATASETS_DRAG_TYPE = "application/x-vis-datasets"

export const encodeDatasetsDrag = (datasetIds: string[]): string =>
	stringifyJsonDangerous({ datasetIds })

export const decodeDatasetsDrag = (raw: string): string[] | null => {
	try {
		const parsed = JSON.parse(raw) as { datasetIds?: unknown }
		return Array.isArray(parsed.datasetIds) &&
			parsed.datasetIds.every((id) => typeof id === "string")
			? (parsed.datasetIds as string[])
			: null
	} catch {
		return null
	}
}
