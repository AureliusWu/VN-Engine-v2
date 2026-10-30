"""Behavior tests for inventory errors, peer drift and evidence boundaries."""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parents[2] / "tools/vn_portfolio.py"
spec = importlib.util.spec_from_file_location("vn_portfolio", TOOL)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def repo(self, name="RESET"):
        root = self.base / name
        root.mkdir()
        (root / ".vn").mkdir()
        (root / "package.json").write_text(json.dumps({"version": "1.0.0", "scripts": {"test": "throw-if-executed"}}))
        (root / "story.json").write_text('{"scenes": []}')
        (root / "AGENTS.md").write_text("execution rules")
        (root / "ci.yml").write_text("not executed")
        profile = {"schema": audit.SCHEMA, "repository": "AureliusWu/" + name,
                   "kind": "game", "releaseAuthority": "native-project-gates",
                   "requiredPaths": ["AGENTS.md"], "sources": ["story.json"],
                   "commands": [{"id": "test", "argv": ["npm", "run", "test"]}], "workflows": ["ci.yml"]}
        self.write_profile(root, profile)
        if profile["repository"] in audit.SHARED_PEERS:
            profile["sharedManifest"] = "reuse.json"
            self.write_profile(root, profile)
            self.shared(root, {"AGENTS.md": audit.sha256(root / "AGENTS.md", True)})
        return root, profile

    def write_profile(self, root, profile):
        (root / audit.PROFILE).write_text(json.dumps(profile))

    def shared(self, root, files):
        (root / "reuse.json").write_text(json.dumps({"version": "1.2.0", "peers": sorted(audit.SHARED_PEERS), "files": files}))

    def test_inventory_never_executes_or_grants_release(self):
        root, _ = self.repo()
        report = audit.audit_portfolio([root])
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["coverage"], "partial")
        self.assertEqual(report["releaseStatus"], "NOT_ASSESSED")
        self.assertFalse(report["commandsExecuted"])
        self.assertEqual(report["repositories"][0]["checks"][0]["execution"], "NOT_RUN")

    def test_all_six_and_duplicate_repository(self):
        roots = [self.repo(name.split("/")[1])[0] for name in sorted(audit.REPOSITORIES)]
        self.assertEqual(audit.audit_portfolio(roots, True)["status"], "PASS")
        self.assertEqual(audit.audit_portfolio(roots[:-1], True)["status"], "FAIL")
        self.assertEqual(audit.audit_portfolio(roots + roots[:1], True)["status"], "FAIL")

    def test_missing_source_and_command_are_failures(self):
        root, profile = self.repo()
        profile["sources"] = ["absent/*.json"]
        profile["commands"][0]["argv"][2] = "typo"
        self.write_profile(root, profile)
        result = audit.audit_repo(root)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(any("No source" in e for e in result["errors"]))
        self.assertTrue(any("npm script" in e for e in result["errors"]))

    def test_corrupt_profile_does_not_hide_other_repos(self):
        first, _ = self.repo("RESET")
        second, _ = self.repo("Circuit")
        (first / audit.PROFILE).write_text("[")
        result = audit.audit_portfolio([first, second])
        self.assertEqual(result["status"], "FAIL")
        self.assertEqual(result["repositories"][1]["status"], "PASS")

    def test_shared_hash_drift_and_manifest_divergence(self):
        first, _ = self.repo("Rain")
        second, _ = self.repo("Healing")
        (first / "AGENTS.md").write_text("changed")
        self.assertEqual(audit.audit_repo(first)["status"], "FAIL")
        self.shared(first, {"AGENTS.md": audit.sha256(first / "AGENTS.md", True)})
        report = audit.audit_portfolio([first, second])
        self.assertTrue(any("Shared manifest drift" in e for e in report["errors"]))

    def test_shared_lf_normalization(self):
        root, _ = self.repo("Rain")
        (root / "shared.txt").write_bytes(b"one\r\ntwo\r\n")
        expected = audit.hashlib.sha256(b"one\ntwo\n").hexdigest()
        self.shared(root, {"shared.txt": expected})
        self.assertEqual(audit.audit_repo(root)["status"], "PASS")

    def test_unsafe_and_symlink_paths(self):
        root, _ = self.repo()
        for name in ("../secret", "/tmp/secret", "a//b", "a/./b", "a\\b", "C:/x"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                audit.repo_path(root, name)
        (root / "escape").symlink_to(self.base, target_is_directory=True)
        with self.assertRaises(ValueError):
            audit.repo_path(root, "escape/absent/file")

    def test_cli_preserves_existing_evidence_and_nonzero_exit(self):
        root, _ = self.repo()
        output = self.base / "report.json"
        first = subprocess.run([sys.executable, str(TOOL), str(root), "--out", str(output)], capture_output=True)
        self.assertEqual(first.returncode, 0)
        original = output.read_bytes()
        repeat = subprocess.run([sys.executable, str(TOOL), str(root), "--out", str(output)], capture_output=True)
        self.assertEqual(repeat.returncode, 2)
        self.assertEqual(output.read_bytes(), original)
        incomplete = subprocess.run([sys.executable, str(TOOL), str(root), "--require-all"], capture_output=True)
        self.assertEqual(incomplete.returncode, 1)


if __name__ == "__main__":
    unittest.main()
