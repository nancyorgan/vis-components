import { RouterProvider } from "@tanstack/react-router"

import { CustomPatternsProvider } from "./contexts/chartBuilder/store/CustomPatternsProvider"
import { router } from "./routes/router"

export const App = () => {
	return (
		<CustomPatternsProvider>
			<RouterProvider router={router} />
		</CustomPatternsProvider>
	)
}
