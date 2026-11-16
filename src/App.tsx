import { RouterProvider } from "@tanstack/react-router"

import { TitleTooltipLayer } from "./components/TitleTooltipLayer"
import { CustomPatternsProvider } from "./contexts/chartBuilder/store/CustomPatternsProvider"
import { router } from "./routes/router"

export const App = () => {
	return (
		<CustomPatternsProvider>
			<RouterProvider router={router} />
			<TitleTooltipLayer />
		</CustomPatternsProvider>
	)
}
