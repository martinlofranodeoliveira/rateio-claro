"""Manual goldens and adversarial mutations of the independent consumer."""
import copy
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
from check_downloads import CheckError, check_downloads, protected, reconstruct, strict_json, validate_project


def tiny(amount=1, shares=None, transfers=None, payer="a"):
    return {"version": 1, "title": "Ouro manual", "currency": "BRL", "participants": [{"id": pid, "name": "Mesmo nome"} for pid in ("a", "b", "c")], "expenses": [{"id": "e", "description": "Despesa", "payer": payer, "amountCents": amount, "shares": shares or [{"participant": pid, "weight": 1} for pid in ("a", "b", "c")]}], "transfers": transfers or []}


class IndependentGoldens(unittest.TestCase):
    def test_demo_literal_totals_receipts_balances_suggestions(self):
        p = strict_json((ROOT / "fixtures/demo-project.json").read_bytes())
        a = reconstruct(p)
        self.assertEqual([a[k] for k in ("totalExpenseCents", "totalTransferCents", "pendingCents")], [26901, 2000, 3450])
        self.assertEqual([r["shareCents"] for r in a["participants"]], [8151, 5300, 8150, 5300])
        self.assertEqual([r["balanceCents"] for r in a["participants"]], [1850, 1600, -150, -3300])
        self.assertEqual(a["suggestions"], [{"from": "clara", "to": "ana", "amountCents": 150}, {"from": "diego", "to": "ana", "amountCents": 1700}, {"from": "diego", "to": "bruno", "amountCents": 1600}])
        lunch = a["receipts"][0]
        self.assertEqual(lunch["expenseId"], "almoco")
        self.assertEqual([r["shareCents"] for r in lunch["allocations"]], [3001, 3000, 3000, 3000])
        self.assertEqual([(r["numerator"], r["denominator"], r["remainder"], r["extraCents"]) for r in lunch["allocations"]], [("12001", "4", "1", 1), ("12001", "4", "1", 0), ("12001", "4", "1", 0), ("12001", "4", "1", 0)])

    def test_ascii_tie_and_split_expenses_literal(self):
        combined = tiny(2)
        split = tiny(1)
        split["expenses"].append(dict(copy.deepcopy(split["expenses"][0]), id="e2"))
        self.assertEqual([p["shareCents"] for p in reconstruct(combined)["participants"]], [1, 1, 0])
        self.assertEqual([p["shareCents"] for p in reconstruct(split)["participants"]], [2, 0, 0])
        self.assertEqual([p["balanceCents"] for p in reconstruct(split)["participants"]], [0, 0, 0])

    def test_weighted_and_large_numerator_literal(self):
        p = tiny(999999999999, [{"participant": "a", "weight": 999999999}, {"participant": "b", "weight": 1000000000}], payer="c")
        a = reconstruct(p)
        self.assertEqual([r["shareCents"] for r in a["participants"]], [499999999749, 500000000250, 0])
        self.assertEqual(a["receipts"][0]["allocations"][0]["numerator"], "999999998999000000001")
        self.assertEqual([r["balanceCents"] for r in a["participants"]], [-499999999749, -500000000250, 999999999999])

    def test_overpayment_sign_and_nonbeneficiary_payer(self):
        p = tiny(100, [{"participant": "a", "weight": 1}, {"participant": "b", "weight": 1}], [{"id": "t", "from": "b", "to": "a", "amountCents": 100, "note": ""}])
        a = reconstruct(p)
        self.assertEqual([r["balanceCents"] for r in a["participants"]], [-50, 50, 0])
        self.assertEqual(a["totalExpenseCents"], 100)
        self.assertEqual(a["suggestions"], [{"from": "a", "to": "b", "amountCents": 50}])
        p = tiny(101, [{"participant": "b", "weight": 1}, {"participant": "c", "weight": 1}])
        self.assertEqual([r["balanceCents"] for r in reconstruct(p)["participants"]], [101, -51, -50])

    def test_order_invariance_and_replay(self):
        p = strict_json((ROOT / "fixtures/demo-project.json").read_bytes())
        wanted = reconstruct(p)
        p["participants"].reverse()
        p["expenses"].reverse()
        for row in p["expenses"]:
            row["shares"].reverse()
        self.assertEqual(reconstruct(p), wanted)
        for index, suggestion in enumerate(wanted["suggestions"]):
            p["transfers"].append(dict(suggestion, id=f"replay-{index}", note=""))
        self.assertEqual(reconstruct(p)["pendingCents"], 0)

    def test_deterministic_suggestions_do_not_claim_minimum(self):
        p = {"version": 1, "title": "Três sugestões, duas bastariam", "currency": "BRL", "participants": [{"id": pid, "name": pid} for pid in "abcd"], "expenses": [{"id": "e1", "description": "Uma", "payer": "c", "amountCents": 400, "shares": [{"participant": "b", "weight": 1}]}, {"id": "e2", "description": "Outra", "payer": "d", "amountCents": 500, "shares": [{"participant": "a", "weight": 1}]}], "transfers": []}
        self.assertEqual(reconstruct(p)["suggestions"], [{"from": "a", "to": "c", "amountCents": 400}, {"from": "a", "to": "d", "amountCents": 100}, {"from": "b", "to": "d", "amountCents": 400}])
        # The valid two-transfer alternative is literal evidence of non-minimality.
        p["transfers"] = [{"id": "t1", "from": "a", "to": "d", "amountCents": 500, "note": ""}, {"id": "t2", "from": "b", "to": "c", "amountCents": 400, "note": ""}]
        self.assertEqual(reconstruct(p)["pendingCents"], 0)

    def test_empty_project_is_valid(self):
        p = {"version": 1, "title": "Vazio", "currency": "BRL", "participants": [], "expenses": [], "transfers": []}
        self.assertEqual(reconstruct(p), {"totalExpenseCents": 0, "totalTransferCents": 0, "pendingCents": 0, "participants": [], "receipts": [], "suggestions": []})

    def test_lexemes_checked_before_numeric_rounding(self):
        for raw in (b'{"x":1000000000000.00001}', b'{"x":1e3}', b'{"x":NaN}', b'{"x":1,"x":2}', b'\xef\xbb\xbf{}', b'{"x":"\xff"}'):
            with self.subTest(raw=raw), self.assertRaises(CheckError):
                strict_json(raw)
        self.assertEqual(strict_json(b'{"x":"1.00001 and 1e3","y":1000000000000}')["y"], 1000000000000)

    def test_schema_rejects_boolean_unknown_reference_and_duplicate(self):
        mutations = [lambda p: p.update(version=True), lambda p: p.update(unknown=1), lambda p: p["expenses"][0].update(payer="missing"), lambda p: p["participants"].append(p["participants"][0]), lambda p: p["expenses"][0].update(amountCents=True)]
        for mutation in mutations:
            p = tiny()
            mutation(p)
            with self.assertRaises(CheckError):
                reconstruct(p)
        p = tiny()
        p["participants"] = [{"id": f"p{i}", "name": "P"} for i in range(100)]
        shares = [{"participant": person["id"], "weight": 1} for person in p["participants"]]
        p["expenses"] = [{"id": f"e{i}", "description": "D", "payer": "p0", "amountCents": 1, "shares": shares} for i in range(500)]
        compact = json.dumps(p, ensure_ascii=False, separators=(",", ":")).encode()
        self.assertLess(len(compact), 2 * 1024**2)
        # Raw import fits; schema's own canonical serialization must also fit.
        with self.assertRaises(CheckError):
            validate_project(strict_json(compact))
        p = tiny()
        p["participants"][0]["name"] = "\u0085=1+1"
        validate_project(p)  # U+0085 is permitted text, not a JS trim character.
        self.assertEqual(protected(p["participants"][0]["name"]), "\u0085=1+1")
        self.assertEqual(protected("\ufeff=1+1"), "'\ufeff=1+1")


