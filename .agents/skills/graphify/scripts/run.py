#!/usr/bin/env python3
"""Run the pinned official Graphify CLI against an explicit local project."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import venv

PACKAGE = "graphifyy[sql]==0.9.108"


def command(project):
    uv = shutil.which("uv")
    if uv:
        return [uv, "tool", "run", "--from", PACKAGE, "graphify"]
    env = project / ".graphify-venv"
    python = env / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.create(env, with_pip=True)
    version = subprocess.run(
        [str(python), "-c", "from importlib.metadata import version; "
         "print(version('graphifyy'))"],
        capture_output=True, text=True, check=False,
    )
    if version.returncode or version.stdout.strip() != "0.9.108":
        subprocess.run(
            [str(python), "-m", "pip", "install", PACKAGE], check=True,
        )
    return [str(python), "-m", "graphify"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=Path.cwd())
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("build")
    actions.add_parser("version")
    for name in ("query", "explain", "affected"):
        actions.add_parser(name).add_argument("text")
    path = actions.add_parser("path")
    path.add_argument("source")
    path.add_argument("target")
    args = parser.parse_args()
    project = args.project.resolve(strict=True)
    if not project.is_dir():
        parser.error("--project must be a directory")
    graph = project / "graphify-out" / "graph.json"
    if args.action not in ("build", "version") and not graph.is_file():
        parser.error("Graph missing: run build first")
    if args.action == "build":
        cli = ["extract", str(project), "--code-only", "--max-workers",
               "2", "--no-dedup"]
    elif args.action == "version":
        cli = ["--version"]
    elif args.action == "path":
        cli = ["path", args.source, args.target, "--graph", str(graph)]
    else:
        cli = [args.action, args.text, "--graph", str(graph)]
        if args.action == "query":
            cli += ["--budget", "1500"]
    base = command(project)
    result = subprocess.run(base + cli, cwd=project, check=False)
    if result.returncode:
        return result.returncode
    if args.action == "build":
        data = json.loads(graph.read_text(encoding="utf-8"))
        if not data.get("nodes"):
            raise RuntimeError("Graphify produced an empty graph")
        print(f"Verified graph: {len(data['nodes'])} nodes, "
              f"{len(data.get('links', data.get('edges', [])))} edges")
        result = subprocess.run(
            base + ["cluster-only", str(project), "--no-label", "--no-viz"],
            cwd=project, check=False,
        )
        return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
