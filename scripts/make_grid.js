// GISTEMP NetCDF3 → 年均格点帧(Node 版,替代浏览器转换器)
// 用法:node scripts/make_grid.js --res 2 [--out gistemp_grid2.json]
//   --res 2 → 原生 2°;3 → 3°(最近邻分箱);4 → 4°
//   帧编码:第 0 帧全量 int8,其后帧存逐格差分字节((cur-prev)&255,无损),deflate 后 base64
//   JSON: { meta:{lats,lons,years,scale,nodata,delta:true,source}, frames:[b64_f0, b64_deltaStream], seasons, zones }
// 用法补:--probe 只打印各方案大小,不写文件
const fs = require("fs");
const zlib = require("zlib");

const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RES = parseFloat(getArg("--res", "2"));
const OUT = getArg("--out", RES === 2 ? "gistemp_grid2.json" : "gistemp_grid_" + RES + ".json");
const PROBE = args.includes("--probe");

const root = __dirname + "/..";
const buf = fs.readFileSync(root + "/data/raw/gistemp1200_GHCNv4_ERSSTv5.nc");
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

// ---------- NetCDF3 classic 解析(与 convert_grid.html 同逻辑,Big-Endian) ----------
let p = 0;
const magic = buf.toString("latin1", 0, 4);
const isCdf2 = magic === "CDF\u0002";
if (magic !== "CDF\u0001" && !isCdf2) throw new Error("不是 NetCDF3 classic: " + JSON.stringify(magic));
p = 4;
const numrecs = dv.getUint32(p); p += 4;
const typeSize = t => [0, 1, 1, 2, 4, 4, 8][t];
const readName = () => {
  const n = dv.getUint32(p); p += 4;
  const s = buf.toString("latin1", p, p + n);
  p += n + ((4 - (n % 4)) % 4); return s;
};
const readAtts = () => {
  const tag = dv.getUint32(p); p += 4;
  const n = dv.getUint32(p); p += 4;
  if (tag === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const nm = readName();
    const t = dv.getUint32(p); p += 4;
    const cnt = dv.getUint32(p); p += 4;
    const sz = typeSize(t) * cnt;
    let val;
    if (t === 2) val = buf.toString("latin1", p, p + cnt);
    else if (t === 1) val = dv.getInt8(p);
    else if (t === 3) val = dv.getInt16(p, false);
    else if (t === 4) val = dv.getInt32(p, false);
    else if (t === 5) val = dv.getFloat32(p, false);
    else if (t === 6) val = dv.getFloat64(p, false);
    p += sz + ((4 - (sz % 4)) % 4);
    out.push({ name: nm, type: t, cnt, val });
  }
  return out;
};
const readDims = () => {
  const tag = dv.getUint32(p); p += 4;
  const n = dv.getUint32(p); p += 4;
  if (tag === 0) return [];
  const out = [];
  for (let i = 0; i < n; i++) { const nm = readName(); const size = dv.getUint32(p); p += 4; out.push({ name: nm, size }); }
  return out;
};
const dims = readDims();
readAtts();
const vTag = dv.getUint32(p); p += 4;
const nv = dv.getUint32(p); p += 4;
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
const latVar = byName.lat, lonVar = byName.lon, tVar = byName.time, taVar = byName.tempanomaly;
if (!latVar || !lonVar || !tVar || !taVar) throw new Error("缺少 lat/lon/time/tempanomaly 变量");
const nlat = dims[latVar.dimids[0]].size, nlon = dims[lonVar.dimids[0]].size;
const coordRead = (v, i) => {
  const off = v.begin + i * typeSize(v.type);
  return v.type === 5 ? dv.getFloat32(off, false) : v.type === 6 ? dv.getFloat64(off, false) : v.type === 3 ? dv.getInt16(off, false) : v.type === 4 ? dv.getInt32(off, false) : NaN;
};
const latArr = [], lonArr = [];
for (let i = 0; i < nlat; i++) latArr.push(coordRead(latVar, i));
for (let i = 0; i < nlon; i++) lonArr.push(coordRead(lonVar, i));
const att = (v, nm) => { const a = v.atts.find(x => x.name === nm); return a ? a.val : undefined; };
const taType = taVar.type, taSize = typeSize(taType);
const taScale = att(taVar, "scale_factor") != null ? att(taVar, "scale_factor") : 1;
const taOffset = att(taVar, "add_offset") != null ? att(taVar, "add_offset") : 0;
const taFill = att(taVar, "_FillValue");
const readRaw = (off, t) => t === 5 ? dv.getFloat32(off, false) : t === 6 ? dv.getFloat64(off, false) : t === 3 ? dv.getInt16(off, false) : t === 4 ? dv.getInt32(off, false) : t === 1 ? dv.getInt8(off) : NaN;
const nrec = dims[taVar.dimids[0]].size;
const tScale = att(tVar, "scale_factor") != null ? att(tVar, "scale_factor") : 1;
const tOffset = att(tVar, "add_offset") != null ? att(tVar, "add_offset") : 0;
const tOf = r => readRaw(tVar.begin + r * typeSize(tVar.type), tVar.type) * tScale + tOffset;
const tUnits = att(tVar, "units") || "days since 1800-01-01";
const um = tUnits.match(/^([A-Za-z]+)\s+since\s+(.+)$/);
const unitMs = { second: 1e3, seconds: 1e3, minute: 6e4, minutes: 6e4, hour: 36e5, hours: 36e5, day: 864e5, days: 864e5, month: 2629746e3, months: 2629746e3, year: 31556952e3, years: 31556952e3 }[(um ? um[1].toLowerCase() : "days")] || 864e5;
let baseMs = Date.parse(um ? um[2].trim().replace(" ", "T") : "1800-01-01T00:00:00");
if (isNaN(baseMs)) baseMs = Date.parse("1800-01-01T00:00:00Z");
console.log("grid " + nlat + "x" + nlon + " lat " + latArr[0] + "→" + latArr[nlat - 1] + " lon " + lonArr[0] + "→" + lonArr[nlon - 1]);
console.log("tempanomaly t" + taType + " scale " + taScale + " offset " + taOffset + " fill " + taFill + " recs " + nrec);

