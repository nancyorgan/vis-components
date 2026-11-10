/** Boot a visual's embed page in a hidden iframe at a given size, run a
 *  capture against it, and tear it down. The publish pictures are captured
 *  this way when no Export dialog preview is open (the header's Republish,
 *  "Republish on every save"), so they come out at the SAME size the dialog
 *  would publish — the visual's remembered export size — instead of
 *  whatever the editor window happens to be. The library's thumbnail
 *  backfill does the same for thumbnails. */

/** Where a hidden embed boots from: same origin as the app (an internal
 *  iframe, like the export preview — never the outward-facing base URL). */
export const offscreenEmbedUrl = (
	visualId: string,
	versionId: string | null
): string => {
	const params = new URLSearchParams()
	if (versionId !== null) params.set("v", versionId)
	// The picture is the chart alone — the published page renders its own
	// data table.
	params.set("table", "off")
	return `${window.location.origin}/embed/${visualId}?${params.toString()}`
}

/** Mount the hidden iframe, hand it to `run`, and remove it whatever
 *  happens. Off-screen but NOT display:none / visibility:hidden: the chart
 *  sizes itself with ResizeObserver and needs real layout to mount at all.
 *  `run` waits for the chart itself (`renderExport` polls the frame for a
 *  settled SVG). */
export const withOffscreenEmbed = async <T>(
	visualId: string,
	versionId: string | null,
	size: { width: number; height: number },
	run: (iframe: HTMLIFrameElement) => Promise<T>
): Promise<T> => {
	const iframe = document.createElement("iframe")
	iframe.src = offscreenEmbedUrl(visualId, versionId)
	iframe.style.position = "fixed"
	iframe.style.left = "-10000px"
	iframe.style.top = "0"
	iframe.style.width = `${size.width}px`
	iframe.style.height = `${size.height}px`
	iframe.style.border = "0"
	iframe.style.pointerEvents = "none"
	iframe.setAttribute("aria-hidden", "true")
	iframe.tabIndex = -1
	document.body.append(iframe)
	try {
		return await run(iframe)
	} finally {
		iframe.remove()
	}
}
