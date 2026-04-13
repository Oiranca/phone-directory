#!/usr/bin/env python3
"""Validate a normalized hospital directory CSV against the MVP contract."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


REQUIRED_HEADERS = {
    "type",
    "displayName",
}

ALLOWED_TYPES = {
    "person",
    "service",
    "department",
    "control",
    "supervision",
    "room",
    "external-center",
    "other",
}

ALLOWED_AREAS = {
    "sanitaria-asistencial",
    "gestion-administracion",
    "especialidades",
    "otros",
}

ALLOWED_PHONE_KINDS = {
    "internal",
    "external",
    "mobile",
    "fax",
    "other",
    "",
}

ALLOWED_STATUS = {
    "active",
    "inactive",
}

BOOLEAN_FIELDS = {
    "phone1IsPrimary",
    "phone1Confidential",
    "phone1NoPatientSharing",
    "phone2IsPrimary",
    "phone2Confidential",
    "phone2NoPatientSharing",
    "email1IsPrimary",
    "email2IsPrimary",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "csv_path",
        type=Path,
        help="Path to the normalized CSV file",
    )
    parser.add_argument(
        "--report",
        type=Path,
        help="Optional JSON report output path",
    )
    return parser.parse_args()


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError("CSV has no header row")
        return reader.fieldnames, list(reader)


def is_truthy_bool(value: str) -> bool:
    return value == "true"


def has_contact_or_location(row: dict[str, str]) -> bool:
    return any(
        row.get(key, "").strip()
        for key in [
            "phone1Number",
            "phone2Number",
            "email1",
            "email2",
            "building",
            "floor",
            "room",
            "locationText",
        ]
    )


def looks_like_placeholder_or_noise(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    markers = [
        "ÍNDICE",
        "INDICE",
        "NUMERO",
        "NÚMERO",
    ]
    return any(marker in text.upper() for marker in markers)


def split_multi(value: str) -> list[str]:
    return [item.strip() for item in value.split("|") if item.strip()]


def validate_rows(rows: list[dict[str, str]]) -> dict[str, object]:
    errors: list[dict[str, object]] = []
    warnings: list[dict[str, object]] = []
    counters = Counter()
    by_external_id: defaultdict[str, list[int]] = defaultdict(list)

    for row_index, row in enumerate(rows, start=2):
        external_id = row.get("externalId", "").strip()
        display_name = row.get("displayName", "").strip()
        row_type = row.get("type", "").strip()
        area = row.get("area", "").strip()
        status = row.get("status", "").strip()

        if external_id:
            by_external_id[external_id].append(row_index)

        if not display_name:
            errors.append(issue(row_index, "missing_displayName", "displayName is required"))
        if not row_type:
            errors.append(issue(row_index, "missing_type", "type is required"))
        elif row_type not in ALLOWED_TYPES:
            errors.append(issue(row_index, "invalid_type", f"unknown type: {row_type}"))

        if not has_contact_or_location(row):
            errors.append(issue(row_index, "missing_contact_or_location", "row must have phone, email, or location"))

        if area and area not in ALLOWED_AREAS:
            errors.append(issue(row_index, "invalid_area", f"unknown area: {area}"))

        if status and status not in ALLOWED_STATUS:
            errors.append(issue(row_index, "invalid_status", f"invalid status: {status}"))

        for field in BOOLEAN_FIELDS:
            value = row.get(field, "").strip()
            if value and value not in {"true", "false"}:
                errors.append(issue(row_index, "invalid_boolean", f"{field} must be true or false"))

        for field in ["phone1Kind", "phone2Kind"]:
            value = row.get(field, "").strip()
            if value not in ALLOWED_PHONE_KINDS:
                warnings.append(issue(row_index, "unknown_phone_kind", f"{field} has unknown value: {value}"))

        primary_phone_count = sum(
            is_truthy_bool(row.get(field, "").strip())
            for field in ["phone1IsPrimary", "phone2IsPrimary"]
        )
        if primary_phone_count > 1:
            warnings.append(issue(row_index, "multiple_primary_phones", "more than one phone is marked as primary"))

        primary_email_count = sum(
            is_truthy_bool(row.get(field, "").strip())
            for field in ["email1IsPrimary", "email2IsPrimary"]
        )
        if primary_email_count > 1:
            warnings.append(issue(row_index, "multiple_primary_emails", "more than one email is marked as primary"))

        for field in ["notes", "phone1Notes", "phone2Notes", "displayName", "service", "locationText"]:
            value = row.get(field, "")
            if looks_like_placeholder_or_noise(value):
                warnings.append(issue(row_index, "noise_text", f"{field} contains likely noise or workbook markers"))

        tags = split_multi(row.get("tags", ""))
        aliases = split_multi(row.get("aliases", ""))
        if len(tags) != len(set(tag.casefold() for tag in tags)):
            warnings.append(issue(row_index, "duplicate_tags", "tags contain duplicates"))
        if len(aliases) != len(set(alias.casefold() for alias in aliases)):
            warnings.append(issue(row_index, "duplicate_aliases", "aliases contain duplicates"))

        if row.get("phone1NoPatientSharing", "") == "true" or row.get("phone2NoPatientSharing", "") == "true":
            counters["rows_with_no_patient_sharing"] += 1
        if row.get("phone1Confidential", "") == "true" or row.get("phone2Confidential", "") == "true":
            counters["rows_with_confidential"] += 1
        if row_type:
            counters[f"type:{row_type}"] += 1
        if area:
            counters[f"area:{area}"] += 1

    for external_id, row_numbers in by_external_id.items():
        if external_id and len(row_numbers) > 1:
            warnings.append(
                {
                    "rows": row_numbers,
                    "code": "duplicate_externalId",
                    "message": f"externalId appears multiple times: {external_id}",
                }
            )

    return {
        "summary": {
            "rowCount": len(rows),
            "errorCount": len(errors),
            "warningCount": len(warnings),
            "stats": dict(counters),
        },
        "errors": errors,
        "warnings": warnings,
    }


def issue(row: int, code: str, message: str) -> dict[str, object]:
    return {"row": row, "code": code, "message": message}


def print_summary(report: dict[str, object]) -> None:
    summary = report["summary"]
    print(f"Rows: {summary['rowCount']}")
    print(f"Errors: {summary['errorCount']}")
    print(f"Warnings: {summary['warningCount']}")

    stats = summary["stats"]
    if stats:
        print("Stats:")
        for key in sorted(stats):
            print(f"  {key}: {stats[key]}")

    if report["errors"]:
        print("Top errors:")
        for item in report["errors"][:10]:
            print(f"  row {item['row']}: {item['code']} - {item['message']}")

    if report["warnings"]:
        print("Top warnings:")
        for item in report["warnings"][:15]:
            rows = item.get("rows")
            if rows:
                print(f"  rows {rows}: {item['code']} - {item['message']}")
            else:
                print(f"  row {item['row']}: {item['code']} - {item['message']}")


def main() -> int:
    args = parse_args()
    headers, rows = read_csv(args.csv_path)

    missing_headers = sorted(REQUIRED_HEADERS - set(headers))
    if missing_headers:
        raise SystemExit(f"Missing required headers: {', '.join(missing_headers)}")

    report = validate_rows(rows)
    print_summary(report)

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Report written to {args.report}")

    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
