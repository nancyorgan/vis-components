/** The safety net for what a publish carries (lib/embedColumns.ts): every
 *  bundled example, published with its reshape and derived variables worked
 *  out and only the columns its chart shows, must render exactly as it does
 *  from the whole stored table and the live settings. A place that reads a column the
 *  pruning doesn't know about shows up here as a different chart. */
import { cleanup, render, waitFor } from "@testing-library/react"
import { Provider } from "jotai"
import { afterEach, describe, expect, it } from "vitest"

import { clearExampleOverlay } from "../contexts/chartBuilder/lib/exampleOverlay"
import { pruneEmbedRecords } from "../contexts/chartBuilder/lib/embedColumns"
import { DEFAULT_TOOLTIP_CONFIG } from "../contexts/chartBuilder/lib/labelsConfig"
import type { Dataset, SavedTheme, Visual } from "../contexts/chartBuilder/lib/types"
import { stringifyJsonDangerous } from "../lib/json"
import examples from "../seed/examples.json"
import { installInMemoryLocalStorage } from "../testSupport/localStorageShim"
import { bootEmbedRuntime } from "./boot"
import { EmbedRoot } from "./EmbedRoot"
import { buildPublicEmbedPayload } from "./payload"

const library = examples as unknown as {
	visuals: Visual[]
	datasets: Record<string, Dataset>
	themes: SavedTheme[]
}

/** The example with its tooltip off (so the hover shows no columns) and a
 *  column no chart uses added to its data. */
const records = (visual: Visual): { visual: Visual; dataset: Dataset } => {
	const stored = library.datasets[visual.datasetId ?? ""]
	if (!stored) throw new Error(`${visual.name}: no data set`)
	const version = stored.versions.find((v) => v.id === stored.latestVersionId) ?? stored.versions[0]
	if (!version) throw new Error(`${visual.name}: no version`)
	const secret = { name: "Secret", inferredType: "categorical" as const }
	return {
		visual: {
			...visual,
			tooltipConfig: { ...DEFAULT_TOOLTIP_CONFIG, ...visual.tooltipConfig, enabled: false },
		},
		dataset: {
			...stored,
			fields: [...stored.fields, secret],
			latestVersionId: version.id,
			versions: [
				{
					...version,
					...(version.fields ? { fields: [...version.fields, secret] } : {}),
					rows: version.rows.map((row, i) => ({ ...row, Secret: `secret-${i}` })),
				},
			],
		},
	}
}

const draw = async (visual: Visual, dataset: Dataset): Promise<string> => {
	installInMemoryLocalStorage()
	const theme = library.themes.find((t) => t.id === visual.themeId) ?? null
	const payload = buildPublicEmbedPayload({ visual, dataset, theme, fonts: [] })
	const { container } = render(
		<Provider store={bootEmbedRuntime(payload)}>
			<div style={{ width: 800, height: 600 }}>
				<EmbedRoot part="full" visualId={payload.visual.id} />
			</div>
		</Provider>
	)
	await waitFor(() => expect(container.querySelector("svg")).not.toBeNull(), { timeout: 5000 })
	// Let the layout passes that follow the first paint finish (a map also
	// loads its boundaries): the markup must hold still for five checks.
	let html = ""
	let still = 0
	await waitFor(
		() => {
			const now = container.innerHTML
			still = now === html ? still + 1 : 0
			html = now
			expect(still).toBeGreaterThanOrEqual(5)
		},
		{ timeout: 15_000, interval: 100 }
	)
	cleanup()
	clearExampleOverlay()
	// React numbers its generated ids per mount (":r8:", "…-r9"); the two
	// charts are mounted one after the other, so only the numbers differ.
	return html.replace(/:r[0-9a-z]+:/g, ":r:").replace(/-r[0-9a-z]+(?=["#)])/g, "-r")
}

afterEach(() => {
	cleanup()
	clearExampleOverlay()
})

describe("an embed published with only the columns its chart shows", () => {
	for (const example of library.visuals) {
		it(`draws "${example.name}" exactly as with every column`, async () => {
			const full = records(example)
			const pruned = pruneEmbedRecords(full.visual, full.dataset)
			// Dropped as unused, or never in the table at all (a reshape keeps
			// only its ID and Combine columns): either way it is not published,
			// and neither is a formula or a reshape's settings.
			const published = stringifyJsonDangerous([pruned.visual, pruned.dataset] as never)
			expect(published).not.toContain("ecret")
			expect(pruned.visual.derivedVariablesConfig?.variables ?? []).toEqual([])
			expect(pruned.visual.reshapeConfig?.meltFields ?? []).toEqual([])
			const whole = await draw(full.visual, full.dataset)
			const trimmed = await draw(pruned.visual, pruned.dataset)
			expect(whole.length).toBeGreaterThan(500)
			expect(trimmed).toBe(whole)
		}, 30_000)
	}
})
