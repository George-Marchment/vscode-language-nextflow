import * as vscode from "vscode";
import { execFile } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

/** Exit code of generate_metro_map.py when bioflow-insight cannot be imported. */
const EXIT_NOT_INSTALLED = 2;

function installHint(requirements: string) {
  return `Install BioFlow-Insight's Python dependencies (\`pip install -r ${requirements}\`) and Graphviz, or point the \`nextflow.metroflow.pythonPath\` setting to a Python that has them.`;
}

/**
 * Generates the MetroFlow metro map of a workflow with bioflow-insight, whose
 * structure comes from the Nextflow language server. Rejects with a message
 * that can be shown to the user.
 */
export async function generateMetroMap(
  context: vscode.ExtensionContext,
  workflowPath: string
): Promise<object> {
  const pythonPath =
    vscode.workspace
      .getConfiguration("nextflow")
      .get<string>("metroflow.pythonPath") || "python3";
  const mediaPath = vscode.Uri.joinPath(context.extensionUri, "media");
  const script = vscode.Uri.joinPath(
    mediaPath,
    "metroflow",
    "generate_metro_map.py"
  ).fsPath;
  // the bioflow-insight bundled with the extension, rather than an installed one
  const bioflowInsightPath = vscode.Uri.joinPath(
    mediaPath,
    "bioflow-insight"
  ).fsPath;
  const hint = installHint(path.join(bioflowInsightPath, "requirements.txt"));
  const env = {
    ...process.env,
    PYTHONPATH: [bioflowInsightPath, process.env.PYTHONPATH]
      .filter(Boolean)
      .join(path.delimiter)
  };
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "metroflow-"));
  try {
    const jsonPath = await new Promise<string>((resolve, reject) => {
      execFile(
        pythonPath,
        [script, workflowPath, outputDir],
        // the language server runs in a JVM started by the script
        { cwd: path.dirname(workflowPath), env, timeout: 120_000 },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(stdout.trim().split("\n").pop()!);
            return;
          }
          if (stderr) {
            console.error(stderr);
          }
          // the exit code, or a string such as ENOENT when Python cannot be run
          const code: unknown = (error as { code?: unknown }).code;
          if (code === "ENOENT") {
            reject(
              new Error(`Python was not found (\`${pythonPath}\`). ${hint}`)
            );
          } else if (code === EXIT_NOT_INSTALLED) {
            reject(
              new Error(
                `BioFlow-Insight's Python dependencies are missing. ${hint}`
              )
            );
          } else if (error.killed) {
            reject(new Error("Generating the metro map timed out."));
          } else {
            const lines = stderr.trim().split("\n");
            reject(new Error(lines[lines.length - 1] || error.message));
          }
        }
      );
    });
    return JSON.parse(await fs.readFile(jsonPath, "utf8"));
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
}
