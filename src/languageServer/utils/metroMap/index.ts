/**
 * Builds the MetroFlow metro map of a pipeline from the structure that the
 * Nextflow language server extracts from its scripts. This is a port of the
 * parts of BioFlow-Insight (https://gitlab.liris.cnrs.fr/sharefair/bioflow-insight)
 * that generate the metro map: the process dependency graph, the conditions
 * of the processes, the layout and the metro map JSON.
 *
 * It doesn't depend on VS Code, so that it can be run against a language
 * server outside of the editor.
 */
import * as path from "path";
import { fileURLToPath } from "url";

import { layoutProcessGraph } from "./layout";
import {
  buildMetroMapJson,
  type MetroMap,
  type MetroMapSources
} from "./metroMapJson";
import { buildProcessGraph } from "./processGraph";
import { loadStructures, type FetchStructure } from "./structure";

export type { MetroMap, MetroMapSources, SourceRef } from "./metroMapJson";
export type { Condition } from "./processGraph";
export { StructureCache } from "./structure";
export type { FetchStructure, ScriptStructure } from "./structure";

export interface MetroMapResult {
  map: MetroMap;
  /** Where the code and the conditions of the map are, to open them. */
  sources: MetroMapSources;
  /**
   * The scripts that have errors, relative to the entry script: the
   * workflows that they define are shown as single stations, and their
   * processes without their code.
   */
  scriptsWithErrors: string[];
  /** The URIs of the scripts that the map is built from, to update it. */
  scripts: string[];
}

/**
 * Builds the metro map of the entry workflow of a script, or of one of its
 * named workflows (e.g. a subworkflow, on its own). Rejects with a message
 * that can be shown to the user.
 */
export async function buildMetroMap(
  entryUri: string,
  fetch: FetchStructure,
  workflowName?: string
): Promise<MetroMapResult> {
  const { scripts, errors } = await loadStructures(entryUri, fetch);
  const graph = buildProcessGraph(entryUri, scripts, workflowName);
  if (graph.processes.length === 0) {
    throw new Error(
      `The ${workflowName ? `workflow ${workflowName}` : "entry workflow"} doesn't call any process.`
    );
  }
  const positions = await layoutProcessGraph(graph);
  const baseDir = path.dirname(fileURLToPath(entryUri));
  const relative = (uri: string) => {
    try {
      return path
        .relative(baseDir, fileURLToPath(uri))
        .split(path.sep)
        .join("/");
    } catch {
      return uri;
    }
  };
  return {
    ...buildMetroMapJson(graph, positions, scripts, baseDir),
    scriptsWithErrors: [...errors.keys()].map(relative).sort(),
    scripts: [...scripts.keys(), ...errors.keys()]
  };
}
