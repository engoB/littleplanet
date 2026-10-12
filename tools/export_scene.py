"""Export des scènes, prefabs et matériaux Unity vers public/data/scene.json.

Rien n'est retapé à la main : toutes les valeurs (transforms, composants,
matériaux, valeurs des MonoBehaviours, systèmes de particules, post-process)
sont lues dans les fichiers YAML du projet Unity.

Conversions appliquées ici (Unity main gauche → three.js main droite) :
  - position (x, y, z)        → (−x, y, z)
  - quaternion (x, y, z, w)   → (x, −y, −z, w)
  - échelles inchangées ; les angles d'Euler éventuels restent en convention
    Unity (ordre Z, X puis Y) et sont convertis au runtime (src/unity/math.ts).
Les couleurs restent telles que sérialisées (sRGB pour les couleurs LDR,
linéaires si une composante dépasse 1 — couleurs HDR) ; les intensités des
lumières restent brutes (le runtime applique × π).
Les Infinity / NaN sont remplacés par des valeurs finies.

Usage : python tools/export_scene.py <racine projet Unity> <sortie scene.json>
"""
from __future__ import annotations

import copy
import json
import math
import os
import re
import subprocess
import sys
from typing import Any

from unity_yaml import UDoc, guid_index, load

# ---------------------------------------------------------------------------
# Scripts Unity intégrés (GUID fixes des paquets) → nom lisible
BUILTIN_SCRIPTS = {
    'f4688fdb7df04437aeb418b961361dc5': 'TextMeshProUGUI',
    'fe87c0e1cc204ed48ad3b37840f39efc': 'Image',
    '4e29b1a8efbd4b44bb3f3716e73f07ff': 'Button',
    '67db9e8f0e2ae9c40bc1e2b64352a6b4': 'Slider',
    '0cd44c1031e13a943bb63640046fad76': 'CanvasScaler',
    'dc42784cf147c0c48a680349fa168899': 'GraphicRaycaster',
    '474bcb49853aa07438625e644c072ee6': 'UniversalAdditionalLightData',
    'a79441f348de89743a2939f4d699eac1': 'UniversalAdditionalCameraData',
    '172515602e62fb746b5d573b38a5fe58': 'Volume',
    '76c392e42b5098c458856cdf6ecaaaa1': 'EventSystem',
    '4f231c4fb786f3946a6b90b886c48677': 'StandaloneInputModule',
}
BUILTIN_MESHES = {10202: 'Cube', 10206: 'Cylinder', 10207: 'Sphere', 10208: 'Capsule', 10209: 'Plane', 10210: 'Quad'}
SKIP_KEYS = {'m_ObjectHideFlags', 'm_CorrespondingSourceObject', 'm_PrefabInstance', 'm_PrefabAsset',
             'm_GameObject', 'm_EditorHideFlags', 'm_EditorClassIdentifier', 'm_Name', 'serializedVersion'}


def finite(v: Any) -> Any:
    """Remplace Infinity / NaN par des valeurs finies (JSON strict)."""
    if isinstance(v, float):
        if math.isnan(v):
            return 0.0
        if math.isinf(v):
            return 1e30 if v > 0 else -1e30
        return v
    if isinstance(v, dict):
        return {k: finite(x) for k, x in v.items()}
    if isinstance(v, list):
        return [finite(x) for x in v]
    return v


