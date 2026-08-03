import { createRoute, rootRoute } from "../../routes/router"
import { EmbedPage } from "./components/EmbedPage"

export type EmbedPart = "chart" | "legend"

export type EmbedSearch = {
	v?: string // pinned dataset version id; absent = live (latest)
	/** Render only one slice of the visual. Used by the dual-iframe embed
	 * option so chart and legend can sit in independently-sized iframes. */
	part?: EmbedPart
}

const validateSearch = (raw: Record<string, unknown>): EmbedSearch => {
	const out: EmbedSearch = {}
	if (typeof raw.v === "string" && raw.v.length > 0) out.v = raw.v
	if (raw.part === "chart" || raw.part === "legend") out.part = raw.part
	return out
}

export const embedRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/embed/$visualId",
	component: EmbedPage,
	validateSearch,
})
