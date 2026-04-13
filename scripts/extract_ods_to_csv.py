#!/usr/bin/env python3
"""Extract selected sheets from an ODS workbook into CSV working files.

This utility is intended as a migration aid for the hospital directory MVP.
It reads the ODS directly without external dependencies and exports one CSV
file per selected sheet.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET


NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
}

DEFAULT_MVP_SHEETS = [
    "Admisión_Central",
    "Urgencias",
    "Rayos",
    "Secretarías",
    "Hospitales_de_día",
    "UMI",
    "Centros_de_salud",
]

INDEX_MARKERS = {
    "INDICEAGENDA",
    "INDICEAGENDAHOSPITALARIA",
}


@dataclass
class SheetData:
    name: str
    rows: list[list[str]]


def normalize_text(value: str) -> str:
    return " ".join(value.split())


def normalized_ascii(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "sheet"


def parse_ods(path: Path) -> list[SheetData]:
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read("content.xml"))

    spreadsheet = root.find("office:body", NS)
    if spreadsheet is None:
        raise ValueError("ODS body not found")
    spreadsheet = spreadsheet.find("office:spreadsheet", NS)
    if spreadsheet is None:
        raise ValueError("ODS spreadsheet not found")

    sheets: list[SheetData] = []
    for table in spreadsheet.findall("table:table", NS):
        name = table.attrib.get(f"{{{NS['table']}}}name", "Unnamed")
        rows: list[list[str]] = []
        for row in table.findall("table:table-row", NS):
            repeat_rows = int(row.attrib.get(f"{{{NS['table']}}}number-rows-repeated", "1"))
            parsed_row = parse_row(row)
            for _ in range(repeat_rows):
                rows.append(parsed_row.copy())
        sheets.append(SheetData(name=name, rows=rows))
    return sheets


def parse_row(row: ET.Element) -> list[str]:
    values: list[str] = []
    for cell in row.findall("table:table-cell", NS):
        repeat_cols = int(cell.attrib.get(f"{{{NS['table']}}}number-columns-repeated", "1"))
        text = normalize_text("".join(cell.itertext()))
        values.extend([text] * repeat_cols)
    while values and values[-1] == "":
        values.pop()
    return values


def remove_empty_rows(rows: Iterable[list[str]]) -> list[list[str]]:
    return [row for row in rows if any(cell.strip() for cell in row)]


def remove_index_rows(rows: Iterable[list[str]]) -> list[list[str]]:
    cleaned: list[list[str]] = []
    for row in rows:
        normalized_cells = {normalize_index_marker(cell) for cell in row if cell.strip()}
        if normalized_cells and normalized_cells.issubset(INDEX_MARKERS):
            continue
        cleaned.append(row)
    return cleaned


def normalize_index_marker(value: str) -> str:
    value = value.replace(" ", "")
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.upper()
    return value


def trim_columns(rows: list[list[str]]) -> list[list[str]]:
    max_len = max((len(row) for row in rows), default=0)
    if max_len == 0:
        return rows

    keep_indices: list[int] = []
    for idx in range(max_len):
        if any(idx < len(row) and row[idx].strip() for row in rows):
            keep_indices.append(idx)

    trimmed: list[list[str]] = []
    for row in rows:
        trimmed.append([row[idx] if idx < len(row) else "" for idx in keep_indices])
    return trimmed


def write_csv(path: Path, rows: list[list[str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    max_len = max((len(row) for row in rows), default=0)
    headers = [f"col_{idx + 1}" for idx in range(max_len)]

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        for row in rows:
            padded = row + [""] * (max_len - len(row))
            writer.writerow(padded)


def find_selected_sheets(all_sheets: list[SheetData], names: list[str]) -> list[SheetData]:
    by_name = {sheet.name: sheet for sheet in all_sheets}
    missing = [name for name in names if name not in by_name]
    if missing:
        available = ", ".join(sheet.name for sheet in all_sheets)
        raise ValueError(f"Unknown sheets: {', '.join(missing)}. Available: {available}")
    return [by_name[name] for name in names]


def list_sheets(sheets: list[SheetData]) -> None:
    for sheet in sheets:
        non_empty = len(remove_empty_rows(sheet.rows))
        print(f"{sheet.name}\trows={len(sheet.rows)}\tnon_empty={non_empty}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ods_path", type=Path, help="Path to the .ods file")
    parser.add_argument(
        "--list",
        action="store_true",
        help="List workbook sheets and exit",
    )
    parser.add_argument(
        "--sheet",
        action="append",
        default=[],
        help="Sheet name to export. Can be used multiple times.",
    )
    parser.add_argument(
        "--group",
        choices=["first-mvp"],
        help="Export a predefined sheet group",
    )
    parser.add_argument(
        "--outdir",
        type=Path,
        default=Path("tmp/ods-export"),
        help="Output directory for CSV files",
    )
    parser.add_argument(
        "--keep-empty",
        action="store_true",
        help="Keep empty rows in the exported CSVs",
    )
    parser.add_argument(
        "--keep-index-rows",
        action="store_true",
        help="Keep visual index rows such as 'ÍNDICE AGENDA'",
    )
    return parser.parse_args()


def resolve_sheet_names(args: argparse.Namespace) -> list[str]:
    selected = list(args.sheet)
    if args.group == "first-mvp":
        for name in DEFAULT_MVP_SHEETS:
            if name not in selected:
                selected.append(name)
    return selected


def main() -> int:
    args = parse_args()

    if not args.ods_path.exists():
        print(f"File not found: {args.ods_path}", file=sys.stderr)
        return 1

    sheets = parse_ods(args.ods_path)

    if args.list:
        list_sheets(sheets)
        return 0

    selected_names = resolve_sheet_names(args)
    if not selected_names:
        print("No sheets selected. Use --list, --sheet, or --group.", file=sys.stderr)
        return 1

    selected_sheets = find_selected_sheets(sheets, selected_names)
    for sheet in selected_sheets:
        rows = sheet.rows
        if not args.keep_empty:
            rows = remove_empty_rows(rows)
        if not args.keep_index_rows:
            rows = remove_index_rows(rows)
        rows = trim_columns(rows)

        filename = f"{normalized_ascii(sheet.name)}.csv"
        output_path = args.outdir / filename
        write_csv(output_path, rows)
        print(f"Exported {sheet.name} -> {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
