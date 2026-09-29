#!/usr/bin/env bash
# Bake every DEV OFFICE kit module with Blender (CPU by default; DEVICE=gpu if VRAM is free).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-web/public/kit}
DEVICE=${DEVICE:-cpu}
SAMPLES=${SAMPLES:-192}
SIZE=${SIZE:-4096}          # albedo / final atlas (texture sharpness up close)
LIGHT_SIZE=${LIGHT_SIZE:-1024}  # irradiance (lighting is smooth; this is what costs bake time)
MODULES=${MODULES:-"office lounge corridor core0 core1"}
mkdir -p .data/kit
for m in $MODULES; do
  echo "== baking $m"
  blender -b --factory-startup -P blender/build_kit.py -- --module "$m" --bake "$OUT" --samples "$SAMPLES" --size "$SIZE" --light-size "$LIGHT_SIZE" --device "$DEVICE" > ".data/kit/bake_$m.log" 2>&1 \
    || { echo "!! $m failed — see .data/kit/bake_$m.log"; tail -20 ".data/kit/bake_$m.log"; exit 1; }
  grep -E "exported|tris" ".data/kit/bake_$m.log"
  # meshopt-compress (decoded locally by three.js; ~5x smaller)
  npx gltf-transform meshopt "$OUT/$m.glb" "$OUT/$m.glb" --level high > /dev/null
done
rm -rf "$OUT/_tmp"
ls -la "$OUT"
