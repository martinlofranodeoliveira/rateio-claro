#!/usr/bin/env python3
"""Run LibreOffice in Linux user/network namespaces, or verify stored evidence."""
from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from check_downloads import CheckError, FILENAMES, HEADERS, check_downloads, csv_rows, digest, require

ROOT = Path(__file__).resolve().parents[1]
ODNS = {"office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0", "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0", "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0"}
XNS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# Every numeric expected result below was authored literally, independently of JS.
# (scenario, expense, amount, participants[(id, weight, (total,numerator,base,rem,extra,share))])
ALLOCATION_CASES = (
    ("Demo", "almoco", 12001, (("ana", 1, (4, 12001, 3000, 1, 1, 3001)), ("bruno", 1, (4, 12001, 3000, 1, 0, 3000)), ("clara", 1, (4, 12001, 3000, 1, 0, 3000)), ("diego", 1, (4, 12001, 3000, 1, 0, 3000)))),
    ("Demo", "transporte", 6900, (("ana", 1, (6, 6900, 1150, 0, 0, 1150)), ("bruno", 2, (6, 13800, 2300, 0, 0, 2300)), ("clara", 1, (6, 6900, 1150, 0, 0, 1150)), ("diego", 2, (6, 13800, 2300, 0, 0, 2300)))),
    ("Demo", "ingressos", 8000, (("ana", 1, (2, 8000, 4000, 0, 0, 4000)), ("clara", 1, (2, 8000, 4000, 0, 0, 4000)))),
    ("Empate", "e", 1, (("a", 1, (3, 1, 0, 1, 1, 1)), ("b", 1, (3, 1, 0, 1, 0, 0)), ("c", 1, (3, 1, 0, 1, 0, 0)))),
    ("Junta", "e", 2, (("a", 1, (3, 2, 0, 2, 1, 1)), ("b", 1, (3, 2, 0, 2, 1, 1)), ("c", 1, (3, 2, 0, 2, 0, 0)))),
    ("Separada", "e1", 1, (("a", 1, (3, 1, 0, 1, 1, 1)), ("b", 1, (3, 1, 0, 1, 0, 0)), ("c", 1, (3, 1, 0, 1, 0, 0)))),
    ("Separada", "e2", 1, (("a", 1, (3, 1, 0, 1, 1, 1)), ("b", 1, (3, 1, 0, 1, 0, 0)), ("c", 1, (3, 1, 0, 1, 0, 0)))),
    ("Sobrepago", "e", 100, (("a", 1, (2, 100, 50, 0, 0, 50)), ("b", 1, (2, 100, 50, 0, 0, 50)))),
)
# scenario, participant, paid, share, sent, received, expected balance, positive part
BALANCE_CASES = (
    ("Demo", "ana", 12001, 8151, 0, 2000, 1850, 1850),
    ("Demo", "bruno", 6900, 5300, 0, 0, 1600, 1600),
    ("Demo", "clara", 8000, 8150, 0, 0, -150, 0),
    ("Demo", "diego", 0, 5300, 2000, 0, -3300, 0),
    ("Empate", "a", 1, 1, 0, 0, 0, 0), ("Empate", "b", 0, 0, 0, 0, 0, 0), ("Empate", "c", 0, 0, 0, 0, 0, 0),
    ("Junta", "a", 2, 1, 0, 0, 1, 1), ("Junta", "b", 0, 1, 0, 0, -1, 0), ("Junta", "c", 0, 0, 0, 0, 0, 0),
    ("Separada", "a", 2, 2, 0, 0, 0, 0), ("Separada", "b", 0, 0, 0, 0, 0, 0), ("Separada", "c", 0, 0, 0, 0, 0, 0),
    ("Sobrepago", "a", 100, 50, 0, 100, -50, 0), ("Sobrepago", "b", 0, 50, 100, 0, 50, 50),
)


def allocation_rows():
    row = 2
    for scenario, expense, amount, participants in ALLOCATION_CASES:
        start, end = row, row + len(participants) - 1
        for pid, weight, expected in participants:
            remainder_range, id_range, base_range = f"$I${start}:$I${end}", f"$C${start}:$C${end}", f"$H${start}:$H${end}"
            formulas = (f"=SUM($E${start}:$E${end})", f"=D{row}*E{row}", f"=INT(G{row}/F{row})", f"=MOD(G{row},F{row})", f'=IF(COUNTIF({remainder_range},">"&I{row})+COUNTIFS({remainder_range},I{row},{id_range},"<"&C{row})<D{row}-SUM({base_range}),1,0)', f"=H{row}+J{row}")
            yield row, (scenario, expense, pid, amount, weight), formulas, expected
            row += 1


