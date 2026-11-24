# Nextflow extension for Visual Studio Code

VS Code extension for [Nextflow](https://www.nextflow.io/) that provides language support for Nextflow scripts and config files.

## Features

### Nextflow language server

![nextflow vscode extension](images/vscode-nextflow.png)

The extension uses the [Nextflow language server](https://github.com/nextflow-io/language-server) to provide code intelligence:

- Syntax highlighting
- Code navigation (outline, go to definition, find references)
- Code completion
- Diagnostics (errors, warnings)
- Formatting
- Hover hints
- Rename
- DAG preview for workflows
- [Metro map preview](#metro-map-preview) for workflows
- Config preview for processes

Read the [Nextflow documentation](https://nextflow.io/docs/latest/vscode.html) for more information about the Nextflow language server.

Related blog posts:

- [Modernizing the Nextflow Developer Experience (Part 1): The IDE](https://seqera.io/blog/modernizing-nextflow-developer-experience/)
- [Modernizing the Nextflow Developer Experience (Part 2): The Language Server](https://seqera.io/blog/modernizing-nextflow-developer-experience-part-2/)

### Metro map preview

**Preview metro-map**, above each workflow of a script, shows it as an interactive metro map, drawn by [MetroFlow](https://gitlab.pasteur.fr/sharefair/metroflow) from the structure of the pipeline extracted by the Nextflow language server. Each process is a station, and the channels that connect the processes are the lines between them. Above the entry workflow, the map shows the whole pipeline; above a named workflow (e.g. a subworkflow), it shows that workflow on its own, in its subworkflow box, with the subworkflows that it calls.

![Metro map of a Nextflow workflow](images/metro-map-overview-white.png)

The metro map allows you to:

- See the code and the condition of a process, a subworkflow or a line by right-clicking on it, then choosing to open it in the editor or to show it in a pop-up. When a condition combines several conditions, you choose which one to open. The pop-up can be moved by its header, resized from its corner, and closed with `Escape`.
- Collapse a subworkflow into a single station by double-clicking on it, and right-click on it to see its code, its condition and what it contains
- Highlight the paths that go through a process
- Follow conditional branches: lines that share a condition have the same color
- Rearrange the map by moving the stations and the subworkflows. A station dropped onto others glides to the closest free spot, and a station moved close to the level of a station it is connected to aligns with it, so that the line between them is straight.
- Hide a station (`H` + click, `Ctrl`/`Cmd` + `Z` to show it again), minimize it (`M` + click), move several stations together (`Shift` + click to select them), or focus on a subworkflow (`F` + click, `Escape` to leave)
- Download, upload or reset the layout, and change the appearance
- Export the whole map as SVG or PNG, whatever the part of it that is shown
- Show the map fullscreen

The map follows the colors of your VS Code theme. It is updated when you save one of the scripts that it is built from, keeping your layout, zoom and pan. Each map keeps its own layout (in the workspace), and the appearance is the same for all maps.

When a script included by the pipeline has errors, the metro map shows the workflows it defines as single stations, with a warning that lists these scripts. When the metro map cannot be generated (e.g. the script has errors), the DAG of the workflow is shown instead, with a warning that explains why.

_Note: the metro map requires a version of the language server that provides the `nextflow.server.previewDagJson` command._

![Metro map features](images/metro-map-overview-black.png)

### Project view

The extension provides a custom view for Nextflow projects. The Project view uses the language server to provide an overview of your pipeline project:

![Project Tree View](images/project_view_tree.png)

_Example taken from the [nf-core/fetchngs](https://github.com/nf-core/fetchngs) pipeline._

The Project view allows you to:

- See the structure of your pipeline
- Navigate to a process, workflow, or test by name
- Monitor test coverage across your entire pipeline
- View and/or generate [nf-tests](https://www.nf-test.com/) for a process
- Build a [Wave container](https://seqera.io/wave/) for a process

### Copilot for Nextflow

The Copilot extension for Seqera AI has been removed. Use [Seqera Co-Scientist](https://docs.seqera.io/platform-cloud/co-scientist/) instead.

## Installation

This extension is available in the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=nextflow.nextflow) and the [Open VSX Registry](https://www.open-vsx.org/extension/nextflow/nextflow).

### Requirements

The language server requires Java 17 or later.

_Note: for custom Java installations such as conda, you might need to set the `nextflow.java.home` extension setting for the extension to find your Java installation._

### Offline usage

The extension downloads an appropriate version of the language server from GitHub based on the `nextflow.languageVersion` extension setting. To use the language server in an offline environment, you must download a language server release manually and save it in the local cache directory used by the extension. For example:

```bash
mkdir -p ~/.nextflow/lsp/v24.10
wget https://github.com/nextflow-io/language-server/releases/download/v24.10.0/language-server-all.jar -O ~/.nextflow/lsp/v24.10/v24.10.0.jar
```

The extension will fall back to the latest patch version from the local cache if it can't download from GitHub.

_Note: Nextflow language server patch versions have no correlation to Nextflow patch versions. Always use the latest patch version of the language server when downloading a release manually._

## Commands

Open the command palette and type `Nextflow` to see the list of available commands.

## Configuration

The following settings are available:

- `nextflow.completion.extended`: Provide auto-completions from outside the current script. If an external completion is selected, it will be automatically included into the current script.

- `nextflow.completion.maxItems`: The maximum number of auto-completions to suggest at a time.

- `nextflow.debug`: Enable debug logging and debug information in hover hints.

- `nextflow.errorReportingMode`: Set the desired level of error reporting.

- `nextflow.files.exclude`: Folders that should be excluded when scanning the workspace for Nextflow files.

- `nextflow.formatting.harshilAlignment`: Use the [Harshil Alignment™️](https://nf-co.re/docs/contributing/code_editors_and_styling/harshil_alignment) when formatting Nextflow scripts and config files.

  _Note: not all rules are supported._

- `nextflow.formatting.maheshForm`: Place process outputs at the end of the process body when formatting Nextflow scripts.

- `nextflow.formatting.sortDeclarations`: Sort script declarations when formatting Nextflow scripts.

- `nextflow.java.home`: Specify the folder path to the desired Java runtime. Equivalent to the `JAVA_HOME` environment variable, i.e. the Java binary should be located at `$JAVA_HOME/bin/java`. Use this setting if the extension cannot find Java automatically.

- `nextflow.languageVersion`: Nextflow language version to be used by the language server.

- `nextflow.log.debugOpacity`: Opacity applied to `DEBUG` and `TRACE` entries in `.nextflow.log` files. Set to `1.0` to disable dimming.

- `nextflow.log.filter.enabled`: Enable filtering by log level. Logs are read-only when filtered.

- `nextflow.log.filter.hiddenLevels`: Log levels to hide in `.nextflow.log` files when filtering is enabled. The file on disk is unchanged. Can be toggled per-file in the editor title bar.

- `nextflow.log.filter.stripAnsi`: Remove ANSI escape codes (e.g. `\u001b[0;32m`) from `.nextflow.log` files when filtering is enabled. The file on disk is unchanged. Can be toggled per-file in the editor title bar.

- `nextflow.telemetry.enabled`: Enable usage data to be sent to Seqera. See [below](#telemetry-notice) for more information about what we do and do not collect.

## Telemetry notice

We (Seqera) collect limited usage data through this extension to help us understand which features are most valuable and improve your overall experience.

This telemetry is opt-in and can be enabled or disabled at any time by toggling "Nextflow > Telemetry: Enabled" in your VS Code settings.

**Information we collect**

- Commands: We track when you invoke a command provided by this extension, but not the contents of that command (e.g. user-supplied arguments).
- File events: We track when you open a Nextflow file, but not the file name or its contents.
- Environment info: We collect your operating system type, VS Code version, and the extension version to help diagnose issues and guide future development.

**Information we do not collect**

- Chat contents: We do not collect any text you enter into the chat panel.
- File contents: We do not collect any source code, file paths, or any other file contents.
- Personal info: We do not collect project names, directory paths, or any personally identifiable information.

If you have any questions or concerns, feel free to open an issue in our repository. We appreciate your trust and feedback!
