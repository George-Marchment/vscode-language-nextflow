import * as vscode from "vscode";
import { randomUUID } from "crypto";

/**
 * The controls and panels of metroflow, in the colors of the editor. Its own
 * styles are added to the page after these, hence the more specific selectors,
 * and the banner sets its colors inline, hence !important.
 */
const themeStyle = `<style>
  #metroflow-container .metroflow-toolbar .metroflow-btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  #metroflow-container .metroflow-toolbar .metroflow-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  #metroflow-container .metroflow-toolbar .metroflow-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  #metroflow-container .metroflow-toolbar .metroflow-btn::after {
    background: var(--vscode-editorHoverWidget-background);
    color: var(--vscode-editorHoverWidget-foreground);
    border: 1px solid var(--vscode-editorHoverWidget-border);
  }
  #metroflow-container .metroflow-export-panel,
  #metroflow-container .metro-aesthetics-panel {
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editorWidget-foreground);
    border: 1px solid var(--vscode-editorWidget-border, transparent);
    font-family: var(--vscode-font-family);
  }
  #metroflow-container .metroflow-export-panel .mf-row {
    border-top-color: var(--vscode-widget-border, var(--vscode-editorWidget-border));
  }
  #metroflow-container .metroflow-export-panel small,
  #metroflow-container .metro-aesthetics-panel .ma-hint,
  #metroflow-container .metroflow-export-panel .mf-close,
  #metroflow-container .metro-aesthetics-panel .ma-close {
    color: var(--vscode-descriptionForeground);
  }
  #metroflow-container .metroflow-export-panel button.mf-action,
  #metroflow-container .metro-aesthetics-panel .ma-btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border-color: transparent;
  }
  #metroflow-container .metroflow-export-panel button.mf-action:hover,
  #metroflow-container .metro-aesthetics-panel .ma-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  #metroflow-container .metroflow-export-panel .mf-status.error {
    color: var(--vscode-errorForeground);
  }
  #metroflow-container .metro-aesthetics-panel select,
  #metroflow-container .metro-aesthetics-panel .ma-palette {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border-color: var(--vscode-dropdown-border, transparent);
  }
  #metroflow-container .metro-aesthetics-panel .ma-palette.active {
    border-color: var(--vscode-focusBorder);
    box-shadow: none;
  }
  /* the logo is in the top left corner, so the focus banner goes below it */
  #metroflow-container .metroflow-focus-indicator {
    top: 64px !important;
    background: var(--vscode-editorWidget-background) !important;
    color: var(--vscode-descriptionForeground) !important;
    border-color: var(--vscode-editorWidget-border, transparent) !important;
  }
  #metroflow-container .metroflow-focus-indicator .mf-focus-label {
    color: var(--vscode-editorWidget-foreground) !important;
  }
</style>`;

/**
 * The page of the metro map. `stored` is what metroflow saved for this map
 * (its layout and the appearance), by key: the page keeps it up to date and
 * sends every change to the extension, which saves it (see `storage`
 * messages).
 */
