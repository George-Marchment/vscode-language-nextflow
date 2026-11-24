/**
 * The structure of the scripts of a pipeline, as returned by the
 * `nextflow.server.previewDagJson` command of the language server. Fields
 * that are null are left out by the server.
 */

export type DagNodeType = "NAME" | "OPERATOR" | "CONTROL" | "INPUT" | "OUTPUT";

export interface DagNode {
  id: number;
  label: string;
  type: DagNodeType;
  /** For a call node, the script that defines the process or workflow. */
  uri?: string;
  /** For a call node, what it calls. */
  kind?: "process" | "workflow";
  /** For a call node, the name of the definition, which an alias hides. */
  definition?: string;
  verbose?: boolean;
  preds: number[];
}

/** The nodes of a workflow, grouped by the branches that contain them. */
export interface DagSubgraph {
  id: number;
  /** The control node of a branch. */
  pred?: number;
  branch?: "if" | "else";
  nodes: number[];
  subgraphs: DagSubgraph[];
}

export interface DagGraph {
  /** The take nodes by name (the params of the entry workflow). */
  inputs: Record<string, number>;
  /** The emit nodes by name (the outputs of the entry workflow). */
  outputs: Record<string, number>;
  nodes: DagNode[];
  subgraph: DagSubgraph;
}

export interface ScriptStructure {
  processes: { name: string; code: string }[];
  workflows: {
    /** Left out for the entry workflow. */
    name?: string;
    code: string;
    graph?: DagGraph;
  }[];
}

/** Gets the structure of a script, or rejects with a message for the user. */
export type FetchStructure = (uri: string) => Promise<ScriptStructure>;

export interface Structures {
  /** The structure of each script, by URI. */
  scripts: Map<string, ScriptStructure>;
  /** Why the structure of a script could not be obtained, by URI. */
  errors: Map<string, string>;
}

/**
 * The scripts that define the processes and workflows that a script calls.
 */
export function dependencies(structure: ScriptStructure): string[] {
  const uris = new Set<string>();
  for (const workflow of structure.workflows) {
    for (const node of workflow.graph?.nodes ?? []) {
      if (node.kind && node.uri) {
        uris.add(node.uri);
      }
    }
  }
  return [...uris];
}

/**
 * Gets the structure of a script and of every script that defines a process
 * or a workflow that it calls, recursively. Each script is fetched as soon
 * as it is found, in parallel with the others. Only the entry script is
 * required: the scripts that have errors are reported in `errors`.
 */
export async function loadStructures(
  entryUri: string,
  fetch: FetchStructure
): Promise<Structures> {
  const scripts = new Map<string, ScriptStructure>();
  const errors = new Map<string, string>();
  const requested = new Set([entryUri]);
  const load = async (uri: string): Promise<void> => {
    let structure: ScriptStructure;
    try {
      structure = await fetch(uri);
    } catch (e) {
      if (uri === entryUri) {
        throw e;
      }
      errors.set(uri, e instanceof Error ? e.message : String(e));
      return;
    }
    scripts.set(uri, structure);
    const next = dependencies(structure).filter((d) => !requested.has(d));
    next.forEach((d) => requested.add(d));
    await Promise.all(next.map(load));
  };
  await load(entryUri);
  return { scripts, errors };
}

/**
 * Keeps the structures of scripts until they change. The structure of a
 * script depends on the scripts that it includes (e.g. whether a call is a
 * process or a workflow), so a change invalidates them too. Errors are not
 * kept, so that a script is fetched again once it is fixed.
 */
export class StructureCache {
  private entries = new Map<string, Promise<ScriptStructure>>();
  /** The scripts that call into each script. */
  private dependents = new Map<string, Set<string>>();

  /**
   * `normalize` gives the same key to the different spellings of a URI (e.g.
   * from the language server and from the editor).
   */
  constructor(
    private fetchStructure: FetchStructure,
    private normalize: (uri: string) => string = (uri) => uri
  ) {}

  fetch: FetchStructure = (uri) => {
    const key = this.normalize(uri);
    let entry = this.entries.get(key);
    if (!entry) {
      const fetched = this.fetchStructure(uri);
      entry = fetched;
      this.entries.set(key, fetched);
      fetched.then(
        (structure) => {
          for (const dependency of dependencies(structure).map(
            this.normalize
          )) {
            if (!this.dependents.has(dependency)) {
              this.dependents.set(dependency, new Set());
            }
            this.dependents.get(dependency)!.add(key);
          }
        },
        () => {
          if (this.entries.get(key) === fetched) {
            this.entries.delete(key);
          }
        }
      );
    }
    return entry;
  };

  /** Forgets a script that changed, and the scripts that include it. */
  invalidate(uri: string) {
    const key = this.normalize(uri);
    this.entries.delete(key);
    for (const dependent of this.dependents.get(key) ?? []) {
      this.entries.delete(dependent);
    }
    this.dependents.delete(key);
  }

  clear() {
    this.entries.clear();
    this.dependents.clear();
  }
}
