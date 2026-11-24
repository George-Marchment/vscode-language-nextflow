import * as vscode from "vscode";

import type { Condition, MetroMapSources, SourceRef } from "./metroMap";

/** What the metro map asks to open, see `openCode` in metroflow. */
export interface OpenCodeTarget {
  type: "station" | "subworkflow" | "edge";
  /** The station id or subworkflow key (where the line starts for an edge). */
  id: string;
  name?: string;
  part: "code" | "condition";
}

/**
 * Opens the definition of a station or a subworkflow of the metro map, or
 * the condition of a station, a subworkflow or a line, in the editor.
 */
export async function openMetroMapSource(
  target: OpenCodeTarget,
  sources: MetroMapSources
) {
  const ref =
    target.type === "subworkflow"
      ? (sources.subworkflows[target.id] ?? sources.stations[target.id])
      : (sources.stations[target.id] ?? sources.subworkflows[target.id]);
  if (!ref) {
    vscode.window.showWarningMessage(
      `Could not find the source of ${target.name ?? target.id}.`
    );
    return;
  }
  if (target.part === "code") {
    await openDefinition(ref);
  } else {
    await openCondition(ref, target.name);
  }
}

async function openDefinition(ref: SourceRef) {
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(ref.uri)
  );
  const text = document.getText();
  // the code is the text of the definition, unless the file changed since
  // the metro map was generated
  let start = ref.code ? text.indexOf(ref.code) : -1;
  if (start < 0) {
    const match = new RegExp(
      `\\b${ref.kind}\\s+${escapeRegExp(ref.name)}\\b`
    ).exec(text);
    start = match?.index ?? -1;
  }
  if (start < 0) {
    await show(document);
    vscode.window.showWarningMessage(
      `Could not find the ${ref.kind} ${ref.name} in ${vscode.workspace.asRelativePath(document.uri)}.`
    );
    return;
  }
  // select the name of the process or the workflow
  const name = new RegExp(`\\b${escapeRegExp(ref.name)}\\b`, "g");
  name.lastIndex = start;
  const match = name.exec(text);
  const nameStart = match ? match.index : start;
  const nameEnd = match ? nameStart + ref.name.length : start;
  await show(document, nameStart, nameEnd, start);
}

async function openCondition(ref: SourceRef, name: string | undefined) {
  if (ref.conditions.length === 0) {
    vscode.window.showInformationMessage(
      `${name ?? ref.name} does not have a condition.`
    );
    return;
  }
  let condition: Condition | undefined = ref.conditions[0];
  // a combined condition comes from several branches, maybe in several files
  if (ref.conditions.length > 1) {
    const picked = await vscode.window.showQuickPick(
      ref.conditions.map((c) => ({
        label: c.text,
        description: `${c.workflow ? `workflow ${c.workflow}` : "entry workflow"} — ${vscode.workspace.asRelativePath(vscode.Uri.parse(c.uri))}`,
        condition: c
      })),
      { placeHolder: "Which part of the condition do you want to open?" }
    );
    condition = picked?.condition;
  }
  if (!condition) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.parse(condition.uri)
  );
  const text = document.getText();
  // the condition is in the workflow where it is, preferably in an if
  const workflow = new RegExp(
    condition.workflow
      ? `\\bworkflow\\s+${escapeRegExp(condition.workflow)}\\s*\\{`
      : `\\bworkflow\\s*\\{`
  ).exec(text);
  const from = workflow?.index ?? 0;
  const source = escapeRegExp(condition.source);
  for (const pattern of [`\\bif\\s*\\(\\s*(${source})`, `(${source})`]) {
    for (const start of from > 0 ? [from, 0] : [0]) {
      const regex = new RegExp(pattern, "g");
      regex.lastIndex = start;
      const match = regex.exec(text);
      if (match) {
        const index = match.index + match[0].length - match[1].length;
        await show(document, index, index + match[1].length);
        return;
      }
    }
  }
  await show(document, from, from);
  vscode.window.showWarningMessage(
    `Could not find the condition ${condition.source} in ${vscode.workspace.asRelativePath(document.uri)}.`
  );
}

/**
 * Shows a document in the editor group where it is already visible, or the
 * first one (the metro map is beside it), with a range selected.
 */
async function show(
  document: vscode.TextDocument,
  start = 0,
  end = start,
  revealFrom = start
) {
  const viewColumn =
    vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === document.uri.toString()
    )?.viewColumn ?? vscode.ViewColumn.One;
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn,
    selection: new vscode.Range(
      document.positionAt(start),
      document.positionAt(end)
    )
  });
  const reveal = document.positionAt(revealFrom);
  editor.revealRange(
    new vscode.Range(reveal, reveal),
    vscode.TextEditorRevealType.InCenterIfOutsideViewport
  );
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
