import { Provider } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import {
	applyExampleSeed,
	type SeedBundle,
} from "./contexts/chartBuilder/lib/exampleSeed"
import { runDatasetStoreCleanup } from "./contexts/chartBuilder/lib/datasetSweep"
import { createHttpStorageAdapter } from "./contexts/chartBuilder/lib/storage/httpAdapter"
import { setStorageAdapter } from "./contexts/chartBuilder/lib/storage/registry"
import { setAppOrigin } from "./lib/appOrigin"
import { probeServerMode } from "./lib/serverMode"
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

// Boot order, all pre-mount because the persisted atoms bootstrap lazily on
// their first read:
//  1. Probe for server mode (the same artifact runs served-by-the-self-host-
//     server or fully browser-local; /api/config answering with the expected
//     shape is the difference). In server mode, install the HTTP storage
//     adapter — this must precede render, atoms capture the adapter on mount —
//     and the server-supplied base URL for outward-facing links. The local
//     seed and dataset cleanup are skipped: they only touch browser-local
//     storage, which server mode doesn't read.
//  2. Local mode: first-run example hydration must land in storage before the
//     root mounts. `finally` (and the swallow-all inside applyExampleSeed)
//     guarantees a bad seed — or a probe gone wrong — can't block first paint.
//     The checked-in public seed is empty (a fresh clone opens to a blank
//     library); a populated seed — committed or the local override — turns
//     this into real first-run hydration.
//     Cast through unknown: the storage layer tolerates (and migrates) loose
//     visual shapes at runtime, so a hand-tweaked or older seed export must
//     not fail the build on a structural mismatch.
//     The one-shot dataset cleanup (duplicate collapse + orphan removal) also
//     runs pre-mount: the datasets atom's onMount load must see the post-
//     cleanup store, or its in-memory copy would resurrect removed datasets on
//     the next save. Ordered after the seed so seeded datasets are judged
//     against the seeded visuals that reference them. Both swallow their own
//     errors.
const bootstrapStorage = async (): Promise<void> => {
	const serverConfig = await probeServerMode()
	if (serverConfig) {
		setAppOrigin(serverConfig.baseUrl)
		setStorageAdapter(createHttpStorageAdapter())
		return
	}
	await applyExampleSeed(seed as unknown as SeedBundle)
	await runDatasetStoreCleanup()
}

void bootstrapStorage().finally(() => {
	createRoot(root).render(
		<StrictMode>
			<Provider>
				<App />
			</Provider>
		</StrictMode>
	)
})