def make_audit(path):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Parcelas"
    sheet.append(["Cenario", "Despesa", "Participante", "Centavos", "Peso", "Soma pesos", "Numerador", "Base", "Resto", "Extra", "Parcela", "Esperado soma", "Esperado numerador", "Esperado base", "Esperado resto", "Esperado extra", "Esperado parcela"])
    refs = {}
    for row, inputs, formulas, expected in allocation_rows():
        sheet.append([*inputs, *formulas, *expected])
        refs.setdefault((inputs[0], inputs[2]), []).append(f"Parcelas!K{row}")
    sheet = workbook.create_sheet("Saldos")
    sheet.append(["Cenario", "Participante", "Pago", "Parcela calculada", "Enviado", "Recebido", "Saldo calculado", "Positivo calculado", "Esperado parcela", "Esperado saldo", "Esperado positivo"])
    for row, (scenario, pid, paid, share, sent, received, balance, positive) in enumerate(BALANCE_CASES, 2):
        sheet.append([scenario, pid, paid, "=SUM(" + ",".join(refs[scenario, pid]) + ")", sent, received, f"=C{row}-D{row}+E{row}-F{row}", f"=MAX(G{row},0)", share, balance, positive])
    for sheet in workbook:
        sheet.freeze_panes = "D2"
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for column in range(1, sheet.max_column + 1):
            sheet.column_dimensions[chr(64 + column)].width = 23
    workbook.save(path)


def zip_xml(path, name):
    with ZipFile(path) as archive:
        require(not any(part.lower().startswith(("basic/", "scripts/")) or "vba" in part.lower() for part in archive.namelist()), "Macros em workbook de QA")
        return ET.fromstring(archive.read(name))


def xlsx_cells(path, index):
    root = zip_xml(path, f"xl/worksheets/sheet{index}.xml")
    with ZipFile(path) as archive:
        shared = ET.fromstring(archive.read("xl/sharedStrings.xml")) if "xl/sharedStrings.xml" in archive.namelist() else None
    strings = ["".join(node.itertext()) for node in shared] if shared is not None else []
    cells = {}
    for cell in root.findall(".//x:c", XNS):
        value = cell.findtext("x:v", namespaces=XNS)
        if cell.get("t") == "s":
            value = strings[int(value)]
        elif cell.get("t") == "inlineStr":
            value = "".join(cell.find("x:is", XNS).itertext())
        cells[cell.get("r")] = (cell.findtext("x:f", namespaces=XNS), value)
    return cells


def verify_audit(source, consumed):
    checked = 0
    before, after = xlsx_cells(source, 1), xlsx_cells(consumed, 1)
    for row, inputs, formulas, expected in allocation_rows():
        for col, wanted in zip("ABCDE", inputs):
            if type(wanted) is int:
                require(Decimal(before[f"{col}{row}"][1]) == wanted == Decimal(after[f"{col}{row}"][1]), "Entrada literal numérica de parcela alterada")
            else:
                require(before[f"{col}{row}"][1] == wanted == after[f"{col}{row}"][1], "Entrada literal textual de parcela alterada")
        for col, formula, wanted in zip("FGHIJK", formulas, expected):
            require(before[f"{col}{row}"][0] == formula[1:], "Fórmula original de parcela divergente")
            actual_formula, cache = after[f"{col}{row}"]
            require(actual_formula is not None and cache is not None and Decimal(cache) == wanted, "Cache recalculado de parcela diverge de literal independente")
            checked += 1
        for col, wanted in zip("LMNOPQ", expected):
            require(Decimal(before[f"{col}{row}"][1]) == wanted == Decimal(after[f"{col}{row}"][1]), "Esperado literal de parcela alterado")
    before, after = xlsx_cells(source, 2), xlsx_cells(consumed, 2)
    refs = {}
    for allocation_row, inputs, _formulas, _expected in allocation_rows():
        refs.setdefault((inputs[0], inputs[2]), []).append(f"Parcelas!K{allocation_row}")
    for row, (scenario, pid, paid, share, sent, received, balance, positive) in enumerate(BALANCE_CASES, 2):
        for col, wanted in zip("ABCEF", (scenario, pid, paid, sent, received)):
            if type(wanted) is int:
                require(Decimal(before[f"{col}{row}"][1]) == wanted == Decimal(after[f"{col}{row}"][1]), "Entrada literal numérica de saldo alterada")
            else:
                require(before[f"{col}{row}"][1] == wanted == after[f"{col}{row}"][1], "Entrada literal textual de saldo alterada")
        formulas = ("SUM(" + ",".join(refs[scenario, pid]) + ")", f"C{row}-D{row}+E{row}-F{row}", f"MAX(G{row},0)")
        for col, wanted, expected_formula in zip("DGH", (share, balance, positive), formulas):
            require(before[f"{col}{row}"][0] == expected_formula, "Fórmula original de saldo divergente")
            formula, cache = after[f"{col}{row}"]
            require(formula is not None and cache is not None and Decimal(cache) == wanted, "Cache recalculado de saldo diverge de literal independente")
            checked += 1
        for col, wanted in zip("IJK", (share, balance, positive)):
            require(Decimal(before[f"{col}{row}"][1]) == wanted == Decimal(after[f"{col}{row}"][1]), "Esperado literal de saldo alterado")
    return {"scenarios": 5, "formulaCachesChecked": checked, "expectedValues": "independently authored integer literals", "formulaTolerance": "0", "scope": "small integer cases: demo, ASCII tie, combined versus split expenses, declared overpayment"}


