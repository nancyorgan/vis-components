import type { CSSProperties } from "react"
import { createPortal } from "react-dom"
import { useAtomValue } from "jotai"
import { contrastRatio } from "../../lib/accessibilityCheck"
import {
	DEFAULT_TOOLTIP_CONFIG,
	resolveTooltipBox,
	type ResolvedTooltipBox,
	type TooltipConfig,
} from "../../lib/labelsConfig"
import { applyTooltipFormats } from "../../lib/tooltipFormats"
import { sanitizeTooltipCss, sanitizeTooltipHtml } from "../../lib/tooltipSanitize"
import { currentTooltipConfigAtom } from "../../store/atoms"
import { tooltipFieldFormatsAtom } from "../../store/renderConfigs"
import { useCurrentTheme } from "../../store/useCurrentTheme"

const TOOLTIP_OFFSET = 12

/** Text inks for a tooltip whose background the user set: whichever of
 * near-black / white contrasts more with the fill, so a dark box doesn't
 * print the light UI's dark text (or vice versa). */
const INK_DARK = "#1c1917"
const INK_LIGHT = "#ffffff"
const inkFor = (background: string): string =>
	contrastRatio(INK_LIGHT, background) >= contrastRatio(INK_DARK, background)
		? INK_LIGHT
		: INK_DARK

/** One tooltip row. A summary statistic (a box's "Median") isn't a variable
 * of its own: it names the variable it summarizes, so it prints with that
 * variable's format (`formatAs`) and follows that variable's "Fields shown"
 * checkbox (`shownWith`). Both default to the entry's own name. */
export type TooltipField = {
	name: string
	value: unknown
	formatAs?: string
	shownWith?: string
}

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
	 * cell aggregate for tiles, per slice for bars/pies). Values are RAW
	 * cells — the tooltip prints each one through the format its variable
	 * carries elsewhere on the chart (`lib/tooltipFormats.ts`), so a
	 * renderer must never pre-format them. */
	fields: Array<TooltipField>
	/** A LINE-level hover under "Show tooltips only at points": `fields`
	 * carries the line's connection value alone. Nothing is shown when that
	 * variable isn't among the Fields shown — not even a custom template,
	 * which would otherwise render with every placeholder empty. */
	seriesOnly?: boolean
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
	fields: ReadonlyArray<TooltipState["fields"][number]>
): string => {
	const map = new Map(fields.map((f) => [f.name, f.value]))
	return template.replaceAll(/\{\{\s*([^}]+?)\s*\}\}/g, (_, name) => {
		const trimmed = String(name).trim()
		return map.has(trimmed) ? htmlEscape(map.get(trimmed)) : ""
	})
}

/** Compose a `position: fixed` placement that keeps the tooltip on-screen
 * regardless of which corner of the chart the user is hovering. We assume
 * the tooltip is at most `maxWidth` wide and (heuristically) ~120 px tall
 * — close enough to clamp against the right/bottom edges. */
const clampToViewport = (
	clientX: number,
	clientY: number,
	maxWidth: number
): CSSProperties => {
	const view =
		typeof window === "undefined" ? { innerWidth: 0, innerHeight: 0 } : window
	// Prefer right-of-cursor, but flip when there isn't room.
	const fitsRight = clientX + TOOLTIP_OFFSET + maxWidth < view.innerWidth
	const left = fitsRight
		? clientX + TOOLTIP_OFFSET
		: Math.max(8, clientX - TOOLTIP_OFFSET - maxWidth)
	// Prefer just-above-cursor; clamp to viewport top/bottom.
	const top = Math.max(8, Math.min(view.innerHeight - 16, clientY - 8))
	return { left, top }
}

/** The resolved box (visual over theme — `resolveTooltipBox`), handed to
 * `.vc-tooltip` (vis-components.css) as custom properties. The box
 * PROPERTIES stay in the stylesheet so the Custom CSS rule, which comes
 * later in the cascade, still overrides them per property. Auto colors
 * leave their property unset so the stylesheet's light / dark fallbacks
 * apply. Exported for the Settings → Themes preview, which draws the same
 * box. */
