/** Publish / unpublish actions for published embeds (the 0016 contract).
 *
 *  `usePublishEmbed` assembles the whole payload from the store — the SAVED
 *  visual, the one dataset version the embed will draw, the theme it renders
 *  under, and the user-font faces the on-screen chart uses — PUTs it, and
 *  records the returned public URLs on the (visualId, versionId) embed
 *  instance. Republishing the same instance reuses its publishId, so the
 *  public URLs never change once copied. */

import { useCallback } from "react"
import { atom } from "jotai"
import { useAtomCallback } from "jotai/utils"

import {
	clearEmbedPublish,
	recordEmbedPublish,
} from "../lib/embedInstances"
import {
	buildEmbedDataset,
	collectEmbedFonts,
	newPublishId,
	publishEmbedImageRequest,
	publishEmbedRequest,
	publishEmbedVectorRequest,
	unpublishEmbedRequest,
	type EmbedPublishUrls,
} from "../lib/embedPublish"
import { clampPixelRatio, renderExport } from "../lib/exportImage"
import { loadZctaTopology } from "../lib/geo/zctaTopology"
import { getStorageAdapter } from "../lib/storage/registry"
import type { Dataset, SavedTheme } from "../lib/types"
import { isTemplate } from "../lib/visualTrash"
import type { EmbedPart } from "../../../embedRuntime/payload"
import {
	datasetIndexAtom,
	embedInstancesAtom,
	publishedEditAckAtom,
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

/** Why a linked picture of a visual's last publish didn't make it, per
 *  format. */
export type PictureFailures = { image?: string; vector?: string }

/** The picture failures of each visual's last publish, by visual id —
 *  session-only, never saved. The Export tab shows them under the retry
 *  hints so a silent failure (capture or upload) has a cause attached. A
 *  publish that lands both pictures clears the visual's entry. */
export const embedPictureFailuresAtom = atom<Record<string, PictureFailures>>({})

export const usePublishEmbed = () =>
	useAtomCallback(
		useCallback(
			async (get, set, args: PublishEmbedArgs): Promise<EmbedPublishUrls> => {
				const visual = get(visualsAtom).find((v) => v.id === args.visualId)
				if (!visual) {
					throw new Error("Save the visualization before publishing.")
				}
				if (isTemplate(visual)) {
					throw new Error(
						"Templates can't be published. Start a visualization from it first."
					)
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

				const htmlUrls = await publishEmbedRequest(publishId, parts, {
					visual,
					dataset,
					theme,
					fonts,
					...(zctaTopology !== undefined ? { zctaTopology } : {}),
				})

				// The linked pictures ride further requests (the server 404s them
				// until the HTML publish exists). Best-effort: the embed is already
				// live, so a failed capture or upload records the publish without
				// that url (the Export tab offers a retry) rather than failing it.
				// The urls object is built fresh, so a stale picture url from an
				// earlier publish never survives a failed picture step.
				const pictures = await publishEmbedPictures(publishId)
				const urls: EmbedPublishUrls = {
					...htmlUrls,
					...("url" in pictures.image ? { image: pictures.image.url } : {}),
					...("url" in pictures.vector ? { vector: pictures.vector.url } : {}),
				}
				const failures: PictureFailures = {
					...("failure" in pictures.image ? { image: pictures.image.failure } : {}),
					...("failure" in pictures.vector ? { vector: pictures.vector.failure } : {}),
				}
				set(embedPictureFailuresAtom, (prev) => {
					if (Object.keys(failures).length === 0) {
						if (!(args.visualId in prev)) return prev
						const { [args.visualId]: _cleared, ...rest } = prev
						return rest
					}
					return { ...prev, [args.visualId]: failures }
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
				// The visual becomes "published" the instant this lands, which
				// would otherwise trip PublishedEditGate's warning on the user's
				// own deliberate publish. Pre-acknowledge it.
				set(publishedEditAckAtom, args.visualId)
				return urls
			},
			[]
		)
	)

/** Capture the on-screen figure (chart + legend + canvas colour) through
 *  the export pipeline and upload it as the embed's pictures: a PNG of the
 *  figure at its laid-out size, 2 raster px per CSS px so it stays crisp
 *  projected, stamped with that resolution so a consumer places it at its
 *  true size — 12pt in the app is 12pt on the slide — and the portable SVG
 *  of the same figure, which stays sharp at any zoom and in print. The
 *  export capture waits for the layout to settle, which is where a
 *  "Republish on every save" lands, 800 ms after an edit. Each format
 *  resolves to its public url or to the reason it failed (no figure on
 *  screen, a capture that never settled, an upload that failed) — a
 *  reason, never a throw, so the publish itself still lands and the Export
 *  tab can say what went wrong; one format failing never costs the other. */
const EMBED_IMAGE_SCALE = 2
export const PICTURE_NO_FIGURE = "No figure on screen to capture — publish from the editor."
type PictureOutcome = { url: string } | { failure: string }
type PictureOutcomes = { image: PictureOutcome; vector: PictureOutcome }

const attemptPicture = async (run: () => Promise<string>): Promise<PictureOutcome> => {
	try {
		return { url: await run() }
	} catch (error) {
		return { failure: error instanceof Error && error.message ? error.message : String(error) }
	}
}

const publishEmbedPictures = async (publishId: string): Promise<PictureOutcomes> => {
	// Layout size (offsetWidth) ignores the editor's display-only zoom.
	const root = document.querySelector<HTMLElement>("[data-chart-root]")
	if (!root || root.offsetWidth === 0 || root.offsetHeight === 0) {
		const failure = { failure: PICTURE_NO_FIGURE }
		return { image: failure, vector: failure }
	}
	const width = root.offsetWidth
	const height = root.offsetHeight
	const image = await attemptPicture(async () => {
		const blob = await renderExport(
			document,
			"png",
			width,
			height,
			clampPixelRatio(width, height, EMBED_IMAGE_SCALE),
			{ root, opaqueBackground: true }
		)
		return publishEmbedImageRequest(publishId, new File([blob], "image.png", { type: "image/png" }))
	})
	const vector = await attemptPicture(async () => {
		const blob = await renderExport(document, "svg", width, height, 1, { root })
		return publishEmbedVectorRequest(
			publishId,
			new File([blob], "image.svg", { type: "image/svg+xml" })
		)
	})
	return { image, vector }
}

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
