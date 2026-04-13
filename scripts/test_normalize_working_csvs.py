#!/usr/bin/env python3
"""Regression tests for CSV normalization helpers."""

from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from normalize_working_csvs import normalize_centers_sheet


class NormalizeCentersSheetTests(unittest.TestCase):
    def test_external_center_secondary_phone_keeps_external_kind(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            csv_path = Path(tmpdir) / "centros-de-salud.csv"
            with csv_path.open("w", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle)
                writer.writerow(["center", "service", "long", "short"])
                writer.writerow(["CENTRO DE PRUEBA C/ DEMO 1", "INF.", "928123456", "1234"])

            records = normalize_centers_sheet(csv_path)

        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["type"], "external-center")
        self.assertEqual(record["phone1Kind"], "external")
        self.assertEqual(record["phone2Kind"], "external")
        self.assertEqual(record["phone2Number"], "1234")


if __name__ == "__main__":
    unittest.main()
