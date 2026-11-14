/** List the controls inside a sidebar options panel: what each is, the
 *  subsection it sits in, and the label a person reads beside it.
 *
 *  One function for two callers:
 *    - the browser sweeps (`e2e/sweep/`) pass it to `page.evaluate`, so it
 *      runs in the page;
 *    - the panel matrix test runs it directly against the test DOM.
 *  Because it is serialized into the page, it must stay SELF-CONTAINED: no
 *  imports, no references to anything outside its own body. */

export type ControlKind =
	| "select"
	| "number"
	| "hex"
	| "text"
	| "checkbox"
	| "radio"
	| "range"
	| "toggle"
	| "segment"
	| "enable"
	| "action"

export type ControlInfo = {
	/** Position in this scan; the element carries it as `data-sweep-idx`. */
	idx: number
	/** Stable identity within the panel, so a control can be found again in
	 *  a later scan: section, label, kind and its ordinal among twins. */
	key: string
	kind: ControlKind
	/** Titles of the collapsible subsections around it, outermost first. */
	section: string
	label: string
	disabled: boolean
	/** The field value, or "on" / "off" for checkboxes and choice buttons. */
	value: string
	/** Selects: every option. */
	options?: Array<{ value: string; label: string; disabled: boolean }>
	selectedIndex?: number
	/** Sliders. */
	min?: number
	max?: number
}

export type ControlScan = {
	/** The root element exists. */
	found: boolean
	/** The "Not in effect while … is mapped" note when the panel is greyed
	 *  out and inert, else null. */
	blocked: string | null
	/** Help text shown in the panel. */
	notes: string[]
	/** Subsection titles in display order. */
	sections: string[]
	controls: ControlInfo[]
}