// ---------- 目标分辨率映射:每个原生格 → 最近目标箱 ----------
const DEG = RES;
const NLAT = Math.floor(180 / DEG), NLON = Math.floor(360 / DEG);
const mapY = new Int16Array(nlat), mapX = new Int16Array(nlon);
for (let i = 0; i < nlat; i++) mapY[i] = Math.min(NLAT - 1, Math.max(0, Math.floor((latArr[i] + 90) / DEG)));
for (let j = 0; j < nlon; j++) mapX[j] = Math.min(NLON - 1, Math.max(0, Math.floor((lonArr[j] + 180) / DEG)));
const ncell = NLAT * NLON;

// ---------- 聚合 ----------
const sums = new Float64Array(ncell), cnts = new Float32Array(ncell);
const SEASON_MONTHS = [0, 3, 6, 9], SEASON_KEYS = ["jan", "apr", "jul", "oct"];
const sSums = SEASON_MONTHS.map(() => new Float64Array(ncell));
const sCnts = SEASON_MONTHS.map(() => new Float32Array(ncell));
const years = [], frames = [];
let curYear = null, monthCount = 0;
const finishYear = () => {
  const f = new Int8Array(ncell);
  for (let gy = 0; gy < NLAT; gy++) for (let gx = 0; gx < NLON; gx++) {
    const idx = gy * NLON + gx;
    f[idx] = cnts[idx] > 0 ? Math.max(-126, Math.min(126, Math.round((sums[idx] / cnts[idx]) / 0.1))) : -127;
  }
  years.push(curYear); frames.push(f);
};
const ZB = [[90, 64], [64, 44], [44, 24], [24, 0], [0, -24], [-24, -44], [-44, -64], [-64, -90]];
const ZKEYS = ["a90n", "a64n", "a44n", "a24n", "a24s", "a44s", "a64s", "a90s"];
const nY = 146;
const zmS = Array.from({ length: 8 }, () => Array.from({ length: 12 }, () => new Float64Array(nY)));
const zmC = Array.from({ length: 8 }, () => Array.from({ length: 12 }, () => new Float32Array(nY)));
const rowZone = [];
for (let row = 0; row < nlat; row++) {
  const lat = latArr[row];
  let zi = -1;
  for (let i = 0; i < ZB.length; i++) { if (lat >= ZB[i][1] && lat <= ZB[i][0]) { zi = i; break; } }
  rowZone.push(zi);
}
const cellBase = r => taVar.begin + r * nlat * nlon * taSize;
for (let r = 0; r < nrec; r++) {
  const d = new Date(baseMs + tOf(r) * unitMs);
  const y = d.getUTCFullYear();
  if (y !== curYear) {
    if (curYear !== null && monthCount === 12) finishYear();
    sums.fill(0); cnts.fill(0);
    curYear = y; monthCount = 0;
  }
  monthCount++;
  const base = cellBase(r);
  const mo = d.getUTCMonth();
  const yi = y - 1880;
  const mi = (y >= 2000 && y <= 2025) ? SEASON_MONTHS.indexOf(mo) : -1;
  const zAvg = new Float64Array(8), zCnt = new Float32Array(8);
  for (let row = 0; row < nlat; row++) {
    const zi = rowZone[row], rowOff = row * nlon, ty = mapY[row];
    for (let col = 0; col < nlon; col++) {
      const raw = readRaw(base + (rowOff + col) * taSize, taType);
      if (raw === taFill) continue;
      const v = raw * taScale + taOffset;
      if (!(v === v && v < 1e30)) continue;
      const t = ty * NLON + mapX[col];
      sums[t] += v; cnts[t] += 1;
      if (mi >= 0) { sSums[mi][t] += v; sCnts[mi][t] += 1; }
      if (zi >= 0) { zAvg[zi] += v; zCnt[zi] += 1; }
    }
  }
  if (yi >= 0 && yi < nY) {
    for (let zi = 0; zi < 8; zi++) {
      if (zCnt[zi] > 0) { zmS[zi][mo][yi] += zAvg[zi] / zCnt[zi]; zmC[zi][mo][yi] += 1; }
    }
  }
}
  if (monthCount === 12) finishYear(); else console.log("末年不完整(" + monthCount + " 个月),丢弃: " + curYear);
