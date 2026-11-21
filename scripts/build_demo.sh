#!/usr/bin/env bash
# 模板(src/demo.template.html)+ 处理数据(data/processed/*.json)
#   → 单文件演示页 dist/index.html(__DATA__ / __LAND__ / __GRID__ / __LR04__ 注入点被替换)
# 注意:awk gsub 的替换串里 & 和 \ 是特殊字符,因此所有数据 JSON 不得含有这两个字符。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
export LC_ALL=C

printf '{"human":%s,"ice":%s,"co2":%s}' \
  "$(cat data/processed/zonann.json)" \
  "$(cat data/processed/epica_temp.json)" \
  "$(cat data/processed/co2_composite.json)" > dist/data.json

# 大体积数据 gzip → base64(浏览器端 DecompressionStream 解压)
gzip -9n -c data/processed/gistemp_grid3_spatial.bin | base64 -w0 > dist/gspatial_gz.b64
gzip -9n -c data/processed/gistemp_grid3_meta.json | base64 -w0 > dist/gmeta_gz.b64
gzip -9n -c data/processed/paleoclim_snapshots.json | base64 -w0 > dist/snap_gz.b64
gzip -9n -c data/processed/paleocean_spatial.bin | base64 -w0 > dist/ocean_gz.b64
gzip -9n -c data/processed/land_50m.json | base64 -w0 > dist/land_gz.b64

awk 'FNR == 1 { f++ }
     f == 1 { d = d $0; next }
     f == 2 { l = l $0; next }
     f == 3 { g = g $0; next }
     f == 4 { gm = gm $0; next }
     f == 5 { r = r $0; next }
     f == 6 { z = z $0; next }
     f == 7 { s = s $0; next }
     f == 8 { q = q $0; next }
     f == 9 { o = o $0; next }
     f == 10 { om = om $0; next }
     f == 11 { w = w $0; next }
     { gsub(/__DATA__/, d); gsub(/__LAND_GZ__/, l); gsub(/__GRIDSPATIAL_GZ__/, g); gsub(/__GRIDMETA_GZ__/, gm); gsub(/__LR04__/, r); gsub(/__ZACHOS__/, z); gsub(/__SNAP_GZ__/, s); gsub(/__PALEOGEO__/, q); gsub(/__OCEANSPATIAL_GZ__/, o); gsub(/__OCEANMETA__/, om); gsub(/__SITES__/, w); print }' \
    dist/data.json dist/land_gz.b64 dist/gspatial_gz.b64 dist/gmeta_gz.b64 data/processed/lr04.json data/processed/zachos.json dist/snap_gz.b64 data/processed/paleogeo.json dist/ocean_gz.b64 data/processed/paleocean_meta.json data/processed/drill_sites.json src/demo.template.html > dist/index.html
rm dist/data.json dist/gspatial_gz.b64 dist/gmeta_gz.b64 dist/snap_gz.b64 dist/land_gz.b64 dist/ocean_gz.b64

node scripts/minify_build.js dist/index.html
echo "dist/index.html: $(wc -c < dist/index.html) bytes"

# GitHub Pages 发布副本(main 分支 /docs 目录)
mkdir -p docs
cp dist/index.html docs/index.html
