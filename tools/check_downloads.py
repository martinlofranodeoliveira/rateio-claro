#!/usr/bin/env python3
"""Independent stdlib verifier of the six Rateio Claro exports; never imports JS."""
from __future__ import annotations

import argparse
import csv
from fractions import Fraction
import hashlib
import html
import io
import json
from pathlib import Path
import re
import sys

FILENAMES = frozenset(("rateio-projeto.json", "rateio-memoria.json", "rateio-saldos.csv", "rateio-parcelas.csv", "rateio-sugestoes.csv", "rateio-relatorio.md"))
HEADERS = {
    "rateio-saldos.csv": "participant_id,name,paid_cents,share_cents,sent_cents,received_cents,balance_cents".split(","),
    "rateio-parcelas.csv": "expense_id,description,payer,participant_id,name,weight,total_weight,base_cents,remainder,extra_cents,share_cents".split(","),
    "rateio-sugestoes.csv": "status,from_id,from_name,to_id,to_name,amount_cents".split(","),
}
MAX_CENTS = 10**12
MAX_BYTES = 2 * 1024**2
ID = re.compile(r"[a-z][a-z0-9_-]{0,39}\Z")
# Match the documented JS trim/\s boundary explicitly, without Python's extra
# U+0085 whitespace or a dependency on either runtime's Unicode tables.
TEXT_SPACES = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


class CheckError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise CheckError(message)


