#!/usr/bin/env bash
# 下载全部原始数据到 data/raw/(约 1 MB)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

fetch() { # fetch <url> <output>
  local url="$1" out="data/raw/$2"
  if [ -s "$out" ]; then echo "已有 $out,跳过"; return 0; fi
  echo "下载 $2 ..."
  curl -fsSL --retry 2 --max-time 120 -o "$out" "$url"
  echo "  -> $(wc -c < "$out") bytes"
}

# 人类史:NASA GISTEMP v4 纬度带年均温距平(°C,基准 1951–1980)
fetch "https://data.giss.nasa.gov/gistemp/tabledata_v4/ZonAnn.Ts+dSST.csv" "gistemp_zonann.csv"

# 地质史:EPICA Dome C 冰芯温度重建(Jouzel et al. 2007,0–800 ka BP)
fetch "https://www.ncei.noaa.gov/pub/data/paleo/icecore/antarctica/epica_domec/edc3deuttemp2007.txt" "epica_edc3_temp2007.txt"

# 地质史:南极冰芯 CO2 复合记录(Lüthi 2008 + Bereiter 2015)
fetch "https://www.ncei.noaa.gov/pub/data/paleo/icecore/antarctica/antarctica2015co2composite.txt" "antarctica_co2_composite2015.txt"

# 地质史:LR04 深海氧同位素堆叠(Lisiecki & Raymo 2005,0–5300 kyr,57 个岩芯)
fetch "https://www.ncei.noaa.gov/pub/data/paleo/contributions_by_author/lisiecki2005/lisiecki2005-d18o-stack-noaa.txt" "lr04_stack.txt"

# 地质史:Zachos 2001 全球底栖有孔虫 δ18O/d13C 汇编(0–67 Ma,IPCC AR4 图 6.1 数据)
fetch "https://www.ncei.noaa.gov/pub/data/paleo/contributions_by_author/zachos2001/zachos2001.txt" "zachos2001.txt"

# 古地理:PaleoDEMS(Scotese & Wright 2018,EarthByte,5 Ma 间隔 1° 古高程)——取 65/55/35 Ma 三期
fetch "https://www.earthbyte.org/webdav/ftp/Data_Collections/Scotese_Wright_2018_PaleoDEM/PaleoDEMS_long_lat_elev_csv_v2.zip" "PaleoDEMS_csv.zip"
mkdir -p data/raw/paleodems
unzip -j -o data/raw/PaleoDEMS_csv.zip "PaleoDEMS_long_lat_elev_csv_v2.csv/Map16_065Ma.csv" -d data/raw/paleodems/ > /dev/null
unzip -j -o data/raw/PaleoDEMS_csv.zip "PaleoDEMS_long_lat_elev_csv_v2.csv/Map14_055Ma.csv" -d data/raw/paleodems/ > /dev/null
unzip -j -o data/raw/PaleoDEMS_csv.zip "PaleoDEMS_long_lat_elev_csv_v2.csv/Map10_035Ma.csv" -d data/raw/paleodems/ > /dev/null

# 快照格点:PaleoClim v1(Brown et al. 2018,CC-BY-NC-SA)+ 现代基准 CHELSA V1.2B(Karger et al. 2017)
# 注意:PaleoClim 没有 LGM;M2 是晚上新世 MIS M2 冰期事件(~3.3 Ma),不是末次盛冰期!
fetch "http://sdmtoolbox.org/paleoclim.org/data/MH/MH_v1_10m.zip" "MH_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/LIG/LIG_v1_10m.zip" "LIG_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/HS1/HS1_v1_10m.zip" "HS1_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/BA/BA_v1_10m.zip" "BA_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/YDS/YDS_v1_10m.zip" "YDS_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/EH/EH_v1_10m.zip" "EH_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/LH/LH_v1_10m.zip" "LH_v1_10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/mpwp/mPWP_v1_r10m.zip" "mPWP_v1_r10m.zip"
fetch "http://sdmtoolbox.org/paleoclim.org/data/chelsa_cur/CHELSA_cur_V1_2B_r10m.zip" "CHELSA_cur_V1_2B_r10m.zip"

