#!/usr/bin/env bash
# 原始数据(data/raw)→ 紧凑 JSON(data/processed)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/processed
export LC_ALL=C

# --- 人类史:NASA GISTEMP v4 纬度带年均温距平(列 8–15 = 自北向南 8 个纬度带)---
awk -F, '
BEGIN{
  id[1]="a90n"; la[1]=90;  lb[1]=64;
  id[2]="a64n"; la[2]=64;  lb[2]=44;
  id[3]="a44n"; la[3]=44;  lb[3]=24;
  id[4]="a24n"; la[4]=24;  lb[4]=0;
  id[5]="a24s"; la[5]=0;   lb[5]=-24;
  id[6]="a44s"; la[6]=-24; lb[6]=-44;
  id[7]="a64s"; la[7]=-44; lb[7]=-64;
  id[8]="a90s"; la[8]=-64; lb[8]=-90;
}
NR>1 && NF>=15 && $1+0>=1880 {
  ys = ys (ys?",":"") $1+0
  gs = gs (gs?",":"") sprintf("%.2f", $2+0)
  for(i=1;i<=8;i++) v[i] = v[i] (v[i]?",":"") sprintf("%.1f", $(7+i)+0)
}
END{
  printf "{\"source\":\"NASA GISTEMP v4 ZonAnn (baseline 1951-1980)\",\"unit\":\"degC\","
  printf "\"years\":[%s],\"glob\":[%s],\"bands\":[", ys, gs
  for(i=1;i<=8;i++) printf "%s{\"id\":\"%s\",\"lat\":[%d,%d],\"values\":[%s]}", (i>1?",":""), id[i], la[i], lb[i], v[i]
  printf "]}"
}' data/raw/gistemp_zonann.csv > data/processed/zonann.json

# --- 地质史:EPICA Dome C 冰芯温度重建(列:Bag ztop Age(yr BP) dD ΔT(°C vs 距今))---
awk '$1 ~ /^-?[0-9.]+$/ && NF>=5 { printf "%.2f\t%.2f\n", $3/1000, $5 }' \
    data/raw/epica_edc3_temp2007.txt | sort -n -k1,1 | \
awk 'NR % 12 == 1 {
  a = a (a?",":"") sprintf("%.2f", $1)
  t = t (t?",":"") sprintf("%.2f", $2)
} END { printf "{\"age_kyr\":[%s],\"dt_c\":[%s]}", a, t }' \
    > data/processed/epica_temp.json

# --- 地质史:南极冰芯 CO2 复合记录(列:age_gas_calBP(yr BP) co2_ppm co2_1s_ppm)---
awk '$1 ~ /^-?[0-9.]+$/ && NF>=3 { printf "%.2f\t%.2f\n", $1/1000, $2 }' \
    data/raw/antarctica_co2_composite2015.txt | sort -n -k1,1 | \
awk 'NR % 12 == 1 {
  a = a (a?",":"") sprintf("%.2f", $1)
  p = p (p?",":"") sprintf("%.1f", $2)
} END { printf "{\"age_kyr\":[%s],\"ppm\":[%s]}", a, p }' \
    > data/processed/co2_composite.json

# --- 地质史:LR04 深海氧同位素堆叠(列:age(kyr BP) d18O(‰) 1σ)---
awk '$1 ~ /^-?[0-9.]+$/ && NF>=3 { printf "%.1f\t%.2f\n", $1, $2 }' \
    data/raw/lr04_stack.txt | sort -n -k1,1 | \
awk 'NR % 5 == 1 {
  a = a (a?",":"") sprintf("%.1f", $1)
  v = v (v?",":"") sprintf("%.2f", $2)
} END { printf "{\"source\":\"Lisiecki and Raymo 2005 LR04 benthic d18O stack\",\"age_kyr\":[%s],\"d18o\":[%s]}", a, v }' \
    > data/processed/lr04.json

# --- 地质史:Zachos 2001 汇编(列:SITE Age(Ma) Genus d18Oadj d13C d18O5pt d13C5pt;取 5 点滑动平均,每 16 行抽 1)---
awk 'NF>=7 && $2 ~ /^-?[0-9.]+$/ && $2+0>=0 && $2+0<=70 && $6 ~ /^-?[0-9.]+$/ { printf "%.4f\t%.2f\n", $2, $6 }' \
    data/raw/zachos2001.txt | sort -n -k1,1 | \
