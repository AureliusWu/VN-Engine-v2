#!/usr/bin/env python3
"""Read-only VN workflow inventory. Never execute profile commands or grant release PASS."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path, PurePosixPath

VERSION = "1.0.0"
SCHEMA = "vn-workflow-profile-v1"
PROFILE = ".vn/workflow.json"
REPOSITORIES = {f"AureliusWu/{name}" for name in (
    "Rain", "Healing", "NetLove", "Circuit", "RESET", "VN-Engine-v2"
)}
SHARED_PEERS = {"AureliusWu/Rain", "AureliusWu/Healing", "AureliusWu/NetLove"}


def repo_path(root: Path, name: str) -> Path:
    """Reject aliases and links outside the checkout, including absent descendants."""
    if (not isinstance(name, str) or not name or "\\" in name or ":" in name
            or "\0" in name or name.startswith("/")
            or any(part in ("", ".", "..") for part in name.split("/"))):
        raise ValueError(f"Unsafe repository path: {name!r}")
    candidate = root.joinpath(*PurePosixPath(name).parts)
    if not candidate.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Path leaves checkout: {name}")
    return candidate


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path: Path, normalize_lf=False):
    raw = path.read_bytes()
    if normalize_lf:
        raw = raw.decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def git_state(root: Path):
    def git(*args):
        try:
            p = subprocess.run(["git", "-C", str(root), *args], capture_output=True,
                               text=True, timeout=10, check=False)
            return p.stdout.strip() if p.returncode == 0 else None
        except (OSError, subprocess.TimeoutExpired):
            return None
    head = git("rev-parse", "HEAD")
    # A snapshot without its own .git must not inherit an ancestor's identity.
    top = git("rev-parse", "--show-toplevel")
    if top is None or Path(top).resolve() != root.resolve():
        return {"commit": None, "dirty": None, "identity": "unversioned-snapshot"}
    dirty = git("status", "--porcelain", "--untracked-files=normal")
    return {"commit": head, "dirty": None if dirty is None else bool(dirty),
            "identity": "checkout"}


def check_command(root, command, scripts):
    """Lint documented argv, without evaluating shell or running the argv."""
    if (not isinstance(command, dict) or not isinstance(command.get("id"), str)
            or not command["id"]):
        raise ValueError("Command needs a nonempty id")
    argv = command.get("argv")
    if not isinstance(argv, list) or not argv or any(not isinstance(a, str) or not a for a in argv):
        raise ValueError(f"Invalid argv: {command['id']}")
    if argv[0] == "npm":
        if len(argv) < 3 or argv[1] != "run" or argv[2] not in scripts:
            raise ValueError(f"Unknown npm script: {command['id']}")
    elif argv[0] == "node":
        if len(argv) < 2 or not repo_path(root, argv[1]).is_file():
            raise ValueError(f"Missing node entry: {command['id']}")
    elif argv[0] in ("python", "python3"):
        if len(argv) >= 3 and argv[1] == "-m":
            module = argv[2]
            if not re.fullmatch(r"[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*", module):
                raise ValueError(f"Invalid Python module: {module}")
            if module != "unittest":
                target = module.replace(".", "/")
                if not (repo_path(root, target + ".py").is_file()
                        or repo_path(root, target + "/__main__.py").is_file()):
                    raise ValueError(f"Missing Python module: {module}")
        elif len(argv) < 2 or not repo_path(root, argv[1]).is_file():
            raise ValueError(f"Missing Python entry: {command['id']}")
    else:
        raise ValueError(f"Unsupported command launcher: {argv[0]}")
    return {"id": command["id"], "argv": argv, "entryStatus": "FOUND", "execution": "NOT_RUN"}


def audit_repo(root: Path):
    root = root.resolve()
    result = {"root": str(root), "repository": None, "errors": [], "checks": [],
              "sources": [], "workflows": [], "shared": None, **git_state(root)}
    try:
        profile_file = repo_path(root, PROFILE)
        profile = read_json(profile_file)
        result["profileSha256"] = sha256(profile_file)
        if not isinstance(profile, dict) or profile.get("schema") != SCHEMA:
            raise ValueError("Unsupported workflow profile schema")
        repository = profile.get("repository")
        if repository not in REPOSITORIES:
            raise ValueError(f"Unsupported portfolio repository: {repository}")
        result["repository"] = repository
        result["kind"] = profile.get("kind")
        if profile.get("kind") not in ("game", "engine"):
            raise ValueError("kind must be game or engine")
        if profile.get("releaseAuthority") != "native-project-gates":
            raise ValueError("Workflow inventory cannot be a release authority")
        for field in ("requiredPaths", "sources", "commands", "workflows"):
            if not isinstance(profile.get(field), list) or not profile[field]:
                raise ValueError(f"Missing or empty {field}")
        package = read_json(repo_path(root, "package.json"))
        result["packageVersion"] = package.get("version")
        for name in profile["requiredPaths"]:
            if not repo_path(root, name).exists():
                result["errors"].append(f"Missing required path: {name}")
        source_files = set()
        for pattern in profile["sources"]:
            # Validate the lexical pattern before globbing; validate every result too.
            repo_path(root, pattern)
            matches = sorted(root.glob(pattern))
            if not matches:
                result["errors"].append(f"No source files: {pattern}")
            for match in matches:
                name = match.relative_to(root).as_posix()
                actual = repo_path(root, name)
                if actual.is_file():
                    source_files.add(name)
        for name in sorted(source_files):
            result["sources"].append({"path": name, "sha256": sha256(repo_path(root, name))})
        if not source_files:
            result["errors"].append("No authored source files were inspected")
        ids = set()
        for command in profile["commands"]:
            try:
                checked = check_command(root, command, package.get("scripts", {}))
                if checked["id"] in ids:
                    raise ValueError(f"Duplicate command id: {checked['id']}")
                ids.add(checked["id"])
                result["checks"].append(checked)
            except (ValueError, TypeError, KeyError) as error:
                result["errors"].append(str(error))
        for name in profile["workflows"]:
            path = repo_path(root, name)
            if not path.is_file():
                result["errors"].append(f"Missing workflow: {name}")
            else:
                result["workflows"].append({"path": name, "sha256": sha256(path), "execution": "NOT_RUN"})
        shared_path = profile.get("sharedManifest")
        if repository in SHARED_PEERS and not shared_path:
            result["errors"].append("Shared peer must declare its existing reuse manifest")
        if shared_path:
            manifest = read_json(repo_path(root, shared_path))
            files = manifest.get("files")
            if (manifest.get("version") != "1.2.0" or not isinstance(files, dict) or not files
                    or set(manifest.get("peers", [])) != SHARED_PEERS):
                raise ValueError("Invalid shared reuse manifest v1.2.0")
            for name, expected in files.items():
                if not isinstance(expected, str) or not re.fullmatch("[a-f0-9]{64}", expected):
                    raise ValueError(f"Invalid shared SHA256: {name}")
                actual = repo_path(root, name)
                if not actual.is_file() or sha256(actual, True) != expected:
                    result["errors"].append(f"Shared file drift: {name}")
            result["shared"] = {"version": manifest["version"], "files": files}
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as error:
        result["errors"].append(str(error))
    result["status"] = "FAIL" if result["errors"] else "PASS"
    return result


def audit_portfolio(roots, require_all=False):
    results = [audit_repo(Path(root)) for root in roots]
    errors = []
    seen = set()
    for item in results:
        name = item["repository"]
        if name in seen:
            errors.append(f"Duplicate repository: {name}")
        if name is not None:
            seen.add(name)
    missing = sorted(REPOSITORIES - seen)
    shared = [r for r in results if r["shared"] is not None]
    for item in shared[1:]:
        if item["shared"] != shared[0]["shared"]:
            errors.append("Shared manifest drift between portfolio peers")
            break
    if require_all and missing:
        errors.append("Missing portfolio repositories: " + ", ".join(missing))
    passed = not errors and all(r["status"] == "PASS" for r in results) and bool(results)
    return {"schema": "vn-workflow-audit-v1", "toolVersion": VERSION,
            "scope": "workflow-inventory-only", "status": "PASS" if passed else "FAIL",
            "coverage": "complete" if not missing else "partial", "missingRepositories": missing,
            "releaseStatus": "NOT_ASSESSED", "runtimeStatus": "NOT_RUN",
            "commandsExecuted": False, "errors": errors, "repositories": results}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", nargs="+", type=Path)
    parser.add_argument("--require-all", action="store_true", help="Require all six repositories")
    parser.add_argument("--out", type=Path, help="Write JSON to a new file (never overwrite evidence)")
    args = parser.parse_args(argv)
    report = audit_portfolio(args.roots, args.require_all)
    serialized = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.out:
        try:
            with args.out.open("x", encoding="utf-8") as output:
                output.write(serialized)
        except OSError as error:
            print(f"Cannot create report: {error}", file=sys.stderr)
            return 2
    print(serialized)
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
