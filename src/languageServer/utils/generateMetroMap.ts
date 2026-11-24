import * as vscode from "vscode";

import {
  buildMetroMap,
  StructureCache,
  type MetroMapResult,
  type ScriptStructure
} from "./metroMap";

/** The language server command that returns the structure of a script. */
const PREVIEW_DAG_JSON = "nextflow.server.previewDagJson";

/** The same URI as the editor spells it. */
export const normalizeUri = (uri: string) => vscode.Uri.parse(uri).toString();

/**
 * The structures of the scripts, kept until they change: building a map
 * again (another workflow, an update) only asks the language server for the
 * scripts that changed.
 */
const cache = new StructureCache(async (scriptUri) => {
  const res: any = await vscode.commands.executeCommand(
    PREVIEW_DAG_JSON,
    scriptUri
  );
  if (!res?.result) {
    const file = vscode.workspace.asRelativePath(vscode.Uri.parse(scriptUri));
    throw new Error(
      `${file}: ${res?.error ?? "the language server did not return its structure."}`
    );
  }
  return res.result as ScriptStructure;
}, normalizeUri);

/** Forgets the structure of a script that changed. */
export function invalidateMetroMapScript(uri: vscode.Uri) {
  cache.invalidate(uri.toString());
}

/** Forgets all the structures, e.g. when the language server restarts. */
export function clearMetroMapCache() {
  cache.clear();
}

/**
 * Generates the MetroFlow metro map of the entry workflow of a script, or of
 * one of its named workflows, from the structure of its scripts that the
 * Nextflow language server extracts. Rejects with a message that can be
 * shown to the user.
 */
export async function generateMetroMap(
  uri: string,
  workflowName?: string
): Promise<MetroMapResult> {
  const commands = await vscode.commands.getCommands(true);
  if (!commands.includes(PREVIEW_DAG_JSON)) {
    throw new Error(
      "The Nextflow language server is still starting, or its version does not support the metro map."
    );
  }
  return buildMetroMap(uri, cache.fetch, workflowName);
}
