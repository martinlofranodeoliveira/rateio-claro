"""Failure-path checks use subprocess doubles; no LibreOffice execution."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import verify_libreoffice as consumer


class ConsumerDiagnostics(unittest.TestCase):
    def invoke_failure(self, mode):
        with tempfile.TemporaryDirectory(prefix="rateio-diagnostic-test-") as temporary:
            output = Path(temporary) / "evidence"
            calls = []

            def simulated(argv, **kwargs):
                calls.append(argv)
                private_temp = str(Path(kwargs["env"]["HOME"]).parent)
                stderr = f"falha\n{private_temp}/profile {output}/downloads /home/private-person/custom-tool "
                if mode == "csv" and len(calls) == 1:
                    return subprocess.CompletedProcess(argv, 0, "LibreOffice simulated-test\n", "")
                if mode == "timeout":
                    raise subprocess.TimeoutExpired(argv, 60, stderr=stderr.encode())
                if mode == "oserror":
                    raise OSError(f"não iniciou /home/private-person/custom-tool {private_temp}")
                return subprocess.CompletedProcess(argv, 77, "", "" if mode == "empty" else stderr + "x" * 1000)

            error = io.StringIO()
            with patch.object(consumer, "make_audit", side_effect=lambda path: path.write_bytes(b"test only")), patch.object(consumer.subprocess, "run", side_effect=simulated), contextlib.redirect_stderr(error):
                status = consumer.main([str(ROOT / "fixtures/interop/node-reference"), "--provenance", "node-reference", "--output-dir", str(output)])
            self.assertEqual(status, 1)
            self.assertFalse((output / "evidence.json").exists())
            message = error.getvalue()
            self.assertNotIn(str(output), message)
            self.assertNotIn("/tmp/rateio-libreoffice-", message)
            self.assertNotIn("/home/private-person", message)
            self.assertLess(len(message), 650)
            return message

    def test_nonzero_csv_phase_has_bounded_portable_stderr(self):
        message = self.invoke_failure("csv")
        self.assertIn("Fase importar-rateio-saldos.csv; returnCode=77", message)
        for placeholder in ("[TEMP]", "[EVIDENCE]", "[PRIVATE_PATH]"):
            self.assertIn(placeholder, message)
        self.assertIn("…", message)

    def test_timeout_bytes_oserror_and_empty_stderr_remain_failures(self):
        for mode, code in (("timeout", "timeout"), ("oserror", "not-started"), ("empty", "77")):
            with self.subTest(mode=mode):
                message = self.invoke_failure(mode)
                self.assertIn(f"Fase identificar-versao; returnCode={code}", message)
                self.assertIn("stderr=(vazio)" if mode == "empty" else "[PRIVATE_PATH]", message)

    def test_only_consumer_runner_is_pinned_and_namespace_precheck_precedes_it(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()
        before_consumer, consumer_job = workflow.split("  libreoffice:\n", 1)
        self.assertEqual(before_consumer.count("runs-on: ubuntu-latest"), 2)
        self.assertIn("runs-on: ubuntu-22.04", consumer_job)
        precheck = "sudo unshare --user --map-root-user --net -- true"
        execution = 'sudo "$(command -v python3)" tools/verify_libreoffice.py'
        self.assertLess(consumer_job.index(precheck), consumer_job.index(execution))


if __name__ == "__main__":
    unittest.main()