awk 'NR % 16 == 1 {
  a = a (a?",":"") sprintf("%.0f", $1 * 1000)
  v = v (v?",":"") sprintf("%.2f", $2)
} END { printf "{\"source\":\"Zachos et al. 2001 global benthic d18O compilation (5pt running mean)\",\"age_kyr\":[%s],\"d18o\":[%s]}", a, v }' \
    > data/processed/zachos.json

# --- 古地理:PaleoDEMS 1° 高程(Scotese & Wright 2018)→ 1° 分类(0 深海 1 陆架 2 低地 3 高地)---
# 11 期:540/450/380/300/250/200/100/66(65)/55/50/35 Ma;2bit 打包(4 格/字节)→ gzip → base64
for pair in e540:e540 e450:e450 e380:e380 e300:e300 e250:e250 e200:e200 e100:e100 e66:Map16_065Ma e55:Map14_055Ma e50:Map11_050Ma e35:Map10_035Ma; do
  key="${pair%%:*}"; pfile="data/raw/paleodems/${pair#*:}.csv"
  # 部分期 CSV 为 CR-only 行尾(Devonian–Triassic 4 期),先统一成 LF 再分类
  tr '\r' '\n' < "$pfile" | awk -F, '!/^#/ && NF>=3 {
    gx = int($1 + 180); gy = int($2 + 90);
    if (gx >= 0 && gx < 360 && gy >= 0 && gy < 180) { s[gy * 360 + gx] += $3; c[gy * 360 + gx]++ }
  } END {
    for (i = 0; i < 64800; i++) {
      m = (c[i] > 0) ? s[i] / c[i] : -3000;
      printf "%d", (m <= -1000) ? 0 : (m <= 0) ? 1 : (m <= 1000) ? 2 : 3
    }
  }' > "data/processed/pg_$key.txt"
  awk '{
    s = $0; gsub(/[^0-3]/, "", s); n = length(s);
    for (i = 1; i + 3 <= n; i += 4) printf "%c", substr(s, i, 1) * 64 + substr(s, i + 1, 1) * 16 + substr(s, i + 2, 1) * 4 + substr(s, i + 3, 1)
  }' "data/processed/pg_$key.txt" > "data/processed/pg_$key.bin"
  gzip -9n -c "data/processed/pg_$key.bin" | base64 -w0 > "data/processed/pg_$key.b64"
done
{
  printf '{"meta":{"nlat":180,"nlon":360},"epochs":{'
  sep=""
  for pair in e540 e450 e380 e300 e250 e200 e100 e66 e55 e50 e35; do
    printf '%s"%s":{"gz":"' "$sep" "$pair"
    sep=","
    cat "data/processed/pg_$pair.b64"
    printf '"}'
  done
  printf '},"note":"Scotese and Wright 2018 PaleoDEMS (EarthByte), 1deg native; class 0 deep 1 shelf 2 lowland 3 highland; 2bit packed 4 cells per byte then gzip; inflate via DecompressionStream"}'
} > data/processed/paleogeo.json
rm -f data/processed/pg_*.txt data/processed/pg_*.bin

# --- 钻孔/采样位置:主要冰芯(坐标为公开文献事实);LR04 海洋岩芯待站点表后补入 ---
{
  printf '{"sites":['
  printf '%s' '{"n":"EPICA Dome C(800 ka 冰芯)","la":-75.1,"lo":123.35,"tag":"ice"},'
  printf '%s' '{"n":"Vostok(冰芯)","la":-78.47,"lo":106.8,"tag":"ice"},'
  printf '%s' '{"n":"Dome F(冰芯)","la":-77.32,"lo":39.7,"tag":"ice"},'
  printf '%s' '{"n":"Law Dome DSS(冰芯)","la":-66.73,"lo":112.83,"tag":"ice"},'
  printf '%s' '{"n":"WAIS Divide(冰芯)","la":-79.47,"lo":-112.1,"tag":"ice"},'
  printf '%s' '{"n":"NGRIP(冰芯)","la":75.1,"lo":-42.3,"tag":"ice"},'
  printf '%s' '{"n":"GRIP(冰芯)","la":72.58,"lo":-37.64,"tag":"ice"},'
  printf '%s' '{"n":"GISP2(冰芯)","la":72.57,"lo":-38.46,"tag":"ice"}'
  printf ']}'
} > data/processed/drill_sites.json

wc -c data/processed/*.json
