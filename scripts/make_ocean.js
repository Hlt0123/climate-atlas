// TraCE-21K-II 年均海面温度(TS, T42 大气格网)→ 8 期快照的海洋距平 → 2° 格点 int8
// 用法:node scripts/make_ocean.js
// 输出:data/processed/paleocean_spatial.bin(6 期 × 16200)+ paleocean_meta.json
// 海洋掩膜:PaleoClim 为陆地上唯一数据源,其 nodata 格即海洋格(与快照网格一致)
// 量化:与各期陆地 scale 相同(hs1/ba/yds 0.25;mh/eh/lh 0.1),保证一期一张 LUT
const fs = require("fs");
const zlib = require("zlib");

const root = __dirname + "/..";
const buf = fs.readFileSync(root + "/data/raw/ocean/trace21k2_ann_TS.nc");
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// ---------- NetCDF3 解析(与 make_grid.js 同逻辑) ----------
let p = 0;
const magic = buf.toString("latin1", 0, 4);
const isCdf2 = magic === "CDF\u0002";
if (magic !== "CDF\u0001" && !isCdf2) throw new Error("不是 NetCDF3: " + JSON.stringify(magic) + "(若是 NetCDF4/HDF5 需另行处理)");
p = 4;
p += 4; // numrecs
const typeSize = t => [0, 1, 1, 2, 4, 4, 8][t];
const readName = () => { const n = dv.getUint32(p); p += 4; const s = buf.toString("latin1", p, p + n); p += n + ((4 - (n % 4)) % 4); return s; };
const readAtts = () => {
  const tag = dv.getUint32(p); p += 4; const n = dv.getUint32(p); p += 4;
  if (tag === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const nm = readName(); const t = dv.getUint32(p); p += 4; const cnt = dv.getUint32(p); p += 4;
    const sz = typeSize(t) * cnt; let val;
    if (t === 2) val = buf.toString("latin1", p, p + cnt);
    else if (t === 1) val = dv.getInt8(p);
    else if (t === 3) val = dv.getInt16(p, false);
    else if (t === 4) val = dv.getInt32(p, false);
    else if (t === 5) val = dv.getFloat32(p, false);
    else if (t === 6) val = dv.getFloat64(p, false);
    p += sz + ((4 - (sz % 4)) % 4);
    out.push({ name: nm, val });
  }
  return out;
};
const readDims = () => {
  const tag = dv.getUint32(p); p += 4; const n = dv.getUint32(p); p += 4;
  if (tag === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) { const nm = readName(); const size = dv.getUint32(p); p += 4; out.push({ name: nm, size }); }
  return out;
};
const dims = readDims();
readAtts();
const vTag = dv.getUint32(p); p += 4; const nv = dv.getUint32(p); p += 4;
const vars = [];
if (vTag === 11) {
  for (let i = 0; i < nv; i++) {
    const name = readName();
    const nd = dv.getUint32(p); p += 4;
    const dimids = []; for (let k = 0; k < nd; k++) { dimids.push(dv.getUint32(p)); p += 4; }
    const atts = readAtts();
    const type = dv.getUint32(p); p += 4;
    const vsize = dv.getUint32(p); p += 4;
    let begin;
    if (isCdf2) { const hi = dv.getUint32(p); p += 4; begin = hi * 4294967296 + dv.getUint32(p); p += 4; }
    else { begin = dv.getUint32(p); p += 4; }
    vars.push({ name, dimids, atts, type, vsize, begin });
  }
}
const byName = Object.fromEntries(vars.map(v => [v.name, v]));
console.log("dims:", dims.map(d => d.name + "=" + d.size).join(", "));
console.log("vars:", vars.map(v => v.name).join(", "));

