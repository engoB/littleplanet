"""Écriture minimale de fichiers glTF binaires (.glb) sans dépendance externe."""
from __future__ import annotations

import json
import struct

import numpy as np


class GlbBuilder:
    def __init__(self) -> None:
        self.gltf: dict = {
            'asset': {'version': '2.0', 'generator': 'littleplanet/tools'},
            'scene': 0, 'scenes': [{'nodes': []}], 'nodes': [], 'meshes': [],
            'materials': [], 'accessors': [], 'bufferViews': [], 'buffers': [],
        }
        self.bin = bytearray()
        self.mat_index: dict[str, int] = {}

    def _view(self, data: bytes, target: int | None) -> int:
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin += data
        bv = {'buffer': 0, 'byteOffset': off, 'byteLength': len(data)}
        if target:
            bv['target'] = target
        self.gltf['bufferViews'].append(bv)
        return len(self.gltf['bufferViews']) - 1

    def accessor(self, arr: np.ndarray, kind: str, target: int | None = 34962) -> int:
        comp = {np.float32: 5126, np.uint32: 5125, np.uint16: 5123}[arr.dtype.type]
        bv = self._view(arr.tobytes(), target)
        acc = {'bufferView': bv, 'componentType': comp, 'count': int(arr.shape[0]), 'type': kind}
        if kind == 'VEC3' and comp == 5126:
            acc['min'] = arr.min(axis=0).tolist()
            acc['max'] = arr.max(axis=0).tolist()
        self.gltf['accessors'].append(acc)
        return len(self.gltf['accessors']) - 1

    def material(self, name: str, color=(0.8, 0.8, 0.8, 1.0), emissive=(0, 0, 0)) -> int:
        if name in self.mat_index:
            return self.mat_index[name]
        m = {'name': name, 'pbrMetallicRoughness': {'baseColorFactor': list(color), 'metallicFactor': 0.0, 'roughnessFactor': 0.5}}
        if any(emissive):
            m['emissiveFactor'] = list(emissive)
        if color[3] < 1:
            m['alphaMode'] = 'BLEND'
        self.gltf['materials'].append(m)
        self.mat_index[name] = len(self.gltf['materials']) - 1
        return self.mat_index[name]

    def mesh(self, name: str, prims: list[tuple[np.ndarray, np.ndarray, np.ndarray | None, np.ndarray, int]]) -> int:
        """prims : (positions Nx3, normales Nx3, uv Nx2|None, indices, matériau)."""
        out = []
        for pos, nrm, uv, idx, mat in prims:
            attrs = {'POSITION': self.accessor(pos.astype(np.float32), 'VEC3'),
                     'NORMAL': self.accessor(nrm.astype(np.float32), 'VEC3')}
            if uv is not None:
                attrs['TEXCOORD_0'] = self.accessor(uv.astype(np.float32), 'VEC2')
            it = np.uint16 if pos.shape[0] < 65536 else np.uint32
            out.append({'attributes': attrs, 'indices': self.accessor(idx.astype(it).ravel(), 'SCALAR', 34963), 'material': mat})
        self.gltf['meshes'].append({'name': name, 'primitives': out})
        return len(self.gltf['meshes']) - 1

    def node(self, name: str, matrix: np.ndarray | None = None, mesh: int | None = None, children: list[int] | None = None) -> int:
        n: dict = {'name': name}
        if matrix is not None and not np.allclose(matrix, np.eye(4)):
            n['matrix'] = [float(x) for x in matrix.T.ravel()]  # glTF : colonne majeure
        if mesh is not None:
            n['mesh'] = mesh
        if children:
            n['children'] = children
        self.gltf['nodes'].append(n)
        return len(self.gltf['nodes']) - 1

    def write(self, path: str, roots: list[int]) -> None:
        self.gltf['scenes'][0]['nodes'] = roots
        while len(self.bin) % 4:
            self.bin.append(0)
        self.gltf['buffers'] = [{'byteLength': len(self.bin)}]
        js = json.dumps(self.gltf, separators=(',', ':')).encode()
        while len(js) % 4:
            js += b' '
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, 'wb') as fh:
            fh.write(struct.pack('<III', 0x46546C67, 2, total))
            fh.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
            fh.write(struct.pack('<II', len(self.bin), 0x004E4942) + bytes(self.bin))
