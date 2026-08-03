import { useEffect, useRef, useState } from "react"
import { useSetAtom } from "jotai"
import { visualsAtom } from "../../chartBuilder/store/atoms"
import { runThumbnailBackfill } from "../lib/thumbnailBackfill"

type Props = {
	visualId: string
	visualName: string
}

const RefreshIcon = () => (
	<svg
		viewBox="0 0 16 16"
		width={12}
		height={12}
		aria-hidden="true"
		fill="currentColor"
	>
		<path
			fillRule="evenodd"
			d="M8 3a5 5 0 104.546 2.914.5.5 0 01.908-.417A6 6 0 118 2v1z"
		/>
		<path d="M8 4.466V.534a.25.25 0 01.41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 018 4.466z" />
	</svg>
)

/**
 * Hover-over-tile button that re-renders this visual offscreen and replaces
 * its thumbnail — the recovery path for previews that captured badly (e.g.
 * mid-layout frames from the old first-nonzero-size capture) or that show
 * stale data. Unlike the library-header bulk backfill, this OVERWRITES an
 * existing thumbnail; the bulk run only fills missing ones.
 */
export const RegeneratePreviewButton = ({ visualId, visualName }: Props) => {
	const setVisuals = useSetAtom(visualsAtom)
	const [busy, setBusy] = useState(false)
	// The capture takes seconds; the card can unmount mid-run (filter change,
	// delete). The thumbnail write targets the atom (safe either way) — only
	// the local busy flag needs the guard.
	const mountedRef = useRef(true)
	useEffect(
		() => () => {
			mountedRef.current = false
		},
		[]
	)

	const onClick = async (e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		if (busy) return
		setBusy(true)
		try {
			await runThumbnailBackfill([{ id: visualId }], {
				onProgress: () => {},
				onCaptured: (id, thumbnail) => {
					setVisuals((prev) =>
						prev.map((v) => (v.id === id ? { ...v, thumbnail } : v))
					)
				},
			})
		} finally {
			if (mountedRef.current) setBusy(false)
		}
	}

	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			title={busy ? "Regenerating preview…" : "Regenerate preview"}
			aria-label={`Regenerate preview for ${visualName}`}
			className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-stone-500 shadow-sm ring-1 ring-stone-200 hover:bg-stone-100 hover:text-stone-700 disabled:cursor-wait dark:bg-stone-800/90 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
		>
			<span className={busy ? "animate-spin" : undefined}>
				<RefreshIcon />
			</span>
		</button>
	)
}
