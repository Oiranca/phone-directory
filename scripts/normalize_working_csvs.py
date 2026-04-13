#!/usr/bin/env python3
"""Normalize extracted ODS working CSVs into the MVP import template."""

from __future__ import annotations

import argparse
import csv
import re
import unicodedata
from pathlib import Path


OUTPUT_HEADERS = [
    "externalId",
    "type",
    "displayName",
    "firstName",
    "lastName",
    "area",
    "department",
    "service",
    "specialty",
    "building",
    "floor",
    "room",
    "locationText",
    "phone1Label",
    "phone1Number",
    "phone1Extension",
    "phone1Kind",
    "phone1IsPrimary",
    "phone1Confidential",
    "phone1NoPatientSharing",
    "phone1Notes",
    "phone2Label",
    "phone2Number",
    "phone2Extension",
    "phone2Kind",
    "phone2IsPrimary",
    "phone2Confidential",
    "phone2NoPatientSharing",
    "phone2Notes",
    "email1",
    "email1Label",
    "email1IsPrimary",
    "email2",
    "email2Label",
    "email2IsPrimary",
    "tags",
    "aliases",
    "notes",
    "status",
]

SERVICE_SHEETS = {
    "admision-central": ("gestion-administracion", "Admisión Central"),
    "rayos": ("especialidades", "Rayos"),
    "secretarias": ("gestion-administracion", "Secretarías"),
    "urgencias": ("sanitaria-asistencial", "Urgencias"),
    "hospitales-de-dia": ("sanitaria-asistencial", "Hospitales de día"),
    "umi": ("sanitaria-asistencial", "UMI"),
}

CENTER_SERVICE_LABELS = {
    "INF.": "Información",
    "ADM.": "Administración",
    "URG.": "Urgencias",
    "URGENCIAS": "Urgencias",
    "FAX.": "Fax",
    "FAX": "Fax",
}

EXCLUDED_PATTERNS = [
    re.compile(r"^servicio$", re.I),
    re.compile(r"^n[uú]mero", re.I),
    re.compile(r"^centros de salud$", re.I),
    re.compile(r"^sala[s]?$", re.I),
    re.compile(r"^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\-\.\(\)0-9]+$"),
]

NO_SHARE_MARKERS = [
    "NO DAR A LA CALLE",
    "NO PASAR DESPACHO MÉDICO",
    "NO DAR EL NÚMERO LARGO A LA CALLE",
    "NO PASAR LLAMADAS EXTERNAS",
    "NO HACEN CAMBIOS DE CITAS",
]

CONFIDENTIAL_MARKERS = [
    "DESPACHO MÉDICO",
    "INTERNAL USE ONLY",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--indir",
        type=Path,
        default=Path("tmp/ods-export"),
        help="Directory with extracted working CSVs",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path("tmp/normalized/contacts-import-ready.csv"),
        help="Output normalized CSV path",
    )
    return parser.parse_args()


