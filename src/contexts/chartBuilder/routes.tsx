import { createRoute, rootRoute } from "../../routes/router"
import {
	VisualLoaderForExisting,
	VisualLoaderForNew,
} from "./components/VisualLoader"

export const editorNewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/editor/new",
	component: VisualLoaderForNew,
	// `?datasetId=…` lets the Header's "New visualization → With this data set"
	// option carry the current dataset across the route change. Without it,
	// VisualLoaderForNew's reset would clear the dataset binding.
	validateSearch: (
		search: Record<string, unknown>,
	): { datasetId?: string } => ({
		datasetId:
			typeof search.datasetId === "string" ? search.datasetId : undefined,
	}),
})

export const editorVisualRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/editor/$visualId",
	component: VisualLoaderForExisting,
})
