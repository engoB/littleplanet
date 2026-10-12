#!/usr/bin/env bash
# Régénère tous les assets web depuis le projet Unity d'origine.
#   bash tools/build_assets.sh [chemin_du_projet_unity]
# Sans argument, le dépôt Unity est cloné dans .cache/MaPetitePlanet.
set -euo pipefail
cd "$(dirname "$0")/.."
UNITY_REPO_URL="${UNITY_REPO_URL:-https://github.com/engoB/MaPetitePlanet.git}"
CACHE=.cache
mkdir -p "$CACHE"

if [ $# -ge 1 ]; then
  PROJECT="$1"
else
  if [ ! -d "$CACHE/MaPetitePlanet" ]; then
    git clone --depth 1 "$UNITY_REPO_URL" "$CACHE/MaPetitePlanet"
  fi
  PROJECT="$CACHE/MaPetitePlanet/Ma petite planete"
fi

FBX2GLTF="$CACHE/FBX2glTF"
if [ ! -x "$FBX2GLTF" ]; then
  curl -sSL -o "$FBX2GLTF" https://github.com/facebookincubator/FBX2glTF/releases/download/v0.9.7/FBX2glTF-linux-x64
  chmod +x "$FBX2GLTF"
fi

python3 -m pip install -q -r tools/requirements.txt
command -v ffmpeg >/dev/null || { echo "ffmpeg est requis (conversion des sons)"; exit 1; }

mkdir -p public/data
python3 tools/export_scene.py "$PROJECT" public/data/scene.json
python3 tools/convert_assets.py "$PROJECT" public "$FBX2GLTF"
echo "Assets régénérés."
