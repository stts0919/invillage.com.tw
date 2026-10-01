#!/usr/bin/env python3
"""Build the OFL editorial font subsets with a pinned isolated toolchain.

Run with Python 3.12 + fonttools 4.66.0 + Brotli 1.2.0. Inputs are never edited.
The original /spaces pilot remains reproducible. --site-editorial creates separate
site-wide heading subsets without replacing that pilot's reviewed binaries.
Generated binaries live in git-ignored assets/optimized/ and public/assets/.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont


REPO = Path(__file__).resolve().parents[4]
SPIKE = Path(__file__).resolve().parents[1]
OPTIMIZED = REPO / "assets/optimized/font-pilot"
PUBLIC = SPIKE / "public/assets/fonts"
ASCII_PRINTABLE = "".join(chr(codepoint) for codepoint in range(32, 127))

SOURCES = {
    "editorial": {
        "source_url": "https://github.com/adobe-fonts/source-han-serif/blob/release/Variable/WOFF2/OTF/Subset/SourceHanSerifTW-VF.otf.woff2",
        "source_sha256": "698be31faf89a9848887c382181ffc484c403ce5a789fc56504e84d97aa9d3a4",
        "source_bytes": 7_234_064,
        "license_url": "https://github.com/adobe-fonts/source-han-serif/blob/release/LICENSE.txt",
        "license_sha256": "9ff5bb567e1b92c801fc1069e5fbf992ff8efccacb9db94e5959a5b3ba9bb903",
        "family": "Invillage Editorial Pilot",
        "filename": "invillage-editorial-pilot-700.woff2",
        "license_filename": "invillage-editorial-pilot-OFL.txt",
    },
    "stone": {
        "source_url": "owner-supplied-local-GenSekiGothic2-TC-B-v2.100",
        "source_sha256": "6deca2cbf28660f2fe77927c33173bd4e4d01bfdb85c8fbe42a6ebe1828b4e12",
        "source_bytes": 15_023_344,
        "license_url": "https://github.com/ButTaiwan/genseki-font/blob/master/SIL_Open_Font_License_1.1.txt",
        "license_sha256": "d84b652ca46586043946969a33c1dbf5a43028440825ae744a325965bec4c8fb",
        "family": "Invillage Stone Pilot",
        "filename": "invillage-stone-pilot-700.woff2",
        "license_filename": "invillage-stone-pilot-OFL.txt",
    },
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked_bytes(path: Path, expected_sha: str, expected_size: int | None = None) -> bytes:
    data = path.read_bytes()
    if expected_size is not None and len(data) != expected_size:
        raise ValueError(f"{path.name}: unexpected source size")
    if sha256(data) != expected_sha:
        raise ValueError(f"{path.name}: unexpected source SHA-256")
    return data


def write_if_absent_or_identical(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise FileExistsError(f"refusing to overwrite different output: {path}")
        return
    path.write_bytes(data)


def required_texts() -> dict[str, list[str]]:
    legacy = json.loads((SPIKE / "reference/legacy-slice.json").read_text())
    spaces = json.loads((SPIKE / "reference/spaces-content.json").read_text())
    groups = spaces["groups"]
    if [len(group["items"]) for group in groups] != [6, 10]:
        raise ValueError("expected 6 rooms and 10 shared spaces")

    editorial = [legacy["titles"]["spaces"]]
    editorial.extend(item["panelHeading"] for group in groups for item in group["items"])
    spaces_page = (SPIKE / "src/pages/spaces.astro").read_text()
    contact_headings = re.findall(
        r'<h2 class="section-heading" id="spaces-contact-heading">([^<]+)</h2>',
        spaces_page,
    )
    if len(contact_headings) != 1 or not contact_headings[0].strip():
        raise ValueError("expected one literal /spaces contact heading")
    editorial.append(contact_headings[0].strip())

    stone = ["客房空間", "公共空間"]
    for item in groups[0]["items"]:
        room_number = re.search(r"\b\d{3}\b", item["label"])
        stone.append(room_number.group() if room_number else item["label"])
    stone.extend(f"{index:02d}" for index in range(1, 11))
    return {"editorial": editorial, "stone": stone}


def site_editorial_texts() -> tuple[list[str], list[str]]:
    """Collect the frozen heading/lead copy actually assigned the serif face."""
    paths = [
        *sorted((SPIKE / "src/pages").glob("*.astro")),
        *(SPIKE / "reference" / name for name in (
            "home-content.json", "spaces-content.json", "legacy-slice.json"
        )),
    ]
    home = json.loads((SPIKE / "reference/home-content.json").read_text())
    spaces = json.loads((SPIKE / "reference/spaces-content.json").read_text())
    legacy = json.loads((SPIKE / "reference/legacy-slice.json").read_text())
    texts = [legacy["home"]["heading"], legacy["titles"]["spaces"], spaces["intro"]]
    texts.extend(group["heading"] for group in home["groups"])
    texts.extend(item["heading"] for group in home["groups"] for item in group["items"])
    texts.extend(item["panelHeading"] for group in spaces["groups"] for item in group["items"])
    for path in sorted((SPIKE / "src/pages").glob("*.astro")):
        source = path.read_text(encoding="utf-8")
        texts.extend(re.findall(r"const pageTitle\s*=\s*'([^']+)'", source))
        for heading in re.findall(r"<h[1-3]\b[^>]*>(.*?)</h[1-3]>", source, re.S):
            literal = re.sub(r"\{[^{}]*\}|<[^>]+>", "", heading).strip()
            if literal:
                texts.append(literal)
    return (texts, [str(path.relative_to(REPO)) for path in paths])


def names(font: TTFont, name_id: int) -> list[str]:
    return list(dict.fromkeys(record.toUnicode() for record in font["name"].names if record.nameID == name_id))


def rename_and_license(font: TTFont, family: str, license_text: str, weight: int = 700) -> None:
    original_copyright = names(font, 0)
    original_version = names(font, 5)
    license_header = license_text.split("\n\n", 1)[0].strip()
    copyright_text = "\n".join(dict.fromkeys([*original_copyright, license_header]))
    style = {600: "SemiBold", 700: "Bold"}[weight]
    postscript = family.replace(" ", "") + "-" + style
    replacement = {
        0: copyright_text,
        1: family,
        2: style,
        3: "INVL-PILOT;" + postscript,
        4: family + " " + style,
        5: "Version 1.0; subset from " + (original_version[0] if original_version else "OFL source"),
        6: postscript,
        13: license_text,
        14: "https://openfontlicense.org/ofl-faq/",
        16: family,
        17: style,
    }
    name_table = font["name"]
    name_table.names = [record for record in name_table.names if record.nameID not in replacement and record.nameID != 25]
    for name_id, value in replacement.items():
        name_table.setName(value, name_id, 3, 1, 0x409)
    font["OS/2"].usWeightClass = weight
    if weight == 700:
        font["OS/2"].fsSelection = (font["OS/2"].fsSelection | (1 << 5)) & ~(1 << 6)
        font["head"].macStyle |= 1
    else:
        font["OS/2"].fsSelection &= ~((1 << 5) | (1 << 6))
        font["head"].macStyle &= ~1


def build_font(kind: str, source: Path, license_path: Path, texts: list[str], *,
               weight: int = 700, family: str | None = None,
               filename: str | None = None, license_filename: str | None = None,
               record_texts: bool = True) -> dict[str, object]:
    spec = SOURCES[kind]
    family = family or spec["family"]
    filename = filename or spec["filename"]
    license_filename = license_filename or spec["license_filename"]
    source_data = checked_bytes(source, spec["source_sha256"], spec["source_bytes"])
    license_data = checked_bytes(license_path, spec["license_sha256"])
    license_text = license_data.decode("utf-8")
    characters = set("".join(texts) + ASCII_PRINTABLE)
    font = TTFont(source, recalcTimestamp=False)
    try:
        missing = sorted(character for character in characters if ord(character) not in font.getBestCmap())
        if missing:
            raise ValueError(f"{kind}: source missing characters: {missing}")
        font.flavor = None
        options = subset.Options()
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=sorted(ord(character) for character in characters))
        subsetter.subset(font)
        if kind == "editorial":
            font = instantiateVariableFont(font, {"wght": weight}, inplace=True, downgradeCFF2=True)
        if "fvar" in font:
            raise ValueError(f"{kind}: expected static {weight}-weight subset")
        rename_and_license(font, family, license_text, weight)
        font.flavor = "woff2"
        OPTIMIZED.mkdir(parents=True, exist_ok=True)
        output = OPTIMIZED / filename
        # A per-build staging file keeps a failed save from replacing a reviewed output.
        staged = OPTIMIZED / (filename + ".building")
        if staged.exists():
            raise FileExistsError(f"stale staged output requires review: {staged}")
        try:
            font.save(staged)
            built = staged.read_bytes()
            write_if_absent_or_identical(output, built)
        finally:
            staged.unlink(missing_ok=True)
    finally:
        font.close()

    for destination in (PUBLIC / filename, PUBLIC / license_filename, OPTIMIZED / license_filename):
        write_if_absent_or_identical(destination, built if destination.suffix == ".woff2" else license_data)
    if kind == "editorial":
        write_if_absent_or_identical(OPTIMIZED / source.name, source_data)

    result = TTFont(output)
    try:
        output_missing = sorted(character for character in characters if ord(character) not in result.getBestCmap())
        if output_missing or result.flavor != "woff2" or result["OS/2"].usWeightClass != weight:
            raise ValueError(f"{kind}: output format, weight or coverage invalid: {output_missing}")
        style = {600: "SemiBold", 700: "Bold"}[weight]
        if ("fvar" in result or names(result, 1) != [family]
                or names(result, 4) != [family + " " + style]
                or names(result, 6) != [family.replace(" ", "") + "-" + style]
                or names(result, 16) != [family]):
            raise ValueError(f"{kind}: modified font naming invalid")
        if names(result, 13) != [license_text] or not names(result, 0):
            raise ValueError(f"{kind}: full OFL or copyright missing")
    finally:
        result.close()

    return {
        "kind": kind,
        "family": family,
        "weight": weight,
        "sourceUrl": spec["source_url"],
        "sourceSha256": spec["source_sha256"],
        "sourceBytes": len(source_data),
        "licenseUrl": spec["license_url"],
        "licenseSha256": spec["license_sha256"],
        **({"texts": texts} if record_texts else {}),
        "characters": "".join(sorted(characters)),
        "characterCount": len(characters),
        "charactersSha256": sha256("".join(sorted(characters)).encode("utf-8")),
        "optimizedPath": str(output.relative_to(REPO)),
        "publicPath": str((PUBLIC / filename).relative_to(REPO)),
        "licensePublicPath": str((PUBLIC / license_filename).relative_to(REPO)),
        "outputBytes": len(built),
        "outputSha256": sha256(built),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=("editorial", "stone"))
    parser.add_argument("--site-editorial", action="store_true",
                        help="Build separate 600/700 subsets for editorial headings across all V1 routes")
    parser.add_argument("--adobe-source", type=Path, required=True)
    parser.add_argument("--adobe-license", type=Path, required=True)
    parser.add_argument("--stone-source", type=Path)
    parser.add_argument("--stone-license", type=Path)
    args = parser.parse_args()
    if importlib.metadata.version("fonttools") != "4.66.0" or importlib.metadata.version("Brotli") != "1.2.0":
        raise RuntimeError("fonttools 4.66.0 and Brotli 1.2.0 are required")
    if args.site_editorial and args.only:
        parser.error("--site-editorial cannot be combined with --only")
    if not args.site_editorial and args.only != "editorial" and (not args.stone_source or not args.stone_license):
        parser.error("the /spaces stone pilot requires --stone-source and --stone-license")
    texts = required_texts()
    inputs = {
        "editorial": (args.adobe_source, args.adobe_license),
        "stone": (args.stone_source, args.stone_license),
    }
    if args.site_editorial:
        site_texts, source_paths = site_editorial_texts()
        results = [build_font(
            "editorial", *inputs["editorial"], site_texts, weight=weight,
            family="Invillage Editorial",
            filename=f"invillage-editorial-site-{weight}.woff2",
            license_filename="invillage-editorial-site-OFL.txt",
            record_texts=False,
        ) for weight in (600, 700)]
        scope = "V1 editorial headings across all routes"
    else:
        kinds = (args.only,) if args.only else ("editorial", "stone")
        results = [build_font(kind, *inputs[kind], texts[kind]) for kind in kinds]
        source_paths = list(json.loads((SPIKE / "reference/font-pilot.json").read_text())["build"]["sourceTextFiles"])
        scope = "/spaces local pilot"
    print(json.dumps({"schemaVersion": 1, "scope": scope,
                      "toolVersions": {"fonttools": "4.66.0", "Brotli": "1.2.0"},
                      "sourceTextFiles": source_paths, "fonts": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
