import { useEffect, useState } from "react"
import { approxCsvBytes } from "../../chartBuilder/lib/datasetMeta"
import {
	loadDatasetSizes,
	saveDatasetSizes,
} from "../../chartBuilder/lib/storage"
import { getStorageAdapter } from "../../chartBuilder/lib/storage/registry"
import type { DatasetMeta } from "../../chartBuilder/lib/types"
import { latestVersionOf } from "../lib/dataLineage"

/** Sizes for the latest versions whose metadata carries none (data sets
 *  stored before the size was derived with the rest of the metadata), keyed
 *  by version id. Measured one data set at a time from the version's rows —
 *  one version, never a whole upload history — and remembered on this
 *  device, so a library is measured once. A version that can't be read is
 *  left unmeasured for this visit. */
export const useDatasetSizes = (
	datasets: Record<string, DatasetMeta>
): Record<string, number> => {
	const [sizes, setSizes] = useState<Record<string, number>>(loadDatasetSizes)

	const pending: string[] = []
	for (const meta of Object.values(datasets)) {
		const version = latestVersionOf(meta)
		if (
			version !== undefined &&
			version.byteSize === undefined &&
			sizes[version.id] === undefined
		)
			pending.push(`${meta.id}\n${version.id}`)
	}
	const pendingKey = pending.join("\n\n")

	useEffect(() => {
		if (pendingKey === "") return
		let cancelled = false
		const run = async () => {
			for (const entry of pendingKey.split("\n\n")) {
				if (cancelled) return
				const [datasetId, versionId] = entry.split("\n")
				let rows: Array<Record<string, string>> | null
				try {
					const adapter = getStorageAdapter()
					rows =
						(await adapter.loadDatasetVersion(datasetId, versionId)) ??
						(await adapter.loadDataset(datasetId))?.versions.find(
							(v) => v.id === versionId
						)?.rows ??
						null
				} catch {
					rows = null
				}
				if (cancelled) return
				// Unreadable: record nothing durable, but stop asking this visit.
				const bytes = rows ? approxCsvBytes(rows) : -1
				setSizes((prev) => {
					const next = { ...prev, [versionId]: bytes }
					if (bytes >= 0) {
						saveDatasetSizes(
							Object.fromEntries(Object.entries(next).filter(([, b]) => b >= 0))
						)
					}
					return next
				})
			}
		}
		void run()
		return () => {
			cancelled = true
		}
	}, [pendingKey])

	return sizes
}
