import { useEffect } from "react"
import { useAtomValue } from "jotai"
import { Outlet, useRouterState } from "@tanstack/react-router"

import { Footer } from "../components/Footer"
import { Header } from "../components/Header"
import { SignInLapsedBanner } from "../components/SignInLapsedBanner"
import { StaleBuildBanner } from "../components/StaleBuildBanner"
import { EMBED_PATH_PREFIX } from "../lib/embedPath"
import { pageTitle, useDocumentTitle } from "../lib/documentTitle"
import { installFocusModality } from "../lib/focusModality"
import { UploadNoticeModal } from "../contexts/chartBuilder/components/UploadNoticeModal"
import { registerUserFonts } from "../contexts/chartBuilder/lib/fontRegistration"
import { userFontsAtom } from "../contexts/chartBuilder/store/atoms"
import { TipHost } from "../tips/TipHost"

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

const MAIN_ID = "main-content"

/** "Skip to main content" for keyboard users: invisible until it takes
 *  keyboard focus (it's the first Tab stop). `<main>` only becomes
 *  focusable for the jump itself, so clicks inside the page never land
 *  focus on it. */
const SkipLink = () => (
	<a
		href={`#${MAIN_ID}`}
		className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded focus-visible:bg-white focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:shadow-lg dark:focus-visible:bg-stone-800"
		onClick={(e) => {
			const main = document.getElementById(MAIN_ID)
			if (!main) return
			e.preventDefault()
			main.setAttribute("tabindex", "-1")
			main.focus()
			main.addEventListener("blur", () => main.removeAttribute("tabindex"), {
				once: true,
			})
		}}
	>
		Skip to main content
	</a>
)

export const RootLayout = () => {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const isEmbed = pathname.startsWith(EMBED_PATH_PREFIX)
	/** The editor fills the viewport and scrolls internally, so a footer
	 *  would only eat chart space. Document-flow pages (library, settings)
	 *  keep it as the end-of-page band. */
	const isEditor = pathname.startsWith("/editor/")
	const showFooter = !isEmbed && !isEditor
	useGlobalFileDropGuard()
	useUserFontRegistration()
	useEffect(() => installFocusModality(), [])
	// The editor and the embed name the page after the visual themselves.
	useDocumentTitle(
		isEditor || isEmbed
			? null
			: pageTitle(pathname.startsWith("/settings") ? "Settings" : "Library")
	)
	return (
		<div className="flex min-h-screen flex-col bg-white text-stone-900 dark:bg-stone-900 dark:text-stone-100">
			{!isEmbed && <SkipLink />}
			{!isEmbed && <StaleBuildBanner />}
			{!isEmbed && <SignInLapsedBanner />}
			{!isEmbed && <Header />}
			<main id={MAIN_ID} className="flex-1">
				<Outlet />
			</main>
			{showFooter && <Footer />}
			{/* Above the outlet so an upload notice survives the navigation that
			 *  creating a new visualization performs. Embeds never upload. */}
			{!isEmbed && <UploadNoticeModal />}
			{/* Just-in-time helper bubbles (src/tips/tips.ts). */}
			{!isEmbed && <TipHost />}
		</div>
	)
}
