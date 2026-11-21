// 独立最小校验:直接读 .nc,计算指定记录的 64–90N 带均值,与两份 JSON 的 zones 对比
const fs = require("fs");
const buf = fs.readFileSync(__dirname + "/../data/raw/gistemp1200_GHCNv4_ERSSTv5.nc");
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
let p = 4;
const numrecs = dv.getUint32(p); p += 4;
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
    else if (t === 5) val = dv.getFloat32(p, false); else if (t === 4) val = dv.getInt32(p, false); else if (t === 3) val = dv.getInt16(p, false);
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
const dims = readDims(); readAtts();
const vTag = dv.getUint32(p); p += 4; const nv = dv.getUint32(p); p += 4;
const vars = [];
for (let i = 0; i < nv; i++) {
  const name = readName();
  const nd = dv.getUint32(p); p += 4;
  const dimids = []; for (let k = 0; k < nd; k++) { dimids.push(dv.getUint32(p)); p += 4; }
  const atts = readAtts();
  const type = dv.getUint32(p); p += 4;
  const vsize = dv.getUint32(p); p += 4;
  const begin = dv.getUint32(p); p += 4;
  vars.push({ name, dimids, atts, type, vsize, begin });
}
const byName = Object.fromEntries(vars.map(v => [v.name, v]));
const latV = byName.lat, taV = byName.tempanomaly, tV = byName.time;
const nlat = dims[latV.dimids[0]].size, nlon = lonN();
function lonN() { return dims[byName.lon.dimids[0]].size; }
const latArr = [], lonArr = [];
for (let i = 0; i < nlat; i++) latArr.push(dv.getFloat32(latV.begin + i * 4, false));
console.log("nlat=" + nlat + " nlon=" + nlon + " lat[0]=" + latArr[0] + " lat[-1]=" + latArr[nlat - 1] + " recs=" + dims[taV.dimids[0]].size);
const taScale = (taV.atts.find(a => a.name === "scale_factor") || {}).val || 1;
const taFill = (taV.atts.find(a => a.name === "_FillValue") || {}).val;
function bandMean(rec, lo, hi) { // 纬度带 [lo,hi](含端点),北纬为正
  let s = 0, c = 0;
  for (let row = 0; row < nlat; row++) {
    if (latArr[row] < lo || latArr[row] > hi) continue;
    for (let col = 0; col < nlon; col++) {
      const raw = dv.getInt16(taV.begin + rec * nlat * nlon * 2 + (row * nlon + col) * 2, false);
      if (raw === taFill) continue;
      s += raw * taScale; c++;
    }
  }
  return [s / c, c];
}
// record 对应月份:time units days since 1800-01-01,GISTEMP 月中值 → 直接由 numrecs/月份表推
const tScale = (tV.atts.find(a => a.name === "scale_factor") || {}).val || 1;
const tOf = r => dv.getInt32(tV.begin + r * 4, false) * tScale;
const recMonth = r => Math.round(tOf(r) / 30.4375); // 近似月序(自 1800-01)
for (const rec of [0, 1752]) {
  const m = recMonth(rec);
  const y = 1800 + Math.floor(m / 12), mo = m % 12;
  const [n, c] = bandMean(rec, 64, 90);
  console.log("rec " + rec + " ≈ " + y + "-" + (mo + 1) + "  64–90N 均值 = " + n.toFixed(3) + "°C (" + c + " 格)");
}
