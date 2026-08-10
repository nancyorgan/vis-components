/** Build a starter HTML template for the tooltip's "Custom HTML" field —
 *  what the user would otherwise see rendered when they hover, but expressed
 *  as an editable template. Enabling "Use custom HTML template" seeds an
 *  empty textarea with this, so the user sees concrete tags + their own
 *  field names and can edit from there ("reset" below the box restores it).
 *  Without this they were staring at an empty textarea with no idea what
 *  classes existed or what the placeholders should look like. */
export const buildDefaultTooltipHtml = (fields: string[]): string => {
	if (fields.length === 0) {
		return '<div class="vc-tooltip-row"><!-- map fields to your encodings, then click Reset to refresh this template --></div>'
	}
	return fields
		.map(
			(name) =>
				`<div class="vc-tooltip-row"><span class="vc-tooltip-name">${name}:</span> <span class="vc-tooltip-value">{{${name}}}</span></div>`
		)
		.join("\n")
}

/** Default CSS that mirrors what `HoverTooltip` applies via Tailwind classes
 *  on the `.vc-tooltip` container today. Editing this in the sidebar lets the
 *  user override the look-and-feel without us shipping a separate styling
 *  panel. The string is intentionally formatted with one rule per line so
 *  diffs in the textarea read clearly. */
export const DEFAULT_TOOLTIP_CSS = `border-radius: 0.375rem;
border: 1px solid #e7e5e4;
background: #ffffff;
padding: 0.375rem 0.625rem;
font-size: 0.875rem;
box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);`
