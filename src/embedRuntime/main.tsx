/** Published-embed entry point (built by vite.embed.config.ts into the
 *  single-file dist/embed-runtime.html the server publishes from).
 *
 *  Boot order matters: the storage seams install before anything renders —
 *  see boot.ts. A document without a valid payload (the raw template, or a
 *  corrupt publish) renders a plain-text notice instead of a broken app. */

import { Provider } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

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
	createRoot(root).render(
		<StrictMode>
			<Provider store={store}>
				<EmbedRoot
					part={embedDocument.part}
					visualId={embedDocument.payload.visual.id}
				/>
			</Provider>
		</StrictMode>
	)
}
