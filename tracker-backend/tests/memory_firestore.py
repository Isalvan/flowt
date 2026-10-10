"""In-memory stand-in for the Firestore client surface the services use.

Transactions buffer their writes, apply them together and refuse any read made
after a write, as Firestore does, so a service that orders its reads wrongly
fails here instead of in production.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from itertools import count

from firebase_admin import firestore

OPERATORS = {
    "==": lambda value, wanted: value == wanted,
    ">=": lambda value, wanted: value is not None and value >= wanted,
    "<": lambda value, wanted: value is not None and value < wanted,
    "in": lambda value, wanted: value in wanted,
}


def merged(current, values, timestamp):
    result = deepcopy(current)
    for key, value in values.items():
        if value is firestore.DELETE_FIELD:
            result.pop(key, None)
        else:
            result[key] = timestamp if value is firestore.SERVER_TIMESTAMP else deepcopy(value)
    return result


class Snapshot:
    def __init__(self, ref):
        self.reference, self.id = ref, ref.id
        self.exists = ref.key in ref.db.data
        self.update_time = ref.db.versions.get(ref.key)
        self._data = deepcopy(ref.db.data.get(ref.key))

    def to_dict(self):
        return deepcopy(self._data)


class Ref:
    def __init__(self, db, collection, key):
        self.db, self.collection_name, self.id = db, collection, key
        self.key = (collection, key)

    def get(self, transaction=None):
        if transaction and transaction.writes:
            raise AssertionError("Firestore cannot read after a transaction write")
        return Snapshot(self)

    def set(self, values, merge=False):
        self.db.write(self.key, values, merge=merge)

    def update(self, values):
        assert self.key in self.db.data
        self.db.write(self.key, values, merge=True)

    def delete(self):
        self.db.data.pop(self.key, None)
        self.db.versions.pop(self.key, None)

    def collection(self, name):
        return Query(self.db, f"{self.collection_name}/{self.id}/{name}")


class Query:
    def __init__(self, db, name, filters=(), order=None, cap=None, after=None):
        self.db, self.name, self.filters, self.order, self.cap, self.after = db, name, filters, order, cap, after

    def _with(self, **changes):
        return Query(self.db, self.name, **{"filters": self.filters, "order": self.order, "cap": self.cap, "after": self.after, **changes})

    def document(self, key=None):
        return Ref(self.db, self.name, key or f"auto-{next(self.db.ids):04d}")

    def where(self, *, filter):
        return self._with(filters=(*self.filters, filter))

    def order_by(self, field, direction="ASCENDING"):
        return self._with(order=(field, direction == "DESCENDING"))

    def limit(self, cap):
        return self._with(cap=cap)

    def start_after(self, snapshot):
        return self._with(after=snapshot.id)

    def stream(self, transaction=None):
        if transaction and transaction.writes:
            raise AssertionError("Firestore cannot query after a transaction write")
        keys = [key for collection, key in sorted(self.db.data) if collection == self.name]
        rows = [(key, self.db.data[(self.name, key)]) for key in keys]
        rows = [(key, data) for key, data in rows
                if all(OPERATORS[f.op_string](data.get(f.field_path), f.value) for f in self.filters)]
        if self.order:
            field, descending = self.order
            rows = [row for row in rows if row[1].get(field) is not None]
            rows.sort(key=lambda row: (row[1][field], row[0]), reverse=descending)
        if self.after:
            ids = [key for key, _ in rows]
            rows = rows[ids.index(self.after) + 1:] if self.after in ids else rows
        for key, _ in rows[:self.cap]:
            yield Snapshot(Ref(self.db, self.name, key))


class Transaction:
    def __init__(self, db):
        self.db, self.writes = db, []

    def set(self, ref, values, merge=False):
        self.writes.append(("merge" if merge else "set", ref, values))

    def update(self, ref, values):
        assert ref.key in self.db.data, f"update of a missing document {ref.key}"
        self.writes.append(("merge", ref, values))

    def create(self, ref, values):
        assert ref.key not in self.db.data, f"create of an existing document {ref.key}"
        self.writes.append(("set", ref, values))

    def delete(self, ref):
        self.writes.append(("delete", ref, {}))

    def commit(self):
        for op, ref, values in self.writes:
            if op == "delete":
                ref.delete()
            else:
                self.db.write(ref.key, values, merge=op == "merge")
        self.db.committed_writes += len(self.writes)


class MemoryFirestore:
    def __init__(self):
        self.data, self.versions = {}, {}
        self.sequence, self.committed_writes, self.ids = 0, 0, count(1)

    def tick(self):
        self.sequence += 1
        return datetime(2026, 10, 10, tzinfo=timezone.utc) + timedelta(microseconds=self.sequence)

    def write(self, key, values, merge):
        timestamp = self.tick()
        self.data[key] = merged(self.data.get(key, {}) if merge else {}, values, timestamp)
        self.versions[key] = timestamp

    def collection(self, name):
        return Query(self, name)

    def put(self, collection, key, data):
        self.write((collection, key), data, merge=False)

    def doc(self, collection, key):
        return self.data.get((collection, key))

    def docs(self, collection):
        return {key: data for (name, key), data in self.data.items() if name == collection}

    def atomic(self, operation):
        """Drop-in for a service's _atomic: all writes land together, or none on error."""
        transaction = Transaction(self)
        result = operation(transaction)
        transaction.commit()
        return result
