"""Stored artifacts only: these tests never claim a new LibreOffice execution."""
from pathlib import Path
import sys
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from check_downloads import CheckError, check_downloads, csv_rows, strict_json
from verify_libreoffice import check_fixtures, verify_acquisition, verify_audit, verify_csv_import


def changed_zip(source, destination, member, transform):
    with ZipFile(source) as original, ZipFile(destination, "w") as changed:
        for entry in original.infolist():
            data = original.read(entry.filename)
            if entry.filename == member:
                data = transform(data)
            changed.writestr(entry, data)


class ConsumerEvidence(unittest.TestCase):
    def test_stored_execution_is_explicitly_not_new_execution(self):
        for name in ("libreoffice-node", "libreoffice-text-node", "libreoffice-chrome"):
            with self.subTest(name=name):
                result = check_fixtures(ROOT / "fixtures/interop" / name)
                self.assertFalse(result["newExternalExecution"])
                self.assertEqual(result["mode"], "stored-evidence-only")
                self.assertEqual(result["results"]["audit"]["formulaCachesChecked"], 189)
                self.assertEqual(result["provenance"], "chrome-download" if name == "libreoffice-chrome" else "node-reference")

    def test_authored_text_survives_json_csv_and_actual_recorded_import(self):
        directory = ROOT / "fixtures/interop/text-reference"
        p = strict_json((directory / "rateio-projeto.json").read_bytes())
        self.assertEqual([r["name"] for r in p["participants"]][:4], ["=1+1", "+SUM(A1:A2)", "-2+3", "@SUM(A1:A2)"])
        rows = csv_rows((directory / "rateio-saldos.csv").read_bytes())
        self.assertEqual([r[1] for r in rows[1:5]], ["'=1+1", "'+SUM(A1:A2)", "'-2+3", "'@SUM(A1:A2)"])
        self.assertEqual(check_downloads(directory, provenance="node-reference")["totals"]["pendingCents"], 85)
        result = verify_csv_import(directory / "rateio-saldos.csv", ROOT / "fixtures/interop/libreoffice-text-node/rateio-saldos-import.ods")
        self.assertTrue(result["allCellsText"])

    def test_imported_numeric_lexeme_mutation_fails(self):
        directory = ROOT / "fixtures/interop/libreoffice-node"
        with tempfile.TemporaryDirectory() as temporary:
            mutated = Path(temporary) / "mutated.ods"
            def transform(data):
                self.assertIn(b">1850<", data)
                return data.replace(b">1850<", b">1851<", 1)
            changed_zip(directory / "rateio-saldos-import.ods", mutated, "content.xml", transform)
            with self.assertRaises(CheckError):
                verify_csv_import(directory / "downloads/rateio-saldos.csv", mutated)
        directory = ROOT / "fixtures/interop/libreoffice-chrome"
        with tempfile.TemporaryDirectory() as temporary:
            proof = Path(temporary) / "acquisition.json"
            proof.write_text((directory / "acquisition.json").read_text().replace('"bytes": 1751', '"bytes": 1752', 1))
            with self.assertRaises(CheckError):
                verify_acquisition(proof, directory / "downloads")

    def test_formula_cache_mutation_fails_against_literal_expected(self):
        directory = ROOT / "fixtures/interop/libreoffice-node"
        with tempfile.TemporaryDirectory() as temporary:
            mutated = Path(temporary) / "mutated.xlsx"
            def transform(data):
                self.assertIn(b"<v>3001</v>", data)
                return data.replace(b"<v>3001</v>", b"<v>3002</v>", 1)
            changed_zip(directory / "audit-libreoffice.xlsx", mutated, "xl/worksheets/sheet1.xml", transform)
            with self.assertRaises(CheckError):
                verify_audit(directory / "audit-source.xlsx", mutated)


if __name__ == "__main__":
    unittest.main()
