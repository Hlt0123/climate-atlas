# -*- coding: utf-8 -*-
# LIG + mPWP 海洋距平 → 2° 格点 int8,追加到 paleocean_spatial.bin
# 用法:python -I scripts/make_ocean_lig_mpwp.py
# 数据源:
#   LIG  = CESM2 lig127k (PMIP4, ESGF) tos 最后 50 年 (651-700) 气候平均
#          − 同模型 piControl (750-800) 气候平均 → SST 距平 (°C),gr 规则网格
#   mPWP = plioDA (Tierney et al. 2025 AGU Advances, Zenodo CC-BY-4.0) SST 距平
# 量化:scale=0.1 与 PaleoClim lig/mpwp 陆层一致(一期一张 LUT);-127 = 无数据
# 海陆掩膜:PaleoClim 该期 nodata(129) 格即海洋格
import json
import os
import numpy as np
import netCDF4 as nc

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
NLAT, NLON = 90, 180
SCALE = 0.1
NCBLOCK = NLAT * NLON

def load_raw(path):
    return json.loads(open(path, "rb").read().decode("utf-8"))

def save_raw(path, obj):
    open(path, "wb").write(json.dumps(obj, ensure_ascii=False).encode("utf-8"))

def clim_mean(path):
    """月值 tos → 整段时间平均场 (lat, lon),°C"""
    d = nc.Dataset(path)
    try:
        tos = d.variables["tos"]
        units = getattr(tos, "units", "")
        assert "degC" in units or "celsius" in units.lower() or units == "K", "tos units: %s" % units
        arr = np.ma.masked_invalid(tos[:].astype("float64"))
        if units == "K":
            arr -= 273.15
        mean = arr.mean(axis=0)  # 所有完整年份等权 → 与「先年均再多年平均」一致
        lat = np.asarray(d.variables["lat"][:], dtype="float64")
        lon = np.asarray(d.variables["lon"][:], dtype="float64")
        return mean.filled(np.nan), lat, lon
    finally:
        d.close()

def to_2deg(field, lat, lon):
    """1° 规则网格 → 2° 最近邻分箱(每 2° 格中心取最近 1° 点)"""
    out = np.full((NLAT, NLON), np.nan)
    for gy in range(NLAT):
        latc = -90.0 + (gy + 0.5) * 2.0
        bi = int(np.argmin(np.abs(lat - latc)))
        for gx in range(NLON):
            lonc = -180.0 + (gx + 0.5) * 2.0
            dlon = np.abs(((lon - lonc + 180.0) % 360.0) - 180.0)
            bj = int(np.argmin(dlon))
            out[gy, gx] = field[bi, bj]
    return out

def quantize(anom2deg, land_bytes):
    """距平 → int8;陆地点 = -127;海洋 NaN = -127"""
    ocean = np.frombuffer(bytes(land_bytes), dtype=np.uint8) == 129
    flat = anom2deg.reshape(-1)
    ok = ocean & np.isfinite(flat)
    q = np.full(NCBLOCK, -127, dtype=np.int8)
    vals = np.round(flat[ok] / SCALE)
    q[ok] = np.clip(vals, -126, 126).astype(np.int8)
    return q, int(ok.sum())

