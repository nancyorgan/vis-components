/** Publish / unpublish actions for published embeds (the 0016 contract).
 *
 *  `usePublishEmbed` assembles the whole payload from the store — the SAVED
 *  visual, the one dataset version the embed will draw, the theme it renders
 *  under, and the user-font faces the on-screen chart uses — PUTs it, and
 *  records the returned public URLs on the (visualId, versionId) embed
 *  instance. Republishing the same instance reuses its publishId, so the
 *  public URLs never change once copied. */

import { useCallback } from "react"
import { useAtomCallback } from "jotai/utils"

import {
	clearEmbedPublish,
	recordEmbedPublish,
} from "../lib/embedInstances"
import {
	buildEmbedDataset,
	collectEmbedFonts,
	newPublishId,
	publishEmbedRequest,
	unpublishEmbedRequest,
	type EmbedPublishUrls,
} from "../lib/embedPublish"
import { loadZctaTopology } from "../lib/geo/zctaTopology"
import { getStorageAdapter } from "../lib/storage/registry"
import type { Dataset, SavedTheme } from "../lib/types"
import type { EmbedPart } from "../../../embedRuntime/payload"
import {
	datasetIndexAtom,
	embedInstancesAtom,
	themeAtom,
	themesAtom,
	visualsAtom,
} from "./atoms"

export type PublishEmbedArgs = {
	visualId: string
	/** Pinned dataset version, or null for "latest at publish time". */
	versionId: string | null
	/** Publish the chart/legend split files instead of the combined page. */
	split: boolean
	/** Inline the ZCTA boundary topology (ZIP-level maps). The caller decides
	 *  — it sits in the editor, where the effective geography level is a
	 *  hook over the live atoms. */
	includeZctaTopology?: boolean
}

export const usePublishEmbed = () =>
	useAtomCallback(
		useCallback(
			async (get, set, args: PublishEmbedArgs): Promise<EmbedPublishUrls> => {
				const visual = get(visualsAtom).find((v) => v.id === args.visualId)
				if (!visual) {
					throw new Error("Save the visualization before publishing.")
				}

				// The one dataset version the embed draws — the payload carries it
				// whole, because a published embed fetches nothing.
				let dataset: Dataset | null = null
				let publishedVersionId: string | null = null
				if (visual.datasetId) {
					const meta = get(datasetIndexAtom)[visual.datasetId]
					if (!meta) {
						throw new Error("The data set could not be loaded. Try again.")
					}
					const versionId = args.versionId ?? meta.latestVersionId
					publishedVersionId = versionId
					const adapter = getStorageAdapter()
					let rows = await adapter.loadDatasetVersion(visual.datasetId, versionId)
					if (rows === null) {
						// Pre-split stores have no per-version body — fall back to the
						// whole dataset, same as the render path does.
						const whole = await adapter.loadDataset(visual.datasetId)
						rows = whole?.versions.find((v) => v.id === versionId)?.rows ?? null
					}
					if (rows === null) {
						throw new Error("The data version could not be loaded. Try again.")
					}
					dataset = buildEmbedDataset(meta, versionId, rows)
					if (dataset === null) {
						throw new Error("The pinned version no longer exists.")
					}
				}

				// The theme the embed renders under: the visual's saved theme when it
				// still exists, else a snapshot of the live editor theme — the embed
				// viewer has no theme library to fall back to.
				const themes = get(themesAtom)
				const saved = visual.themeId
					? (themes.find((t) => t.id === visual.themeId) ?? null)
					: null
				const theme: SavedTheme = saved ?? {
					id: "embedded-theme",
					name: "Embedded theme",
					isSystem: false,
					...get(themeAtom),
				}

				const fonts = await collectEmbedFonts()

				// ZIP-level maps carry their boundary topology — the runtime has no
				// fetch path for it. Failure to load it degrades exactly like the
				// editor does (the level reports unavailable), so it never blocks.
				const zctaTopology = args.includeZctaTopology
					? await loadZctaTopology().catch(() => undefined)
					: undefined

				const instances = get(embedInstancesAtom)
				const existing = Object.values(instances).find(
					(i) => i.visualId === args.visualId && i.versionId === args.versionId
				)
				const publishId = existing?.publishId ?? newPublishId()
				const parts: EmbedPart[] = args.split ? ["chart", "legend"] : ["full"]

				const urls = await publishEmbedRequest(publishId, parts, {
					visual,
					dataset,
					theme,
					fonts,
					...(zctaTopology !== undefined ? { zctaTopology } : {}),
				})

				set(embedInstancesAtom, (prev) =>
					recordEmbedPublish(prev, args.visualId, args.versionId, {
						publishId,
						publishedAt: Date.now(),
						publishedParts: parts,
						publishedUrls: urls,
						publishedVersionId,
					})
				)
				return urls
			},
			[]
		)
	)

/** Unpublish one instance: delete its public files, then clear its publish
 *  fields (the landing row stays, shown as not published). */
export const useUnpublishEmbed = () =>
	useAtomCallback(
		useCallback(async (get, set, instanceId: string): Promise<void> => {
			const instance = get(embedInstancesAtom)[instanceId]
			if (!instance?.publishId) return
			await unpublishEmbedRequest(instance.publishId)
			set(embedInstancesAtom, (prev) => clearEmbedPublish(prev, instanceId))
		}, [])
	)
