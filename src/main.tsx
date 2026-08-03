import { Provider } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import {
	applyExampleSeed,
	type SeedBundle,
} from "./contexts/chartBuilder/lib/exampleSeed"
import publicSeed from "./seed/examples.json"

import "./global.css"

// Optional local override: a gitignored `src/seed/examples.local.json` (a
// developer's private library, shared with colleagues out-of-band) wins over
// the committed public seed. `import.meta.glob` resolves to an empty object
// when the file is absent, so the public repo — which ships only the public
// seed — still builds. Present → its default export replaces `publicSeed`.
const localSeed = Object.values(
	import.meta.glob<{ default: unknown }>("./seed/examples.local.json", {
		eager: true,
	})
)[0]?.default

const seed = localSeed ?? publicSeed

const root = document.querySelector("#root")
if (!root) throw new Error("Root element #root not found")

// First-run example hydration must land in storage BEFORE the root mounts —
// the persisted atoms bootstrap lazily on their first read. `finally` (and
// the swallow-all inside applyExampleSeed) guarantees a bad seed can't block
// first paint. The checked-in public seed is empty (a fresh clone opens to a
// blank library); a populated seed — committed or the local override — turns
// this into real first-run hydration.
// Cast through unknown: the storage layer tolerates (and migrates) loose
// visual shapes at runtime, so a hand-tweaked or older seed export must not
// fail the build on a structural mismatch.
void applyExampleSeed(seed as unknown as SeedBundle).finally(() => {
	createRoot(root).render(
		<StrictMode>
			<Provider>
				<App />
			</Provider>
		</StrictMode>
	)
})
