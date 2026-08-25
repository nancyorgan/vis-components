import { useState } from "react"
import { Button } from "../../../components/ui/Button"
import {
	downloadVisualsBundle,
	type DownloadableVisual,
} from "../../chartBuilder/lib/downloadVisuals"

/** Bulk-selection toolbar action: download the selected visualizations as a
 *  library bundle (JSON) the recipient imports via Settings → Sharing. The
 *  build reads the whole library through the storage adapter, so it's async;
 *  the button disables and relabels while it runs, and a failure reports
 *  inline instead of taking the page down. */
export const DownloadVisualsButton = ({
	selected,
}: {
	selected: readonly DownloadableVisual[]
}) => {
	const [downloading, setDownloading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const onDownload = async () => {
		if (downloading || selected.length === 0) return
		setDownloading(true)
		setError(null)
		try {
			await downloadVisualsBundle(selected)
		} catch (e) {
			setError(
				`Download failed: ${e instanceof Error ? e.message : String(e)}`
			)
		} finally {
			setDownloading(false)
		}
	}

	return (
		<>
			{error !== null && (
				<span className="text-sm text-red-700 dark:text-red-300">{error}</span>
			)}
			<Button
				compact
				disabled={downloading || selected.length === 0}
				onClick={() => {
					void onDownload()
				}}
				title={
					selected.length === 1
						? "Download this visualization as a JSON bundle"
						: "Download the selected visualizations as one JSON bundle"
				}
			>
				{downloading ? "Downloading…" : "Download"}
			</Button>
		</>
	)
}
