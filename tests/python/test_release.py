"""Packaging tests do not initialize a repository or publish any artifact."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("rateio_release", ROOT / "scripts/release.py")
RELEASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RELEASE)


class ReleasePackagingTests(unittest.TestCase):
    def test_zip_is_deterministic_sorted_complete_and_crc_valid(self):
        with tempfile.TemporaryDirectory(prefix="rateio-release-test-") as temporary:
            first = Path(temporary) / "one.zip"
            second = Path(temporary) / "two.zip"
            files = {"src/core.mjs": (b"export const answer = 42;\n", 0o644),
                     "LICENSE": (b"MIT License\n", 0o644), "tools/check.py": (b"print('ok')\n", 0o755)}
            RELEASE.write_zip(first, files, "rateio-claro-source")
            RELEASE.write_zip(second, dict(reversed(list(files.items()))), "rateio-claro-source")
            self.assertEqual(first.read_bytes(), second.read_bytes())
            with zipfile.ZipFile(first) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(archive.namelist(), [f"rateio-claro-source/{name}" for name in sorted(files)])
                for info in archive.infolist():
                    name = info.filename.removeprefix("rateio-claro-source/")
                    self.assertEqual(archive.read(info), files[name][0])
                    self.assertEqual(info.date_time, (1980, 1, 1, 0, 0, 0))
                    self.assertEqual(info.compress_type, zipfile.ZIP_STORED)
                    self.assertEqual(stat.S_IMODE(info.external_attr >> 16), files[name][1])
                    self.assertTrue(stat.S_ISREG(info.external_attr >> 16))

    def test_paths_cannot_include_local_state_venv_secrets_or_traversal(self):
        for name in ("", "../file", "/file", "src/../file", "src\\file", "local/file", "dist/file",
                     ".git/config", ".venv-interop/file", ".impeccable/context", ".openai/config",
                     "nested/.impeccable/context", "nested/.openai/config", "node_modules/file", "a/__pycache__/x.pyc",
                     ".env", "src/.env.production", "release/file", "test.pyc"):
            with self.subTest(name=name), self.assertRaises(RELEASE.ReleaseError):
                RELEASE.safe_name(name)
        for name in (".github/workflows/ci.yml", "scripts/release.py", "fixtures/report.ods", "LICENSE", "src/core.mjs"):
            self.assertEqual(RELEASE.safe_name(name), name)

    def test_no_repository_means_no_release(self):
        with tempfile.TemporaryDirectory(prefix="rateio-release-clean-test-") as temporary:
            with self.assertRaisesRegex(RELEASE.ReleaseError, "repositório Git próprio"):
                RELEASE.clean_commit(Path(temporary))
            self.assertEqual(list(Path(temporary).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
