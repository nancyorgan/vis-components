/** Footer for the document-flow pages (library landing, settings). The
 * editor omits it — it fills the viewport and scrolls internally, so a band
 * there would only eat chart space. Intentionally empty for now — a colored
 * band that sits in normal flow after the page content (not pinned to the
 * viewport), so scrolling to the bottom reaches it. Height comes from
 * `--vc-footer-h` (vis-components.css). */
export const Footer = () => {
	return (
		<footer
			className="vc-rule-t vc-bg flex-shrink-0"
			style={{ height: "var(--vc-footer-h)" }}
		/>
	)
}
