import { useEffect, useRef, useState } from "react"
import { useParams, useSearch } from "@tanstack/react-router"
import { useAtomValue } from "jotai"
import {
	clampExportDim,
	clampPixelRatio,
	exportSizeFor,
	renderExport,
} from "../../chartBuilder/lib/exportImage"
import {
	visualsAtom,
	visualsHydratedAtom,
} from "../../chartBuilder/store/atoms"
import { EMBED_PATH_PREFIX } from "../../../lib/embedPath"

type Result =
	| { status: "working" }
	| { status: "done"; blob: Blob; base64: string; ms: number }
	| { status: "failed"; message: string }

const blobToBase64 = (blob: Blob): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.addEventListener("load", () =>
			resolve(String(reader.result).replace(/^data:[^,]*,/, ""))
		)
		reader.addEventListener("error", () => reject(reader.error))
		reader.readAsDataURL(blob)
	})

/** Loads the same capture iframe the Export dialog previews in, at the
 * export size, runs the dialog's renderExport on it, and writes the file
 * into `#export-result` as base64, with its mime type, byte count, size
 * and resolution as data attributes. A failure lands in `#export-error`.
 * Nothing is saved or uploaded. */
export const ExportPage = () => {
	const { visualId } = useParams({ from: "/export/$visualId" })
	const search = useSearch({ from: "/export/$visualId" })
	const visuals = useAtomValue(visualsAtom)
	const visualsHydrated = useAtomValue(visualsHydratedAtom)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const [result, setResult] = useState<Result>({ status: "working" })

	const visual = visualsHydrated
		? visuals.find((v) => v.id === visualId)
		: undefined
	const format = search.format
	const ready = visual !== undefined && format !== null
	const seed = exportSizeFor(visual?.channelConfigs.canvasSize)
	const width =
		search.width === undefined ? seed.width : clampExportDim(search.width)
	const height =
		search.height === undefined ? seed.height : clampExportDim(search.height)
	const pixelRatio = clampPixelRatio(
		width,
		height,
		search.ratio ?? seed.pixelRatio
	)

	const params = new URLSearchParams()
	if (search.v) params.set("v", search.v)
	params.set("table", "off")
	const embedUrl = `${EMBED_PATH_PREFIX}${visualId}?${params.toString()}`

	useEffect(() => {
		if (!ready) return
		let cancelled = false
		const started = Date.now()
		;(async () => {
			try {
				const blob = await renderExport(
					iframeRef.current,
					format,
					width,
					height,
					pixelRatio
				)
				const base64 = await blobToBase64(blob)
				if (cancelled) return
				setResult({
					status: "done",
					blob,
					base64,
					ms: Math.round(Date.now() - started),
				})
			} catch (error) {
				if (cancelled) return
				setResult({
					status: "failed",
					message: error instanceof Error ? error.message : String(error),
				})
			}
		})()
		return () => {
			cancelled = true
		}
		// One export per page load, once the visual is known.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ready])

	if (!visualsHydrated) return null
	if (!visual) {
		return <pre id="export-error">Visualization not found.</pre>
	}
	if (format === null) {
		return <pre id="export-error">Unknown format.</pre>
	}
	return (
		<div>
			{result.status === "done" && (
				<pre
					id="export-result"
					data-mime={result.blob.type}
					data-bytes={result.blob.size}
					data-width={width}
					data-height={height}
					data-pixel-ratio={pixelRatio}
					data-ms={result.ms}
				>
					{result.base64}
				</pre>
			)}
			{result.status === "failed" && (
				<pre id="export-error">{result.message}</pre>
			)}
			<iframe
				ref={iframeRef}
				src={embedUrl}
				width={width}
				height={height}
				title="Export capture"
				className="block bg-white"
			/>
		</div>
	)
}