export const boxVars = (box: ResolvedTooltipBox): Record<string, string> => {
	const vars: Record<string, string> = {
		"--vc-tooltip-max-width": `${box.maxWidth}px`,
		"--vc-tooltip-radius": `${box.cornerRadius}px`,
		"--vc-tooltip-opacity": String(box.backgroundOpacity),
		"--vc-tooltip-shadow": `${box.shadowSize}px`,
		"--vc-tooltip-shadow-color": box.shadowColor,
		"--vc-tooltip-shadow-opacity": String(box.shadowOpacity),
	}
	if (box.outlineColor) vars["--vc-tooltip-outline"] = box.outlineColor
	if (box.backgroundColor) {
		vars["--vc-tooltip-fill"] = box.backgroundColor
		vars.color = inkFor(box.backgroundColor)
	}
	return vars
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
	// Each variable prints with the format the user set for it elsewhere —
	// its axis first, then a quantitative legend, then its data labels.
	// Applied before BOTH render paths so a custom HTML template's
	// `{{Sales}}` reads "$1,235" like the axis does.
	const formats = useAtomValue(tooltipFieldFormatsAtom)
	// The box follows the LIVE theme (Settings → Themes → Tooltips) wherever
	// the visual hasn't pinned a setting of its own.
	const box = resolveTooltipBox(cfg, useCurrentTheme())
	if (!cfg.enabled) return null

	const fields = applyTooltipFormats(state.fields, formats)
	const visible = cfg.visibleFields
	const filtered =
		visible.length === 0
			? fields
			: fields.filter((f) => visible.includes(f.shownWith ?? f.name))
	if (
		filtered.length === 0 &&
		(state.seriesOnly || !(cfg.useCustomHtml && cfg.customHtml.trim()))
	)
		return null

	const style: CSSProperties = {
		position: "fixed",
		zIndex: 9999,
		...clampToViewport(state.clientX, state.clientY, box.maxWidth),
		...boxVars(box),
	}
	// A set background carries its own ink (see `boxVars`); the role
	// classes would otherwise print the UI's text color onto it.
	const ownInk = !!box.backgroundColor

	// Custom HTML AND custom CSS are OPT-IN via `useCustomHtml`. Enabling
	// the toggle seeds empty textareas with the defaults, but the checkbox
	// state alone decides whether template rendering + container CSS are
	// active — the sidebar hides both boxes when it's off, so nothing
	// hidden keeps styling the tooltip. This keeps the default
	// checkbox-driven tooltip in charge until power users opt out.
	const customHtmlActive = !!cfg.useCustomHtml && cfg.customHtml.trim() !== ""
	// Both boxes are written by one person and rendered for everyone who
	// opens the chart or its published embed, so neither goes to the page
	// as typed (`lib/tooltipSanitize.ts`). The template is cleaned AFTER
	// its values are filled in: a value lands inside the author's markup
	// (`style="color: {{Color}}"`), where escaping alone doesn't cover it.
	const customCss = cfg.useCustomHtml ? sanitizeTooltipCss(cfg.customCss.trim()) : null
	const customCssActive = customCss !== null && customCss !== ""
	const customHtml = customHtmlActive ? cfg.customHtml.trim() : ""
	const interpolated = customHtml
		? sanitizeTooltipHtml(renderTemplate(customHtml, fields))
		: ""

	const tooltip = (
		<>
			{customCssActive && (
				<style>{`.vc-tooltip { ${customCss} }`}</style>
			)}
			<div
				className="vc-tooltip pointer-events-none px-2.5 py-1.5 text-sm"
				style={style}
			>
				{customHtml ? (
					// The author's template with its values filled in, reduced
					// to formatting by `sanitizeTooltipHtml` above. Never pass
					// this prop a string that hasn't been through it.
					<div dangerouslySetInnerHTML={{ __html: interpolated }} />
				) : (
					// Rows WRAP: the name keeps its line, the value breaks across
					// as many lines as it needs inside the box's max width. A long
					// cell used to truncate to "…", which hid the one thing the
					// user hovered to read.
					filtered.map((f) => (
						<div key={f.name} className="flex gap-2">
							<span className={ownInk ? "shrink-0 opacity-75" : "shrink-0 vc-muted"}>
								{f.name}:
							</span>
							<span
								className={
									ownInk
										? "min-w-0 font-medium"
										: "min-w-0 font-medium vc-text"
								}
							>
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
