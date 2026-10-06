"""Generate the MetroFlow metro map of a Nextflow workflow.

The structure comes from the Nextflow language server (bioflow-insight's
language-server mode). Unlike `bioflow-insight --analysis metroflow`, there is
no fallback to the bioflow-insight engine.

Usage: generate_metro_map.py <main.nf> <output dir>
Prints the path of the generated metro_map.json.
bioflow-insight is bundled with the extension, which puts it on PYTHONPATH.
Exit codes: 0 success, 1 generation failed, 2 bioflow-insight cannot be imported
(usually because one of its Python dependencies is not installed).
"""

import contextlib
import os
import sys
import traceback


def main():
    workflow_file, output_dir = sys.argv[1], sys.argv[2]

    try:
        from src.workflow import Workflow
    except ImportError as e:
        print(f"bioflow-insight cannot be imported: {e}", file=sys.stderr)
        sys.exit(2)

    try:
        # bioflow-insight prints progress on stdout, which is reserved for the result
        with contextlib.redirect_stdout(sys.stderr):
            workflow = Workflow(file=workflow_file, display_info=False, output_dir=output_dir)
            workflow.initialise_with_language_server()
            workflow.get_metro_map_json(render_dot=True)
    except Exception as e:
        # The last line of stderr is the message shown to the user
        traceback.print_exc()
        message = str(e) if type(e).__name__ == "BioFlowInsightError" else f"{type(e).__name__}: {e}"
        print(message, file=sys.stderr)
        sys.exit(1)

    print(os.path.join(output_dir, "graphs", "metro_map.json"))


if __name__ == "__main__":
    main()
