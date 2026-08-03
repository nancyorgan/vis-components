import { createRoute, rootRoute } from "../../routes/router"
import { LibraryPage } from "./components/LibraryPage"

// URL search params for the library page. Defaults are intentionally chosen so
// that the "clean URL" /  matches the default UI state.
//
// folder  — selected folder id; absent = root ("All visualizations")
// dataset — selected dataset NAME filter; absent = all datasets
// view    — "grid" | "table"; absent = "grid"
// q       — search query string; absent = ""
// sort    — `<field>:<asc|desc>`; absent = "updatedAt:desc"
export type LibrarySearch = {
	folder?: string
	dataset?: string
	view?: "grid" | "table"
	q?: string
	sort?: string
}

const validateSearch = (raw: Record<string, unknown>): LibrarySearch => {
	const out: LibrarySearch = {}
	if (typeof raw.folder === "string" && raw.folder.length > 0) {
		out.folder = raw.folder
	}
	if (typeof raw.dataset === "string" && raw.dataset.length > 0) {
		out.dataset = raw.dataset
	}
	if (raw.view === "table" || raw.view === "grid") out.view = raw.view
	if (typeof raw.q === "string" && raw.q.length > 0) out.q = raw.q
	if (typeof raw.sort === "string" && raw.sort.length > 0) out.sort = raw.sort
	return out
}

export const libraryRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: LibraryPage,
	validateSearch,
})
