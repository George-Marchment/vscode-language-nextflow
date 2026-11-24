import * as path from "path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  Executable
} from "vscode-languageclient/node";

import { buildConfigPreview, ConfigPreview } from "./utils/buildConfigPreview";
import { buildDagPreview } from "./utils/buildDagPreview";
import { buildMetroMapPreview } from "./utils/buildMetroMapPreview";
import {
  clearMetroMapCache,
  generateMetroMap,
  invalidateMetroMapScript,
  normalizeUri
} from "./utils/generateMetroMap";
import type { MetroMapSources } from "./utils/metroMap";
import { openMetroMapSource } from "./utils/openMetroMapSource";
import {
  fetchLanguageServerJar,
  fetchLanguageServerNative,
  resolveLanguageVersion
} from "./utils/fetchLanguageServer";
import { findJava, checkJavaVersion } from "./utils/findExecutable";
import type { TrackEvent } from "../telemetry";

const LABEL_RELOAD_WINDOW = "Reload Window";

let languageClient: LanguageClient | null = null;

function startLanguageServer() {
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window },
    (progress) => {
      return new Promise<void>(async (resolve, reject) => {
        const { versionPrefix, isPreview } = resolveLanguageVersion();
        const nativePath = fetchLanguageServerNative(versionPrefix);
        const javaPath = nativePath ? null : findJava();
        if (!nativePath && !javaPath) {
          resolve();
          const settingsJavaHome = vscode.workspace
            .getConfiguration("nextflow")
            .get<string>("java.home");
          if (settingsJavaHome) {
            vscode.window.showErrorMessage(
              "The `nextflow.java.home` setting does not point to a valid Java install."
            );
          } else {
            vscode.window.showErrorMessage(
              "Could not locate Java. Use the `nextflow.java.home` setting to configure Java manually."
            );
          }
          return;
        }
        try {
          if (javaPath && !checkJavaVersion(javaPath)) {
            resolve();
            vscode.window.showErrorMessage(
              `Java 17 or later is required to use the Nextflow language server (using path: ${javaPath}).`
            );
            return;
          }
        } catch (e) {
          console.warn(`Failed to check Java version: ${e}`);
        }
        progress.report({
          message: "Initializing Nextflow language server..."
        });
        const clientOptions: LanguageClientOptions = {
          documentSelector: [
            { scheme: "file", language: "nextflow" },
            { scheme: "file", language: "nextflow-config" }
          ],
          synchronize: {
            configurationSection: "nextflow"
          },
          middleware: {
            async provideCodeLenses(document, token, next) {
              const lenses = await next(document, token);
              return lenses?.map(toMetroMapLens);
            }
          },
          uriConverters: {
            code2Protocol: (value: vscode.Uri) => {
              if (/^win32/.test(process.platform)) {
                // drive letters on Windows are encoded with %3A instead of :
                // but Java doesn't treat them the same
                return value.toString().replace("%3A", ":");
              } else {
                return value.toString();
              }
            },
            protocol2Code: (value) => vscode.Uri.parse(value)
          }
        };
        let executable: Executable;
        if (nativePath) {
          vscode.window.showInformationMessage(
            `Using native Nextflow language server (${versionPrefix}).`
          );
          executable = { command: nativePath };
        } else {
          const serverPath = await fetchLanguageServerJar(
            versionPrefix,
            isPreview
          );
          if (!serverPath) {
            resolve();
            vscode.window.showErrorMessage(
              "Failed to retrieve language server."
            );
            return;
          }
          const args = ["-jar", serverPath];
          // uncomment to allow a debugger to attach to the language server
          // args.unshift("-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005,quiet=y");
          executable = {
            command: javaPath as string,
            args: args
          };
        }
        languageClient = new LanguageClient(
          "nextflow",
          "Nextflow Language Server",
          executable,
          clientOptions
        );
        try {
          await languageClient.start();
        } catch (e) {
          resolve();
          vscode.window.showErrorMessage(
            "The Nextflow extension failed to start."
          );
          return;
        }
        resolve();
      });
    }
  );
}

