const { build } = require("esbuild");
const { copy } = require("esbuild-plugin-copy");
const fs = require("fs");

const production = process.argv.includes("--production");

async function main() {
  for (const file of [
    "metroflow/metro_map.js",
    "bioflow-insight/src/workflow.py"
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `The ${file.split("/")[0]} submodule is missing, run: git submodule update --init`
      );
    }
  }

  const files = {
    "images/**": "./images",
    "snippets/**": "./snippets",
    "syntaxes/**": "./syntaxes",
    "CHANGELOG.md": "./CHANGELOG.md",
    "LICENSE.md": "./LICENSE.md",
    "README.md": "./README.md",
    "language-configuration.json": "./language-configuration.json",
    "package.json": "./package.json",
    "node_modules/mermaid/dist/mermaid.min.js": "media",
    "metroflow/*.js": "./media/metroflow",
    "metroflow/LICENSE": "./media/metroflow",
    "scripts/generate_metro_map.py": "./media/metroflow",
    // bioflow-insight's package is named `src`
    "bioflow-insight/src/**/*.{py,jar}": "./media/bioflow-insight/src",
    "bioflow-insight/{LICENSE,requirements.txt}": "./media/bioflow-insight",
    "node_modules/d3/dist/d3.min.js": "media",
    "node_modules/prismjs/components/prism-{core,clike,groovy,python}.min.js":
      "media/prism",
    "node_modules/prismjs/themes/prism-tomorrow.min.css": "media/prism"
  };

  // The webview: a browser bundle, built from its own tsconfig so that the
  // @shared/* alias resolves.
  await build({
    entryPoints: ["src/ui/main.tsx"],
    bundle: true,
    format: "esm",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outdir: "build/ui/assets",
    entryNames: "ui",
    assetNames: "[name]",
    loader: { ".ttf": "file" },
    tsconfig: "tsconfig.ui.json",
    logLevel: "silent"
  });

  // The extension host: a Node bundle, plus everything else that ships.
  await build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "build/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [
      copy({
        assets: Object.entries(files).map(([from, to]) => {
          return { from, to };
        })
      })
    ]
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