def ods_text(node):
    parts = [node.text or ""]
    for child in node:
        if child.tag == f"{{{ODNS['text']}}}s":
            repeat = int(child.get(f"{{{ODNS['text']}}}c", "1"))
            require(1 <= repeat <= 10000, "Repetição textual ODS excessiva")
            parts.append(" " * repeat)
        elif child.tag == f"{{{ODNS['text']}}}tab":
            parts.append("\t")
        else:
            parts.append(ods_text(child))
        parts.append(child.tail or "")
    return "".join(parts)


def verify_csv_import(csv_path, ods_path):
    expected = csv_rows(csv_path.read_bytes())
    root = zip_xml(ods_path, "content.xml")
    for node in root.iter():
        require(f"{{{ODNS['table']}}}formula" not in node.attrib, "Fórmula inesperada na importação CSV estática")
        require("{http://www.w3.org/1999/xlink}href" not in node.attrib, "Relação externa na importação CSV")
    tables = root.findall("office:body/office:spreadsheet/table:table", ODNS)
    require(len(tables) == 1, "Aba CSV divergente")
    actual = {}
    row_index = 1
    for row in tables[0].iter(f"{{{ODNS['table']}}}table-row"):
        row_repeat = int(row.get(f"{{{ODNS['table']}}}number-rows-repeated", "1"))
        col_index = 1
        for cell in row:
            col_repeat = int(cell.get(f"{{{ODNS['table']}}}number-columns-repeated", "1"))
            kind = cell.get(f"{{{ODNS['office']}}}value-type")
            if kind:
                require(kind == "string", "Importação CSV deve preservar todas as colunas como texto")
                value = "\n".join(ods_text(p) for p in cell.findall("text:p", ODNS))
                require(row_repeat * col_repeat <= 10000 and len(actual) + row_repeat * col_repeat <= 10000, "Células CSV importadas demais")
                for rr in range(row_repeat):
                    for cc in range(col_repeat):
                        actual[row_index + rr, col_index + cc] = value
            col_index += col_repeat
        row_index += row_repeat
    wanted = {(r, c): value for r, row in enumerate(expected, 1) for c, value in enumerate(row, 1) if value != ""}
    require(actual == wanted, "LibreOffice alterou as células ou lexemas do CSV")
    return {"cellsCompared": len(wanted), "allCellsText": True, "equal": True, "formulasAbsent": True}


def check_artifacts(directory, provenance):
    check = check_downloads(directory / "downloads", provenance=provenance)
    imports = {name: verify_csv_import(directory / "downloads" / name, directory / f"{Path(name).stem}-import.ods") for name in HEADERS}
    audit = verify_audit(directory / "audit-source.xlsx", directory / "audit-libreoffice.xlsx")
    return {"independentDownloads": check, "csvImports": imports, "audit": audit}


