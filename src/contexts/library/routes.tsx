import { createRoute, rootRoute } from "../../routes/router"
import { LibraryPage } from "./components/LibraryPage"
import { parseLibraryKind, type LibraryKind } from "./lib/libraryKind"

// URL search params for the library page. Defaults are intentionally chosen so
// that the "clean URL" /  matches the default UI state.
//
// folder  — selected folder id; absent = root ("All visualizations");
//           "unfiled" (UNFILED_FOLDER_ID) = visuals not in any folder
// dataset — selected dataset NAME filter; absent = all datasets
// view    — "grid" | "table"; absent = "grid"
// q       — search query string; absent = ""
// sort    — `<field>:<asc|desc>`; absent = "updatedAt:desc"
// kind    — "templates" | "data"; absent = ordinary visuals only. "data" is
//           the Data tab: `folder` then names a DATA folder and `sort` one
//           of its columns; `dataset` and `view` don't apply.
export type LibrarySearch = {
	folder?: string
	dataset?: string
	view?: "grid" | "table"
	q?: string
	sort?: string
	kind?: LibraryKind
}

export const validateSearch = (raw: Record<string, unknown>): LibrarySearch => {
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
	const kind = parseLibraryKind(raw.kind)
	if (kind) out.kind = kind
	return out
}

export const libraryRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: LibraryPage,
	validateSearch,
})