class ExportMutations(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name) / "downloads"
        shutil.copytree(ROOT / "fixtures/interop/node-reference", self.directory)

    def tearDown(self):
        self.temp.cleanup()

    def test_reference_is_explicitly_node(self):
        result = check_downloads(self.directory, provenance="node-reference")
        self.assertEqual(result["provenance"], "node-reference")
        self.assertEqual(result["totals"]["pendingCents"], 3450)
        memory_path = self.directory / "rateio-memoria.json"
        memory_path.write_text(memory_path.read_text().replace('"version": 1', '"version": true', 1))
        with self.assertRaises(CheckError):
            check_downloads(self.directory, provenance="node-reference")

    def test_each_export_monetary_or_authored_mutation_fails(self):
        mutations = {"rateio-projeto.json": ('"amountCents": 12001', '"amountCents": 12002'), "rateio-memoria.json": ('"pendingCents": 3450', '"pendingCents": 3451'), "rateio-saldos.csv": ("1850", "1851"), "rateio-parcelas.csv": ("3001", "3002"), "rateio-sugestoes.csv": ("1700", "1701"), "rateio-relatorio.md": ("R$ 1,50", "R$ 1,51")}
        for name, (old, new) in mutations.items():
            path = self.directory / name
            original = path.read_text(encoding="utf-8")
            self.assertIn(old, original)
            path.write_text(original.replace(old, new, 1), encoding="utf-8")
            with self.subTest(name=name), self.assertRaises(CheckError):
                check_downloads(self.directory, provenance="node-reference")
            path.write_text(original, encoding="utf-8")

    def test_extra_missing_and_suffixed_filename_fail(self):
        path = self.directory / "rateio-saldos.csv"
        path.rename(self.directory / "rateio-saldos (1).csv")
        with self.assertRaises(CheckError):
            check_downloads(self.directory, provenance="node-reference")
        (self.directory / "rateio-saldos (1).csv").rename(path)
        (self.directory / "extra.txt").write_text("extra")
        with self.assertRaises(CheckError):
            check_downloads(self.directory, provenance="node-reference")


if __name__ == "__main__":
    unittest.main()