export const scanControls = (rootSelector: string): ControlScan => {
	const root = document.querySelector(rootSelector)
	if (!root) return { found: false, blocked: null, notes: [], sections: [], controls: [] }

	const clean = (text: string | null | undefined): string =>
		(text ?? "").replace(/\s+/g, " ").trim()

	/** The header button of a collapsible subsection, when `el` is one
	 *  (components/ui/CollapsibleSubsection: root > div > button). */
	const headerOf = (el: Element): Element | null => {
		if (!el.classList.contains("vc-jump-target")) return null
		const bar = el.children[0]
		const button = bar?.children[0]
		return button && button.tagName === "BUTTON" && button.hasAttribute("aria-expanded")
			? button
			: null
	}
	const isHeader = (el: Element): boolean => {
		const section = el.parentElement?.parentElement
		return !!section && headerOf(section) === el
	}

	const notes = [...root.querySelectorAll(".vc-help")]
		.map((n) => clean(n.textContent))
		.filter((t) => t.length > 0)
	const blocked = root.classList.contains("pointer-events-none")
		? (notes[0] ?? "Options are greyed out")
		: null
	const sections = [...root.querySelectorAll(".vc-jump-target")]
		.map((s) => headerOf(s))
		.filter((h): h is Element => h !== null)
		.map((h) => clean(h.textContent))

	const sectionOf = (el: Element): string => {
		const parts: string[] = []
		for (let cur = el.parentElement; cur && cur !== root; cur = cur.parentElement) {
			const header = headerOf(cur)
			if (header) parts.unshift(clean(header.textContent))
		}
		return parts.join(" › ")
	}

	const hasControl = (el: Element): boolean =>
		el.matches("select, input, button, textarea") ||
		el.querySelector("select, input, textarea") !== null

	/** The label a hand-built row gives its control: the first sibling
	 *  <span> (of the control or of a wrapper) that carries text. */
	const rowLabelOf = (el: Element): string => {
		for (let up: Element | null = el; up && up !== root; up = up.parentElement) {
			const parent: Element | null = up.parentElement
			if (!parent) break
			const span = [...parent.children].find(
				(c) => c !== up && c.tagName === "SPAN" && clean(c.textContent).length > 0
			)
			if (span) return clean(span.textContent)
			if (parent.classList.contains("vc-subsection-card")) break
		}
		return ""
	}

	const labelOf = (el: Element): string => {
		const aria = el.getAttribute("aria-label")
		if (aria) return aria.trim()
		// A button names itself; the row's label (if any) names its group.
		if (el.tagName === "BUTTON") {
			const own = clean(el.textContent) || clean(el.getAttribute("title"))
			const group = rowLabelOf(el)
			return group && own && group !== own ? `${group}: ${own}` : own || group
		}
		const wrapping = el.closest("label")
		if (wrapping) {
			// The first text-bearing child is the label; anything after it is a
			// readout ("60%") or the control.
			const first = [...wrapping.children].find(
				(c) => !hasControl(c) && clean(c.textContent).length > 0
			)
			if (first) return clean(first.textContent)
			const direct = [...wrapping.childNodes]
				.filter((n) => n.nodeType === 3)
				.map((n) => n.textContent ?? "")
				.join(" ")
			if (clean(direct)) return clean(direct)
		}
		const id = el.getAttribute("id")
		if (id) {
			const forLabel = [...document.querySelectorAll("label")].find(
				(l) => l.getAttribute("for") === id
			)
			if (forLabel) return clean(forLabel.textContent)
		}
		const fromRow = rowLabelOf(el)
		if (fromRow) return fromRow
		const title = el.getAttribute("title")
		if (title) return title.trim()
		return clean(el.textContent)
	}

	const controls: ControlInfo[] = []
	const seen = new Map<string, number>()
	let idx = 0
	for (const el of root.querySelectorAll("select, input, button")) {
		if (isHeader(el)) continue
		const tag = el.tagName.toLowerCase()
		const type = (el.getAttribute("type") ?? "").toLowerCase()
		const label = labelOf(el).slice(0, 80)
		const input = el as HTMLInputElement
		let kind: ControlKind
		if (tag === "select") kind = "select"
		else if (tag === "input" && type === "checkbox") kind = "checkbox"
		else if (tag === "input" && type === "radio") kind = "radio"
		else if (tag === "input" && type === "range") kind = "range"
		else if (tag === "input") {
			const spinner = el.parentElement?.querySelector('button[aria-label="Increment"]')
			if (spinner) kind = "number"
			else if (/ hex$/i.test(label) || /^#[0-9a-f]{3,8}$/i.test(input.value)) kind = "hex"
			else kind = "text"
		} else if (el.getAttribute("role") === "radio") kind = "segment"
		else if (el.hasAttribute("aria-pressed")) kind = "toggle"
		else if (/^enable override$/i.test(label)) kind = "enable"
		else kind = "action"

		const section = sectionOf(el)
		const base = `${section}|${label}|${kind}`
		const ordinal = seen.get(base) ?? 0
		seen.set(base, ordinal + 1)
		el.setAttribute("data-sweep-idx", String(idx))

		let value = ""
		if (kind === "checkbox" || kind === "radio") value = input.checked ? "on" : "off"
		else if (kind === "segment") value = el.getAttribute("aria-checked") === "true" ? "on" : "off"
		else if (kind === "toggle") value = el.getAttribute("aria-pressed") === "true" ? "on" : "off"
		else if (tag === "input" || tag === "select") value = String(input.value)

		const info: ControlInfo = {
			idx,
			key: `${base}#${ordinal}`,
			kind,
			section,
			label,
			disabled: (el as HTMLButtonElement).disabled === true,
			value,
		}
		if (tag === "select") {
			const select = el as HTMLSelectElement
			info.options = [...select.options].map((o) => ({
				value: o.value,
				label: clean(o.textContent),
				disabled: o.disabled,
			}))
			info.selectedIndex = select.selectedIndex
		}
		if (kind === "range") {
			info.min = Number(input.min || 0)
			info.max = Number(input.max || 1)
		}
		controls.push(info)
		idx++
	}
	return { found: true, blocked, notes, sections, controls }
}

/** Open every collapsed subsection under `rootSelector`. Returns how many
 *  it opened; call until it returns 0 (opening one can reveal more). Same
 *  self-contained rule as `scanControls`. */
export const expandSubsections = (rootSelector: string): number => {
	const root = document.querySelector(rootSelector)
	if (!root) return 0
	let opened = 0
	for (const section of root.querySelectorAll(".vc-jump-target")) {
		const button = section.children[0]?.children[0]
		if (
			button &&
			button.tagName === "BUTTON" &&
			button.getAttribute("aria-expanded") === "false"
		) {
			;(button as HTMLButtonElement).click()
			opened++
		}
	}
	return opened
}