export function buildMetroMapPreview(
  data: object,
  webview: vscode.Webview,
  mediaPath: vscode.Uri,
  imagesPath: vscode.Uri,
  stored: Record<string, string>
): string {
  const nonce = randomUUID();
  const media = (...segments: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(mediaPath, ...segments));
  const image = (name: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(imagesPath, name));

  // d3 and metroflow set inline styles, and the exports are drawn on data and
  // blob images.
  const csp = [
    "default-src 'none'",
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data: blob:`,
    `font-src ${webview.cspSource} data:`
  ].join("; ");

  // The data is read as text, so it only has to be kept from closing its tag
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const storedJson = JSON.stringify(stored).replace(/</g, "\\u003c");

  const scripts = [
    media("d3.min.js"),
    ...["core", "clike", "groovy", "python"].map((language) =>
      media("prism", `prism-${language}.min.js`)
    )
  ];

  return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="stylesheet" href="${media("prism", "prism-tomorrow.min.css")}">
    <style>
      html, body {
        margin: 0;
        height: 100%;
        overflow: hidden;
      }
      /* metroflow fills its container, which therefore needs a size */
      #metroflow-container {
        position: fixed;
        inset: 0;
      }
      /* The MetroFlow logo, with dark text on light themes and white text
         on dark ones. It lets the clicks through to the map. */
      .metroflow-logo {
        position: fixed;
        top: 12px;
        left: 12px;
        height: 40px;
        z-index: 9998;
        pointer-events: none;
        user-select: none;
      }
      .metroflow-logo.on-dark,
      body[data-vscode-theme-kind="vscode-dark"] .metroflow-logo.on-light,
      body[data-vscode-theme-kind="vscode-high-contrast"] .metroflow-logo.on-light {
        display: none;
      }
      body[data-vscode-theme-kind="vscode-dark"] .metroflow-logo.on-dark,
      body[data-vscode-theme-kind="vscode-high-contrast"] .metroflow-logo.on-dark {
        display: block;
      }
    </style>
    ${themeStyle}
  </head>
  <body>
    <div id="metroflow-container"></div>
    <img class="metroflow-logo on-light" src="${image("metroflow_logo.png")}" alt="MetroFlow">
    <img class="metroflow-logo on-dark" src="${image("metroflow_logo_white_text.png")}" alt="MetroFlow">
    <script type="application/json" id="metro-map-data">${json}</script>
    <script type="application/json" id="metro-map-storage">${storedJson}</script>
    ${scripts.map((src) => `<script src="${src}"></script>`).join("\n    ")}
    <script type="module" nonce="${nonce}">
      import { renderMetroflow } from "${media("metroflow", "metro_map.js")}";
      const vscode = acquireVsCodeApi();
      // metroflow moves the stations in the data it draws, so every render
      // starts from a fresh copy of the original map
      let json = document.getElementById("metro-map-data").textContent;
      const render = () =>
        renderMetroflow(JSON.parse(json), { ...options, theme: editorTheme() });

      // The extension sends the map again when its scripts change. It is
      // drawn with the same layout, zoom and pan.
      window.addEventListener("message", (event) => {
        if (event.data?.type === "update") {
          json = JSON.stringify(event.data.data);
          render();
        }
      });

      // The layout of this map and the appearance are kept by the extension,
      // the local storage of a webview being shared by all the maps
      const stored = JSON.parse(document.getElementById("metro-map-storage").textContent);
      const storage = {
        getItem: (key) => (key in stored ? stored[key] : null),
        setItem(key, value) {
          value = String(value);
          if (stored[key] === value) return;
          stored[key] = value;
          vscode.postMessage({ type: "storage", key, value });
        },
        removeItem(key) {
          if (!(key in stored)) return;
          delete stored[key];
          vscode.postMessage({ type: "storage", key, value: null });
        }
      };

      // The map itself is drawn by metroflow, with the colors of the editor.
      // Stations keep metroflow's colors (white with a dark ring) in every theme.
      function editorTheme() {
        const style = getComputedStyle(document.documentElement);
        const color = (name) => style.getPropertyValue("--vscode-" + name).trim() || undefined;
        const theme = {
          background: color("editor-background"),
          text: color("editor-foreground"),
          grid: color("editorIndentGuide-background1") ?? color("editorWidget-border")
        };
        // a color the theme does not define keeps metroflow's default
        return Object.fromEntries(Object.entries(theme).filter(([, value]) => value));
      }

      // VS Code sets the theme colors on the root element and the theme kind
      // on the body
      const observer = new MutationObserver(() => render());
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });

      // Webviews cannot download, go fullscreen, alert, reload or open files,
      // so the extension does these instead
      const options = {
        container: "#metroflow-container",
        storage,
        // a new render (theme, update) keeps the zoom and pan
        keepView: true,
        // SVG and the largest PNG, saved through the extension
        export: { pngScales: [3], copy: false },
        host: {
          saveFile(filename, blob) {
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = reader.result.slice(reader.result.indexOf(",") + 1);
              vscode.postMessage({ type: "saveFile", filename, data: base64 });
            };
            reader.readAsDataURL(blob);
          },
          toggleFullscreen() {
            vscode.postMessage({ type: "toggleFullscreen" });
          },
          notify(message) {
            vscode.postMessage({ type: "notify", message });
          },
          // right-clicking a station, a subworkflow or a line offers to open
          // its code or condition in the editor
          openCode(target) {
            vscode.postMessage({ type: "openCode", target });
          },
          // the map reads the saved layout again when it is rendered
          reload: render
        }
      };
      render();
    </script>
  </body>
</html>`;
}