const latV = byName.lat || byName.latitude, lonV = byName.lon || byName.longitude, tV = byName.time;
const TS = byName.TS || byName.sst || byName.SST;
if (!latV || !lonV || !tV || !TS) throw new Error("缺少 lat/lon/time/TS 变量");
const nlat = dims[latV.dimids[0]].size, nlon = dims[lonV.dimids[0]].size;
const numrecs = dv.getUint32(4); /* 无限维的实际记录数 */
console.log("grid " + nlat + "x" + nlon + " numrecs " + numrecs + " TS type " + TS.type);
const typeSizeV = v => typeSize(v.type);
const readVal = (v, off) => v.type === 5 ? dv.getFloat32(off, false) : v.type === 6 ? dv.getFloat64(off, false) : v.type === 3 ? dv.getInt16(off, false) : v.type === 4 ? dv.getInt32(off, false) : v.type === 1 ? dv.getInt8(off) : NaN;
const att = (v, nm) => { const a = v.atts.find(x => x.name === nm); return a ? a.val : undefined; };
const latArr = [], lonArr = [];
for (let i = 0; i < nlat; i++) latArr.push(readVal(latV, latV.begin + i * typeSizeV(latV)));
for (let i = 0; i < nlon; i++) lonArr.push(readVal(lonV, lonV.begin + i * typeSizeV(lonV)));
console.log("lat " + latArr[0].toFixed(2) + "→" + latArr[nlat - 1].toFixed(2) + "  lon " + lonArr[0].toFixed(2) + "→" + lonArr[nlon - 1].toFixed(2));

const tUnits = att(tV, "units") || "";
console.log("time units: " + tUnits);
if (!/ka\s*BP/i.test(tUnits)) throw new Error("time units 非 ka BP: " + tUnits);

// ---------- 记录变量布局:time/TS 首维为无限维,数据按记录交错存放 ----------
const recVars = vars.filter(v => dims[v.dimids[0]].size === 0 && v.dimids.length > 1 || v.dimids.length === 1 && dims[v.dimids[0]].size === 0);
const recSize = recVars.reduce((s, v) => {
  const perRec = v.dimids.slice(1).reduce((a, id) => a * dims[id].size, 1) * typeSizeV(v);
  return s + Math.ceil(perRec / 4) * 4;
}, 0);
const recOffsets = {};
let offAcc = 0;
for (const v of recVars) {
  recOffsets[v.name] = offAcc;
  const perRec = v.dimids.slice(1).reduce((a, id) => a * dims[id].size, 1) * typeSizeV(v);
  offAcc += Math.ceil(perRec / 4) * 4;
}
const recBase = Math.min(...recVars.map(v => v.begin)); /* 记录区起点 = 首个记录变量的 begin(固定变量 lat/lon 夹在头部与记录区之间) */
console.log("recVars " + recVars.map(v => v.name).join(",") + " recSize " + recSize + " recBase " + recBase);

// ---------- 读取全部记录 ----------
const taScale = att(TS, "scale_factor") != null ? att(TS, "scale_factor") : 1;
const taOffset = att(TS, "add_offset") != null ? att(TS, "add_offset") : 0;
const taFill = att(TS, "_FillValue");
const tScale = 1;
const ncellT = nlat * nlon;
const recAge = [], recData = [];
for (let r = 0; r < numrecs; r++) {
  const rb = recBase + r * recSize;
  const age = Math.abs(readVal(tV, rb + recOffsets.time) * tScale); /* "ka BP" 取幅值:正值=过去 */
  recAge.push(age);
  const f = new Float32Array(ncellT);
  for (let c = 0; c < ncellT; c++) {
    const raw = readVal(TS, rb + recOffsets.TS + c * typeSizeV(TS));
    const v = raw * taScale + taOffset;
    f[c] = (v === v && v > -1e10 && v < 1e10) ? v : NaN;
  }
  recData.push(f);
}
console.log("记录 age " + recAge[0].toFixed(2) + "→" + recAge[numrecs - 1].toFixed(2) + " ka BP(" + numrecs + " 条)");

