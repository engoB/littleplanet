"""Lecture des fichiers YAML Unity (scènes, prefabs, matériaux, assets).

Unity sérialise chaque objet dans un document « --- !u!<classe> &<fileID> ».
Ce module découpe le fichier, parse chaque document avec PyYAML et indexe
les GUID des fichiers .meta pour résoudre les références externes.
"""
from __future__ import annotations

import os
import re
from typing import Any

import yaml

HDR = re.compile(r'^--- !u!(\d+) &(-?\d+)( stripped)?')


class UDoc:
    __slots__ = ('cls', 'file_id', 'type', 'data', 'stripped')

    def __init__(self, cls: int, file_id: int, type_: str | None, data: dict, stripped: bool):
        self.cls = cls
        self.file_id = file_id
        self.type = type_
        self.data = data
        self.stripped = stripped

    def __repr__(self) -> str:  # pragma: no cover
        return f'<UDoc {self.type} &{self.file_id}>'


def load(path: str) -> dict[int, UDoc]:
    """Charge un fichier YAML Unity → {fileID: UDoc}."""
    docs: dict[int, UDoc] = {}
    cur: tuple[int, int, bool] | None = None
    buf: list[str] = []

    def flush() -> None:
        if cur is None:
            return
        txt = '\n'.join(buf)
        try:
            d = yaml.safe_load(txt) or {}
        except yaml.YAMLError:
            # Certains champs (chaînes binaires) cassent PyYAML : on les neutralise.
            d = yaml.safe_load(re.sub(r':\s*[^\n]*\\x[0-9A-F]{2}[^\n]*', ': ""', txt)) or {}
        k = next(iter(d)) if d else None
        docs[cur[1]] = UDoc(cur[0], cur[1], k, (d.get(k) if k else {}) or {}, cur[2])

    with open(path, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            line = line.rstrip('\n')
            m = HDR.match(line)
            if m:
                flush()
                cur = (int(m.group(1)), int(m.group(2)), bool(m.group(3)))
                buf = []
            elif cur is not None:
                buf.append(line)
    flush()
    return docs


def guid_index(assets_root: str) -> dict[str, str]:
    """{guid: chemin relatif à Assets/} pour tous les .meta du projet."""
    idx: dict[str, str] = {}
    for dp, _dn, fn in os.walk(assets_root):
        for f in fn:
            if not f.endswith('.meta'):
                continue
            p = os.path.join(dp, f)
            with open(p, encoding='utf-8', errors='ignore') as fh:
                for line in fh:
                    if line.startswith('guid:'):
                        idx[line.split()[1]] = os.path.relpath(p[:-5], assets_root).replace(os.sep, '/')
                        break
    return idx


def read_meta(path: str) -> dict[str, Any]:
    with open(path + '.meta', encoding='utf-8', errors='ignore') as fh:
        return yaml.safe_load(fh) or {}
