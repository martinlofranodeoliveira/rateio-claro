#!/usr/bin/env python3
"""Create four deterministic release assets from a clean, committed Git tree."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_PARTS = {".git", "local", "dist", "release", "node_modules", "__pycache__", ".venv-interop", ".impeccable", ".openai"}
SOURCE_ZIP = "rateio-claro-source.zip"
STATIC_ZIP = "rateio-claro-static.zip"
DEMO_JSON = "rateio-demo-project.json"


class ReleaseError(ValueError):
    pass


def run(args, root=ROOT):
    result = subprocess.run(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode:
        raise ReleaseError("Um comando de validação falhou; consulte os testes antes de empacotar.")
    return result.stdout


def safe_name(name):
    path = PurePosixPath(name)
    if (not name or "\\" in name or path.is_absolute() or str(path) != name
            or any(part in FORBIDDEN_PARTS or part in (".", "..") or part.startswith(".env") for part in path.parts)
            or name.endswith((".pyc", ".pyo"))):
        raise ReleaseError("A árvore contém um caminho que não pode integrar a fonte pública.")
    return name


def clean_commit(root=ROOT):
    try:
        try:
            top = Path(run(["git", "rev-parse", "--show-toplevel"], root).decode().strip()).resolve()
        except ReleaseError as error:
            raise ReleaseError("A release exige um repositório Git próprio, limpo e commitado na raiz do projeto.") from error
        if top != root.resolve():
            raise ReleaseError("A release exige um repositório Git próprio na raiz do projeto.")
        if run(["git", "status", "--porcelain=v1", "--untracked-files=all"], root):
            raise ReleaseError("A release exige a árvore Git limpa, com todas as fontes commitadas.")
        commit = run(["git", "rev-parse", "--verify", "HEAD"], root).decode().strip()
        if len(commit) != 40 or any(c not in "0123456789abcdef" for c in commit):
            raise ReleaseError("O commit de origem não é válido.")
        return commit
    except (OSError, UnicodeError) as error:
        raise ReleaseError("Git não está disponível para verificar a origem da release.") from error


def tracked_source(root=ROOT):
    files = {}
    tree = run(["git", "ls-tree", "-r", "-z", "--full-tree", "HEAD"], root)
    for entry in tree.split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        mode, kind, object_id = metadata.split(b" ")
        if kind != b"blob" or mode not in (b"100644", b"100755"):
            raise ReleaseError("A fonte pública não pode conter submódulos ou links simbólicos.")
        name = safe_name(raw_name.decode("utf-8", errors="strict"))
        files[name] = (run(["git", "cat-file", "blob", object_id.decode("ascii")], root),
                       0o755 if mode == b"100755" else 0o644)
    if not files or "LICENSE" not in files or "package.json" not in files:
        raise ReleaseError("A árvore commitada precisa conter o projeto e sua licença.")
    return files


def write_zip(target, files, prefix):
    """Stored entries avoid timestamps, host paths and compressor-version variance."""
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        for name in sorted(files):
            safe_name(name)
            data, mode = files[name]
            info = zipfile.ZipInfo(f"{prefix}/{name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | mode) << 16
            info.compress_type = zipfile.ZIP_STORED
            archive.writestr(info, data)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise ReleaseError("A conferência CRC do ZIP falhou.")


def static_files(root=ROOT):
    manifest = json.loads((root / "dist/build-manifest.json").read_text("utf-8"))
    names = sorted([*manifest["files"], "build-manifest.json"])
    files = {}
    for name in names:
        safe_name(name)
        target = root / "dist" / name
        if target.is_symlink() or target.resolve() != target or not target.is_file():
            raise ReleaseError("A distribuição precisa conter apenas arquivos regulares locais.")
        files[name] = (target.read_bytes(), 0o644)
    return files


def package_release(output):
    commit = clean_commit()
    # Build e conferência pertencem ao commit cuja árvore será arquivada.
    for command in (["npm", "test"], ["npm", "run", "build"], ["npm", "run", "check"]):
        run(command)
    if clean_commit() != commit:
        raise ReleaseError("A árvore Git mudou durante a validação.")
    source = tracked_source()
    public = static_files()
    demo = run(["node", "--input-type=module", "-e",
                "import {demoProject} from './src/demo.mjs'; import {serializeProject} from './src/io.mjs'; process.stdout.write(serializeProject(demoProject()));"])
    output = output.resolve()
    if (ROOT / "release").is_symlink():
        raise ReleaseError("A pasta release não pode ser um link simbólico.")
    release_root = (ROOT / "release").resolve()
    if output != release_root and release_root not in output.parents:
        raise ReleaseError("Use um diretório de saída dentro de release/.")
    if output.exists() and (output.is_symlink() or not output.is_dir() or any(output.iterdir())):
        raise ReleaseError("A pasta de saída deve estar ausente ou vazia.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".rateio-release-", dir=output.parent) as temporary:
        staging = Path(temporary)
        write_zip(staging / SOURCE_ZIP, source, "rateio-claro-source")
        write_zip(staging / STATIC_ZIP, public, "rateio-claro-static")
        (staging / DEMO_JSON).write_bytes(demo)
        assets = []
        for name in sorted((SOURCE_ZIP, STATIC_ZIP, DEMO_JSON)):
            data = (staging / name).read_bytes()
            assets.append({"name": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        sums = "".join(f"{asset['sha256']}  {asset['name']}\n" for asset in assets)
        (staging / "SHA256SUMS").write_text(sums, encoding="ascii", newline="\n")
        output.mkdir(parents=True, exist_ok=True)
        for name in (SOURCE_ZIP, STATIC_ZIP, DEMO_JSON, "SHA256SUMS"):
            os.replace(staging / name, output / name)
    return {"commit": commit, "sourceFiles": len(source), "staticFiles": len(public), "assets": assets,
            "checksumFile": "SHA256SUMS", "zipCompression": "stored", "zipTimestamp": "1980-01-01T00:00:00"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "release")
    args = parser.parse_args()
    try:
        result = package_release(args.output_dir)
    except (ReleaseError, OSError, UnicodeError, ValueError, KeyError) as error:
        print(f"Release recusada: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