def num(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def conv_pos(p: dict | None) -> list[float]:
    p = p or {}
    return [-num(p.get('x')), num(p.get('y')), num(p.get('z'))]


def conv_quat(q: dict | None) -> list[float]:
    q = q or {'w': 1}
    return [num(q.get('x')), -num(q.get('y')), -num(q.get('z')), num(q.get('w'), 1.0)]


def vec(p: dict | None, keys='xyz') -> list[float]:
    p = p or {}
    return [num(p.get(k)) for k in keys]


def color(c: dict | None) -> list[float]:
    c = c or {}
    return [num(c.get('r')), num(c.get('g')), num(c.get('b')), num(c.get('a'), 1.0)]


# ---------------------------------------------------------------------------
# Courbes et dégradés Unity (AnimationCurve, MinMaxCurve, MinMaxGradient)
def curve(c: dict | None) -> list[list[float]]:
    """AnimationCurve → [[temps, valeur, pente entrée, pente sortie], …]."""
    if not c:
        return []
    return [[num(k.get('time')), num(k.get('value')), num(k.get('inSlope')), num(k.get('outSlope'))]
            for k in c.get('m_Curve', [])]


def minmax_curve(c: dict | None) -> dict:
    if not isinstance(c, dict):
        return {'mode': 0, 'scalar': num(c)}
    return {'mode': int(c.get('minMaxState', 0)), 'scalar': num(c.get('scalar')), 'minScalar': num(c.get('minScalar')),
            'max': curve(c.get('maxCurve')), 'min': curve(c.get('minCurve'))}


def gradient(g: dict | None) -> dict:
    g = g or {}
    nc, na = int(g.get('m_NumColorKeys', 2)), int(g.get('m_NumAlphaKeys', 2))
    ck = [[num(g.get(f'ctime{i}')) / 65535.0] + color(g.get(f'key{i}'))[:3] for i in range(nc)]
    ak = [[num(g.get(f'atime{i}')) / 65535.0, color(g.get(f'key{i}'))[3]] for i in range(na)]
    return {'colors': ck, 'alphas': ak, 'fixed': int(g.get('m_Mode', 0)) == 1}


def minmax_gradient(g: dict | None) -> dict:
    g = g or {}
    return {'mode': int(g.get('minMaxState', 0)), 'minColor': color(g.get('minColor')), 'maxColor': color(g.get('maxColor')),
            'max': gradient(g.get('maxGradient')), 'min': gradient(g.get('minGradient'))}


# ---------------------------------------------------------------------------
class Exporter:
    def __init__(self, project: str) -> None:
        self.project = project
        self.assets = os.path.join(project, 'Assets')
        self.guids = guid_index(self.assets)
        self.materials: dict[str, dict] = {}
        self.models: dict[str, dict] = {}
        self.audio: set[str] = set()
        self.textures: set[str] = set()
        self.prefabs: dict[str, dict] = {}
        self.prefab_queue: list[str] = []
        self.ext_cache: dict[str, dict[int, UDoc]] = {}

    # -- utilitaires de références --------------------------------------
    def asset_path(self, ref: dict | None) -> str | None:
        if not isinstance(ref, dict) or not ref.get('guid'):
            return None
        return self.guids.get(ref['guid'])

    def stem(self, path: str) -> str:
        return os.path.splitext(os.path.basename(path))[0]

    def script_name(self, ref: dict) -> str:
        g = (ref or {}).get('guid', '')
        if g in BUILTIN_SCRIPTS:
            return BUILTIN_SCRIPTS[g]
        p = self.guids.get(g)
        if p and p.endswith('.cs'):
            # Le nom de la classe C# (pas celui du fichier) fait foi.
            src = open(os.path.join(self.assets, p), encoding='utf-8', errors='ignore').read()
            m = re.search(r'class\s+(\w+)\s*:\s*MonoBehaviour', src) or re.search(r'class\s+(\w+)\s*:\s*\w+', src)
            return m.group(1) if m else self.stem(p)
        return f'script:{g}'

    def ref_value(self, v: Any, docs: dict[int, UDoc]) -> Any:
        """Résout une référence d'objet pour les champs de MonoBehaviour."""
        if isinstance(v, dict) and set(v) >= {'fileID'} and len(v) <= 3:
            fid = int(v.get('fileID') or 0)
            if fid == 0:
                return None
            path = self.asset_path(v)
            if path:
                return self.asset_ref(path)
            d = docs.get(fid)
            if d is None:
                return {'ref': fid}
            go = self.owner_name(d, docs)
            return {'ref': fid, 'type': d.type, 'gameObject': go}
        if isinstance(v, list):
            return [self.ref_value(x, docs) for x in v]
        if isinstance(v, dict):
            return {k: self.ref_value(x, docs) for k, x in v.items()}
        return v

    def asset_ref(self, path: str) -> dict:
        ext = os.path.splitext(path)[1].lower()
        if ext == '.prefab':
            name = self.stem(path)
            if path not in self.prefab_queue:
                self.prefab_queue.append(path)
            return {'prefab': name}
        if ext in ('.wav', '.mp3', '.ogg'):
            self.audio.add(path)
            return {'audio': self.stem(path)}
        if ext == '.mat':
            return {'material': self.material(path)}
        if ext in ('.fbx', '.dae', '.obj'):
            return {'model': self.model(path)}
        if ext in ('.png', '.jpg', '.psd', '.tga'):
            self.textures.add(path)
            return {'texture': self.stem(path)}
        return {'asset': path}

    def owner_name(self, d: UDoc, docs: dict[int, UDoc]) -> str | None:
        if d.type == 'GameObject':
            return d.data.get('m_Name')
        go = docs.get(int((d.data.get('m_GameObject') or {}).get('fileID') or 0))
        return go.data.get('m_Name') if go else None

    # -- matériaux --------------------------------------------------------
    def material(self, path: str) -> str:
        name = self.stem(path)
        if name in self.materials:
            return name
        docs = load(os.path.join(self.assets, path))
        m = next((d for d in docs.values() if d.type == 'Material'), None)
        if m is None:
            return name
        props = m.data.get('m_SavedProperties', {})
        tex = {}
        for k, v in pairs(props.get('m_TexEnvs')):
            if True:
                p = self.asset_path(v.get('m_Texture'))
                if p:
                    self.textures.add(p)
                    tex[k] = {'texture': self.stem(p), 'scale': vec(v.get('m_Scale'), 'xy'), 'offset': vec(v.get('m_Offset'), 'xy')}
        floats = {k: num(v) for k, v in pairs(props.get('m_Floats'))}
        colors = {k: color(v) for k, v in pairs(props.get('m_Colors'))}
        shader_ref = m.data.get('m_Shader') or {}
        shader = self.asset_path(shader_ref) or ('URP/Lit' if shader_ref.get('guid') == '933532a4fcc9baf4fa0491de14d08ed7' else
                                                 f"builtin:{shader_ref.get('fileID')}")
        self.materials[name] = {
            'shader': shader, 'keywords': m.data.get('m_ValidKeywords') or (m.data.get('m_ShaderKeywords') or '').split(),
            'renderQueue': int(m.data.get('m_CustomRenderQueue', -1)), 'textures': tex, 'floats': floats, 'colors': colors,
        }
        return name

    def model(self, path: str) -> str:
        name = self.stem(path)
        if name in self.models:
            return name
        meta = open(os.path.join(self.assets, path + '.meta'), encoding='utf-8').read()
        gs = re.search(r'meshes:.*?globalScale: ([\d.eE+-]+)', meta, re.S)
        global_scale = float(gs.group(1)) if gs else 1.0
        self.models[name] = {'source': path, 'file': f'models/{name}.glb', 'globalScale': global_scale,
                             'materials': self.model_materials(path, meta)}
        return name

    def model_materials(self, path: str, meta: str) -> dict[str, str | None]:
        """Matériaux d'un modèle importé, résolus comme l'importeur Unity
        (materialSearch : recherche par nom dans les dossiers « Materials »
        en remontant, sous-dossiers compris). Nom du modèle → matériau du
        projet (exporté) ou None (Unity crée alors un matériau depuis le modèle)."""
        names: list[str] = []
        full = os.path.join(self.assets, path)
        if path.lower().endswith('.dae'):
            names = re.findall(r'<material id="[^"]*" name="([^"]+)"', open(full, encoding='utf-8', errors='ignore').read())
        m = re.search(r'materialSearch: (\d+)', meta)
        search = int(m.group(1)) if m else 1
        index: dict[str, str] = {}
        if search:
            d = os.path.dirname(path)
            while True:
                mat_dir = os.path.join(self.assets, d, 'Materials')
                if os.path.isdir(mat_dir):
                    for dp, _dn, fn in os.walk(mat_dir):
                        for f in fn:
                            if f.endswith('.mat'):
                                index.setdefault(f[:-4], os.path.relpath(os.path.join(dp, f), self.assets).replace(os.sep, '/'))
                if not d:
                    break
                d = os.path.dirname(d)
        return {n: (self.material(index[n]) if n in index else None) for n in names}

    # -- composants -------------------------------------------------------
    def component(self, d: UDoc, docs: dict[int, UDoc]) -> dict | None:
        t, x = d.type, d.data
        if t in ('Transform', 'RectTransform'):
            return None
        out: dict[str, Any] = {'type': t, 'id': d.file_id}
        if 'm_Enabled' in x:
            out['enabled'] = bool(x.get('m_Enabled'))
        if t == 'Light':
            out.update(lightType=['spot', 'directional', 'point', 'area'][int(x.get('m_Type', 2))], color=color(x.get('m_Color')),
                       intensity=num(x.get('m_Intensity')), range=num(x.get('m_Range')), spotAngle=num(x.get('m_SpotAngle')),
                       shadows=int((x.get('m_Shadows') or {}).get('m_Type', 0)))
        elif t == 'Camera':
            out.update(fov=num(x.get('field of view')), near=num(x.get('near clip plane')), far=num(x.get('far clip plane')),
                       orthographic=bool(x.get('orthographic')), orthoSize=num(x.get('orthographic size')),
                       clearFlags=int(x.get('m_ClearFlags', 1)), background=color(x.get('m_BackGroundColor')),
                       fovAxis=int(x.get('m_FOVAxisMode', 0)))
        elif t == 'MeshFilter':
            mesh = x.get('m_Mesh') or {}
            p = self.asset_path(mesh)
            if p:
                out['model'] = self.model(p)
                out['meshFileID'] = mesh.get('fileID')
            else:
                out['builtin'] = BUILTIN_MESHES.get(int(mesh.get('fileID') or 0), 'unknown')
        elif t in ('MeshRenderer', 'ParticleSystemRenderer', 'SkinnedMeshRenderer'):
            mats = []
            for r in x.get('m_Materials') or []:
                p = self.asset_path(r)
                if p and p.endswith('.mat'):
                    mats.append(self.material(p))
                elif p:
                    mats.append(f'embedded:{self.stem(p)}')
                else:
                    mats.append(None if not r.get('fileID') else f"missing:{r.get('guid', '')}")
            out.update(materials=mats, castShadows=bool(x.get('m_CastShadows', 1)), receiveShadows=bool(x.get('m_ReceiveShadows', 1)))
            if t == 'ParticleSystemRenderer':
                out.update(renderMode=int(x.get('m_RenderMode', 0)), velocityScale=num(x.get('m_VelocityScale')),
                           lengthScale=num(x.get('m_LengthScale')), maxParticleSize=num(x.get('m_MaxParticleSize'), 0.5),
                           minParticleSize=num(x.get('m_MinParticleSize')), sortingFudge=num(x.get('m_SortingFudge')),
                           alignment=int(x.get('m_RenderAlignment', 0)))
        elif t == 'SphereCollider':
            out.update(radius=num(x.get('m_Radius')), center=conv_pos(x.get('m_Center')), isTrigger=bool(x.get('m_IsTrigger')))
        elif t == 'BoxCollider':
            out.update(size=vec(x.get('m_Size')), center=conv_pos(x.get('m_Center')), isTrigger=bool(x.get('m_IsTrigger')))
        elif t == 'MeshCollider':
            out.update(isTrigger=bool(x.get('m_IsTrigger')), convex=bool(x.get('m_Convex')))
        elif t == 'Rigidbody':
            out.update(mass=num(x.get('m_Mass'), 1), useGravity=bool(x.get('m_UseGravity')), isKinematic=bool(x.get('m_IsKinematic')))
        elif t == 'AudioSource':
            clip = self.asset_path(x.get('m_audioClip'))
            if clip:
                self.audio.add(clip)
            out.update(clip=self.stem(clip) if clip else None, volume=num(x.get('m_Volume'), 1), pitch=num(x.get('m_Pitch'), 1),
                       loop=bool(x.get('Loop')), playOnAwake=bool(x.get('m_PlayOnAwake')))
        elif t == 'ParticleSystem':
            out['particle'] = self.particle(x)
        elif t == 'Canvas':
            out.update(renderMode=int(x.get('m_RenderMode', 0)))
        elif t == 'MonoBehaviour':
            script = self.script_name(x.get('m_Script'))
            out['type'] = script
            fields = {k: v for k, v in x.items() if k not in SKIP_KEYS and k not in ('m_Script', 'm_Enabled')}
            if script == 'TextMeshProUGUI':
                fa = self.asset_path(x.get('m_fontAsset'))
                sm = self.asset_path(x.get('m_sharedMaterial'))
                out.update(text=x.get('m_text'), fontSize=num(x.get('m_fontSize')), fontSizeMin=num(x.get('m_fontSizeMin')),
                           fontSizeMax=num(x.get('m_fontSizeMax')), autoSize=bool(x.get('m_enableAutoSizing')),
                           color=color(x.get('m_fontColor')), fontStyle=int(x.get('m_fontStyle', 0)),
                           font=self.stem(fa) if fa else None, fontMaterial=self.stem(sm) if sm else None,
                           hAlign=int(x.get('m_HorizontalAlignment', 1)), vAlign=int(x.get('m_VerticalAlignment', 256)))
            elif script == 'Image':
                sp = x.get('m_Sprite') or {}
                out.update(color=color(x.get('m_Color')), sprite=self.asset_path(sp) or f"builtin:{sp.get('fileID')}")
            elif script == 'Slider':
                out.update(min=num(x.get('m_MinValue')), max=num(x.get('m_MaxValue'), 1), value=num(x.get('m_Value')),
                           wholeNumbers=bool(x.get('m_WholeNumbers')), direction=int(x.get('m_Direction', 0)))
            elif script == 'Button':
                calls = ((x.get('m_OnClick') or {}).get('m_PersistentCalls') or {}).get('m_Calls') or []
                out['onClick'] = [{'target': int((c.get('m_Target') or {}).get('fileID') or 0),
                                   'type': (c.get('m_TargetAssemblyTypeName') or '').split(',')[0],
                                   'method': c.get('m_MethodName')} for c in calls]
            elif script == 'CanvasScaler':
                out.update(uiScaleMode=int(x.get('m_UiScaleMode', 0)), referenceResolution=vec(x.get('m_ReferenceResolution'), 'xy'),
                           match=num(x.get('m_MatchWidthOrHeight')))
            elif script == 'Volume':
                p = self.asset_path(x.get('sharedProfile'))
                out.update(profile=self.volume_profile(p) if p else None, weight=num(x.get('weight'), 1))
            elif script == 'CFXR_Effect':
                cs = x.get('cameraShake') or {}
                out['cameraShake'] = {'enabled': bool(cs.get('enabled')), 'delay': num(cs.get('delay')), 'duration': num(cs.get('duration'), 1),
                                      'space': int(cs.get('shakeSpace', 0)), 'strength': vec(cs.get('shakeStrength')),
                                      'curve': curve(cs.get('shakeCurve')), 'shakesDelay': num(cs.get('shakesDelay'))}
                out['animatedLights'] = [{'light': int((l.get('light') or {}).get('fileID') or 0), 'loop': bool(l.get('loop')),
                                          'animateIntensity': bool(l.get('animateIntensity')), 'intensityStart': num(l.get('intensityStart')),
                                          'intensityEnd': num(l.get('intensityEnd')), 'intensityDuration': num(l.get('intensityDuration'), 1),
                                          'intensityCurve': curve(l.get('intensityCurve')), 'perlinIntensity': bool(l.get('perlinIntensity')),
                                          'fadeIn': bool(l.get('fadeIn')), 'fadeInDuration': num(l.get('fadeInDuration')),
                                          'fadeOut': bool(l.get('fadeOut')), 'fadeOutDuration': num(l.get('fadeOutDuration'))}
                                         for l in (x.get('animatedLights') or [])]
                out['clearBehavior'] = int(x.get('clearBehavior', 0))
            elif not script.startswith('Universal') and script not in BUILTIN_SCRIPTS.values():
                out['fields'] = self.ref_value(fields, docs)
            if script.startswith('script:'):
                out['fields'] = self.ref_value(fields, docs)
        else:
            return {'type': t, 'id': d.file_id}
        return out

    def particle(self, x: dict) -> dict:
        im = x.get('InitialModule') or {}
        sh = x.get('ShapeModule') or {}
        em = x.get('EmissionModule') or {}
        col = x.get('ColorModule') or {}
        sz = x.get('SizeModule') or {}
        rot = x.get('RotationModule') or {}
        uv = x.get('UVModule') or {}
        vel = x.get('VelocityModule') or {}
        lim = x.get('ClampVelocityModule') or {}
        frc = x.get('ForceModule') or {}
        noise = x.get('NoiseModule') or {}
        bursts = [{'time': num(b.get('time')), 'count': minmax_curve(b.get('countCurve')), 'cycles': int(b.get('cycleCount', 1)),
                   'interval': num(b.get('repeatInterval'), 0.01), 'probability': num(b.get('probability'), 1)}
                  for b in em.get('m_Bursts') or []]
        return {
            'duration': num(x.get('lengthInSec'), 5), 'looping': bool(x.get('looping')), 'prewarm': bool(x.get('prewarm')),
            'playOnAwake': bool(x.get('playOnAwake', 1)), 'simulationSpeed': num(x.get('simulationSpeed'), 1),
            'startDelay': minmax_curve(x.get('startDelay')), 'worldSpace': int(x.get('moveWithTransform', 0)) == 1,
            'scalingMode': int(x.get('scalingMode', 1)), 'stopAction': int(x.get('stopAction', 0)),
            'main': {'lifetime': minmax_curve(im.get('startLifetime')), 'speed': minmax_curve(im.get('startSpeed')),
                     'size': minmax_curve(im.get('startSize')), 'size3D': bool(im.get('size3D')), 'sizeY': minmax_curve(im.get('startSizeY')),
                     'rotation': minmax_curve(im.get('startRotation')), 'color': minmax_gradient(im.get('startColor')),
                     'gravity': minmax_curve(im.get('gravityModifier')), 'maxParticles': int(im.get('maxNumParticles', 1000)),
                     'randomizeRotationDirection': num(im.get('randomizeRotationDirection'))},
            'shape': {'enabled': bool(sh.get('enabled')), 'type': int(sh.get('type', 4)), 'radius': num((sh.get('radius') or {}).get('value'), 1),
                      'radiusThickness': num(sh.get('radiusThickness'), 1), 'angle': num(sh.get('angle')), 'length': num(sh.get('length')),
                      'arc': num((sh.get('arc') or {}).get('value'), 360), 'position': conv_pos(sh.get('m_Position')),
                      'rotation': vec(sh.get('m_Rotation')), 'scale': vec(sh.get('m_Scale')) if sh.get('m_Scale') else [1, 1, 1],
                      'boxThickness': vec(sh.get('boxThickness')), 'randomDirection': num(sh.get('randomDirectionAmount')),
                      'sphericalDirection': num(sh.get('sphericalDirectionAmount')), 'alignToDirection': bool(sh.get('alignToDirection'))},
            'emission': {'enabled': bool(em.get('enabled', 1)), 'rate': minmax_curve(em.get('rateOverTime')),
                         'rateOverDistance': minmax_curve(em.get('rateOverDistance')), 'bursts': bursts},
            'colorOverLifetime': {'enabled': bool(col.get('enabled')), 'gradient': minmax_gradient(col.get('gradient'))},
            'sizeOverLifetime': {'enabled': bool(sz.get('enabled')), 'curve': minmax_curve(sz.get('curve'))},
            'rotationOverLifetime': {'enabled': bool(rot.get('enabled')), 'curve': minmax_curve(rot.get('curve'))},
            'textureSheet': {'enabled': bool(uv.get('enabled')), 'tilesX': int(uv.get('tilesX', 1)), 'tilesY': int(uv.get('tilesY', 1)),
                             'frameOverTime': minmax_curve(uv.get('frameOverTime')), 'startFrame': minmax_curve(uv.get('startFrame')),
                             'cycles': num(uv.get('cycles'), 1), 'animationType': int(uv.get('animationType', 0))},
            'velocityOverLifetime': {'enabled': bool(vel.get('enabled')), 'x': minmax_curve(vel.get('x')), 'y': minmax_curve(vel.get('y')),
                                     'z': minmax_curve(vel.get('z')), 'radial': minmax_curve(vel.get('radial')),
                                     'speedModifier': minmax_curve(vel.get('speedModifier')), 'worldSpace': bool(vel.get('inWorldSpace'))},
            'limitVelocity': {'enabled': bool(lim.get('enabled')), 'limit': minmax_curve(lim.get('magnitude')), 'dampen': num(lim.get('dampen')),
                              'drag': minmax_curve(lim.get('drag'))},
            'force': {'enabled': bool(frc.get('enabled')), 'x': minmax_curve(frc.get('x')), 'y': minmax_curve(frc.get('y')),
                      'z': minmax_curve(frc.get('z')), 'worldSpace': bool(frc.get('inWorldSpace'))},
            'noise': {'enabled': bool(noise.get('enabled')), 'strength': minmax_curve(noise.get('strength')),
                      'frequency': num(noise.get('frequency'), 0.5), 'scrollSpeed': minmax_curve(noise.get('scrollSpeed'))},
        }

    def volume_profile(self, path: str) -> dict:
        docs = load(os.path.join(self.assets, path))
        out: dict[str, Any] = {}
        for d in docs.values():
            if d.type != 'MonoBehaviour' or 'active' not in d.data:
                continue
            comp: dict[str, Any] = {'active': bool(d.data.get('active'))}
            for k, v in d.data.items():
                if isinstance(v, dict) and 'm_OverrideState' in v:
                    val = v.get('m_Value')
                    if isinstance(val, dict) and 'r' in val:
                        val = color(val)
                    elif isinstance(val, dict) and 'x' in val:
                        val = [num(val.get(a)) for a in 'xyzw' if a in val]
                    comp[k] = {'override': bool(v.get('m_OverrideState')), 'value': val}
            out[d.data.get('m_Name')] = comp
        return {'name': self.stem(path), 'components': out}

    # -- arbres de GameObjects ------------------------------------------
    def build_tree(self, docs: dict[int, UDoc], root_tr: int, extra: dict | None = None) -> dict:
        tr = docs[root_tr]
        go_id = int(tr.data['m_GameObject']['fileID'])
        go = docs[go_id].data
        node: dict[str, Any] = {
            'name': go.get('m_Name'), 'id': go_id, 'tag': go.get('m_TagString'), 'layer': int(go.get('m_Layer', 0)),
            'active': bool(go.get('m_IsActive', 1)),
            'position': conv_pos(tr.data.get('m_LocalPosition')), 'rotation': conv_quat(tr.data.get('m_LocalRotation')),
            'scale': vec(tr.data.get('m_LocalScale')), 'components': [], 'children': [],
        }
        if tr.type == 'RectTransform':
            node['rect'] = {'anchorMin': vec(tr.data.get('m_AnchorMin'), 'xy'), 'anchorMax': vec(tr.data.get('m_AnchorMax'), 'xy'),
                            'anchoredPosition': vec(tr.data.get('m_AnchoredPosition'), 'xy'), 'sizeDelta': vec(tr.data.get('m_SizeDelta'), 'xy'),
                            'pivot': vec(tr.data.get('m_Pivot'), 'xy')}
        for c in go.get('m_Component', []):
            cd = docs.get(int(c['component']['fileID']))
            if cd is not None:
                comp = self.component(cd, docs)
                if comp:
                    node['components'].append(comp)
        for ch in tr.data.get('m_Children', []) or []:
            cid = int(ch['fileID'])
            sub = self.child_node(docs, cid)
            if sub:
                node['children'].append(sub)
        return node

    def child_node(self, docs: dict[int, UDoc], tr_id: int) -> dict | None:
        d = docs.get(tr_id)
        if d is None:
            return None
        if not d.stripped:
            return self.build_tree(docs, tr_id)
        # Transform « stripped » : racine d'une instance de prefab imbriquée
        inst = int((d.data.get('m_PrefabInstance') or {}).get('fileID') or 0)
        return self.prefab_instance(docs, inst)

    def prefab_instance(self, docs: dict[int, UDoc], inst_id: int) -> dict | None:
        inst = docs[inst_id].data
        mod = inst.get('m_Modification') or {}
        src = self.asset_path(inst.get('m_SourcePrefab'))
        if not src:
            return None
        mods = mod.get('m_Modifications') or []
        by_prop: dict[str, Any] = {}
        for m in mods:
            val = m.get('value')
            ref = m.get('objectReference') or {}
            if ref.get('fileID'):
                val = self.ref_value(ref, docs)
            by_prop.setdefault(m.get('propertyPath'), val)
        ext = os.path.splitext(src)[1].lower()
        if ext in ('.fbx', '.dae', '.obj'):
            # Instance d'un modèle importé : la racine porte les surcharges.
            def g(k: str, d: float) -> float:
                return num(by_prop.get(k), d)
            node: dict[str, Any] = {
                'name': by_prop.get('m_Name') or self.stem(src), 'id': inst_id, 'tag': by_prop.get('m_TagString', 'Untagged'),
                'layer': int(num(by_prop.get('m_Layer'), 0)), 'active': bool(int(num(by_prop.get('m_IsActive'), 1))),
                'position': conv_pos({'x': g('m_LocalPosition.x', 0), 'y': g('m_LocalPosition.y', 0), 'z': g('m_LocalPosition.z', 0)}),
                'rotation': conv_quat({'x': g('m_LocalRotation.x', 0), 'y': g('m_LocalRotation.y', 0), 'z': g('m_LocalRotation.z', 0),
                                       'w': g('m_LocalRotation.w', 1)}),
                'scale': [g('m_LocalScale.x', 1), g('m_LocalScale.y', 1), g('m_LocalScale.z', 1)],
                'model': self.model(src), 'components': [], 'children': [],
            }
            mats = [v.get('material') for k, v in by_prop.items() if k.startswith('m_Materials.Array.data') and isinstance(v, dict)]
            if mats:
                node['materialOverride'] = mats
            if 'm_CastShadows' in by_prop:
                node['castShadows'] = bool(int(num(by_prop['m_CastShadows'], 1)))
            # Composants et GameObjects ajoutés dans la scène sur l'instance
            for a in mod.get('m_AddedComponents') or []:
                cd = docs.get(int(a['addedObject']['fileID']))
                if cd is not None:
                    comp = self.component(cd, docs)
                    if comp:
                        node['components'].append(comp)
            for a in mod.get('m_AddedGameObjects') or []:
                sub = self.child_node(docs, int(a['addedObject']['fileID']))
                if sub:
                    node['children'].append(sub)
            return node
        # Instance d'un prefab YAML : on résout le prefab puis on applique les surcharges
        pdocs = copy.deepcopy(self.load_ext(src))
        for m in mods:
            tid = int((m.get('target') or {}).get('fileID') or 0)
            if tid in pdocs:
                ref = m.get('objectReference') or {}
                val: Any = m.get('value')
                if ref.get('fileID'):
                    val = ref
                set_path(pdocs[tid].data, m.get('propertyPath', ''), val)
        root = next(i for i, d in pdocs.items() if d.type in ('Transform', 'RectTransform') and not int((d.data.get('m_Father') or {}).get('fileID') or 0))
        node = self.build_tree(pdocs, root)
        node['id'] = inst_id
        node['prefab'] = self.stem(src)
        return node

    def load_ext(self, path: str) -> dict[int, UDoc]:
        if path not in self.ext_cache:
            self.ext_cache[path] = load(os.path.join(self.assets, path))
        return self.ext_cache[path]

    def scene(self, path: str) -> dict:
        docs = load(os.path.join(self.assets, path))
        roots = []
        settings: dict[str, Any] = {}
        for fid, d in docs.items():
            if d.type == 'RenderSettings':
                x = d.data
                sky = self.asset_path(x.get('m_SkyboxMaterial'))
                settings = {'ambientMode': int(x.get('m_AmbientMode', 0)), 'ambientSky': color(x.get('m_AmbientSkyColor')),
                            'ambientEquator': color(x.get('m_AmbientEquatorColor')), 'ambientGround': color(x.get('m_AmbientGroundColor')),
                            'ambientIntensity': num(x.get('m_AmbientIntensity'), 1), 'fog': bool(x.get('m_Fog')),
                            'fogColor': color(x.get('m_FogColor')), 'fogDensity': num(x.get('m_FogDensity')),
                            'skybox': self.material(sky) if sky else None, 'sun': int((x.get('m_Sun') or {}).get('fileID') or 0)}
            if d.type in ('Transform', 'RectTransform') and not d.stripped and not int((d.data.get('m_Father') or {}).get('fileID') or 0):
                roots.append((int(d.data.get('m_RootOrder', 0)), self.build_tree(docs, fid)))
            if d.type == 'PrefabInstance':
                parent = int(((d.data.get('m_Modification') or {}).get('m_TransformParent') or {}).get('fileID') or 0)
                if parent == 0:
                    n = self.prefab_instance(docs, fid)
                    if n:
                        roots.append((0, n))
        order = next((d.data.get('m_Roots') for d in docs.values() if d.type == 'SceneRoots'), None)
        return {'renderSettings': settings, 'roots': [r for _, r in roots]}

    def prefab(self, path: str) -> dict:
        docs = self.load_ext(path)
        root = next(i for i, d in docs.items() if d.type in ('Transform', 'RectTransform') and not int((d.data.get('m_Father') or {}).get('fileID') or 0))
        return self.build_tree(docs, root)


def pairs(entries: Any) -> list[tuple[str, Any]]:
    """Propriétés de matériau : format récent ([{nom: valeur}]) ou ancien
    ([{first: {name: nom}, second: valeur}] / dict)."""
    out: list[tuple[str, Any]] = []
    if isinstance(entries, dict):
        return list(entries.items())
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        if 'first' in e:
            out.append(((e['first'] or {}).get('name'), e.get('second')))
        else:
            out.extend(e.items())
    return out


def set_path(obj: Any, path: str, value: Any) -> None:
    """Applique une surcharge de prefab « a.b.Array.data[2].c » sur un dict."""
    parts = re.findall(r'[^.\[\]]+|\[\d+\]', path.replace('.Array.data', ''))
    cur = obj
    for i, p in enumerate(parts):
        last = i == len(parts) - 1
        if p.startswith('['):
            idx = int(p[1:-1])
            if not isinstance(cur, list):
                return
            while len(cur) <= idx:
                cur.append({})
            if last:
                cur[idx] = value
            else:
                cur = cur[idx]
        else:
            if p == 'Array' or p == 'size':
                return
            if not isinstance(cur, dict):
                return
            if last:
                old = cur.get(p)
                if isinstance(old, (int, float)) and not isinstance(value, dict):
                    value = num(value, old)
                cur[p] = value
            else:
                if p not in cur or cur[p] is None:
                    cur[p] = {}
                cur = cur[p]


def git_commit(path: str) -> str | None:
    try:
        return subprocess.check_output(['git', '-C', path, 'rev-parse', 'HEAD'], text=True).strip()
    except Exception:  # noqa: BLE001
        return None


def main() -> None:
    project, out = sys.argv[1], sys.argv[2]
    ex = Exporter(project)
    scenes = {
        'SampleScene': ex.scene('Scenes/SampleScene.unity'),
        'Menu': ex.scene('Scenes/Menu.unity'),
    }
    # Prefabs référencés par les scripts (file d'attente remplie pendant l'export)
    i = 0
    while i < len(ex.prefab_queue):
        p = ex.prefab_queue[i]
        ex.prefabs[ex.stem(p)] = ex.prefab(p)
        i += 1
    version = open(os.path.join(project, 'ProjectSettings', 'ProjectVersion.txt')).read().split()[1]
    ps = open(os.path.join(project, 'ProjectSettings', 'ProjectSettings.asset'), encoding='utf-8').read()
    data = {
        'meta': {'generator': 'tools/export_scene.py', 'unityVersion': version, 'sourceCommit': git_commit(project),
                 'colorSpace': 'linear' if re.search(r'm_ActiveColorSpace: 1', ps) else 'gamma',
                 'defaultOrientation': int(re.search(r'defaultScreenOrientation: (\d+)', ps).group(1)),
                 'productName': re.search(r'productName: (.*)', ps).group(1).strip()},
        'tags': re.findall(r'^  - (\S.*)$', open(os.path.join(project, 'ProjectSettings', 'TagManager.asset')).read().split('layers:')[0], re.M),
        'layers': [l.strip() for l in re.findall(r'^  - ?(.*)$', open(os.path.join(project, 'ProjectSettings', 'TagManager.asset')).read().split('layers:')[1].split('m_SortingLayers')[0], re.M)],
        'scenes': scenes, 'prefabs': ex.prefabs, 'materials': ex.materials, 'models': ex.models,
        'audio': {ex.stem(p): {'source': p, 'file': f'audio/{ex.stem(p)}.mp3'} for p in sorted(ex.audio)},
        'textures': sorted(ex.textures),
    }
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(finite(data), fh, ensure_ascii=False, indent=1, allow_nan=False)
    print(f'scene.json : {len(ex.prefabs)} prefabs, {len(ex.materials)} matériaux, {len(ex.models)} modèles, {len(ex.audio)} sons')


if __name__ == '__main__':
    main()
