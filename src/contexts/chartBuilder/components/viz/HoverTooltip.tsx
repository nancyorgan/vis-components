import type { CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useAtomValue } from "jotai"
import {
	DEFAULT_TOOLTIP_CONFIG,
	type TooltipConfig,
} from "../../lib/labelsConfig"
import { currentTooltipConfigAtom } from "../../store/atoms"

const TOOLTIP_MAX_WIDTH = 240
const TOOLTIP_OFFSET = 12

export type TooltipState = {
	/** Viewport-relative pointer X (from `event.clientX`). The tooltip
	 * renders portaled to `document.body` and positioned with `position:
	 * fixed`, so we work in viewport coords throughout — that way the
	 * tooltip can escape `overflow:hidden` ancestors (facet panels, the
	 * chart wrapper) without getting clipped at panel edges. */
	clientX: number
	clientY: number
	/** Field-name → display value, in the order the user wants to see them.
	 * Charts compose this object in their own way (per-row for scatter, per
	 * cell aggregate for tiles, per slice for bars/pies). */
	fields: Array<{ name: string; value: unknown }>
}

/** HTML-escape a value to safely interpolate raw data into a user-supplied
 * HTML template. Prevents XSS-style breakage when a row's text contains `<`,
 * `>`, `&`, or quote characters. */
const htmlEscape = (raw: unknown): string =>
	String(raw ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")

/** Substitute `{{fieldName}}` placeholders in `template` with the matching
 * (HTML-escaped) values from `fields`. Unknown placeholders resolve to an
 * empty string so a typo doesn't blow up the tooltip. */
const renderTemplate = (
	template: string,
	fields: TooltipState["fields"]
): string => {
	const map = new Map(fields.map((f) => [f.name, f.value]))
	return template.replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => {
		const trimmed = String(name).trim()
		return map.has(trimmed) ? htmlEscape(map.get(trimmed)) : ""
	})
}

/** Compose a `position: fixed` placement that keeps the tooltip on-screen
 * regardless of which corner of the chart the user is hovering. We assume
 * the tooltip is at most `TOOLTIP_MAX_WIDTH` wide and (heuristically) ~120
 * px tall — close enough to clamp against the right/bottom edges. */
const clampToViewport = (clientX: number, clientY: number): CSSProperties => {
	const view =
		typeof window === "undefined" ? { innerWidth: 0, innerHeight: 0 } : window
	// Prefer right-of-cursor, but flip when there isn't room.
	const fitsRight =
		clientX + TOOLTIP_OFFSET + TOOLTIP_MAX_WIDTH < view.innerWidth
	const left = fitsRight
		? clientX + TOOLTIP_OFFSET
		: Math.max(8, clientX - TOOLTIP_OFFSET - TOOLTIP_MAX_WIDTH)
	// Prefer just-above-cursor; clamp to viewport top/bottom.
	const top = Math.max(8, Math.min(view.innerHeight - 16, clientY - 8))
	return { left, top, maxWidth: TOOLTIP_MAX_WIDTH }
}

/** Shared hover tooltip used by every chart renderer. Filters fields against
 * the user's `TooltipConfig.visibleFields` (empty = show all) and applies
 * any custom CSS the user has supplied. Disabled when `enabled === false`.
 * Renders into a portal at `document.body` so the tooltip can extend past
 * the chart wrapper, panel edges, and any other `overflow:hidden`
 * ancestor. */
export const HoverTooltip = ({ state }: { state: TooltipState }) => {
	const cfg: TooltipConfig = {
		...DEFAULT_TOOLTIP_CONFIG,
		...useAtomValue(currentTooltipConfigAtom),
	}
	if (!cfg.enabled) return null

	const visible = cfg.visibleFields
	const filtered =
		visible.length === 0
			? state.fields
			: state.fields.filter((f) => visible.includes(f.name))
	if (filtered.length === 0 && !(cfg.useCustomHtml && cfg.customHtml.trim()))
		return null

	const style: CSSProperties = {
		position: "fixed",
		zIndex: 9999,
		...clampToViewport(state.clientX, state.clientY),
	}

	// Custom HTML is OPT-IN via `useCustomHtml`. Load Default populates
	// the textarea as a starter template without switching modes; the
	// user must explicitly toggle the checkbox to activate template
	// rendering. This keeps the default checkbox-driven tooltip in
	// charge until power users opt out.
	const customHtmlActive = !!cfg.useCustomHtml && cfg.customHtml.trim() !== ""
	const customHtml = customHtmlActive ? cfg.customHtml.trim() : ""
	const interpolated = customHtml
		? renderTemplate(customHtml, state.fields)
		: ""

	const tooltip = (
		<>
			{cfg.customCss.trim() && (
				<style>{`.vc-tooltip { ${cfg.customCss} }`}</style>
			)}
			<div
				className="vc-tooltip pointer-events-none rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm shadow-lg dark:border-stone-700 dark:bg-stone-800"
				style={style}
			>
				{customHtml ? (
					// User-supplied template; data values are HTML-escaped via
					// `renderTemplate` before interpolation, so this is safe.
					<div dangerouslySetInnerHTML={{ __html: interpolated }} />
				) : (
					filtered.map((f) => (
						<div key={f.name} className="flex gap-2 whitespace-nowrap">
							<span className="text-stone-600 dark:text-stone-400">
								{f.name}:
							</span>
							<span className="truncate font-medium text-stone-800 dark:text-stone-200">
								{String(f.value ?? "")}
							</span>
						</div>
					))
				)}
			</div>
		</>
	)

	if (typeof document === "undefined") return null
	return createPortal(tooltip, document.body)
}
