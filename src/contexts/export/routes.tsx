import { IMAGE_FORMATS } from "../chartBuilder/lib/exportImage"
import type { ImageFormat } from "../chartBuilder/lib/exportImage"
import { createRoute, rootRoute } from "../../routes/router"
import { ExportPage } from "./components/ExportPage"

export type ExportSearch = {
	/** Absent = png; null = a format the dialog doesn't offer. */
	format: ImageFormat | null
	v?: string // pinned dataset version id; absent = live (latest)
	/** Override the size and resolution `exportSizeFor` picks: CSS px, and
	 * image px per CSS px (dpi = 96 × ratio). */
	width?: number
	height?: number
	ratio?: number
}

const positive = (raw: unknown): number | undefined => {
	const n = Number(raw)
	return Number.isFinite(n) && n > 0 ? n : undefined
}

const validateSearch = (raw: Record<string, unknown>): ExportSearch => {
	const format =
		raw.format === undefined
			? "png"
			: (IMAGE_FORMATS.find((f) => f === raw.format) ?? null)
	const out: ExportSearch = { format }
	if (typeof raw.v === "string" && raw.v.length > 0) out.v = raw.v
	const width = positive(raw.width)
	const height = positive(raw.height)
	const ratio = positive(raw.ratio)
	if (width !== undefined) out.width = width
	if (height !== undefined) out.height = height
	if (ratio !== undefined) out.ratio = ratio
	return out
}

/** `/export/<id>?format=png|jpeg|svg|pdf` runs the Export dialog's image
 * pipeline with no one at the dialog, for a script or headless browser
 * that reads the file out of the page. */
export const exportRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/export/$visualId",
	component: ExportPage,
	validateSearch,
})
