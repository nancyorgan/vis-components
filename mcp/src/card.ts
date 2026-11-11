/** The chart card: an MCP App view (ui://zafiro/chart.html) that hosts
 *  with MCP Apps support draw beside create_chart, edit_chart,
 *  undo_chart_edit and get_chart results. One self-contained page (inline
 *  CSS and JS, no network), speaking the MCP Apps protocol (2026-01-26)
 *  with the host over postMessage JSON-RPC:
 *
 *  - `ui/initialize` first, then `ui/notifications/initialized`;
 *  - on `ui/notifications/tool-result`: name and editorUrl from the first
 *    text block's JSON merged with structuredContent; the picture fetched
 *    in slices with `tools/call` to chart_picture (by the result's
 *    pictureKey) and shown as a data: URL; with no picture, the result's
 *    no-picture line; on a refusal, its first line;
 *  - height reported with `ui/notifications/size-changed`;
 *  - "Open in editor" through `ui/open-link`; "Full screen" through
 *    `ui/request-display-mode`, offered only when the host lists it;
 *  - answers `ping` and `ui/resource-teardown`.
 *
 *  Light and dark follow `color-scheme` and the host's style variables;
 *  the plot keeps a white background. */

const STYLE = `
:root {
	color-scheme: light dark;
	--color-background-primary: light-dark(#ffffff, #1a1a1a);
	--color-background-secondary: light-dark(#f4f4f5, #27272a);
	--color-text-primary: light-dark(#18181b, #fafafa);
	--color-text-secondary: light-dark(#52525b, #b4b4bb);
	--color-border-primary: light-dark(#d4d4d8, #3f3f46);
	--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	--font-weight-semibold: 600;
	--font-text-sm-size: 13px;
	--font-heading-sm-size: 15px;
	--border-radius-md: 8px;
}
html, body { margin: 0; padding: 0; }
body {
	background: var(--color-background-primary);
	color: var(--color-text-primary);
	font-family: var(--font-sans);
	font-size: var(--font-text-sm-size);
}
.card { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
h1 {
	flex: 1 1 auto; min-width: 0; margin: 0;
	font-size: var(--font-heading-sm-size); font-weight: var(--font-weight-semibold);
	overflow-wrap: anywhere;
}
.actions { display: flex; gap: 6px; }
button {
	font: inherit; cursor: pointer; padding: 5px 10px;
	color: var(--color-text-primary); background: var(--color-background-secondary);
	border: 1px solid var(--color-border-primary); border-radius: var(--border-radius-md);
}
button:hover { filter: brightness(0.96); }
[hidden] { display: none !important; }
.plot {
	background: #ffffff; border: 1px solid var(--color-border-primary);
	border-radius: var(--border-radius-md); overflow: hidden;
}
.plot img { display: block; width: 100%; height: auto; }
.placeholder { margin: 0; padding: 48px 12px; text-align: center; color: #52525b; }
.line, .link { margin: 0; color: var(--color-text-secondary); overflow-wrap: anywhere; }
`

