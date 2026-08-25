import { Provider } from "jotai"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import {
	applyExampleSeed,
	installEphemeralExamples,
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

// Cast through unknown: the storage layer tolerates (and migrates) loose
// visual shapes at runtime, so a hand-tweaked or older seed export must not
// fail the build on a structural mismatch.
const seed = (localSeed ?? publicSeed) as unknown as SeedBundle

// Which seed won decides how it's delivered. The PUBLIC examples are a
// sandbox — overlaid in memory, editable, reset on every reload. A private
// override is somebody's real library handed to colleagues, so it keeps the
// persist-once behaviour it has always had.
const seedIsPublic = localSeed === undefined

const root = document.querySelector("#root")
if (!root) throw new Error("Root element #root not found")

// Boot order, all pre-mount because the persisted atoms bootstrap lazily on
// their first read:
//  1. Probe for server mode (the same artifact runs served-by-the-self-host-
//     server or fully browser-local; /api/config answering with the expected
//     shape is the difference). In server mode, install the HTTP storage
//     adapter — this must precede render, atoms capture the adapter on mount —
//     and the server-supplied base URL for outward-facing links. Then seed
//     through that adapter: a hosted library gets the examples written into
//     SQL and backed up like any other work, sandbox or not. The dataset
//     cleanup is skipped — it only touches browser-local storage, which
//     server mode doesn't read.
//  2. Local mode: the library must be settled before the root mounts, because
//     every persisted atom bootstraps lazily on its first read. `finally` (and
//     the swallow-all inside both seed paths) guarantees a bad seed — or a
//     probe gone wrong — can't block first paint.
//     The public seed installs as an in-memory OVERLAY (editable sandbox, no
//     writes, reset every reload); a private `examples.local.json` override
//     hydrates storage once, as it always has. The checked-in public seed may
//     be empty, in which case both paths no-op and a fresh clone opens to a
//     blank library.
//     The one-shot dataset cleanup (duplicate collapse + orphan removal) also
//     runs pre-mount: the datasets atom's onMount load must see the post-
//     cleanup store, or its in-memory copy would resurrect removed datasets on
//     the next save. It runs BEFORE the overlay (which it must never see —
//     seed datasets are not orphans to collect, and not the store's to
//     rewrite) and AFTER a persisted seed (so seeded datasets are judged
//     against the seeded visuals that reference them). All of them swallow
//     their own errors.
const bootstrapStorage = async (): Promise<void> => {
	const serverConfig = await probeServerMode()
	if (serverConfig) {
		setAppOrigin(serverConfig.baseUrl)
		setStorageAdapter(createHttpStorageAdapter())
		await applyExampleSeed(seed)
		return
	}
	if (seedIsPublic) {
		await runDatasetStoreCleanup()
		await installEphemeralExamples(seed)
		return
	}
	await applyExampleSeed(seed)
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