# 解压各期 bio_1(年均温,°C×10)GeoTIFF 供浏览器转换页使用
mkdir -p data/raw/paleoclim
unzip -j -o data/raw/MH_v1_10m.zip "bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/mh_bio1.tif
unzip -j -o data/raw/LIG_v1_10m.zip "*bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/lig_bio1.tif
unzip -j -o data/raw/HS1_v1_10m.zip "*bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/hs1_bio1.tif
unzip -j -o data/raw/mPWP_v1_r10m.zip "*bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/mpwp_bio1.tif
unzip -j -o data/raw/CHELSA_cur_V1_2B_r10m.zip "*bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/cur_bio1.tif
unzip -j -o data/raw/BA_v1_10m.zip "bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/ba_bio1.tif
unzip -j -o data/raw/YDS_v1_10m.zip "bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/yds_bio1.tif
unzip -j -o data/raw/EH_v1_10m.zip "bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/eh_bio1.tif
unzip -j -o data/raw/LH_v1_10m.zip "bio_1.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_1.tif data/raw/paleoclim/lh_bio1.tif
unzip -j -o data/raw/MH_v1_10m.zip "*bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/mh_bio12.tif
unzip -j -o data/raw/LIG_v1_10m.zip "*bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/lig_bio12.tif
unzip -j -o data/raw/HS1_v1_10m.zip "*bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/hs1_bio12.tif
unzip -j -o data/raw/BA_v1_10m.zip "bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/ba_bio12.tif
unzip -j -o data/raw/YDS_v1_10m.zip "bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/yds_bio12.tif
unzip -j -o data/raw/EH_v1_10m.zip "bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/eh_bio12.tif
unzip -j -o data/raw/LH_v1_10m.zip "bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/lh_bio12.tif
unzip -j -o data/raw/mPWP_v1_r10m.zip "10min/bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/mpwp_bio12.tif
unzip -j -o data/raw/CHELSA_cur_V1_2B_r10m.zip "10min/bio_12.tif" -d data/raw/paleoclim/ > /dev/null && mv data/raw/paleoclim/bio_12.tif data/raw/paleoclim/cur_bio12.tif
echo "PaleoClim bio1 就绪: $(ls data/raw/paleoclim | tr '\n' ' ')"

# 地图海岸线:Natural Earth 110m 陆地(仅制图参考底图;GitHub raw 直连常超时,走 jsDelivr 镜像)
fetch "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_land.geojson" "ne_110m_land.geojson"
fetch "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_50m_land.geojson" "ne_50m_land.geojson"

# LIG 海洋:PMIP4 CESM2 lig127k + piControl tos(gr 规则网格;ESGF 匿名 HTTP,月值各 ~150-300 MB)
# 各取最后 50 年做气候平均距平(make_ocean_lig_mpwp.py)
fetch "http://esgf-node.ornl.gov/thredds/fileServer/css03_data/CMIP6/PMIP/NCAR/CESM2/lig127k/r1i1p1f1/Omon/tos/gr/v20190923/tos_Omon_CESM2_lig127k_r1i1p1f1_gr_065101-070012.nc" "ocean/lig_cesm2/tos_lig127k_065101-070012.gr.nc"
fetch "http://esgf-node.ornl.gov/thredds/fileServer/css03_data/CMIP6/CMIP/NCAR/CESM2/piControl/r1i1p1f1/Omon/tos/gr/v20190320/tos_Omon_CESM2_piControl_r1i1p1f1_gr_070001-079912.nc" "ocean/lig_cesm2/tos_piControl_070001-079912.gr.nc"

# mPWP 海洋:plioDA 数据同化重建(Tierney et al. 2025 AGU Advances;Zenodo CC-BY-4.0;time 0/3.25/4.75 Ma)
# 注:~78 MB,Zenodo 限速偶发断连,建议 curl -C - 续传
fetch "https://zenodo.org/api/records/14532079/files/plioDAMainResults.nc/content" "ocean/plioDA_main.nc"

echo "完成。"