def strict_json(data, *, max_bytes=MAX_BYTES):
    """json's parse hooks see raw numeric lexemes before any float rounding."""
    if isinstance(data, str):
        data = data.encode("utf-8", errors="strict")
    require(len(data) <= max_bytes, "JSON acima do limite")
    require(not data.startswith(b"\xef\xbb\xbf"), "BOM JSON recusado")

    def integer(raw):
        require(re.fullmatch(r"-?(?:0|[1-9][0-9]*)", raw), "Lexema JSON não inteiro")
        return int(raw)

    def noninteger(_raw):
        raise CheckError("Lexema JSON fracionário, exponencial ou não finito")

    def pairs(rows):
        result = {}
        for key, value in rows:
            require(key not in result, "Chave JSON duplicada")
            result[key] = value
        return result

    try:
        return json.loads(data.decode("utf-8", errors="strict"), parse_int=integer, parse_float=noninteger, parse_constant=noninteger, object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise CheckError("JSON ou UTF-8 inválido") from error


def keys(value, expected):
    require(type(value) is dict and set(value) == set(expected.split()), "Estrutura ou campos divergentes")


def text(value, minimum, maximum):
    require(type(value) is str and minimum <= len(value) <= maximum and value.strip(TEXT_SPACES) == value, "Texto inválido")
    require(not any(ord(c) < 32 or ord(c) == 127 or 0xD800 <= ord(c) <= 0xDFFF or ord(c) in (0x2028, 0x2029, 0xFFFE, 0xFFFF) for c in value), "Caractere de texto inválido")


def integer(value, low, high):
    require(type(value) is int and low <= value <= high, "Inteiro fora dos limites")


def validate_project(project):
    keys(project, "version title currency participants expenses transfers")
    require(type(project["version"]) is int and project["version"] == 1 and project["currency"] == "BRL", "Versão ou moeda divergente")
    text(project["title"], 1, 120)
    ids = {}
    for collection, limit, fields in (("participants", 100, "id name"), ("expenses", 500, "id description payer amountCents shares"), ("transfers", 500, "id from to amountCents note")):
        rows = project[collection]
        require(type(rows) is list and len(rows) <= limit, "Coleção inválida")
        seen = set()
        for row in rows:
            keys(row, fields)
            require(type(row["id"]) is str and ID.fullmatch(row["id"]) and row["id"] not in seen, "ID inválido ou repetido")
            seen.add(row["id"])
        ids[collection] = seen
    for person in project["participants"]:
        text(person["name"], 1, 80)
    for expense in project["expenses"]:
        text(expense["description"], 1, 160)
        require(expense["payer"] in ids["participants"], "Pagador ausente")
        integer(expense["amountCents"], 1, MAX_CENTS)
        require(type(expense["shares"]) is list and 1 <= len(expense["shares"]) <= 100, "Beneficiários inválidos")
        seen = set()
        for share in expense["shares"]:
            keys(share, "participant weight")
            require(share["participant"] in ids["participants"] and share["participant"] not in seen, "Beneficiário ausente ou repetido")
            seen.add(share["participant"])
            integer(share["weight"], 1, 10**9)
    for transfer in project["transfers"]:
        require(transfer["from"] in ids["participants"] and transfer["to"] in ids["participants"] and transfer["from"] != transfer["to"], "Acerto inválido")
        integer(transfer["amountCents"], 1, MAX_CENTS)
        text(transfer["note"], 0, 160)
    for collection in ("expenses", "transfers"):
        require(sum(row["amountCents"] for row in project[collection]) <= MAX_CENTS, "Soma acima do limite")
    # A compact input can fit 2 MiB while its canonical pretty project does not.
    canonical = json.dumps(project, ensure_ascii=False, indent=2) + "\n"
    require(len(canonical.encode("utf-8")) <= MAX_BYTES, "Serialização canônica do projeto acima do limite")
    return project


def reconstruct(project):
    """Use rational Fraction quotas, exact floors and canonical remainder ranking."""
    validate_project(project)
    people = {p["id"]: dict(p, paidCents=0, shareCents=0, sentCents=0, receivedCents=0, balanceCents=0) for p in project["participants"]}
    receipts = []
    for expense in sorted(project["expenses"], key=lambda row: row["id"]):
        amount = expense["amountCents"]
        total = sum(row["weight"] for row in expense["shares"])
        allocations = []
        for share in sorted(expense["shares"], key=lambda row: row["participant"]):
            numerator = amount * share["weight"]
            quota = Fraction(numerator, total)
            base = quota.numerator // quota.denominator
            allocations.append(dict(participant=share["participant"], weight=share["weight"], numerator=str(numerator), denominator=str(total), baseCents=base, remainder=str(numerator % total), extraCents=0, shareCents=base))
        leftover = amount - sum(row["baseCents"] for row in allocations)
        ranked = sorted(allocations, key=lambda row: (-int(row["remainder"]), row["participant"]))
        for row in ranked[:leftover]:
            row["extraCents"] = 1
            row["shareCents"] += 1
        require(sum(row["shareCents"] for row in allocations) == amount, "Conservação de parcelas falhou")
        for row in allocations:
            people[row["participant"]]["shareCents"] += row["shareCents"]
        people[expense["payer"]]["paidCents"] += amount
        receipts.append(dict(expenseId=expense["id"], payer=expense["payer"], amountCents=amount, totalWeight=total, allocations=allocations))
    for transfer in project["transfers"]:
        people[transfer["from"]]["sentCents"] += transfer["amountCents"]
        people[transfer["to"]]["receivedCents"] += transfer["amountCents"]
    participants = [people[pid] for pid in sorted(people)]
    for row in participants:
        row["balanceCents"] = row["paidCents"] - row["shareCents"] + row["sentCents"] - row["receivedCents"]
    require(sum(row["balanceCents"] for row in participants) == 0, "Conservação de saldos falhou")
    debtors = [[row["id"], -row["balanceCents"]] for row in participants if row["balanceCents"] < 0]
    creditors = [[row["id"], row["balanceCents"]] for row in participants if row["balanceCents"] > 0]
    suggestions = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        amount = min(debtors[i][1], creditors[j][1])
        suggestions.append(dict(**{"from": debtors[i][0], "to": creditors[j][0]}, amountCents=amount))
        debtors[i][1] -= amount
        creditors[j][1] -= amount
        i += debtors[i][1] == 0
        j += creditors[j][1] == 0
    return dict(totalExpenseCents=sum(e["amountCents"] for e in project["expenses"]), totalTransferCents=sum(t["amountCents"] for t in project["transfers"]), pendingCents=sum(p["balanceCents"] for p in participants if p["balanceCents"] > 0), participants=participants, receipts=receipts, suggestions=suggestions)


def protected(value):
    return "'" + value if value.lstrip(TEXT_SPACES)[:1] in ("=", "+", "-", "@") else value


def expected_csv(project, analysis):
    names = {p["id"]: p["name"] for p in project["participants"]}
    expenses = {e["id"]: e for e in project["expenses"]}
    result = {name: [headers] for name, headers in HEADERS.items()}
    for row in analysis["participants"]:
        result["rateio-saldos.csv"].append([row["id"], protected(row["name"]), *(str(row[key]) for key in ("paidCents", "shareCents", "sentCents", "receivedCents", "balanceCents"))])
    for receipt in analysis["receipts"]:
        for row in receipt["allocations"]:
            result["rateio-parcelas.csv"].append([receipt["expenseId"], protected(expenses[receipt["expenseId"]]["description"]), receipt["payer"], row["participant"], protected(names[row["participant"]]), str(row["weight"]), str(receipt["totalWeight"]), str(row["baseCents"]), row["remainder"], str(row["extraCents"]), str(row["shareCents"])])
    for row in analysis["suggestions"]:
        result["rateio-sugestoes.csv"].append(["suggestion", row["from"], protected(names[row["from"]]), row["to"], protected(names[row["to"]]), str(row["amountCents"])])
    return result


def csv_rows(data):
    try:
        text_data = data.decode("utf-8", errors="strict")
        require(not text_data.startswith("\ufeff") and "\r" not in text_data, "CSV deve usar UTF-8 sem BOM e LF")
        rows = list(csv.reader(io.StringIO(text_data, newline=""), strict=True))
        require(all(len(row) == len(rows[0]) for row in rows), "Colunas CSV divergentes")
        return rows
    except (UnicodeError, csv.Error, IndexError) as error:
        raise CheckError("CSV inválido") from error


def money(cents):
    sign = "-" if cents < 0 else ""
    whole, decimal = divmod(abs(cents), 100)
    return f"{sign}R$ {whole:,}".replace(",", ".") + f",{decimal:02}"


def check_markdown(data, project, analysis):
    try:
        document = data.decode("utf-8", errors="strict")
    except UnicodeError as error:
        raise CheckError("Markdown não é UTF-8") from error
    require("\r" not in document and document.endswith("\n"), "Markdown deve terminar LF")
    require("<" not in document and ">" not in document, "HTML autoral deve estar escapado no Markdown")
    lower = document.lower()
    for phrase in ("despesas", "acertos", "sugest", "restos", "centavo", "saldo"):
        require(phrase in lower, "Markdown sem explicação ou seção requerida")
    require(re.search(r"n[aã]o.{0,30}registrad", lower) and re.search(r"n[aã]o.{0,80}m[ií]nimo", lower), "Markdown deve distinguir sugestões e algoritmo não mínimo")
    for amount in (analysis["totalExpenseCents"], analysis["totalTransferCents"], analysis["pendingCents"]):
        require(money(amount) in document, "Total Markdown diverge do projeto")
    def decoded(value):
        return html.unescape(re.sub(r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])", r"\1", value.strip()))

    tables, current = [], []
    for line in document.splitlines() + [""]:
        if line.startswith("| ") and line.endswith(" |"):
            cells = [decoded(cell) for cell in re.split(r"(?<!\\)\|", line)[1:-1]]
            current.append(cells)
        elif current:
            require(len(current) >= 2 and all(c == "---" for c in current[1]), "Tabela Markdown sem separador")
            tables.append(current[2:])
            current = []
    names = {p["id"]: p["name"] for p in project["participants"]}
    person = lambda pid: f"{names[pid]} ({pid})"
    expected = [[[person(row["id"]), *(money(row[key]) for key in ("paidCents", "shareCents", "sentCents", "receivedCents", "balanceCents"))] for row in analysis["participants"]]]
    for receipt in analysis["receipts"]:
        expected.append([[person(row["participant"]), *(str(row[key]) for key in ("weight", "numerator", "denominator", "baseCents", "remainder", "extraCents")), money(row["shareCents"])] for row in receipt["allocations"]])
    if project["transfers"]:
        expected.append([[row["id"], person(row["from"]), person(row["to"]), money(row["amountCents"]), row["note"]] for row in sorted(project["transfers"], key=lambda row: row["id"])])
    if analysis["suggestions"]:
        expected.append([[person(row["from"]), person(row["to"]), money(row["amountCents"]), "Sugestão não registrada"] for row in analysis["suggestions"]])
    require(tables == expected, "Tabelas Markdown divergem de participantes, memória, acertos ou sugestões")
    require(decoded(document.splitlines()[0].removeprefix("# ")) == project["title"], "Título Markdown divergente")
    headings = [decoded(line.removeprefix("### ")) for line in document.splitlines() if line.startswith("### ")]
    expense_by_id = {row["id"]: row for row in project["expenses"]}
    require(headings == [f"{expense_by_id[row['expenseId']]['description']} ({row['expenseId']})" for row in analysis["receipts"]], "Despesas Markdown divergentes")
    return {"bytes": len(data), "sectionsAndTotalsChecked": True, "semanticTablesChecked": len(tables)}


def digest(path):
    content = path.read_bytes()
    return {"sha256": hashlib.sha256(content).hexdigest(), "size": len(content)}


def exact_equal(actual, expected):
    """Python bool equals int numerically; JSON semantic comparison must not."""
    if type(actual) is not type(expected):
        return False
    if type(expected) is dict:
        return actual.keys() == expected.keys() and all(exact_equal(actual[key], value) for key, value in expected.items())
    if type(expected) is list:
        return len(actual) == len(expected) and all(exact_equal(a, b) for a, b in zip(actual, expected))
    return actual == expected


def check_downloads(directory, *, provenance):
    directory = Path(directory)
    require(directory.is_dir(), "Diretório de downloads ausente")
    entries = list(directory.iterdir())
    require({p.name for p in entries} == FILENAMES and all(p.is_file() and not p.is_symlink() for p in entries), "Exija exatamente os seis downloads com nomes canônicos")
    project = strict_json((directory / "rateio-projeto.json").read_bytes())
    analysis = reconstruct(project)
    # A derived receipt memory can be much larger than its <=2 MiB project.
    # 64 MiB is an independent consumer resource cap, not a project-format limit.
    memory = strict_json((directory / "rateio-memoria.json").read_bytes(), max_bytes=64 * 1024**2)
    require(exact_equal(memory, {"version": 1, "title": project["title"], "currency": "BRL", "analysis": analysis}), "Memória JSON diverge da reconstrução independente")
    counts = {}
    for name, expected in expected_csv(project, analysis).items():
        actual = csv_rows((directory / name).read_bytes())
        require(actual == expected, "CSV diverge da reconstrução independente")
        counts[name] = len(actual) - 1
    markdown = check_markdown((directory / "rateio-relatorio.md").read_bytes(), project, analysis)
    return {"status": "ok", "provenance": provenance, "independentArithmetic": "Python Fraction and arbitrary-precision integers; no production JS imported", "project": {"participants": len(project["participants"]), "expenses": len(project["expenses"]), "transfers": len(project["transfers"])}, "totals": {key: analysis[key] for key in ("totalExpenseCents", "totalTransferCents", "pendingCents")}, "balances": {row["id"]: row["balanceCents"] for row in analysis["participants"]}, "csvDataRows": counts, "markdown": markdown, "files": {name: digest(directory / name) for name in sorted(FILENAMES)}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--provenance", choices=("node-reference", "chrome-download"), required=True, help="declared acquisition method; not inferred or authenticated by this script")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(argv)
    try:
        result = check_downloads(args.directory, provenance=args.provenance)
        output = json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
        if args.report:
            require(args.report.parent.resolve() != args.directory.resolve(), "Guarde o relatório fora dos seis downloads")
            args.report.write_text(output, encoding="utf-8")
        print(output, end="")
    except (CheckError, OSError, ValueError, TypeError, KeyError, OverflowError) as error:
        print(f"Falha na conferência independente: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