def main():
    pc = load_raw(os.path.join(ROOT, "data", "processed", "paleoclim_snapshots.json"))
    import base64
    land_lig = base64.b64decode(pc["periods"]["lig"]["temp"]["values"])
    land_mpwp = base64.b64decode(pc["periods"]["mpwp"]["temp"]["values"])

    # ---------- LIG:CESM2 ----------
    lig_dir = os.path.join(ROOT, "data", "raw", "ocean", "lig_cesm2")
    lig_f = os.path.join(lig_dir, "tos_lig127k_065101-070012.gr.nc")
    pi_f = os.path.join(lig_dir, "tos_piControl_070001-079912.gr.nc")
    lig_mean, lat, lon = clim_mean(lig_f)
    pi_mean, lat2, lon2 = clim_mean(pi_f)
    assert lat.shape == lat2.shape, "网格不一致"
    anom = lig_mean - pi_mean
    print("LIG 距平 (CESM2 lig127k 651-700 年平均 vs piControl 700-800 年平均): 全球海洋均值 %.2f°C, 范围 %.1f..%.1f" % (
        np.nanmean(anom), np.nanmin(anom), np.nanmax(anom)))
    zon = np.nanmean(anom, axis=1)  # 纬向带均值(1°)
    for la in (70, 50, 30, 10, -10, -30, -50, -70):
        print("  纬度 %+.0f: %+.2f°C" % (la, zon[int(la + 89.5)]))
    anom2 = to_2deg(anom, lat, lon)
    q_lig, n_lig = quantize(anom2, land_lig)
    n_ocean_lig = int((np.frombuffer(bytes(land_lig), dtype=np.uint8) == 129).sum())
    print("LIG 2° 海洋有值格 %d/%d, 量化均值 %.2f°C" % (n_lig, n_ocean_lig, float(np.nanmean(anom2))))

    # ---------- mPWP:plioDA (Tierney et al. 2025;time = [0, 3.25, 4.75] Ma,绝对 SST) ----------
    plio_f = os.path.join(ROOT, "data", "raw", "ocean", "plioDA_main.nc")
    if not os.path.exists(plio_f):
        plio_f = os.path.join(ROOT, "tmp", "plioda_main.nc")  # 手动下载暂存位置
    d = nc.Dataset(plio_f)
    try:
        tvals = np.asarray(d.variables["time"][:])
        tos = np.ma.masked_invalid(d.variables["tos_annual"][:].astype("float64"))
        lat_p = np.asarray(d.variables["lat"][:], dtype="float64")
        lon_p = np.asarray(d.variables["lon"][:], dtype="float64")
    finally:
        d.close()
    i_mod = int(np.argmin(np.abs(tvals)))            # 0 Ma = 现代基准(海洋均值 ≈13.8,与 HadISST 一致)
    i_plio = int(np.argmin(np.abs(tvals - 3.25)))    # 3.25 Ma = 中上新暖期
    assert abs(tvals[i_plio] - 3.25) < 0.01, "time 轴意外: %s" % tvals
    anom_mp = (tos[i_plio] - tos[i_mod]).filled(np.nan)
    print("mPWP 距平 (plioDA 3.25 Ma − 0 Ma): 全球海洋均值 %.2f°C, 范围 %.1f..%.1f" % (
        np.nanmean(anom_mp), np.nanmin(anom_mp), np.nanmax(anom_mp)))
    anom_mp2 = to_2deg(anom_mp, lat_p, lon_p)
    q_mpwp, n_mpwp = quantize(anom_mp2, land_mpwp)
    n_ocean_mp = int((np.frombuffer(bytes(land_mpwp), dtype=np.uint8) == 129).sum())
    print("mPWP 2° 海洋有值格 %d/%d, 量化均值 %.2f°C" % (n_mpwp, n_ocean_mp, float(np.nanmean(anom_mp2))))

    # ---------- 追加 blocks ----------
    oc_bin = os.path.join(ROOT, "data", "processed", "paleocean_spatial.bin")
    oc_meta = load_raw(os.path.join(ROOT, "data", "processed", "paleocean_meta.json"))
    order = oc_meta["meta"]["order"]
    assert order == ["hs1", "ba", "yds", "eh", "mh", "lh"], "现有 order 意外: %s" % order
    assert os.path.getsize(oc_bin) == NCBLOCK * len(order), "bin 尺寸与 order 不符"

    blocks = [q_lig.tobytes(), q_mpwp.tobytes()]
    new_order = order + ["lig", "mpwp"]
    with open(oc_bin, "ab") as f:
        for b in blocks:
            f.write(b)
    oc_meta["meta"]["order"] = new_order
    oc_meta["meta"]["keys"]["lig"] = {"scale": SCALE, "label": "PMIP4 CESM2"}
    oc_meta["meta"]["keys"]["mpwp"] = {"scale": SCALE, "label": "plioDA"}
    for k in ("hs1", "ba", "yds", "eh", "mh", "lh"):
        oc_meta["meta"]["keys"][k]["label"] = "TraCE-21K-II"
    oc_meta["meta"]["source"] = ("TraCE-21K-II (He and Clark 2022) ann TS, T42→2deg nearest-bin, anomaly vs latest record (~1990) "
                                 "for hs1/ba/yds/eh/mh/lh; CESM2 lig127k (PMIP4) last-50yr climatology minus piControl 750-800 for lig; "
                                 "plioDA (Tierney et al. 2025) for mpwp; ocean mask = PaleoClim land-only complement")
    save_raw(os.path.join(ROOT, "data", "processed", "paleocean_meta.json"), oc_meta)
    print("追加 %d block → %d B;order=%s" % (len(blocks), os.path.getsize(oc_bin), ",".join(new_order)))

if __name__ == "__main__":
    main()