/** The page's script: plain ES2017, no imports. */
const SCRIPT = `
(function () {
	"use strict";
	var PROTOCOL = "2026-01-26";
	var IMAGE_TYPES = ["image/png", "image/webp", "image/jpeg"];
	var host = window.parent;
	var nextId = 1;
	var pending = {};
	var ctx = {};
	var ready = false;
	var gone = false;
	var shown = 0;
	var lastHeight = -1;
	var view = { name: "", editorUrl: "", line: "", link: "", src: "", loading: true };

	function el(id) { return document.getElementById(id); }
	function send(message) { if (!gone) host.postMessage(message, "*"); }
	function request(method, params) {
		var id = nextId++;
		var answer = new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
		send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
		return answer;
	}
	function notify(method, params) { send({ jsonrpc: "2.0", method: method, params: params || {} }); }
	function textOf(block) { return block && block.type === "text" && typeof block.text === "string" ? block.text : ""; }
	function firstLine(text) { return String(text || "").split("\\n")[0]; }

	function reportSize() {
		if (!ready || gone || ctx.displayMode === "fullscreen") return;
		var height = Math.ceil(document.body.getBoundingClientRect().height || document.body.scrollHeight || 0);
		if (height === lastHeight) return;
		lastHeight = height;
		notify("ui/notifications/size-changed", { height: height });
	}

	function draw() {
		el("name").textContent = view.name || "Chart";
		el("open").hidden = !view.editorUrl;
		var modes = Array.isArray(ctx.availableDisplayModes) ? ctx.availableDisplayModes : [];
		var full = el("full");
		full.hidden = modes.indexOf("fullscreen") < 0;
		full.textContent = ctx.displayMode === "fullscreen" ? "Exit full screen" : "Full screen";
		el("placeholder").hidden = !view.loading;
		var img = el("picture");
		if (view.src) {
			if (img.getAttribute("src") !== view.src) img.setAttribute("src", view.src);
			img.setAttribute("alt", view.name ? "Chart: " + view.name : "Chart");
			img.hidden = false;
		} else {
			img.removeAttribute("src");
			img.hidden = true;
		}
		el("plot").hidden = !view.src && !view.loading;
		el("line").textContent = view.line;
		el("line").hidden = !view.line;
		el("link").textContent = view.link;
		el("link").hidden = !view.link;
		reportSize();
	}

	function applyContext(next) {
		if (!next || typeof next !== "object") return;
		for (var key in next) ctx[key] = next[key];
		var root = document.documentElement;
		if (next.theme === "light" || next.theme === "dark") {
			root.style.colorScheme = next.theme;
			root.setAttribute("data-theme", next.theme);
		}
		var vars = next.styles && next.styles.variables;
		if (vars && typeof vars === "object")
			for (var name in vars)
				if (name.indexOf("--") === 0 && typeof vars[name] === "string") root.style.setProperty(name, vars[name]);
	}

	function fetchPicture(key) {
		var parts = [];
		function from(offset) {
			return request("tools/call", { name: "chart_picture", arguments: { picture_key: key, offset: offset } }).then(
				function (result) {
					var slice = result && result.structuredContent;
					if (!result || result.isError || !slice || typeof slice.data !== "string")
						throw new Error(firstLine(textOf(result && result.content && result.content[0])) || "no picture");
					if (IMAGE_TYPES.indexOf(slice.mimeType) < 0) throw new Error("not an image");
					parts.push(slice.data);
					var reached = slice.offset + slice.data.length;
					if (reached < slice.total) {
						if (slice.data.length === 0) throw new Error("picture cut short");
						return from(reached);
					}
					return "data:" + slice.mimeType + ";base64," + parts.join("");
				}
			);
		}
		return from(0);
	}

	function onResult(result) {
		var turn = ++shown;
		result = result || {};
		var content = Array.isArray(result.content) ? result.content : [];
		var first = textOf(content[0]);
		var info = {};
		try {
			var parsed = JSON.parse(first);
			if (parsed && typeof parsed === "object") info = parsed;
		} catch (error) {}
		var structured = result.structuredContent;
		if (structured && typeof structured === "object") for (var key in structured) info[key] = structured[key];
		if (typeof info.name === "string") view.name = info.name;
		if (typeof info.editorUrl === "string") view.editorUrl = info.editorUrl;
		view.src = "";
		view.line = "";
		view.loading = false;
		if (result.isError) {
			view.line = firstLine(typeof info.message === "string" ? info.message : first);
			return draw();
		}
		var notes = content.slice(1).map(textOf).filter(Boolean);
		var image = content.filter(function (b) {
			return b && b.type === "image" && typeof b.data === "string" && IMAGE_TYPES.indexOf(b.mimeType) >= 0;
		})[0];
		var inline = image ? "data:" + image.mimeType + ";base64," + image.data : "";
		if (typeof info.pictureKey === "string") {
			view.loading = true;
			draw();
			fetchPicture(info.pictureKey).then(
				function (src) {
					if (turn !== shown) return;
					view.src = src;
					view.loading = false;
					draw();
				},
				function () {
					if (turn !== shown) return;
					view.src = inline;
					view.loading = false;
					if (!inline) view.line = "The picture didn't load; the chart is saved, and Open in editor shows it.";
					draw();
				}
			);
			return;
		}
		if (inline) view.src = inline;
		else view.line = notes[0] || "No picture came with this result; Open in editor shows the chart.";
		draw();
	}

	window.addEventListener("message", function (event) {
		if (event.source && event.source !== host) return;
		var message = event.data;
		if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;
		var hasId = message.id !== undefined && message.id !== null;
		if (typeof message.method === "string") {
			if (hasId) {
				if (message.method === "ping") return send({ jsonrpc: "2.0", id: message.id, result: {} });
				if (message.method === "ui/resource-teardown") {
					send({ jsonrpc: "2.0", id: message.id, result: {} });
					gone = true;
					return;
				}
				return send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
			}
			if (message.method === "ui/notifications/tool-result") onResult(message.params);
			else if (message.method === "ui/notifications/host-context-changed") {
				applyContext(message.params);
				draw();
			} else if (message.method === "ui/notifications/tool-cancelled") {
				view.loading = false;
				view.line = "The request was cancelled.";
				draw();
			}
			return;
		}
		if (hasId && pending[message.id]) {
			var waiting = pending[message.id];
			delete pending[message.id];
			if (message.error) waiting.reject(new Error(String(message.error.message || "error")));
			else waiting.resolve(message.result);
		}
	});

	el("open").addEventListener("click", function () {
		if (!view.editorUrl) return;
		var url = view.editorUrl;
		request("ui/open-link", { url: url }).then(
			function () {},
			function () {
				view.link = "Open the chart at " + url;
				draw();
			}
		);
	});

	el("full").addEventListener("click", function () {
		var mode = ctx.displayMode === "fullscreen" ? "inline" : "fullscreen";
		request("ui/request-display-mode", { mode: mode }).then(
			function (result) {
				if (result && typeof result.mode === "string") ctx.displayMode = result.mode;
				lastHeight = -1;
				draw();
			},
			function () {}
		);
	});

	if (typeof ResizeObserver === "function") new ResizeObserver(reportSize).observe(document.body);
	el("picture").addEventListener("load", reportSize);
	draw();

	request("ui/initialize", {
		appInfo: { name: "Zafiro chart card", version: "1.0.0" },
		appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
		protocolVersion: PROTOCOL,
	}).then(
		function (result) {
			applyContext(result && result.hostContext);
			notify("ui/notifications/initialized", {});
			ready = true;
			draw();
		},
		function () {
			notify("ui/notifications/initialized", {});
			ready = true;
			draw();
		}
	);
})();
`

export const CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zafiro chart</title>
<style>${STYLE}</style>
</head>
<body>
<main class="card">
<header>
<h1 id="name">Chart</h1>
<div class="actions">
<button type="button" id="open" hidden>Open in editor</button>
<button type="button" id="full" hidden>Full screen</button>
</div>
</header>
<div class="plot" id="plot">
<p class="placeholder" id="placeholder">Drawing the chart...</p>
<img id="picture" hidden alt="Chart">
</div>
<p class="line" id="line" hidden></p>
<p class="link" id="link" hidden></p>
</main>
<script>${SCRIPT}</script>
</body>
</html>
`
