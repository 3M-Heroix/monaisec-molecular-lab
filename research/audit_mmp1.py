#!/usr/bin/env python3
"""Reproduce the CHEMBL332 assay inventory with the public ChEMBL API."""

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import json
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

API = "https://www.ebi.ac.uk/chembl/api/data/"
TARGET = "CHEMBL332"
PROTEIN_ASSAY_FORMAT = "BAO_0000357"


def get_json(url):
    if not url.startswith(API):
        raise ValueError(f"Unexpected ChEMBL API URL: {url}")
    request = Request(url, headers={"User-Agent": "Monaisec-Molecular-Lab-audit/1.0"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                raise
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2 ** attempt)


def endpoint(resource, **parameters):
    query = urlencode({"target_chembl_id": TARGET, **parameters})
    return f"{API}{resource}.json?{query}"


def fetch_pages(url, list_key, identifier):
    records = {}
    visited = set()
    reported = None
    while url:
        if url in visited:
            raise ValueError(f"ChEMBL repeated a page: {url}")
        visited.add(url)
        payload = get_json(url)
        page = payload["page_meta"]
        if reported is None:
            reported = page["total_count"]
        if page["total_count"] != reported:
            raise ValueError(f"ChEMBL changed its total for {list_key} mid-run")
        for row in payload[list_key]:
            key = row[identifier]
            if key in records:
                raise ValueError(f"Duplicate {identifier} received: {key}")
            records[key] = row
        link = page["next"]
        url = urljoin(url, link) if link else None
    if len(records) != reported:
        raise ValueError(f"{list_key}: expected {reported}, received {len(records)}")
    return records


def positive_value(row):
    try:
        value = Decimal(row["standard_value"])
    except (InvalidOperation, TypeError, KeyError):
        return False
    return value.is_finite() and value > 0


def is_selected(row, assays):
    assigned = assays[row["assay_chembl_id"]]
    return (
        assigned.get("confidence_score") == 9
        and row.get("assay_type") == "B"
        and row.get("bao_format") == PROTEIN_ASSAY_FORMAT
        and bool(row.get("canonical_smiles") and row.get("molecule_chembl_id"))
        and not row.get("assay_variant_mutation")
        and not row.get("data_validity_comment")
        and positive_value(row)
    )


def audit_endpoint(kind, assays):
    exact_url = endpoint(
        "activity", standard_type=kind, standard_relation="=", standard_units="nM", limit=500
    )
    records = fetch_pages(exact_url, "activities", "activity_id")
    selected = [row for row in records.values() if is_selected(row, assays)]
    by_assay = defaultdict(set)
    for row in selected:
        by_assay[row["assay_chembl_id"]].add(row["molecule_chembl_id"])
    largest = sorted(by_assay, key=lambda key: (-len(by_assay[key]), key))[:3]
    all_url = endpoint("activity", standard_type=kind, limit=1)
    return {
        "all_measurements": get_json(all_url)["page_meta"]["total_count"],
        "exact_measurements_nm": len(records),
        "selected_measurements": len(selected),
        "unique_chembl_molecule_ids": len({row["molecule_chembl_id"] for row in selected}),
        "unique_assay_ids": len(by_assay),
        "unique_document_ids": len(
            {row["document_chembl_id"] for row in selected if row.get("document_chembl_id")}
        ),
        "largest_assays": [
            {"assay_chembl_id": key, "unique_chembl_molecule_ids": len(by_assay[key])}
            for key in largest
        ],
        "queries": {"all_measurements": all_url, "exact_measurements_nm": exact_url},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", help="Reject an API release other than this value")
    args = parser.parse_args()
    status_url = f"{API}status.json"
    status = get_json(status_url)
    release = status["chembl_db_version"]
    if args.release and release != args.release:
        parser.error(f"API serves {release}, requested {args.release}")
    assay_query = endpoint("assay", limit=500)
    assays = fetch_pages(assay_query, "assays", "assay_chembl_id")
    all_activity_query = endpoint("activity", limit=1)
    result = {
        "target_chembl_id": TARGET,
        "database_release": release,
        "database_release_date": status["chembl_release_date"],
        "license": "CC BY-SA 3.0",
        "source": "ChEMBL, EMBL-EBI",
        "queries": {"status": status_url, "assays": assay_query, "all_activities": all_activity_query},
        "all_target_activities": get_json(all_activity_query)["page_meta"]["total_count"],
        "endpoints": {kind: audit_endpoint(kind, assays) for kind in ("IC50", "Ki")},
    }
    if get_json(status_url)["chembl_db_version"] != release:
        raise ValueError("ChEMBL release changed during this run")
    result["retrieved_at_utc"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(json.dumps(result, ensure_ascii=False, indent=2), file=sys.stdout)


if __name__ == "__main__":
    main()