/**
 * Replaces the "Preview DAG" lens of each workflow with "Preview metro-map":
 * the metro map of the whole pipeline for the entry workflow, whose name is
 * null, and of the workflow on its own for a named workflow.
 */
function toMetroMapLens(lens: vscode.CodeLens): vscode.CodeLens {
  const command = lens.command;
  if (command?.command !== "nextflow.previewDag") {
    return lens;
  }
  const [uri, name] = command.arguments ?? [];
  lens.command = {
    title: "Preview metro-map",
    command: "nextflow.previewMetroMap",
    arguments: name ? [uri, name] : [uri]
  };
  return lens;
}

/**
 * Shows the MetroFlow metro map of the entry workflow, or of a named
 * workflow, or its Mermaid DAG when the metro map cannot be generated.
 */
async function previewMetroMap(
  context: vscode.ExtensionContext,
  uri: string,
  name?: string
) {
  try {
    await showMetroMap(context, uri, name);
  } catch (e) {
    vscode.window.showWarningMessage(
      `Could not generate the metro map, showing the DAG instead: ${e instanceof Error ? e.message : e}`
    );
    await previewDag(context, uri, name);
  }
}

/** Where the extension keeps what metroflow saves for a map, and for all. */
const METRO_MAP_STORAGE = "nextflow.metroMap.storage";
const METRO_MAP_AESTHETICS = "nextflow.metroMap.aesthetics";
/** The key under which metroflow saves the appearance, the same for all maps. */
const AESTHETICS_KEY = "metro-aesthetics";
/** How long to wait after a save before updating the metro map. */
const UPDATE_DELAY = 400;

async function showMetroMap(
  context: vscode.ExtensionContext,
  uri: string,
  name?: string
) {
  const mediaPath = vscode.Uri.joinPath(context.extensionUri, "media");
  const imagesPath = vscode.Uri.joinPath(context.extensionUri, "images");
  const workflowPath = vscode.Uri.parse(uri).fsPath;
  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating the metro map..."
    },
    () => generateMetroMap(uri, name)
  );
  warnAboutScriptsWithErrors(result.scriptsWithErrors);

  const panel = vscode.window.createWebviewPanel(
    "metro-map-preview",
    name ? `Metro Map: ${name}` : "Metro Map",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [mediaPath, imagesPath],
      // the panel keeps its layout while it is hidden
      retainContextWhenHidden: true
    }
  );

  // Each map keeps its own layout (positions, collapsed subworkflows...),
  // the appearance is the same for all maps
  const mapKey = `${METRO_MAP_STORAGE}:${normalizeUri(uri)}#${name ?? ""}`;
  const storage = new MetroMapStorage(context, mapKey);

  // The map is updated when one of its scripts is saved
  let current = result;
  let scripts = new Set(current.scripts.map(normalizeUri));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let updating = Promise.resolve();
  const update = () =>
    (updating = updating.then(async () => {
      try {
        const updated = await generateMetroMap(uri, name);
        if (
          updated.scriptsWithErrors.join() !== current.scriptsWithErrors.join()
        ) {
          warnAboutScriptsWithErrors(updated.scriptsWithErrors);
        }
        current = updated;
        scripts = new Set(updated.scripts.map(normalizeUri));
        await panel.webview.postMessage({ type: "update", data: updated.map });
      } catch (e) {
        vscode.window.setStatusBarMessage(
          `$(warning) Metro map not updated: ${e instanceof Error ? e.message : e}`,
          8000
        );
      }
    }));
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => {
    if (!scripts.has(document.uri.toString())) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(update, UPDATE_DELAY);
  });

  const listener = panel.webview.onDidReceiveMessage((message) =>
    message?.type === "storage"
      ? storage.set(message.key, message.value)
      : handleMetroMapMessage(message, workflowPath, current.sources)
  );
  panel.onDidDispose(() => {
    clearTimeout(timer);
    onSave.dispose();
    listener.dispose();
  });
  panel.webview.html = buildMetroMapPreview(
    current.map,
    panel.webview,
    mediaPath,
    imagesPath,
    storage.all()
  );
}

