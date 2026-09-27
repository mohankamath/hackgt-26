#!/usr/bin/env python3
"""
Firestore Backup & Restore utility.

Usage:
  python scripts/firestore_manage.py save              # Save all collections to backup.json
  python scripts/firestore_manage.py save mybackup     # Save to mybackup.json
  python scripts/firestore_manage.py restore           # Wipe DB then restore from backup.json
  python scripts/firestore_manage.py restore mybackup  # Wipe DB then restore from mybackup.json
  python scripts/firestore_manage.py wipe              # Just wipe everything (no restore)
"""

import json
import sys
import os
from datetime import datetime

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1 import DocumentReference
import sys as _sys
_sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.config import load_config
from app.db.firestore import FirestoreDB

FIRESTORE_CREDENTIALS_PATH = FirestoreDB._resolve_credentials(load_config().firestore_credentials_path)

# ── Firebase init ───────────────────────────────────────────────────

if not firebase_admin._apps:
    if FIRESTORE_CREDENTIALS_PATH:
        firebase_admin.initialize_app(credentials.Certificate(FIRESTORE_CREDENTIALS_PATH))
    else:
        firebase_admin.initialize_app()

db = firestore.client(database_id=load_config().firestore_database_id)

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "..", "backups")

# ── Helpers ─────────────────────────────────────────────────────────

def _serialize(value):
    """Convert Firestore-native types to JSON-safe types."""
    if isinstance(value, firestore.firestore.GeoPoint):
        return {"__type__": "geopoint", "lat": value.latitude, "lng": value.longitude}
    if isinstance(value, DocumentReference):
        return {"__type__": "ref", "path": value.path}
    if hasattr(value, "isoformat"):  # datetime / DatetimeWithNanoseconds
        return {"__type__": "timestamp", "iso": value.isoformat()}
    if isinstance(value, dict):
        return {k: _serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_serialize(v) for v in value]
    return value


def _deserialize(value):
    """Convert saved JSON values back to Firestore-native types."""
    if isinstance(value, dict):
        t = value.get("__type__")
        if t == "timestamp":
            return datetime.fromisoformat(value["iso"])
        if t == "geopoint":
            return firestore.firestore.GeoPoint(value["lat"], value["lng"])
        if t == "ref":
            return db.document(value["path"])
        return {k: _deserialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_deserialize(v) for v in value]
    return value


def _backup_path(name: str) -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    return os.path.join(BACKUP_DIR, f"{name}.json")


# ── Save ────────────────────────────────────────────────────────────

def save(name: str = "backup"):
    """Export every document in every top-level collection to a JSON file."""
    data: dict[str, dict[str, dict]] = {}
    collections = db.collections()
    doc_count = 0

    for coll_ref in collections:
        coll_name = coll_ref.id
        data[coll_name] = {}
        for doc in coll_ref.stream():
            data[coll_name][doc.id] = _serialize(doc.to_dict())
            doc_count += 1
        print(f"  📦 {coll_name}: {len(data[coll_name])} docs")

    path = _backup_path(name)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"\n✅ Saved {doc_count} documents across {len(data)} collections → {path}")
    return path


# ── Wipe ────────────────────────────────────────────────────────────

def wipe():
    """Delete every document in every top-level collection."""
    collections = db.collections()
    total = 0

    for coll_ref in collections:
        coll_name = coll_ref.id
        docs = list(coll_ref.stream())
        batch = db.batch()
        for i, doc in enumerate(docs):
            batch.delete(doc.reference)
            # Firestore batches max 500 ops
            if (i + 1) % 500 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
        count = len(docs)
        total += count
        print(f"  🗑️  {coll_name}: deleted {count} docs")

    print(f"\n🧹 Wiped {total} documents total")


# ── Restore ─────────────────────────────────────────────────────────

def restore(name: str = "backup"):
    """Wipe the database then re-create every document from the backup file."""
    path = _backup_path(name)
    if not os.path.exists(path):
        print(f"❌ Backup file not found: {path}")
        sys.exit(1)

    with open(path, "r") as f:
        data = json.load(f)

    print("Step 1/2 — Wiping current database…")
    wipe()

    print("\nStep 2/2 — Restoring from backup…")
    doc_count = 0
    for coll_name, docs in data.items():
        batch = db.batch()
        for i, (doc_id, doc_data) in enumerate(docs.items()):
            ref = db.collection(coll_name).document(doc_id)
            batch.set(ref, _deserialize(doc_data))
            doc_count += 1
            if (i + 1) % 500 == 0:
                batch.commit()
                batch = db.batch()
        batch.commit()
        print(f"  📥 {coll_name}: restored {len(docs)} docs")

    print(f"\n✅ Restored {doc_count} documents across {len(data)} collections from {path}")


# ── CLI ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    command = sys.argv[1].lower()
    name = sys.argv[2] if len(sys.argv) > 2 else "backup"

    if command == "save":
        save(name)
    elif command == "restore":
        confirm = input(f"⚠️  This will WIPE the entire database and restore from '{name}.json'. Continue? (y/N): ")
        if confirm.strip().lower() == "y":
            restore(name)
        else:
            print("Aborted.")
    elif command == "wipe":
        confirm = input("⚠️  This will DELETE every document in every collection. Continue? (y/N): ")
        if confirm.strip().lower() == "y":
            wipe()
        else:
            print("Aborted.")
    else:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)
