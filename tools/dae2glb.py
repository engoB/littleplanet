"""Conversion Collada (.dae) → .glb en conservant la hiérarchie et les noms.

FBX2glTF ne lit pas le Collada : la voiture (Cartoon_SportCar_B01.dae) passe
par ce convertisseur basé sur pycollada. Les unités brutes du fichier sont
conservées ; l'échelle d'import Unity (globalScale) est appliquée au runtime
à partir de public/data/scene.json.

Usage : python tools/dae2glb.py entree.dae sortie.glb
"""
from __future__ import annotations

import sys

import collada
import numpy as np
from collada.scene import GeometryNode, Node

from glb_writer import GlbBuilder


def convert(src: str, dst: str) -> None:
    col = collada.Collada(src, ignore=[collada.common.DaeUnsupportedError, collada.common.DaeBrokenRefError])
    g = GlbBuilder()

    def mat_for(target) -> int:
        name = target.name or target.id
        eff = target.effect
        diffuse = eff.diffuse if isinstance(eff.diffuse, tuple) else (0.8, 0.8, 0.8, 1.0)
        alpha = 1.0
        if eff.transparency is not None and eff.transparent is not None and isinstance(eff.transparent, tuple):
            # opaque="RGB_ZERO" : transparence = 1 - lum(transparent) * transparency (approx.)
            alpha = 1.0 - float(np.mean(eff.transparent[:3])) * float(eff.transparency)
            alpha = max(0.05, min(1.0, alpha)) if alpha < 0.999 else 1.0
        emission = eff.emission if isinstance(eff.emission, tuple) else (0, 0, 0)
        return g.material(name, (diffuse[0], diffuse[1], diffuse[2], alpha), emission[:3])

    def build_geom(gnode: GeometryNode, name: str) -> int | None:
        symbols = {m.symbol: m.target for m in gnode.materials}
        prims = []
        for p in gnode.geometry.primitives:
            if isinstance(p, (collada.polylist.Polylist, collada.polygons.Polygons)):
                p = p.triangleset()
            if not isinstance(p, collada.triangleset.TriangleSet) or len(p) == 0:
                continue
            vi = p.vertex_index.reshape(-1)
            pos = p.vertex[vi]
            if p.normal is not None:
                nrm = p.normal[p.normal_index.reshape(-1)]
            else:
                tri = pos.reshape(-1, 3, 3)
                fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
                fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
                nrm = np.repeat(fn, 3, axis=0)
            uv = None
            if p.texcoordset:
                uv = p.texcoordset[0][p.texcoord_indexset[0].reshape(-1)].copy()
                uv[:, 1] = 1.0 - uv[:, 1]
            # Soudure des sommets identiques (position + normale + uv)
            key = np.hstack([pos, nrm] + ([uv] if uv is not None else []))
            uniq, inv = np.unique(np.round(key, 6), axis=0, return_inverse=True)
            pos_u = uniq[:, 0:3]
            nrm_u = uniq[:, 3:6]
            uv_u = uniq[:, 6:8] if uv is not None else None
            target = symbols.get(p.material)
            mi = mat_for(target) if target is not None else g.material('default')
            prims.append((pos_u, nrm_u, uv_u, inv.reshape(-1).astype(np.uint32), mi))
        return g.mesh(name, prims) if prims else None

    def walk(node: Node) -> int:
        children: list[int] = []
        mesh = None
        name = node.xmlnode.get('name') or node.id or 'node'
        for c in node.children:
            if isinstance(c, Node):
                children.append(walk(c))
            elif isinstance(c, GeometryNode):
                m = build_geom(c, name)
                if m is not None:
                    if mesh is None:
                        mesh = m
                    else:
                        children.append(g.node(name + '_geo', None, m))
        return g.node(name, np.array(node.matrix, dtype=np.float64), mesh, children)

    roots = [walk(n) for n in col.scene.nodes if isinstance(n, Node)]
    g.write(dst, roots)


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])
    print('écrit', sys.argv[2])
