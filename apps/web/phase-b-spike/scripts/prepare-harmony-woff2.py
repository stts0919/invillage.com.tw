#!/usr/bin/env python3
"""Create lossless WOFF2 copies of the full HarmonyOS body font files.

Run with the isolated fontTools 4.66.0 / Brotli 1.2.0 environment. The TTF
inputs are SHA-pinned, never rewritten, and every output is decoded and
compared at the glyph and table semantic level before anything is written.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import stat
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import brotli  # noqa: F401 - required by fontTools' WOFF2 codec
from fontTools.ttLib import TTFont


SOURCES = {
    "harmonyos-regular.ttf": {
        "weight": 400,
        "bytes": 4_119_636,
        "sha256": "b63084477c1b5cd0db3b88fdba581ae0f05c947445f47d03810f1189544cd5a0",
        "output": "harmonyos-regular.woff2",
    },
    "harmonyos-bold.ttf": {
        "weight": 700,
        "bytes": 4_064_528,
        "sha256": "6382485ee421f54d87d0cdbd63e7028b5b1a2988fbdc7a6a6d233158c511994e",
        "output": "harmonyos-bold.woff2",
    },
}
REQUIRED_TABLES = {"cmap", "glyf", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "GPOS", "GSUB"}
INTERNAL_TAGS = {"GlyphOrder"}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _absolute_path(raw: str | Path) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        raise ValueError("paths must be absolute")
    if ".." in path.parts:
        raise ValueError("parent traversal is not allowed")
    return path


def _reject_symlink_components(path: Path) -> None:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        try:
            mode = os.lstat(current).st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise ValueError("symlink path components are not allowed")


def _source_dir(raw: str | Path) -> Path:
    path = _absolute_path(raw)
    _reject_symlink_components(path)
    if not path.exists() or not path.is_dir():
        raise ValueError("source directory must exist and be a directory")
    return path


def _output_dir(raw: str | Path) -> Path:
    path = _absolute_path(raw)
    _reject_symlink_components(path)
    if path.exists() or path.is_symlink():
        raise FileExistsError("output directory already exists; refusing to overwrite")
    parent = path.parent
    if not parent.exists() or not parent.is_dir():
        raise ValueError("output parent must already exist and be a directory")
    return path


def _check_separation(source_dir: Path, output_dir: Path) -> None:
    if source_dir == output_dir or source_dir in output_dir.parents or output_dir in source_dir.parents:
        raise ValueError("source and output paths must not overlap")


def _read_source(path: Path, expected: dict[str, Any]) -> bytes:
    try:
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except OSError as exc:
        raise ValueError(f"cannot open source font safely: {path.name}") from None
    with os.fdopen(fd, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError(f"source is not a regular file: {path.name}")
        data = stream.read(expected["bytes"] + 1)
    if len(data) != expected["bytes"]:
        raise ValueError(f"unexpected source byte count: {path.name}")
    if _sha256(data) != expected["sha256"]:
        raise ValueError(f"unexpected source SHA-256: {path.name}")
    return data


def _load_font(data: bytes, label: str) -> TTFont:
    try:
        return TTFont(BytesIO(data), recalcTimestamp=False, lazy=False)
    except Exception as exc:
        raise ValueError(f"font decode failed for {label}: {type(exc).__name__}") from None


def _freeze(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if isinstance(value, dict):
        return tuple(sorted((str(key), _freeze(item)) for key, item in value.items()))
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if hasattr(value, "tolist"):
        return _freeze(value.tolist())
    raise ValueError("font contains an unsupported semantic field")


def _jsonable(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray, memoryview)):
        data = bytes(value)
        return {"byteLength": len(data), "sha256": _sha256(data)}
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def _digest_json(value: Any) -> str:
    encoded = json.dumps(_jsonable(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return _sha256(encoded)


def _name_signature(font: TTFont) -> tuple[Any, ...]:
    records = []
    for record in font["name"].names:
        records.append((
            int(record.platformID), int(record.platEncID), int(record.langID), int(record.nameID),
            bytes(record.string), record.toUnicode(),
        ))
    return tuple(records)


def _cmap_signature(font: TTFont) -> tuple[Any, ...]:
    subtables = []
    for table in font["cmap"].tables:
        mappings = tuple(sorted((int(codepoint), glyph_name) for codepoint, glyph_name in getattr(table, "cmap", {}).items()))
        variations = _freeze(getattr(table, "uvsDict", None))
        subtables.append((
            int(table.platformID), int(table.platEncID), _freeze(table.language), int(table.format),
            bool(table.isUnicode()), mappings, variations,
        ))
    return int(font["cmap"].tableVersion), tuple(subtables)


def _glyph_signature(glyph: Any) -> dict[str, Any]:
    program = getattr(glyph, "program", None)
    instructions = bytes(program.getBytecode()) if program is not None else b""
    bounds = tuple(getattr(glyph, key, None) for key in ("xMin", "yMin", "xMax", "yMax"))
    signature: dict[str, Any] = {
        "numberOfContours": int(glyph.numberOfContours),
        "bounds": bounds,
        "instructions": instructions,
    }
    if glyph.isComposite():
        fields = ("glyphName", "flags", "x", "y", "firstPt", "secondPt", "transform")
        signature["components"] = tuple(
            tuple((field, _freeze(getattr(component, field, None))) for field in fields)
            for component in glyph.components
        )
    else:
        signature["coordinates"] = tuple((int(x), int(y)) for x, y in getattr(glyph, "coordinates", ()))
        signature["endPoints"] = tuple(int(point) for point in getattr(glyph, "endPtsOfContours", ()))
        signature["flags"] = bytes(getattr(glyph, "flags", b""))
    return signature


def _glyph_proof(source: TTFont, output: TTFont) -> dict[str, Any]:
    source_order = source.getGlyphOrder()
    output_order = output.getGlyphOrder()
    if source_order != output_order:
        raise ValueError("glyph order or full glyph coverage changed")

    digest = hashlib.sha256()
    source_glyf = source["glyf"]
    output_glyf = output["glyf"]
    for index, glyph_name in enumerate(source_order):
        source_signature = _glyph_signature(source_glyf[glyph_name])
        output_signature = _glyph_signature(output_glyf[glyph_name])
        if source_signature != output_signature:
            raise ValueError(f"glyph semantics changed at glyph index {index}")
        encoded_name = glyph_name.encode("utf-8")
        encoded_signature = json.dumps(
            _jsonable(source_signature), sort_keys=True, separators=(",", ":"), ensure_ascii=False
        ).encode("utf-8")
        digest.update(len(encoded_name).to_bytes(4, "big"))
        digest.update(encoded_name)
        digest.update(len(encoded_signature).to_bytes(8, "big"))
        digest.update(encoded_signature)
    return {
        "equal": True,
        "glyphCount": len(source_order),
        "glyphOrderSha256": _digest_json(source_order),
        "glyphSemanticsSha256": digest.hexdigest(),
    }


def _metrics_signature(font: TTFont, tag: str) -> Any:
    if tag not in font:
        return None
    return tuple(sorted((glyph_name, tuple(metric)) for glyph_name, metric in font[tag].metrics.items()))


def _head_signature(font: TTFont) -> Any:
    values = dict(vars(font["head"]))
    values.pop("checkSumAdjustment", None)
    values["flags"] = int(values["flags"]) & ~(1 << 11)
    return _freeze(values)


def _name_fields(font: TTFont) -> dict[str, list[dict[str, Any]]]:
    fields: dict[str, list[dict[str, Any]]] = {}
    for name_id in (0, 1, 2, 4, 6, 13, 14):
        fields[str(name_id)] = [
            {
                "platformID": int(record.platformID),
                "encodingID": int(record.platEncID),
                "languageID": int(record.langID),
                "text": record.toUnicode(),
            }
            for record in font["name"].names
            if record.nameID == name_id
        ]
    return fields


def _verify_round_trip(source: TTFont, output: TTFont, expected_weight: int) -> dict[str, Any]:
    if output.flavor != "woff2":
        raise ValueError("round-trip output is not WOFF2")
    source_tags = set(source.keys()) - INTERNAL_TAGS
    output_tags = set(output.keys()) - INTERNAL_TAGS
    expected_output_tags = source_tags - ({"DSIG"} if "DSIG" in source_tags else set())
    if output_tags != expected_output_tags:
        raise ValueError("WOFF2 table set changed beyond the source DSIG signature table")
    missing_required = REQUIRED_TABLES - source_tags
    if missing_required:
        raise ValueError("source font lacks required tables: " + ", ".join(sorted(missing_required)))

    glyphs = _glyph_proof(source, output)
    cmap_equal = _cmap_signature(source) == _cmap_signature(output)
    if not cmap_equal:
        raise ValueError("cmap semantics changed")
    names_equal = _name_signature(source) == _name_signature(output)
    if not names_equal:
        raise ValueError("name/copyright/license records changed")
    head_equal = _head_signature(source) == _head_signature(output)
    if not head_equal:
        raise ValueError("head table semantics changed")
    if not (int(output["head"].flags) & (1 << 11)):
        raise ValueError("WOFF2 lossless flag bit 11 is not set")

    metrics = {}
    for tag in ("hmtx", "vmtx"):
        equal = _metrics_signature(source, tag) == _metrics_signature(output, tag)
        if not equal:
            raise ValueError(f"{tag} metrics changed")
        metrics[tag] = {"present": tag in source, "equal": equal, "recordCount": len(source[tag].metrics) if tag in source else 0}

    source_weight = int(source["OS/2"].usWeightClass)
    output_weight = int(output["OS/2"].usWeightClass)
    if source_weight != expected_weight or output_weight != source_weight:
        raise ValueError("font weight changed")

    equal_tables = []
    for tag in sorted(source_tags & output_tags):
        if tag in {"head", "glyf", "loca"}:
            continue
        if source.getTableData(tag) != output.getTableData(tag):
            raise ValueError(f"font table changed: {tag}")
        equal_tables.append(tag)
    for tag in ("GSUB", "GPOS"):
        if source.getTableData(tag) != output.getTableData(tag):
            raise ValueError(f"{tag} shaping table changed")

    return {
        "glyphs": glyphs,
        "cmap": {"equal": True, "subtableCount": len(source["cmap"].tables), "sha256": _digest_json(_cmap_signature(source))},
        "nameRecords": {"equal": True, "recordCount": len(source["name"].names), "sha256": _digest_json(_name_signature(source))},
        "weight": {"equal": True, "usWeightClass": source_weight},
        "metrics": metrics,
        "GSUB": {"equal": True, "sha256": _sha256(source.getTableData("GSUB"))},
        "GPOS": {"equal": True, "sha256": _sha256(source.getTableData("GPOS"))},
        "head": {
            "equal": True,
            "sha256": _digest_json(_head_signature(source)),
            "checkSumAdjustmentExcluded": True,
            "woff2LosslessBit11Set": True,
            "sourceFlags": int(source["head"].flags),
            "outputFlags": int(output["head"].flags),
        },
        "unchangedTableBytes": equal_tables,
        "sourceTableTags": sorted(source_tags),
        "outputTableTags": sorted(output_tags),
        "sourceDSIGPresent": "DSIG" in source_tags,
        "outputDSIGPresent": "DSIG" in output_tags,
    }


def _expect_rejection(name: str, operation: Callable[[], Any]) -> dict[str, str]:
    try:
        operation()
    except (FileExistsError, ValueError, OSError) as exc:
        return {"case": name, "result": "passed", "rejectedBy": type(exc).__name__}
    raise ValueError(f"negative safety case was not rejected: {name}")


def _negative_safety_cases(source_dir: Path, output_parent: Path) -> list[dict[str, str]]:
    results = []
    with tempfile.TemporaryDirectory(prefix=".harmony-woff2-check-", dir=output_parent) as temp_name:
        temp_dir = Path(temp_name)
        existing_dir = temp_dir / "existing-output"
        existing_dir.mkdir()
        results.append(_expect_rejection("existing output directory", lambda: _output_dir(existing_dir)))

        traversal = temp_dir / ".." / "traversal-output"
        results.append(_expect_rejection("parent path traversal", lambda: _output_dir(traversal)))

        source_link = temp_dir / "source-symlink"
        source_link.symlink_to(source_dir, target_is_directory=True)
        results.append(_expect_rejection("symlink source directory", lambda: _source_dir(source_link)))
    return results


def _write_exclusive(path: Path, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(path, flags, 0o644)
    except OSError as exc:
        raise FileExistsError(f"refusing to overwrite output: {path.name}") from None
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)


def _build_font(source_dir: Path, source_name: str, spec: dict[str, Any]) -> tuple[bytes, dict[str, Any], dict[str, Any]]:
    source_path = source_dir / source_name
    source_data = _read_source(source_path, spec)
    source_font = _load_font(source_data, source_name)
    output_font: TTFont | None = None
    try:
        missing = REQUIRED_TABLES - (set(source_font.keys()) - INTERNAL_TAGS)
        if missing:
            raise ValueError("source font lacks required tables: " + ", ".join(sorted(missing)))
        if int(source_font["OS/2"].usWeightClass) != spec["weight"]:
            raise ValueError(f"unexpected source weight: {source_name}")

        source_font.flavor = "woff2"
        buffer = BytesIO()
        try:
            source_font.save(buffer)
        except Exception as exc:
            raise ValueError(f"WOFF2 encoding failed for {source_name}: {type(exc).__name__}") from None
        output_data = buffer.getvalue()
        if output_data[:4] != b"wOF2":
            raise ValueError(f"WOFF2 signature missing for {source_name}")

        output_font = _load_font(output_data, spec["output"])
        proof = _verify_round_trip(source_font, output_font, spec["weight"])
        record = {
            "source": source_name,
            "sourceBytes": len(source_data),
            "sourceSha256": _sha256(source_data),
            "output": spec["output"],
            "outputBytes": len(output_data),
            "outputSha256": _sha256(output_data),
            "sizeRatio": round(len(output_data) / len(source_data), 6),
            "sizeReductionPercent": round((1 - len(output_data) / len(source_data)) * 100, 2),
            "weight": spec["weight"],
            "glyphCount": len(source_font.getGlyphOrder()),
            "nameFields": _name_fields(source_font),
            "roundTripProof": proof,
        }
        return output_data, record, proof
    finally:
        source_font.close()
        if output_font is not None:
            output_font.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", required=True, help="absolute directory containing the two pinned source TTFs")
    parser.add_argument("--out", required=True, help="absolute path for a new output directory")
    args = parser.parse_args()

    try:
        if sys.version_info[:2] != (3, 12):
            raise RuntimeError("Python 3.12 is required")
        if importlib.metadata.version("fonttools") != "4.66.0" or importlib.metadata.version("Brotli") != "1.2.0":
            raise RuntimeError("fontTools 4.66.0 and Brotli 1.2.0 are required")

        source_dir = _source_dir(args.source_dir)
        output_dir = _output_dir(args.out)
        _check_separation(source_dir, output_dir)
        if output_dir.parent != output_dir.parent.resolve(strict=True):
            raise ValueError("output parent must be canonical and symlink-free")

        output_files: list[tuple[str, bytes]] = []
        font_records = []
        font_proofs = []
        for source_name, spec in SOURCES.items():
            data, record, proof = _build_font(source_dir, source_name, spec)
            output_files.append((spec["output"], data))
            font_records.append(record)
            font_proofs.append({"font": spec["output"], "result": "passed", "checks": proof})

        negative_cases = _negative_safety_cases(source_dir, output_dir.parent)
        manifest = {
            "schemaVersion": 1,
            "purpose": "full HarmonyOS body font WOFF2 supply",
            "transformation": {"subset": False, "familyRenamed": False, "sourceFilesModified": False},
            "toolchain": {
                "python": platform.python_version(),
                "fontTools": importlib.metadata.version("fonttools"),
                "Brotli": importlib.metadata.version("Brotli"),
            },
            "fonts": font_records,
            "signatureTable": {
                "sourceDSIGPresent": all(item["roundTripProof"]["sourceDSIGPresent"] for item in font_records),
                "outputDSIGPresent": all(item["roundTripProof"]["outputDSIGPresent"] for item in font_records),
                "note": "The WOFF2 encoder omits the source DSIG table; the original TTFs remain unchanged.",
            },
        }
        test_results = {
            "schemaVersion": 1,
            "result": "passed",
            "positiveCases": font_proofs,
            "negativeCases": negative_cases,
        }
        manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        tests_bytes = (json.dumps(test_results, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

        output_dir.mkdir(mode=0o755)
        for filename, data in output_files:
            _write_exclusive(output_dir / filename, data)
        _write_exclusive(output_dir / "manifest.json", manifest_bytes)
        _write_exclusive(output_dir / "test-results.json", tests_bytes)
        print(json.dumps({
            "outputDirectory": str(output_dir),
            "toolchain": manifest["toolchain"],
            "fonts": [{key: font[key] for key in ("source", "output", "sourceBytes", "outputBytes", "sizeReductionPercent", "outputSha256")} for font in font_records],
            "negativeCases": negative_cases,
        }, ensure_ascii=False, indent=2))
    except Exception as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
