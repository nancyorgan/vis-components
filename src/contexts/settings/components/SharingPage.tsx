import { useState } from "react"
import { useAtomValue } from "jotai"
import { buildSeedBundle } from "../../chartBuilder/lib/exampleSeed"
import { stringifyJsonDangerous } from "../../../lib/json"
import { datasetsAtom, visualsAtom } from "../../chartBuilder/store/atoms"

import { Button } from "../../../components/ui/Button"

const formatBytes = (n: number): string =>
	n >= 1024 * 1024
		? `${(n / (1024 * 1024)).toFixed(1)} MB`
		: `${Math.max(1, Math.round(n / 1024))} KB`

/** Settings → Sharing: author-side export of the current library as the
 *  example-seed bundle baked into the single-file build. */
export const SharingPage = () => {
	const visuals = useAtomValue(visualsAtom)
	const datasets = useAtomValue(datasetsAtom)
	const [status, setStatus] = useState<string | null>(null)
	const [exporting, setExporting] = useState(false)

	const onExport = async () => {
		if (exporting) return
		setExporting(true)
		setStatus(null)
		try {
			const bundle = await buildSeedBundle()
			const json = stringifyJsonDangerous(bundle as never)
			const blob = new Blob([json], { type: "application/json" })
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = "examples.json"
			a.click()
			URL.revokeObjectURL(url)
			setStatus(
				`Exported ${bundle.visuals.length} visualization${
					bundle.visuals.length === 1 ? "" : "s"
				} and ${Object.keys(bundle.datasets).length} data set${
					Object.keys(bundle.datasets).length === 1 ? "" : "s"
				} — ${formatBytes(json.length)}. This full amount is added to the built file's size.`
			)
		} catch (error) {
			setStatus(
				`Export failed: ${error instanceof Error ? error.message : String(error)}`
			)
		} finally {
			setExporting(false)
		}
	}

	// Count what the export will actually contain: datasets some visual
	// references. The store also holds orphans (uploads whose visuals were
	// deleted or never saved) that buildSeedBundle filters out.
	const datasetCount = new Set(
		visuals.map((v) => v.datasetId).filter((id) => id != null && id in datasets)
	).size

	return (
		<div className="mx-auto max-w-5xl px-8 py-8">
			<h1 className="mb-1 text-xl font-semibold text-stone-900 dark:text-white">
				Sharing
			</h1>
			<p className="mb-8 text-sm text-stone-600 dark:text-stone-400">
				Tools for sharing this app as a single, self-contained HTML file.
			</p>

			<div className="max-w-2xl rounded-lg border border-stone-200 p-5 dark:border-stone-700">
				<h2 className="mb-2 text-sm font-semibold text-stone-900 dark:text-white">
					Bundle your library as examples
				</h2>
				<p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
					Downloads your current library — {visuals.length} visualization
					{visuals.length === 1 ? "" : "s"}, {datasetCount} data set
					{datasetCount === 1 ? "" : "s"}, previews, and your custom themes —
					as an <code className="text-xs">examples.json</code> file. Save it as{" "}
					<code className="text-xs">src/seed/examples.local.json</code> in the
					repo (a gitignored override) and rebuild: everyone who opens that
					build for the first time starts with these examples already in their
					library. Save it over <code className="text-xs">src/seed/examples.json</code>{" "}
					instead to publish it as the app&apos;s committed starter examples.
					Recipients&apos; own work is never overwritten, and they can delete
					the examples for good.
				</p>
				<div className="flex items-center gap-3">
					<Button compact onClick={onExport} disabled={exporting}>
						{exporting ? "Exporting…" : "Download examples bundle"}
					</Button>
					{status && (
						<span className="text-sm text-stone-600 dark:text-stone-400">
							{status}
						</span>
					)}
				</div>
			</div>
		</div>
	)
}