def check_fixtures(directory):
    evidence = json.loads((directory / "evidence.json").read_text(encoding="utf-8"))
    require(evidence.get("kind") == "actual-libreoffice-execution" and evidence.get("status") == "ok", "Fixture não registra execução externa concluída")
    names = {f"downloads/{name}" for name in FILENAMES} | {f"{Path(name).stem}-import.ods" for name in HEADERS} | {"audit-source.xlsx", "audit-libreoffice.xlsx"}
    if evidence["provenance"] == "chrome-download":
        names.add("acquisition.json")
    require(set(evidence["files"]) == names, "Inventário externo divergente")
    for name in names:
        require(digest(directory / name) == evidence["files"][name], "Hash ou tamanho da evidência externa divergente")
    checked = check_artifacts(directory, evidence["provenance"])
    if evidence["provenance"] == "chrome-download":
        verify_acquisition(directory / "acquisition.json", directory / "downloads")
    require(checked == evidence["results"], "Resultados da fixture divergentes")
    return {"status": "ok", "mode": "stored-evidence-only", "newExternalExecution": False, "recordedLibreOfficeVersion": evidence["libreofficeVersion"], "provenance": evidence["provenance"], "results": checked}


def verify_acquisition(proof_path, downloads):
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    require(type(proof) is list and len(proof) == 6 and {row["file"] for row in proof} == FILENAMES, "Prova Chrome deve inventariar os seis downloads")
    for row in proof:
        require(set(row) == {"file", "download", "bytes", "sha256", "source"} and row["file"] == row["download"] and row["source"] == "Chrome UI Blob download", "Registro de aquisição Chrome divergente")
        require(digest(downloads / row["file"]) == {"sha256": row["sha256"], "size": row["bytes"]}, "Bytes Chrome divergem da prova de aquisição")
    return proof


