/** Published-embed entry point (built by vite.embed.config.ts into the
 *  single-file dist/embed-runtime.html the server publishes from).
 *
 *  Boot order matters: the storage seams install before anything renders —
 *  see boot.ts. A document without a valid payload (the raw template, or a
 *  corrupt publish) renders a plain-text notice instead of a broken app. */

import { Provider } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { CustomPatternsProvider } from "../contexts/chartBuilder/store/CustomPatternsProvider"
import { bootEmbedRuntime } from "./boot"
import { EmbedRoot } from "./EmbedRoot"
import { readEmbedDocument } from "./payload"

import "../global.css"

const root = document.querySelector("#root")
if (!root) throw new Error("Root element #root not found")

const embedDocument = readEmbedDocument(document)
if (embedDocument === null) {
	root.textContent =
		"This embed could not be loaded — the page carries no published chart."
} else {
	const store = bootEmbedRuntime(embedDocument.payload)
	// Name the document after the chart (the server also writes it into the
	// <title>; this covers templates published before that).
	const visualName = embedDocument.payload.visual.name?.trim()
	if (visualName) document.title = visualName
	createRoot(root).render(
		<StrictMode>
			<Provider store={store}>
				<CustomPatternsProvider>
					<EmbedRoot
						part={embedDocument.part}
						visualId={embedDocument.payload.visual.id}
					/>
				</CustomPatternsProvider>
			</Provider>
		</StrictMode>
	)
}
