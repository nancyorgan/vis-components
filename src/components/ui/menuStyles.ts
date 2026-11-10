/** Classes for the dropdown menus that hang off a split button (the
 *  header's "New visualization", the editor's "Save"): one item per row,
 *  a title line and a hint line, hairlines between items. */
export const MENU_ITEM =
	"block w-full px-3 py-2 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-stone-700"
export const MENU_ITEM_DIVIDED = `${MENU_ITEM} border-t border-stone-200 dark:border-stone-700`
export const MENU_TITLE = "vc-heading font-medium"
export const MENU_HINT = "text-sm vc-muted"
/** The menu's floating panel, anchored under the split button's right edge. */
export const MENU_PANEL =
	"absolute top-full right-0 z-20 mt-1 w-64 overflow-hidden rounded-md border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800"
