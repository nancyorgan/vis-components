/**
 * THE TIP CATALOG — every helper bubble the app can show, in one place.
 *
 * Edit freely: titles and bodies are plain strings, and the order of
 * MOMENTS is the order of priority. Nothing else needs to change when you
 * reword a tip, drop one, or move one to a different moment.
 *
 * ── How it's organized ──────────────────────────────────────────────────
 * A MOMENT is a short run of tips (aim for 3 at most) that appear one
 * after another, each pointing at one element, each closed with "OK".
 * A moment shows once, ever; when it finishes, it's done.
 *
 * ── When a moment shows ─────────────────────────────────────────────────
 * Three things must all be true:
 *   1. `page` matches the page the person is on.
 *   2. `when` (if given) is true — e.g. "a data set is loaded".
 *   3. Its `pace` allows it:
 *        "now"   — as soon as 1 and 2 hold. For the fundamentals someone
 *                  needs to get unstuck (first landing, first editor,
 *                  first data).
 *        "soon"  — at least SOON_GAP_MINUTES since the last tips closed.
 *                  For the next step in a flow they've just started.
 *        "arrival" — the next time the person ARRIVES on the page
 *                  (navigates to it from elsewhere, or loads it), one
 *                  moment per arrival, and at least ARRIVAL_GAP_MINUTES
 *                  since the last tips closed. The landing page uses this:
 *                  each return to it teaches one more thing.
 *        "sight" — when one of its anchors first comes into view (an
 *                  options panel opened, a section expanded), and at
 *                  least SIGHT_GAP_SECONDS since the last tips closed, so
 *                  opening a busy panel never sets off a chain of them.
 *                  For explaining a control the first time it's seen.
 *        "later" — only on a visit that hasn't shown any tips yet, and
 *                  at least LATER_GAP_MINUTES since the last tips closed.
 *                  So at most ONE "later" moment per visit, never on the
 *                  heels of other tips. A visit is a browser tab; one
 *                  left open longer than VISIT_HOURS counts as a new one.
 *                  For feature discovery once the basics are in hand.
 * On top of that, nothing shows while a menu is open or while the person
 * is typing, and over a dialog only that dialog's own moment (`dialog`)
 * can show, and a moment waits a moment (SETTLE_MS) after its
 * conditions come true so it never lands mid-click.
 *
 * ── Anchors ─────────────────────────────────────────────────────────────
 * `anchor` names the element a tip points at: the element carrying
 * `data-tip="<anchor>"`. Every left-menu section gets one for free:
 * `section-<title in kebab case>` (e.g. "Aesthetics & Theme" →
 * `section-aesthetics-theme`), and every encoding row gets
 * `shelf-<channel id>` (e.g. `shelf-facet`). The first VISIBLE match wins.
 * A tip whose anchor isn't on screen (a collapsed section, a phone
 * layout) is quietly skipped; a moment with no anchors on screen waits.
 *
 * ── Previewing ──────────────────────────────────────────────────────────
 * Add `?tips=reset` to any URL to forget which tips were seen, and
 * `?tips=fast` to drop the pacing waits for this tab (conditions still
 * apply) — handy for walking the whole sequence. `?tips=off` / `?tips=on`
 * switch tips off and back on for this browser.
 */

export type TipPage = "library" | "editor" | "settings"

export type TipPlacement = "top" | "bottom" | "left" | "right"

export type Tip = {
	/** Stable id; renaming it re-shows nothing (moments are what's tracked). */
	id: string
	anchor: string
	body: string
	/** Preferred side of the anchor; flips automatically when it won't fit. */
	placement?: TipPlacement
}

/** What a moment's `when` can look at. Milestones are sticky: once true,
 *  they stay true across visits. */
export type TipSignals = {
	/** The editor has a data set bound. */
	hasData: boolean
	/** The editor's chart has at least one field mapped. */
	hasChart: boolean
	/** Has ever opened the editor. */
	editorVisited: boolean
	/** Has ever had a chart drawn in the editor. */
	chartMade: boolean
	/** How many visits (browser tabs/sessions) so far, this one included. */
	visits: number
}

export type TipPace = "now" | "soon" | "arrival" | "sight" | "later"