def external_run(downloads, output, provenance, executable, unshare, acquisition_proof=None):
    check_downloads(downloads, provenance=provenance)
    if provenance == "chrome-download":
        require(acquisition_proof is not None, "Chrome exige --acquisition-proof com o inventário de download observado")
        proof = verify_acquisition(acquisition_proof, downloads)
    require(not output.exists(), "Diretório de evidência deve ser novo")
    output.mkdir(parents=True)
    shutil.copytree(downloads, output / "downloads")
    if provenance == "chrome-download":
        (output / "acquisition.json").write_text(json.dumps(proof, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    make_audit(output / "audit-source.xlsx")
    commands, options = [], {}
    with tempfile.TemporaryDirectory(prefix="rateio-libreoffice-") as temporary:
        temporary = Path(temporary)
        for subdir in ("home", "config", "cache", "data", "runtime", "profile"):
            (temporary / subdir).mkdir(mode=0o700)
        profile = temporary / "profile"
        (profile / "user").mkdir()
        (profile / "user/registrymodifications.xcu").write_text('''<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>''', encoding="utf-8")
        environment = {"PATH": "/usr/bin:/bin", "HOME": str(temporary / "home"), "XDG_CONFIG_HOME": str(temporary / "config"), "XDG_CACHE_HOME": str(temporary / "cache"), "XDG_DATA_HOME": str(temporary / "data"), "XDG_RUNTIME_DIR": str(temporary / "runtime"), "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "SAL_USE_VCLPLUGIN": "svp"}
        prefix = [str(unshare), "--user", "--map-root-user", "--net", "--", str(executable)]

        def portable(value):
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            value = (value or "").replace(temporary.as_uri(), "[TEMP_URI]").replace(str(temporary), "[TEMP]").replace(str(output), "[EVIDENCE]")
            return re.sub(r"(?:file://)?/(?:home|Users)/[^\s\"'<>]+", "[PRIVATE_PATH]", value)

        def failure(phase, return_code, stderr):
            # Redact before clipping: a long private path must not leak a prefix.
            short = " ".join(re.sub(r"[\x00-\x1f\x7f]", " ", portable(stderr)).split())
            short = short[:480] + ("…" if len(short) > 480 else "")
            return CheckError(f"Fase {phase}; returnCode={return_code}; stderr={short or '(vazio)'}")

        def run(argv, phase):
            try:
                process = subprocess.run(argv, env=environment, check=False, capture_output=True, text=True, errors="replace", timeout=60)
            except subprocess.TimeoutExpired as error:
                raise failure(phase, "timeout", error.stderr) from None
            except OSError as error:
                raise failure(phase, "not-started", str(error)) from None
            commands.append({"phase": phase, "argv": [portable(value) for value in argv], "returnCode": process.returncode, "stdout": portable(process.stdout), "stderr": portable(process.stderr)})
            if process.returncode != 0:
                raise failure(phase, process.returncode, process.stderr)
            return process

        version = run([*prefix, "--version"], "identificar-versao").stdout.strip()
        require("LibreOffice" in version, "Versão de consumidor não identificada")
        common = [*prefix, f"-env:UserInstallation={profile.as_uri()}", "--headless", "--invisible", "--norestore", "--nodefault", "--nolockcheck", "--nofirststartwizard"]
        for name, headers in HEADERS.items():
            # Explicit format 2 (Text) for every column, UTF-8, no trimming,
            # no formulas and no scientific/special-number detection.
            column_formats = "/".join(f"{col}/2" for col in range(1, len(headers) + 1))
            filter_options = f"44,34,76,1,{column_formats},1033,true,false,false,false,false,0,false,false,false"
            options[name] = filter_options
            destination = temporary / Path(name).stem
            destination.mkdir()
            run([*common, f"--infilter=Text - txt - csv (StarCalc):{filter_options}", "--convert-to", "ods", "--outdir", str(destination), str(output / "downloads" / name)], f"importar-{name}")
            produced = destination / f"{Path(name).stem}.ods"
            require(produced.is_file(), "LibreOffice não produziu importação CSV")
            shutil.copyfile(produced, output / f"{Path(name).stem}-import.ods")
        destination = temporary / "audit-converted"
        destination.mkdir()
        run([*common, "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(destination), str(output / "audit-source.xlsx")], "recalcular-auditoria")
        require((destination / "audit-source.xlsx").is_file(), "LibreOffice não recalculou auditoria")
        shutil.copyfile(destination / "audit-source.xlsx", output / "audit-libreoffice.xlsx")
    results = check_artifacts(output, provenance)
    file_names = [path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()]
    evidence = {"version": 1, "kind": "actual-libreoffice-execution", "status": "ok", "provenance": provenance, "libreofficeVersion": version, "commands": commands, "commandPathPlaceholders": {"[TEMP]": "unique temporary private directory, removed after execution", "[TEMP_URI]": "file URI of that temporary directory", "[EVIDENCE]": "this evidence directory"}, "csvImportOptions": options, "isolation": {"freshTemporaryProfile": True, "privateHomeAndXdg": True, "existingUserProfileRead": False, "macrosDisabledInTemporaryProfile": True, "osNetworkSandbox": "unshare --user --map-root-user --net", "globalKernelPolicyChanged": False}, "results": results, "files": {name: digest(output / name) for name in sorted(file_names)}, "scope": "Exact semantic all-text import of three canonical CSVs; separately authored formula audit with small integer literal expected results. CSV numeric lexemes are text, independently checked as integers by Python. No generic Excel/LibreOffice exact arithmetic or arbitrary workbook guarantee."}
    (output / "evidence.json").write_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    return {"status": "ok", "mode": "actual-external-execution", "newExternalExecution": True, "provenance": provenance, "libreofficeVersion": version, "results": results}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, nargs="?")
    parser.add_argument("--provenance", choices=("node-reference", "chrome-download"))
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--acquisition-proof", type=Path, help="required for chrome-download: observed download inventory with filenames, sizes and SHA-256")
    parser.add_argument("--libreoffice", type=Path, default=Path("/usr/bin/libreoffice"))
    parser.add_argument("--unshare", type=Path, default=Path("/usr/bin/unshare"))
    parser.add_argument("--check-fixtures", action="store_true")
    parser.add_argument("--fixtures-dir", type=Path, default=ROOT / "fixtures/interop/libreoffice-node")
    args = parser.parse_args(argv)
    try:
        if args.check_fixtures:
            require(not any((args.directory, args.provenance, args.output_dir, args.acquisition_proof)), "Modo fixture não aceita entrada ou saída externa")
            result = check_fixtures(args.fixtures_dir.resolve())
        else:
            require(all((args.directory, args.provenance, args.output_dir)), "Informe diretório, --provenance e --output-dir")
            result = external_run(args.directory.resolve(), args.output_dir.resolve(), args.provenance, args.libreoffice.resolve(), args.unshare.resolve(), args.acquisition_proof.resolve() if args.acquisition_proof else None)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    except (CheckError, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        print(f"Falha na prova de interoperabilidade: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