console.log("years " + years[0] + "→" + years[years.length - 1] + " (" + years.length + " 帧) 目标 " + NLAT + "x" + NLON + " @ " + DEG + "°");

const seasons = {};
SEASON_KEYS.forEach((k, i) => {
  const f = new Int8Array(ncell);
  for (let idx = 0; idx < ncell; idx++) f[idx] = sCnts[i][idx] > 0 ? Math.max(-126, Math.min(126, Math.round((sSums[i][idx] / sCnts[i][idx]) / 0.25))) : -127;
  seasons[k] = { scale: 0.25, values: f };
});
const zones = ZKEYS.map((k, zi) => {
  const f = new Int8Array(12 * nY);
  for (let m = 0; m < 12; m++) for (let yi = 0; yi < nY; yi++) {
    const v = (zmC[zi][m][yi] > 0) ? zmS[zi][m][yi] / zmC[zi][m][yi] : NaN;
    f[m * nY + yi] = (v === v) ? Math.max(-126, Math.min(126, Math.round(v * 10))) : -127;
  }
  return { id: k, values: f };
});

// ---------- 编码方案对比 ----------
const u8 = f => new Uint8Array(f.buffer, f.byteOffset, f.length);
const gzLen = bufs => zlib.gzipSync(Buffer.concat(bufs), { level: 9 }).length;
const defLen = bufs => zlib.deflateSync(Buffer.concat(bufs), { level: 9 }).length;
const b64len = n => Math.ceil(n * 4 / 3);
const allFrames = frames.map(u8).concat(SEASON_KEYS.map(k => u8(seasons[k].values)));
const plainGz = gzLen(allFrames);
// 差分:第 0 帧全量,其余帧逐格 (cur-prev)&255
const f0 = frames[0];
const delta = new Uint8Array((frames.length - 1) * ncell);
for (let i = 1; i < frames.length; i++) {
  const cur = frames[i], prev = frames[i - 1];
  for (let c = 0; c < ncell; c++) delta[(i - 1) * ncell + c] = (cur[c] - prev[c]) & 255;
}
const deltaPkg = defLen([u8(f0), delta]);
console.log("原始 " + allFrames.length + " 帧 = " + allFrames.reduce((s, f) => s + f.length, 0) + " B");
console.log("  plain gzip(b64) = " + b64len(plainGz));
console.log("  delta+defl(b64) = " + b64len(deltaPkg));
// 差分无损自检
{
  const cur = Uint8Array.from(u8(f0));
  for (let i = 1; i < frames.length; i++) {
    for (let c = 0; c < ncell; c++) cur[c] = (cur[c] + delta[(i - 1) * ncell + c]) & 255;
    for (let c = 0; c < ncell; c++) if (cur[c] !== u8(frames[i])[c]) throw new Error("差分自检失败 @frame " + i + " cell " + c);
  }
  console.log("  差分无损自检: 通过(" + frames.length + " 帧逐字节一致)");
}