export type TipMoment = {
	id: string
	page: TipPage
	pace: TipPace
	when?: (s: TipSignals) => boolean
	/** Narrow `page` to URL paths matching this, e.g. /^\/settings\/fonts/. */
	path?: RegExp
	/** Show only inside this dialog (its Modal's `tipDialog`), the first
	 *  time it's open. Moments without one never show over a dialog. */
	dialog?: string
	tips: Tip[]
}

export const SOON_GAP_MINUTES = 2
export const ARRIVAL_GAP_MINUTES = 1
export const SIGHT_GAP_SECONDS = 45
export const LATER_GAP_MINUTES = 10
export const SETTLE_MS = 300
export const VISIT_HOURS = 6

export const TIP_MOMENTS: TipMoment[] = [
	// ── Day one: the fundamentals ────────────────────────────────────────
	{
		id: "landing-welcome",
		page: "library",
		pace: "now",
		tips: [
			{
				id: "new-visual",
				anchor: "new-visual",
				body: "New visualization opens the editor on a blank canvas. Import your data there.",
				placement: "bottom",
			},
			{
				id: "new-visual-menu",
				anchor: "new-visual-menu",
				body: "Start from a saved template, or import a visualization someone sent you.",
				placement: "bottom",
			},
			{
				id: "new-folder",
				anchor: "new-folder",
				body: "Click + to make a folder. Your visualizations live here; click one to see what's inside.",
				placement: "right",
			},
		],
	},
	{
		id: "editor-start",
		page: "editor",
		pace: "now",
		when: (s) => !s.hasData,
		tips: [
			{
				id: "upload-data",
				anchor: "upload-data",
				body: "Upload a CSV to get started. The first row should be the column names.",
				placement: "right",
			},
			{
				id: "paste-data",
				anchor: "paste-data",
				body: "Copy-paste rows from a spreadsheet and paste them here.",
				placement: "top",
			},
			{
				id: "visual-title",
				anchor: "visual-title",
				body: "Give your visualization a name, then hit save to keep it in your library.",
				placement: "bottom",
			},
		],
	},
	{
		id: "editor-data",
		page: "editor",
		pace: "now",
		when: (s) => s.hasData,
		tips: [
			{
				id: "fields",
				anchor: "section-fields",
				body: "Each column has a specific data type: quantitative, categorical, ordinal, or temporal. Change types to make the data behave differently.",
				placement: "right",
			},
			{
				id: "quickstart",
				anchor: "quickstart",
				body: "Not sure where to begin? Use Quickstart to randomly generate a chart using your data, then tweak it to your liking.",
				placement: "right",
			},
			{
				id: "encodings",
				anchor: "section-encodings",
				body: "Assign variables to X, Y, Color, Length and more. The chart type follows from the variables you encode.",
				placement: "right",
			},
		],
	},
	{
		id: "editor-first-chart",
		page: "editor",
		pace: "soon",
		when: (s) => s.hasChart,
		tips: [
			{
				id: "encoding-options",
				anchor: "encoding-options",
				body: "Open a row's main menu to see the full options.",
				placement: "right",
			},
			{
				id: "titles",
				anchor: "section-titles",
				body: "Add a title, subtitle, and axis titles here.",
				placement: "right",
			},
			{
				id: "export",
				anchor: "export",
				body: "Export downloads a visualization as an image or publishes the chart for slides and web pages.",
				placement: "bottom",
			},
		],
	},
	{
		id: "edit-dialog",
		page: "editor",
		dialog: "edit-data",
		pace: "now",
		tips: [
			{
				id: "edit-grid",
				anchor: "edit-grid",
				body: "Click a cell to edit it, just like in a spreadsheet.",
				placement: "top",
			},
			{
				id: "edit-add-column",
				anchor: "edit-add-column",
				body: "Add a column or a row with the +. Right-click to delete rows or columns.",
				placement: "left",
			},
			{
				id: "edit-data-name",
				anchor: "edit-data-name",
				body: "Edits save as a new data set version, so your original data stays untouched. See the versions in the page header.",
				placement: "top",
			},
		],
	},
	{
		id: "export-dialog",
		page: "editor",
		dialog: "export",
		pace: "now",
		tips: [
			{
				id: "export-embed-tab",
				anchor: "export-embed-tab",
				body: "Publish puts the chart online: picture links for slides and documents, or an iframe for a page.",
				placement: "bottom",
			},
			{
				id: "export-image-tab",
				anchor: "export-image-tab",
				body: "Download image saves a PNG, JPEG, SVG or PDF at the size you choose.",
				placement: "bottom",
			},
		],
	},
	{
		id: "landing-organize",
		page: "library",
		pace: "arrival",
		when: (s) => s.chartMade,
		tips: [
			{
				id: "card-actions",
				anchor: "library-card",
				body: "Hover a card for its actions. Tick its corner box to work on several at once, or drag it onto a folder.",
				placement: "bottom",
			},
			{
				id: "library-view",
				anchor: "library-view",
				body: "Table view lists everything with sortable columns.",
				placement: "bottom",
			},
			{
				id: "trash",
				anchor: "trash",
				body: "Deleted visualizations wait here. Open it to restore one, or empty it for good.",
				placement: "left",
			},
		],
	},

	// Each later return to the landing page: one of these, in order.
	{
		id: "landing-find",
		page: "library",
		pace: "arrival",
		tips: [
			{
				id: "library-search",
				anchor: "library-search",
				body: "Search by name, or filter to visualizations built on one data set.",
				placement: "bottom",
			},
			{
				id: "library-kind",
				anchor: "library-kind",
				body: "Templates you save live here too. Switch to see them, or both at once.",
				placement: "bottom",
			},
		],
	},
	{
		id: "landing-folders",
		page: "library",
		pace: "arrival",
		when: (s) => s.chartMade,
		tips: [
			{
				id: "file-into-folder",
				anchor: "new-folder",
				body: "Drag a card onto a folder to file it. Folders can hold folders, too.",
				placement: "right",
			},
			{
				id: "folder-row",
				anchor: "folder-row",
				body: "Hover a folder to add a subfolder or delete it. Double-click its name to rename it.",
				placement: "right",
			},
		],
	},
	{
		id: "landing-settings",
		page: "library",
		pace: "arrival",
		tips: [
			{
				id: "settings",
				anchor: "settings",
				body: "Settings holds your themes, fonts and sharing. Set a house style once; every chart can use it.",
				placement: "bottom",
			},
		],
	},
	{
		id: "landing-share",
		page: "library",
		pace: "arrival",
		when: (s) => s.chartMade,
		tips: [
			{
				id: "import-json",
				anchor: "new-visual-menu",
				body: "Import from JSON brings in a visualization, or a whole library, that someone shared with you.",
				placement: "bottom",
			},
			{
				id: "bulk-download",
				anchor: "library-card",
				body: "Tick several cards' corner boxes to move, duplicate or download them together.",
				placement: "bottom",
			},
		],
	},

	// ── First sight: a control explained the first time it comes into view
	{
		id: "sight-customized-dot",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "customized-dot",
				anchor: "customized-dot",
				body: "A dot means something here was changed from the default. Follow the dots to find every change.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-color",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "color-swatch",
				anchor: "color-swatch",
				body: "Click a swatch to pick any color, or type a hex code beside it.",
				placement: "right",
			},
			{
				id: "palette-picker",
				anchor: "palette-picker",
				body: "The palette icon picks a color straight from your theme.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-reset",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "reset-link",
				anchor: "reset-link",
				body: "Reset puts a setting back to its default.",
				placement: "left",
			},
		],
	},
	{
		id: "sight-stack-mode",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "stack-mode",
				anchor: "stack-mode",
				body: "Stack the pieces of each bar, set them side by side, or overlay them.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-color-rules",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "color-rules",
				anchor: "color-rules",
				body: "Color rules color marks by a condition, like red for anything under zero.",
				placement: "left",
			},
		],
	},
	{
		id: "sight-axis",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "axis-scale",
				anchor: "axis-scale",
				body: "Set the axis range here. Leave it blank to fit your data.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-number-format",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "number-format",
				anchor: "number-format",
				body: "Show numbers as currency, percents, thousands and more.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-jump-link",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "jump-link",
				anchor: "jump-link",
				body: "Links like this take you to a related setting elsewhere in the menu.",
				placement: "left",
			},
		],
	},
	{
		id: "sight-area-fill",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "area-fill",
				anchor: "area-fill",
				body: "Check this to turn your lines into filled areas.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-custom-shape",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "custom-shape",
				anchor: "custom-shape",
				body: "Make your own shape from a few characters or an image.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-facet-dimension",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "facet-dimension",
				anchor: "facet-dimension",
				body: "Choose how many rows or columns of panels to make, or leave it blank for an automatic grid.",
				placement: "right",
			},
		],
	},
	{
		id: "sight-a11y-findings",
		page: "editor",
		pace: "sight",
		tips: [
			{
				id: "a11y-finding",
				anchor: "a11y-finding",
				body: "Hover a finding to outline the problem on your chart.",
				placement: "left",
			},
		],
	},
	{
		id: "sight-theme-palettes",
		page: "settings",
		path: /^\/settings\/themes\/[^/]+/,
		pace: "sight",
		tips: [
			{
				id: "palette-default",
				anchor: "palette-default",
				body: "The star marks the palette new charts use first.",
				placement: "right",
			},
			{
				id: "add-palette",
				anchor: "add-palette",
				body: "Add palette makes a new set of colors for this theme.",
				placement: "right",
			},
		],
	},

	// ── Later visits: one discovery moment at a time ─────────────────────
	{
		id: "editor-data-tools",
		page: "editor",
		pace: "later",
		when: (s) => s.hasData,
		tips: [
			{
				id: "rename-field",
				anchor: "field-name",
				body: "Click a field's name to rename it. Your chart and later uploads follow along.",
				placement: "right",
			},
			{
				id: "reshape",
				anchor: "reshape-data",
				body: "Years spread across columns? Reshape stacks them into one long column, or spreads them back out.",
				placement: "top",
			},
			{
				id: "edit-data",
				anchor: "edit-data",
				body: "Fix a typo or add a row in a spreadsheet-style editor. Your original data stays untouched.",
				placement: "top",
			},
		],
	},
	{
		id: "editor-checks",
		page: "editor",
		pace: "later",
		when: (s) => s.hasChart,
		tips: [
			{
				id: "a11y-check",
				anchor: "a11y-check",
				body: "Lists anything that may be hard to read — low contrast, tiny text, colors that clash.",
				placement: "bottom",
			},
			{
				id: "bw-toggle",
				anchor: "bw-toggle",
				body: "Does your chart still read without color? Check here; nothing is saved.",
				placement: "bottom",
			},
			{
				id: "alt-text",
				anchor: "section-accessibility",
				body: "Write the description screen readers announce for this chart.",
				placement: "right",
			},
		],
	},
	// ── Settings: each page explained on its first visit
	{
		id: "settings-tour",
		page: "settings",
		path: /^\/settings(\/themes)?\/?$/,
		pace: "now",
		tips: [
			{
				id: "theme-card",
				anchor: "theme-card",
				body: "A theme sets the colors, fonts and spacing of every chart that uses it. Click one to open it.",
				placement: "bottom",
			},
			{
				id: "add-theme",
				anchor: "add-theme",
				body: "Start a new theme from an existing one, or import a theme file.",
				placement: "bottom",
			},
			{
				id: "nav-fonts",
				anchor: "nav-fonts",
				body: "Fonts, Accessibility and Sharing each have a page of their own.",
				placement: "right",
			},
		],
	},
	{
		id: "settings-theme-kinds",
		page: "settings",
		path: /^\/settings(\/themes)?\/?$/,
		pace: "arrival",
		tips: [
			{
				id: "theme-lock",
				anchor: "theme-lock",
				body: "Locked themes can't be changed here. Copy a System theme to make your own; Managed themes are shared, so editing needs an administrator.",
				placement: "right",
			},
			{
				id: "theme-default",
				anchor: "theme-default",
				body: "New charts start with the theme marked Default.",
				placement: "bottom",
			},
		],
	},
	{
		id: "settings-theme-editor",
		page: "settings",
		path: /^\/settings\/themes\/[^/]+/,
		pace: "now",
		tips: [
			{
				id: "theme-previews",
				anchor: "theme-previews",
				body: "These previews redraw as you edit, so you can see each change right away.",
				placement: "bottom",
			},
			{
				id: "theme-section",
				anchor: "theme-section",
				body: "Each section styles one part of every chart: text, axes, legends, palettes and more. Click one to open it.",
				placement: "top",
			},
			{
				id: "theme-done",
				anchor: "theme-done",
				body: "Done saves your changes.",
				placement: "top",
			},
		],
	},
	{
		id: "settings-fonts",
		page: "settings",
		path: /^\/settings\/fonts/,
		pace: "now",
		tips: [
			{
				id: "font-name",
				anchor: "font-name",
				body: "Type any Google Fonts name and click Add font. It's then ready to use in every theme.",
				placement: "bottom",
			},
		],
	},
	{
		id: "settings-accessibility",
		page: "settings",
		path: /^\/settings\/accessibility/,
		pace: "now",
		tips: [
			{
				id: "contrast-model",
				anchor: "contrast-model",
				body: "Choose how text contrast is measured. The editor's accessibility check uses your choice.",
				placement: "bottom",
			},
		],
	},
	{
		id: "settings-sharing",
		page: "settings",
		path: /^\/settings\/sharing/,
		pace: "now",
		tips: [
			{
				id: "download-bundle",
				anchor: "download-bundle",
				body: "Download your whole library (charts, data and themes) as one file. Keep it as a backup, or share it.",
				placement: "bottom",
			},
			{
				id: "import-bundle",
				anchor: "import-bundle",
				body: "Import adds a bundle's contents to your library. Nothing of yours is replaced.",
				placement: "bottom",
			},
		],
	},
	{
		id: "editor-polish",
		page: "editor",
		pace: "later",
		when: (s) => s.hasChart,
		tips: [
			{
				id: "data-labels",
				anchor: "section-data-labels",
				body: "Print values right on the marks — totals, percents, or any field.",
				placement: "right",
			},
			{
				id: "legend",
				anchor: "section-legend",
				body: "Move, resize, retitle or hide the legend.",
				placement: "right",
			},
			{
				id: "tooltips",
				anchor: "section-tooltips-and-hover",
				body: "Choose what shows when someone hovers over a mark.",
				placement: "right",
			},
		],
	},
	{
		id: "editor-theme",
		page: "editor",
		pace: "later",
		when: (s) => s.hasChart,
		tips: [
			{
				id: "aesthetics-theme",
				anchor: "section-aesthetics-theme",
				body: "Switch this chart's theme, or adjust its background, margins and canvas size.",
				placement: "right",
			},
			{
				id: "undo",
				anchor: "undo",
				body: "Undo and redo cover every change — ⌘Z / Ctrl+Z works too.",
				placement: "bottom",
			},
		],
	},
	{
		id: "editor-fields-more",
		page: "editor",
		pace: "later",
		when: (s) => s.hasData,
		tips: [
			{
				id: "new-variable",
				anchor: "new-variable",
				body: "Make a new field from a formula, like a ratio or a percent change.",
				placement: "left",
			},
			{
				id: "field-levels",
				anchor: "field-levels",
				body: "Open a categorical field's arrow to reorder its values. Every chart axis and legend follows.",
				placement: "right",
			},
		],
	},
	{
		id: "editor-annotate",
		page: "editor",
		pace: "later",
		when: (s) => s.hasChart,
		tips: [
			{
				id: "annotations",
				anchor: "section-annotations",
				body: "Call out a point, shade a range, or add a note anywhere on the chart.",
				placement: "right",
			},
			{
				id: "caption",
				anchor: "section-caption",
				body: "Credit your source or add a footnote under the chart.",
				placement: "right",
			},
		],
	},
	{
		id: "editor-more-views",
		page: "editor",
		pace: "later",
		when: (s) => s.hasChart,
		tips: [
			{
				id: "facets",
				anchor: "shelf-facet",
				body: "Map a field to Facet to split the chart into one panel per value — or pick Two variables… for a rows × columns grid.",
				placement: "right",
			},
			{
				id: "maps",
				anchor: "section-maps",
				body: "Have states, countries or ZIP codes? Quickstart's map icon draws them on a map.",
				placement: "right",
			},
		],
	},
	{
		id: "editor-reuse",
		page: "editor",
		pace: "later",
		when: (s) => s.chartMade && s.visits >= 3,
		tips: [
			{
				id: "templates",
				anchor: "export",
				body: "In Export, save this chart as a template. Then New → From template starts from it with fresh data.",
				placement: "bottom",
			},
			{
				id: "new-same-data",
				anchor: "new-visual-menu",
				body: "Start another visualization with this data set already loaded.",
				placement: "bottom",
			},
		],
	},
]