function warnAboutScriptsWithErrors(scriptsWithErrors: string[]) {
  if (scriptsWithErrors.length > 0) {
    vscode.window.showWarningMessage(
      `Some scripts have errors, so the metro map shows their workflows as single stations and their processes without their code: ${scriptsWithErrors.join(", ")}`
    );
  }
}

/**
 * What metroflow saves for a map: its layout in the workspace, under the key
 * of the map, and the appearance for all workspaces.
 */
class MetroMapStorage {
  constructor(
    private context: vscode.ExtensionContext,
    private mapKey: string
  ) {}

  /** Everything saved, by metroflow key. */
  all(): Record<string, string> {
    const saved: Record<string, string> = {
      ...this.context.workspaceState.get<Record<string, string>>(
        this.mapKey,
        {}
      )
    };
    const aesthetics =
      this.context.globalState.get<string>(METRO_MAP_AESTHETICS);
    if (aesthetics !== undefined) {
      saved[AESTHETICS_KEY] = aesthetics;
    }
    return saved;
  }

  /** Saves a value, or removes it when it is null. */
  async set(key: string, value: string | null) {
    if (key === AESTHETICS_KEY) {
      await this.context.globalState.update(
        METRO_MAP_AESTHETICS,
        value ?? undefined
      );
      return;
    }
    const saved = {
      ...this.context.workspaceState.get<Record<string, string>>(
        this.mapKey,
        {}
      )
    };
    if (value === null) {
      delete saved[key];
    } else {
      saved[key] = value;
    }
    await this.context.workspaceState.update(
      this.mapKey,
      Object.keys(saved).length > 0 ? saved : undefined
    );
  }
}

/** What the metro map asks the extension, because a webview cannot do it. */
async function handleMetroMapMessage(
  message: any,
  workflowPath: string,
  sources: MetroMapSources
) {
  switch (message?.type) {
    case "saveFile": {
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(
          path.join(path.dirname(workflowPath), message.filename)
        )
      });
      if (!target) {
        return;
      }
      await vscode.workspace.fs.writeFile(
        target,
        Buffer.from(message.data, "base64")
      );
      vscode.window.showInformationMessage(`Saved ${target.fsPath}`);
      return;
    }
    case "toggleFullscreen":
      // the webview has focus, so this maximizes the metro map's editor group
      await vscode.commands.executeCommand(
        "workbench.action.toggleMaximizeEditorGroup"
      );
      return;
    case "notify":
      vscode.window.showInformationMessage(String(message.message));
      return;
    case "openCode":
      await openMetroMapSource(message.target, sources);
      return;
  }
}

async function previewDag(
  context: vscode.ExtensionContext,
  uri: string,
  name?: string
) {
  const mediaPath = vscode.Uri.joinPath(context.extensionUri, "media");
  const res: any = await vscode.commands.executeCommand(
    "nextflow.server.previewDag",
    uri,
    name
  );
  if (!res || !res.result) {
    const message = res?.error ?? "Failed to render DAG preview.";
    vscode.window.showErrorMessage(message);
    return;
  }
  const content = res.result;
  const panel = vscode.window.createWebviewPanel(
    "dag-preview",
    "DAG Preview",
    vscode.ViewColumn.Beside,
    {
      enableCommandUris: true,
      enableScripts: true,
      localResourceRoots: [mediaPath],
      // the panel keeps its pan and zoom while it is hidden
      retainContextWhenHidden: true
    }
  );
  const mermaidLibUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(mediaPath, "mermaid.min.js")
  );
  panel.webview.html = buildDagPreview(
    content,
    name ?? "Entry",
    mermaidLibUri,
    panel.webview.cspSource
  );
}

async function fetchConfigPreview(
  uri: string,
  name: string,
  profiles: string[],
  qualifiedName: string | null
): Promise<ConfigPreview | null> {
  const res: any = await vscode.commands.executeCommand(
    "nextflow.server.previewConfig",
    uri,
    name,
    profiles,
    qualifiedName
  );
  if (!res || !res.result) {
    const message = res?.error ?? "Failed to render config preview.";
    vscode.window.showErrorMessage(message);
    return null;
  }
  return res.result as ConfigPreview;
}

