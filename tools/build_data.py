#!/usr/bin/env python3
"""Liest die Kapitel-YAMLs, packt sie als gzip-JSON und verschlüsselt sie mit AES-GCM.

Aufruf:
    HIRNBERT_PASSWORT=... python3 tools/build_data.py <yaml-verzeichnis> [ausgabe]

Die Klartext-Fragen landen nie im Repo, nur data.enc.json.
"""
import base64
import glob
import gzip
import json
import os
import sys

import yaml
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 250_000
# Abkürzungen, deren Punkt am Antwortende erhalten bleiben muss
ABBREVIATIONS = {"etc", "usw", "bzw", "ggf", "evtl", "inkl", "zzgl", "ca", "abs", "nr", "ff", "vgl", "co"}


def strip_period(text):
    """Entfernt den Satzpunkt am Ende einer Antwort, außer nach Abkürzungen."""
    text = text.strip()
    if not text.endswith(".") or text.endswith(".."):
        return text
    last = text.split()[-1][:-1]
    if last.lower() in ABBREVIATIONS or "." in last and last.replace(".", "").isalpha():
        return text
    return text[:-1]


def load_chapters(src_dir):
    chapters = []
    for path in sorted(glob.glob(os.path.join(src_dir, "kapitel_*.yaml"))):
        with open(path, encoding="utf-8") as f:
            d = yaml.safe_load(f)
        questions = []
        for q in d["fragen"]:
            item = {
                "nr": q["nr"],
                "q": q["frage"],
                "a": {str(k): strip_period(str(v)) for k, v in q["antworten"].items()},
                "k": [str(x) for x in q["korrekt"]],
            }
            if q.get("loesung"):
                item["l"] = {str(k): str(v) for k, v in q["loesung"].items()}
            if q.get("erklaerung"):
                item["e"] = q["erklaerung"]
            questions.append(item)
        chapters.append({
            "nr": d["kapitel"],
            "titel": d["titel"],
            "fragen": questions,
            "infoboxen": [
                {"nach": i["nach_frage"], "titel": i["titel"], "text": i["text"]}
                for i in (d.get("infoboxen") or [])
            ],
        })
    chapters.sort(key=lambda c: c["nr"])
    return chapters


def encrypt(payload: bytes, password: str) -> dict:
    salt = os.urandom(16)
    iv = os.urandom(12)
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
    key = kdf.derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, payload, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"v": 1, "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    password = os.environ.get("HIRNBERT_PASSWORT")
    if not password:
        sys.exit("HIRNBERT_PASSWORT ist nicht gesetzt.")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data.enc.json")

    chapters = load_chapters(sys.argv[1])
    raw = json.dumps({"kapitel": chapters}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    enc = encrypt(gzip.compress(raw, mtime=0), password)
    with open(out, "w", encoding="ascii") as f:
        json.dump(enc, f)
    n = sum(len(c["fragen"]) for c in chapters)
    print(f"{len(chapters)} Kapitel, {n} Fragen -> {os.path.normpath(out)}")


if __name__ == "__main__":
    main()