// ---------- 快照期 → 最近记录,相对基准(最新记录)取距平 ----------
const SNAP_KEYS = ["hs1", "ba", "yds", "eh", "mh", "lh"];
const SNAP_AGE = { hs1: 17, ba: 14, yds: 12.9, eh: 9, mh: 6, lh: 0.3 };
let baseRec = 0;
for (let r = 0; r < numrecs; r++) if (recAge[r] < recAge[baseRec]) baseRec = r;
console.log("基准(最新)记录: age " + recAge[baseRec].toFixed(2) + " ka BP");
// T42 → 2° 格点:最近邻装箱(T42 ~2.8°,海洋场平滑,最近邻即可;2° 格中心取最近 T42 点)
const NLAT = 90, NLON = 180, ncell2 = NLAT * NLON;
const oceanAnom = {}; // key → Float32Array(ncell2) 距平
for (const k of SNAP_KEYS) {
  const target = SNAP_AGE[k];
  let best = 0;
  for (let r = 0; r < numrecs; r++) if (Math.abs(recAge[r] - target) < Math.abs(recAge[best] - target)) best = r;
  const f = recData[best], fb = recData[baseRec];
  const out = new Float32Array(ncell2);
  for (let gy = 0; gy < NLAT; gy++) {
    const latC = -90 + (gy + 0.5) * 2;
    let bi = 0;
    for (let i = 1; i < nlat; i++) if (Math.abs(latArr[i] - latC) < Math.abs(latArr[bi] - latC)) bi = i;
    for (let gx = 0; gx < NLON; gx++) {
      const lonC = -180 + (gx + 0.5) * 2;
      let bj = 0;
      for (let j = 1; j < nlon; j++) {
        const ls = lonArr[j] > 180 ? lonArr[j] - 360 : lonArr[j];
        const cs = lonArr[bj] > 180 ? lonArr[bj] - 360 : lonArr[bj];
        if (Math.abs(ls - lonC) < Math.abs(cs - lonC)) bj = j;
      }
      const v = f[bi * nlon + bj], vb = fb[bi * nlon + bj];
      out[gy * NLON + gx] = (v === v && vb === vb) ? v - vb : NaN;
    }
  }
  oceanAnom[k] = out;
  console.log(k + " 取 age " + recAge[best].toFixed(2) + " ka BP(目标 " + target + ")");
}

// ---------- 与 PaleoClim 海洋掩膜合成:陆地点 -127(陆层数据),海洋点量化,NaN → -127 ----------
const PC = JSON.parse(fs.readFileSync(root + "/data/processed/paleoclim_snapshots.json", "utf8"));
const dF = b64 => new Uint8Array(Buffer.from(b64, "base64"));
const landMask = dF(PC.periods.hs1.temp.values); // nodata(129) = 海洋
const SCALE = { hs1: 0.25, ba: 0.25, yds: 0.25, eh: 0.1, mh: 0.1, lh: 0.1 };
const order = ["hs1", "ba", "yds", "eh", "mh", "lh"];
const blocks = [];
const metaKeys = {};
for (const k of order) {
  const ocean = new Int8Array(ncell2);
  let nOcean = 0;
  for (let i = 0; i < ncell2; i++) {
    if (landMask[i] !== 129) { ocean[i] = -127; continue; } /* 陆地:海层无数据 */
    const v = oceanAnom[k][i];
    if (v === v && Math.abs(v) < 1e30) { ocean[i] = Math.max(-126, Math.min(126, Math.round(v / SCALE[k]))); nOcean++; }
    else ocean[i] = -127;
  }
  metaKeys[k] = { scale: SCALE[k] };
  blocks.push(new Uint8Array(ocean.buffer, ocean.byteOffset, ocean.length));
  console.log(k + " 海洋有值格 " + nOcean + "/" + ncell2 + " 均值 " + (() => { let s = 0, c = 0; for (let i = 0; i < ncell2; i++) if (ocean[i] !== -127) { s += ocean[i] * SCALE[k]; c++; } return (s / Math.max(1, c)).toFixed(2); })() + "°C");
}
const spatial = Buffer.concat(blocks);
fs.writeFileSync(root + "/data/processed/paleocean_spatial.bin", spatial);
const meta = {
  meta: { nlat: NLAT, nlon: NLON, order, keys: metaKeys, nodata: -127, source: "TraCE-21K-II (He and Clark 2022) ann TS, T42→2deg nearest-bin, anomaly vs latest record (~1990); ocean mask = PaleoClim land-only complement" },
  note: "spatial: " + order.length + " blocks x " + ncell2 + " bytes, order " + order.join(",") + "; -127 = 无数据(陆地或缺测); 与 paleoclim_snapshots 同网格"
};
fs.writeFileSync(root + "/data/processed/paleocean_meta.json", JSON.stringify(meta));
const gzB = b => zlib.gzipSync(b, { level: 9 }).length;
console.log("spatial.bin " + spatial.length + " B → gz " + gzB(spatial) + " → b64 " + Math.ceil(gzB(spatial) * 4 / 3));
console.log("meta.json " + meta.length + " B");