async function previewConfig(
  uri: string,
  name: string,
  qualifiedName: string | null = null
) {
  const data = await fetchConfigPreview(uri, name, [], qualifiedName);
  if (!data) return;

  const panel = vscode.window.createWebviewPanel(
    "config-preview",
    `${qualifiedName ?? name} config`,
    vscode.ViewColumn.Beside,
    // the panel keeps profile, filter and scroll state while it is hidden
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = buildConfigPreview(data);

  // the previews are resolved concurrently, so a selection that is made while
  // an earlier one is still pending must not be overwritten by it
  let pending = 0;
  let disposed = false;
  panel.onDidDispose(() => {
    disposed = true;
  });

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === "open") {
      const position = new vscode.Position(Math.max(message.line - 1, 0), 0);
      await vscode.window.showTextDocument(vscode.Uri.parse(message.uri), {
        viewColumn: vscode.ViewColumn.One,
        selection: new vscode.Range(position, position)
      });
    }
    // The cascade has to be resolved again for a new profile selection: a
    // profile is merged into the base config before the process selectors
    // are applied, so the winning setting cannot be filtered client-side.
    if (message.type === "profiles") {
      const generation = ++pending;
      const updated = await fetchConfigPreview(
        uri,
        name,
        message.profiles,
        qualifiedName
      );
      if (updated && generation === pending && !disposed)
        panel.webview.postMessage({ type: "update", data: updated });
    }
  });
}

function restartLanguageServer() {
  // the new server may give other structures
  clearMetroMapCache();
  if (!languageClient) {
    startLanguageServer();
    return;
  }
  let oldLanguageClient = languageClient;
  languageClient = null;
  oldLanguageClient.stop().then(
    () => {
      startLanguageServer();
    },
    () => {
      vscode.window
        .showWarningMessage(
          "To apply new settings for Nextflow, please reload the window.",
          LABEL_RELOAD_WINDOW
        )
        .then((action) => {
          if (action === LABEL_RELOAD_WINDOW) {
            vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        });
    }
  );
}

export function stopLanguageServer(): Thenable<void> {
  if (!languageClient) {
    return Promise.resolve();
  }
  return languageClient.stop();
}

export function activateLanguageServer(
  context: vscode.ExtensionContext,
  trackEvent: TrackEvent
) {
  vscode.workspace.onDidChangeConfiguration(
    (event: vscode.ConfigurationChangeEvent) => {
      const shouldRestart =
        event.affectsConfiguration("nextflow.java.home") ||
        event.affectsConfiguration("nextflow.languageVersion");
      if (shouldRestart) {
        restartLanguageServer();
      }
    }
  );
  vscode.commands.registerCommand("nextflow.previewDag", (uri, name) => {
    previewDag(context, uri, name);
  });
  vscode.commands.registerCommand("nextflow.previewMetroMap", (uri, name) => {
    previewMetroMap(context, uri, name);
  });
  // The structures of the scripts are kept for the metro map until they
  // change, in the editor or on disk
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === "nextflow") {
        invalidateMetroMapScript(event.document.uri);
      }
    })
  );
  const scriptWatcher = vscode.workspace.createFileSystemWatcher("**/*.nf");
  scriptWatcher.onDidChange(invalidateMetroMapScript);
  scriptWatcher.onDidCreate(invalidateMetroMapScript);
  scriptWatcher.onDidDelete(invalidateMetroMapScript);
  context.subscriptions.push(scriptWatcher);
  vscode.commands.registerCommand(
    "nextflow.previewConfig",
    (uri, name, qualifiedName) => {
      previewConfig(uri, name, qualifiedName ?? null);
    }
  );
  vscode.commands.registerCommand("nextflow.languageServer.restart", () => {
    restartLanguageServer();
  });
  vscode.commands.registerCommand("nextflow.languageServer.stop", () => {
    stopLanguageServer();
  });
  vscode.commands.registerCommand(
    "nextflow.openFileFromWebview",
    async (uriString: string) => {
      if (!uriString) {
        vscode.window.showErrorMessage("Missing file URI.");
        return;
      }
      trackEvent("openFileFromWebview");
      const uri = vscode.Uri.parse(uriString);
      await vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.One
      });
    }
  );
  startLanguageServer();
}
