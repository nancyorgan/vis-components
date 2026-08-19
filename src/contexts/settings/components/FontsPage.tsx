import { useState } from "react"
import { useAtom } from "jotai"

import { Button } from "../../../components/ui/Button"
import { ConfirmDialog } from "../../../components/ui/Modal"
import { deleteFontBinaries } from "../../chartBuilder/lib/fontBinaries"
import {
	fontStackFor,
	userFontId,
	type UserFont,
} from "../../chartBuilder/lib/fontLibrary"
import { registerUserFonts } from "../../chartBuilder/lib/fontRegistration"
import { userFontsAtom } from "../../chartBuilder/store/atoms"
import {
	GoogleFontLookupError,
	lookupGoogleFont,
} from "../../../lib/googleFonts"

const fontMeta = (font: UserFont): string => {
	const weights = font.weights.join(", ")
	return font.hasItalic ? `Weights ${weights} · italic` : `Weights ${weights}`
}

/** Settings → Fonts: the user font library. Add a Google Font once by name
 *  and it appears in every Family picker (theme editor + all per-element
 *  pickers) and embeds into image/SVG exports automatically. */
export const FontsPage = () => {
	const [fonts, setFonts] = useAtom(userFontsAtom)
	const [name, setName] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [removing, setRemoving] = useState<UserFont | null>(null)

	const onAdd = async () => {
		const typed = name.trim()
		if (!typed || busy) return
		setBusy(true)
		setError(null)
		try {
			const found = await lookupGoogleFont(typed)
			if (
				fonts.some(
					(f) => f.family.toLowerCase() === found.family.toLowerCase()
				)
			) {
				setError(`${found.family} is already in your library.`)
				return
			}
			const font: UserFont = {
				id: userFontId(found.family),
				family: found.family,
				stack: fontStackFor(found.family),
				weights: found.weights,
				hasItalic: found.hasItalic,
				faces: found.faces,
				addedAt: new Date().toISOString(),
			}
			// Fetch + register the faces before saving so the list entry below
			// (and any open picker) renders in the real font immediately.
			await registerUserFonts([font])
			setFonts((prev) => [...prev, font])
			setName("")
		} catch (error_) {
			setError(
				error_ instanceof GoogleFontLookupError
					? error_.message
					: `Couldn't add the font: ${
							error_ instanceof Error ? error_.message : String(error_)
						}`
			)
		} finally {
			setBusy(false)
		}
	}

	const onRemove = (font: UserFont) => {
		setFonts((prev) => prev.filter((f) => f.id !== font.id))
		// Free the cached binaries; charts still using the family fall back to
		// its stack's generic fallback on the next load.
		void deleteFontBinaries(font.faces.map((f) => f.url))
		setRemoving(null)
	}

	return (
		<div className="mx-auto max-w-5xl px-8 py-8">
			<h1 className="mb-1 text-xl font-semibold text-stone-900 dark:text-white">
				Fonts
			</h1>
			<p className="mb-8 text-sm text-stone-600 dark:text-stone-400">
				Add fonts from{" "}
				<a
					href="https://fonts.google.com"
					target="_blank"
					rel="noreferrer"
					className="underline"
				>
					Google Fonts
				</a>{" "}
				by name. Added fonts appear in every font picker — theme defaults
				and per-label overrides alike — and are embedded into image and SVG
				exports so they render correctly anywhere.
			</p>

			<div className="max-w-2xl rounded-lg border border-stone-200 p-5 dark:border-stone-700">
				<h2 className="mb-2 text-sm font-semibold text-stone-900 dark:text-white">
					Add a Google Font
				</h2>
				<form
					className="flex items-center gap-2"
					onSubmit={(e) => {
						e.preventDefault()
						void onAdd()
					}}
				>
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Font name, e.g. Roboto Slab"
						aria-label="Google Font name"
						className="w-64 rounded border border-stone-300 bg-white px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
					/>
					<Button compact type="submit" disabled={busy || !name.trim()}>
						{busy ? "Looking up…" : "Add font"}
					</Button>
				</form>
				{error && (
					<p className="mt-2 text-sm text-red-600 dark:text-red-400">
						{error}
					</p>
				)}
			</div>

			{fonts.length > 0 && (
				<ul className="mt-6 max-w-2xl divide-y divide-stone-200 rounded-lg border border-stone-200 dark:divide-stone-700 dark:border-stone-700">
					{fonts.map((font) => (
						<li
							key={font.id}
							className="flex items-center gap-4 px-5 py-3"
						>
							<div className="min-w-0 flex-1">
								<div
									className="truncate text-lg text-stone-900 dark:text-white"
									style={{ fontFamily: font.stack }}
								>
									{font.family}
								</div>
								<div className="text-xs text-stone-500 dark:text-stone-400">
									{fontMeta(font)}
								</div>
							</div>
							<Button
								compact
								outline
								onClick={() => setRemoving(font)}
							>
								Remove
							</Button>
						</li>
					))}
				</ul>
			)}

			<ConfirmDialog
				open={removing !== null}
				title="Remove font?"
				message={
					<>
						Remove <strong>{removing?.family}</strong> from your font
						library? Charts using it will fall back to a generic font
						until it&apos;s added again.
					</>
				}
				confirmLabel="Remove"
				destructive
				onCancel={() => setRemoving(null)}
				onConfirm={() => removing && onRemove(removing)}
			/>
		</div>
	)
}
