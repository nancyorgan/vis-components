import { useEffect } from "react"
import { useAtomValue } from "jotai"
import { Outlet, useRouterState } from "@tanstack/react-router"

import { Header } from "../components/Header"
import { EMBED_PATH_PREFIX } from "../lib/embedPath"
import { UploadNoticeModal } from "../contexts/chartBuilder/components/UploadNoticeModal"
import { registerUserFonts } from "../contexts/chartBuilder/lib/fontRegistration"
import { userFontsAtom } from "../contexts/chartBuilder/store/atoms"

/** Swallow file drops that miss the data drawer's drop zone. Without this, the
 * browser default (navigate to the file:// URL) replaces the app with what
 * looks like a generic "this file was downloaded" / error page. The data
 * drawer's own handler still runs (events bubble); we just ensure that drops
 * outside the drawer are not navigated to. We don't touch `dropEffect` so the
 * drawer can still show a "copy" cursor when drag passes over it. */
const useGlobalFileDropGuard = () => {
	useEffect(() => {
		const isFile = (e: DragEvent) =>
			[...(e.dataTransfer?.types ?? [])].includes("Files")
		const onDragOver = (e: DragEvent) => {
			if (!isFile(e)) return
			e.preventDefault()
		}
		const onDrop = (e: DragEvent) => {
			if (!isFile(e)) return
			e.preventDefault()
		}
		window.addEventListener("dragover", onDragOver)
		window.addEventListener("drop", onDrop)
		return () => {
			window.removeEventListener("dragover", onDragOver)
			window.removeEventListener("drop", onDrop)
		}
	}, [])
}

/** Register the user font library's FontFaces (from the IndexedDB binary
 * cache, fetching on first sight). Lives at the root so user fonts render
 * everywhere charts do — editor, library thumbnails, and /embed/ pages. */
const useUserFontRegistration = () => {
	const fonts = useAtomValue(userFontsAtom)
	useEffect(() => {
		void registerUserFonts(fonts)
	}, [fonts])
}

export const RootLayout = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const isEmbed = pathname.startsWith(EMBED_PATH_PREFIX)
	useGlobalFileDropGuard()
	useUserFontRegistration()
	return (
		<div className="flex min-h-screen flex-col bg-white text-stone-900 dark:bg-stone-900 dark:text-stone-100">
			{!isEmbed && <Header />}
			<main className="flex-1">
				<Outlet />
			</main>
			{/* Above the outlet so an upload notice survives the navigation that
			 *  creating a new visualization performs. Embeds never upload. */}
			{!isEmbed && <UploadNoticeModal />}
		</div>
	)
}