if (PROBE) { console.log("(probe 模式,不写文件)"); process.exit(0); }

// ---------- 输出 ----------
// 空间数据(146 年帧 + 4 季节帧)拼接为原始字节流单文件,由构建脚本 gzip+b64 注入;
// 元数据(坐标/年份/纬带矩阵)为小 JSON,同样 gzip+b64 注入。
const b64buf = b => Buffer.from(b).toString("base64"); /* Uint8Array.toString 忽略编码参数,必须走 Buffer */
const aggLat = [], aggLon = [];
for (let gy = 0; gy < NLAT; gy++) aggLat.push(Math.round((-90 + (gy + 0.5) * DEG) * 10) / 10);
for (let gx = 0; gx < NLON; gx++) aggLon.push(Math.round((-180 + (gx + 0.5) * DEG) * 10) / 10);
const spatial = Buffer.concat(frames.map(f => Buffer.from(u8(f))).concat(SEASON_KEYS.map(k => Buffer.from(u8(seasons[k].values)))));
const base = OUT.replace(/\.json$/, "");
const metaJson = JSON.stringify({
  meta: { lats: aggLat, lons: aggLon, years, scale: 0.1, nodata: -127, deg: DEG, nframes: frames.length, source: "NASA GISTEMP v4 gistemp1200_GHCNv4_ERSSTv5 (annual means, " + DEG + "deg)" },
  seasonsScale: Object.fromEntries(SEASON_KEYS.map(k => [k, 0.25])),
  zones: zones.map(z => ({ id: z.id, values: b64buf(u8(z.values)) })),
  spatialNote: base + "_spatial.bin: rows = " + frames.length + " annual frames then " + SEASON_KEYS.join("/") + " seasons, " + NLAT + "x" + NLON + " bytes each, row-major"
});
fs.writeFileSync(root + "/data/processed/" + base + "_spatial.bin", spatial);
fs.writeFileSync(root + "/data/processed/" + base + "_meta.json", metaJson);
const gzB = b => zlib.gzipSync(b, { level: 9 }).length;
console.log("written " + base + "_spatial.bin = " + spatial.length + " B (gz " + gzB(spatial) + ", b64 " + b64len(gzB(spatial)) + ")");
console.log("written " + base + "_meta.json = " + metaJson.length + " B (gz+b64 " + b64len(gzB(Buffer.from(metaJson))) + ")");
