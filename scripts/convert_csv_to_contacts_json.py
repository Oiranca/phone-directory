#!/usr/bin/env python3
"""Convert a validated normalized CSV into the MVP contacts.json dataset."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


CATALOGS = {
    "recordTypes": [
        "person",
        "service",
        "department",
        "control",
        "supervision",
        "room",
        "external-center",
        "other",
    ],
    "areas": [
        "sanitaria-asistencial",
        "gestion-administracion",
        "especialidades",
        "otros",
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path, help="Path to the validated normalized CSV")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("tmp/json/contacts.json"),
        help="Output path for contacts.json",
    )
    parser.add_argument(
        "--editor-name",
        default="Migration Import",
        help="Value used for createdBy and updatedBy",
    )
    parser.add_argument(
        "--version",
        default="1.0.0",
        help="Dataset version",
    )
    return parser.parse_args()


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def split_multi(value: str) -> list[str]:
    parts = [item.strip() for item in (value or "").split("|")]
    seen: set[str] = set()
    result: list[str] = []
    for part in parts:
        key = part.casefold()
        if part and key not in seen:
            seen.add(key)
            result.append(part)
    return result


def maybe(value: str) -> str | None:
    value = (value or "").strip()
    return value or None


def compact_object(value: dict[str, object]) -> dict[str, object]:
    return {key: item for key, item in value.items() if item is not None and item != ""}


def build_person(row: dict[str, str]) -> dict[str, str | None] | None:
    first_name = maybe(row.get("firstName", ""))
    last_name = maybe(row.get("lastName", ""))
    if not first_name and not last_name:
        return None
    return compact_object({
        "firstName": first_name,
        "lastName": last_name,
    })


def normalize_area(value: str) -> str | None:
    area = maybe(value)
    if area in CATALOGS["areas"]:
        return area
    return None


def build_organization(row: dict[str, str]) -> dict[str, str | None]:
    return compact_object({
        "department": maybe(row.get("department", "")),
        "service": maybe(row.get("service", "")),
        "area": normalize_area(row.get("area", "")),
        "specialty": maybe(row.get("specialty", "")),
    })


def build_location(row: dict[str, str]) -> dict[str, str | None] | None:
    location = compact_object({
        "building": maybe(row.get("building", "")),
        "floor": maybe(row.get("floor", "")),
        "room": maybe(row.get("room", "")),
        "text": maybe(row.get("locationText", "")),
    })
    if location:
        return location
    return None


def build_phone(row: dict[str, str], prefix: str, record_idx: int, ordinal: int) -> dict[str, object] | None:
    number = maybe(row.get(f"{prefix}Number", ""))
    if not number:
        return None
    return compact_object({
        "id": f"ph_{record_idx:04d}_{ordinal}",
        "label": maybe(row.get(f"{prefix}Label", "")),
        "number": number,
        "extension": maybe(row.get(f"{prefix}Extension", "")),
        "kind": maybe(row.get(f"{prefix}Kind", "")) or "other",
        "isPrimary": row.get(f"{prefix}IsPrimary", "") == "true",
        "confidential": row.get(f"{prefix}Confidential", "") == "true",
        "noPatientSharing": row.get(f"{prefix}NoPatientSharing", "") == "true",
        "notes": maybe(row.get(f"{prefix}Notes", "")),
    })


def build_email(row: dict[str, str], prefix: str, record_idx: int, ordinal: int) -> dict[str, object] | None:
    address = maybe(row.get(prefix, ""))
    if not address:
        return None
    label_key = f"{prefix}Label"
    primary_key = f"{prefix}IsPrimary"
    return compact_object({
        "id": f"em_{record_idx:04d}_{ordinal}",
        "address": address,
        "label": maybe(row.get(label_key, "")),
        "isPrimary": row.get(primary_key, "") == "true",
    })


def derive_source_info(external_id: str | None) -> dict[str, object] | None:
    if not external_id:
        return None
    if "-" not in external_id:
        return {"externalId": external_id}
    sheet_slug, _, row_ref = external_id.rpartition("-")
    source = {
        "externalId": external_id,
        "sheetSlug": sheet_slug or None,
        "sheetRow": row_ref or None,
    }
    return compact_object(source)


def convert_row(row: dict[str, str], record_idx: int, editor_name: str, timestamp: str) -> dict[str, object]:
    phones = [
        phone
        for phone in [
            build_phone(row, "phone1", record_idx, 1),
            build_phone(row, "phone2", record_idx, 2),
        ]
        if phone is not None
    ]
    emails = [
        email
        for email in [
            build_email(row, "email1", record_idx, 1),
            build_email(row, "email2", record_idx, 2),
        ]
        if email is not None
    ]

    record = {
        "id": f"cnt_{record_idx:04d}",
        "externalId": maybe(row.get("externalId", "")),
        "type": row.get("type", "").strip(),
        "displayName": row.get("displayName", "").strip(),
        "person": build_person(row),
        "organization": build_organization(row),
        "location": build_location(row),
        "contactMethods": {
            "phones": phones,
            "emails": emails,
        },
        "aliases": split_multi(row.get("aliases", "")),
        "tags": split_multi(row.get("tags", "")),
        "notes": maybe(row.get("notes", "")),
        "status": row.get("status", "").strip() or "active",
        "source": derive_source_info(maybe(row.get("externalId", ""))),
        "audit": {
            "createdAt": timestamp,
            "updatedAt": timestamp,
            "createdBy": editor_name,
            "updatedBy": editor_name,
        },
    }
    return compact_object(record)


def build_dataset(rows: list[dict[str, str]], version: str, editor_name: str) -> dict[str, object]:
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    records = [
        convert_row(row, index, editor_name, timestamp)
        for index, row in enumerate(rows, start=1)
    ]
    type_counts = Counter(record["type"] for record in records)
    area_counts = Counter(record["organization"]["area"] for record in records if "organization" in record and "area" in record["organization"])
    return {
        "version": version,
        "exportedAt": timestamp,
        "metadata": {
            "recordCount": len(records),
            "generatedFrom": "normalized-csv",
            "generatedBy": "scripts/convert_csv_to_contacts_json.py",
            "editorName": editor_name,
            "typeCounts": dict(type_counts),
            "areaCounts": dict(area_counts),
        },
        "catalogs": CATALOGS,
        "records": records,
    }


def main() -> int:
    args = parse_args()
    rows = read_rows(args.csv_path)
    dataset = build_dataset(rows, args.version, args.editor_name)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Converted {len(rows)} rows -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