def read_rows(path: Path) -> list[list[str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        return list(csv.reader(handle))


def clean(value: str) -> str:
    return " ".join(value.replace("\xa0", " ").split())


def normalize_marker(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    return value.upper().replace(" ", "")


def is_excluded_label(label: str) -> bool:
    value = clean(label)
    if not value:
        return True
    normalized = normalize_marker(value)
    if normalized in {"INDICEAGENDA", "INDICEAGENDAHOSPITALARIA"}:
        return True
    for pattern in EXCLUDED_PATTERNS:
        if pattern.match(value):
            if any(ch.isdigit() for ch in value) and len(value.split()) > 3:
                return False
            return True
    return False


def extract_numbers(text: str) -> list[str]:
    value = clean(text)
    if not value:
        return []

    results: list[str] = []
    for part in re.split(r"\s*/\s*", value):
        part = clean(part)
        if not part:
            continue
        expanded = expand_compact_range(part)
        if expanded:
            results.extend(expanded)
            continue
        digits = re.sub(r"\D", "", part)
        if len(digits) >= 4:
            results.append(digits)
    return dedupe_keep_order(results)


def expand_compact_range(part: str) -> list[str] | None:
    # Example: 79616-21 -> 79616, 79617, ..., 79621
    match = re.fullmatch(r"(\d+)-(\d+)", part)
    if not match:
        return None
    start_raw, end_suffix = match.groups()
    if len(start_raw) <= len(end_suffix):
        return None
    prefix = start_raw[: len(start_raw) - len(end_suffix)]
    try:
        start = int(start_raw)
        end = int(prefix + end_suffix)
    except ValueError:
        return None
    if end < start or end - start > 20:
        return None
    return [str(number) for number in range(start, end + 1)]


def dedupe_keep_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def detect_privacy(notes: str) -> tuple[bool, bool]:
    upper = notes.upper()
    confidential = any(marker in upper for marker in CONFIDENTIAL_MARKERS)
    no_share = any(marker in upper for marker in NO_SHARE_MARKERS)
    return confidential, no_share


def clean_note_fragments(values: list[str]) -> list[str]:
    cleaned: list[str] = []
    for value in values:
        text = clean(value)
        if not text:
            continue
        marker = normalize_marker(text)
        if marker in {"INDICEAGENDA", "INDICEAGENDAHOSPITALARIA"}:
            continue
        cleaned.append(text)
    return cleaned


def classify_type(label: str, sheet_slug: str) -> str:
    lower = label.lower()
    if "supervisi" in lower:
        return "supervision"
    if lower.startswith("sala") or lower.startswith("qx ") or "camas" in lower or "boxes" in lower:
        return "room"
    if "mostrador" in lower or "control" in lower or "puerta" in lower:
        return "control"
    if sheet_slug == "centros-de-salud":
        return "external-center"
    if looks_like_person(label):
        return "person"
    return "service"


def looks_like_person(label: str) -> bool:
    lower = label.lower()
    person_markers = ["dr.", "dra.", "laura", "juan", "lidia", "tere", "cris", "ana ", "david ", "natalia "]
    return any(marker in lower for marker in person_markers)


def aliases_from_label(label: str) -> str:
    aliases: list[str] = []
    upper = label.upper()
    if "TAC" in upper:
        aliases.append("scanner")
    if "RX" in upper:
        aliases.append("radiologia")
    if "UMI" in upper:
        aliases.append("uci")
    if "SECRETAR" in upper:
        aliases.append("secretaria")
    return "|".join(dedupe_keep_order(aliases))


def normalize_service_sheet(path: Path) -> list[dict[str, str]]:
    rows = read_rows(path)
    data = rows[1:] if rows else []
    area, department = SERVICE_SHEETS[path.stem]
    records: list[dict[str, str]] = []
    current_section = ""

    for index, row in enumerate(data, start=1):
        cells = [clean(value) for value in row]
        label = cells[0] if cells else ""
        if is_excluded_label(label):
            continue

        non_empty = [value for value in cells if value]
        if len(non_empty) == 1 and label:
            current_section = label
            continue
        if all(is_excluded_label(value) for value in non_empty if value):
            continue
        if len(non_empty) > 1 and all(
            is_excluded_label(value) or not extract_numbers(value) for value in non_empty[1:]
        ) and not extract_numbers(label):
            current_section = label
            continue

        phone_numbers: list[str] = []
        note_fragments: list[str] = []
        for cell in cells[1:]:
            if not cell:
                continue
            extracted = extract_numbers(cell)
            if extracted:
                phone_numbers.extend(extracted)
            if re.search(r"[A-Za-zÁÉÍÓÚáéíóúÑñ]", cell):
                note_fragments.extend(clean_note_fragments([cell]))
        notes = " | ".join(note_fragments)

        phone_numbers = dedupe_keep_order(phone_numbers)
        if not phone_numbers and not any(cells[1:]):
            continue

        label_note = []
        if current_section and current_section != department:
            label_note.append(f"Sección: {current_section}")
        if notes:
            label_note.append(notes)
        final_notes = " | ".join(clean_note_fragments(label_note))
        privacy_source = " | ".join(clean_note_fragments([label, current_section, final_notes]))
        confidential, no_share = detect_privacy(privacy_source)

        record = blank_record()
        record["externalId"] = f"{path.stem}-{index}"
        record["type"] = classify_type(label, path.stem)
        record["displayName"] = label
        record["area"] = area
        record["department"] = department
        record["service"] = current_section if current_section and current_section != department else label
        record["phone1Label"] = "Principal" if phone_numbers else ""
        record["phone1Number"] = phone_numbers[0] if phone_numbers else ""
        record["phone1Kind"] = "internal" if phone_numbers else ""
        record["phone1IsPrimary"] = "true" if phone_numbers else "false"
        record["phone1Confidential"] = "true" if confidential else "false"
        record["phone1NoPatientSharing"] = "true" if no_share else "false"
        record["phone1Notes"] = final_notes
        if len(phone_numbers) > 1:
            record["phone2Label"] = "Secundario"
            record["phone2Number"] = phone_numbers[1]
            record["phone2Kind"] = "internal"
            record["phone2IsPrimary"] = "false"
            record["phone2Confidential"] = "true" if confidential else "false"
            record["phone2NoPatientSharing"] = "true" if no_share else "false"
            record["phone2Notes"] = final_notes
        record["aliases"] = aliases_from_label(label)
        record["notes"] = final_notes
        record["status"] = "active"
        records.append(record)
    return records


def normalize_centers_sheet(path: Path) -> list[dict[str, str]]:
    rows = read_rows(path)
    data = rows[1:] if rows else []
    records: list[dict[str, str]] = []
    current_center = ""
    current_address = ""

    for index, row in enumerate(data, start=1):
        cells = [clean(value) for value in row]
        first = cells[0] if len(cells) > 0 else ""
        second = cells[1] if len(cells) > 1 else ""
        third = cells[2] if len(cells) > 2 else ""
        fourth = cells[3] if len(cells) > 3 else ""

        if is_excluded_label(first):
            continue

        if looks_like_center_header(first, second):
            current_center, current_address = split_center_address(first)
            service = normalize_center_service(second)
            long_number = third
            short_number = fourth
        else:
            if not current_center:
                continue
            service = normalize_center_service(first)
            long_number = second
            short_number = third

        if not service:
            continue

        record = blank_record()
        record["externalId"] = f"{path.stem}-{index}"
        record["type"] = "external-center"
        record["displayName"] = f"{current_center} - {service}"
        record["area"] = "otros"
        record["department"] = "Centros de salud"
        record["service"] = service
        record["locationText"] = current_address
        phones = dedupe_keep_order(extract_numbers(long_number) + extract_numbers(short_number))
        if phones:
            record["phone1Label"] = "General"
            record["phone1Number"] = phones[0]
            record["phone1Kind"] = "external"
            record["phone1IsPrimary"] = "true"
            record["phone1Confidential"] = "false"
            record["phone1NoPatientSharing"] = "false"
        if len(phones) > 1:
            record["phone2Label"] = ""
            record["phone2Number"] = phones[1]
            record["phone2Kind"] = "external"
            record["phone2IsPrimary"] = "false"
            record["phone2Confidential"] = "false"
            record["phone2NoPatientSharing"] = "false"
        record["aliases"] = current_center.lower()
        record["status"] = "active"
        records.append(record)
    return records


def split_center_address(raw: str) -> tuple[str, str]:
    value = clean(raw)
    prefix_chars: list[str] = []
    idx = 0
    while idx < len(value):
        ch = value[idx]
        if ch.isupper() or ch in " ÁÉÍÓÚÜÑ,.-":
            prefix_chars.append(ch)
            idx += 1
            continue
        break

    if not prefix_chars:
        return value, ""

    center_raw = "".join(prefix_chars).rstrip()
    address = value[idx:].lstrip()

    if address and center_raw:
        next_three = address[:3]
        if (
            center_raw[-1].isupper()
            and len(next_three) == 3
            and next_three[:2].islower()
            and next_three[2].islower()
        ):
            address = center_raw[-1] + address
            center_raw = center_raw[:-1].rstrip()

    center = clean(center_raw.title())
    return center or value, clean(address)


def normalize_center_service(value: str) -> str:
    text = clean(value)
    return CENTER_SERVICE_LABELS.get(text.upper(), text)


def looks_like_center_header(first: str, second: str) -> bool:
    if not first or not second:
        return False
    if normalize_center_service(second) not in CENTER_SERVICE_LABELS.values():
        return False
    first_clean = clean(first)
    if re.search(r"\d", first_clean):
        return True
    address_markers = ["c/", "carretera", "avda", "calle", "plaza", "paseo", "doctor", "médico", "medico"]
    return any(marker in first_clean.lower() for marker in address_markers)


def blank_record() -> dict[str, str]:
    return {header: "" for header in OUTPUT_HEADERS}


def write_output(path: Path, records: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_HEADERS)
        writer.writeheader()
        for record in records:
            writer.writerow(record)


def main() -> int:
    args = parse_args()
    records: list[dict[str, str]] = []

    for path in sorted(args.indir.glob("*.csv")):
        if path.stem == "centros-de-salud":
            records.extend(normalize_centers_sheet(path))
            continue
        if path.stem in SERVICE_SHEETS:
            records.extend(normalize_service_sheet(path))

    write_output(args.out, records)
    print(f"Normalized {len(records)} records -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
