// 全量数据审计:每项成品 JSON 与其原始文件独立对账(不复用生产管线代码)
// 用法:node scripts/audit_data.js
const fs = require("fs");
const zlib = require("zlib");
const R = __dirname + "/..";
let pass = 0, fail = 0;
const ok = (name, cond, detail) => { console.log((cond ? "  ✓ " : "  ✗ ") + name + (detail ? "  [" + detail + "]" : "")); cond ? pass++ : fail++; };
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- 1. zonann(纬度带年均)vs 原始 CSV ----------
console.log("== 1. zonann(人类史纬度带,GISTEMP CSV)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/zonann.json", "utf8"));
  ok("年份 146 个,1880→2025", J.years.length === 146 && J.years[0] === 1880 && J.years[145] === 2025, J.years[0] + "→" + J.years[145] + " n=" + J.years.length);
  const rows = fs.readFileSync(R + "/data/raw/gistemp_zonann.csv", "utf8").split("\n").filter(l => { const f = l.split(","); return f.length >= 15 && +f[0] >= 1880; });
  const src = new Map(rows.map(l => { const f = l.split(","); return [+f[0], { glob: +f[1], bands: f.slice(7, 15).map(Number) }]; }));
  let bad = 0;
  for (let i = 0; i < J.years.length; i++) {
    const s = src.get(J.years[i]);
    if (!s) { bad++; continue; }
    if (!near(J.glob[i], +s.glob.toFixed(2), 0.011)) bad++;
    for (let b = 0; b < 8; b++) if (!near(J.bands[b].values[i], +s.bands[b].toFixed(1), 0.11)) bad++; /* 容差 0.11 覆盖 %.1f 银行家舍入与 JS toFixed 的方向差 */
  }
  ok("抽全 146 年 × (glob + 8 带) 与 CSV 逐值一致", bad === 0, "不一致 " + bad);
  ok("2025 glob = " + J.glob[145] + "°C(2024 为 " + J.glob[144] + ")", Math.abs(J.glob[145] - 1.18) < 0.3, "UI 读数 +1.18 应一致");
}

// ---------- 2. gistemp_grid3(空间帧/季节/zones)----------
console.log("== 2. gistemp_grid3(3° 年帧 + 季节 + zones)==");
{
  const M = JSON.parse(fs.readFileSync(R + "/data/processed/gistemp_grid3_meta.json", "utf8"));
  const sp = fs.readFileSync(R + "/data/processed/gistemp_grid3_spatial.bin");
  const nt = M.meta.lats.length, nl = M.meta.lons.length, ncell = nt * nl;
  ok("网格 60×120 = 7200 格/帧", nt === 60 && nl === 120, nt + "×" + nl);
  ok("spatial 字节数 = 150 帧 × 7200", sp.length === 150 * ncell, sp.length);
  ok("years 146 帧", M.meta.years.length === 146 && M.meta.nframes === 146);
  const sgn = u => u > 127 ? u - 256 : u;
  let bad = 0, g2025 = 0, cells = 0;
  const f2025 = sp.subarray(145 * ncell, 146 * ncell);
  for (let i = 0; i < ncell; i++) { const v = sgn(f2025[i]); if (v === -127) continue; if (v < -126 || v > 126) bad++; g2025 += v * 0.1; cells++; }
  ok("2025 帧值域合法(int8 ±126,无越界)", bad === 0, "越界 " + bad);
  ok("2025 帧非加权均值 = " + (g2025 / cells).toFixed(2) + "°C ∈ [0.3, 2.2](2025 全球 +1.18,未加权含高纬偏置)", g2025 / cells > 0.3 && g2025 / cells < 2.2);
  // 季节帧在 spatial 尾部 4 块
  const skeys = ["jan", "apr", "jul", "oct"];
  for (let si = 0; si < 4; si++) {
    const blk = sp.subarray((146 + si) * ncell, (147 + si) * ncell);
    let n = 0, sum = 0;
    for (let i = 0; i < ncell; i++) { const v = sgn(blk[i]); if (v === -127) continue; n++; sum += v * 0.25; }
    const mean = sum / Math.max(1, n);
    ok(skeys[si] + " 季节帧有数据(" + n + "/7200 格)均值 " + mean.toFixed(2) + "°C", n > 6000);
  }
  const z = M.zones.map(zz => Buffer.from(zz.values, "base64"));
  ok("zones 8 带 × 1752 字节(12 月 × 146 年)", z.length === 8 && z.every(b => b.length === 1752));
  ok("zones 数据非平凡(有正值有负值)", z.every(b => b.some(x => (x > 127 ? x - 256 : x) > 5) && b.some(x => (x > 127 ? x - 256 : x) < -5)));
}

// ---------- 3. paleoclim_snapshots(2° 快照)vs UI 文献标签 ----------
console.log("== 3. paleoclim_snapshots(8 期 × 温度/降水 @2°)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/paleoclim_snapshots.json", "utf8"));
  const dec = b64 => Buffer.from(b64, "base64");
  const ncell = J.meta.lats.length * J.meta.lons.length;
  ok("网格 90×180 = 16200 格", ncell === 16200, J.meta.lats.length + "×" + J.meta.lons.length);
  const keys = ["mh", "lig", "hs1", "ba", "yds", "eh", "lh", "mpwp"];
  const claim = { mh: -0.2, lig: 1.5, hs1: -3.5, ba: -1.5, yds: -1.5, eh: -0.5, lh: 0, mpwp: 3 };
  const names = { mh: "全新世中期", lig: "末次间冰期", hs1: "HS-1 冷期", ba: "BA 暖期", yds: "新仙女木", eh: "全新世早期", lh: "前工业晚期", mpwp: "中上新世" };
  for (const k of keys) {
    const t = dec(J.periods[k].temp.values), p = dec(J.periods[k].precip.values);
    const sgn = u => u > 127 ? u - 256 : u;
    let s = 0, c = 0, bad = 0, pbad = 0;
    for (let i = 0; i < ncell; i++) {
      const tv = sgn(t[i]); if (tv === -127) continue; if (tv < -126 || tv > 126) bad++; s += tv * J.periods[k].temp.scale; c++;
      const pv = sgn(p[i]); if (pv !== -127 && (pv < -126 || pv > 126)) pbad++;
    }
    const mean = s / c;
    ok(names[k] + " 温度场完整(越界 " + bad + ", 降水越界 " + pbad + ")陆均 " + mean.toFixed(2) + "°C", bad === 0 && pbad === 0 && c > 3000, "文献参考 " + claim[k] + "°C(陆/海差异容许)");
  }
}

// ---------- 3b. paleocean(海洋距平:TraCE 6 期 + CESM2 LIG + plioDA mPWP)----------
console.log("== 3b. paleocean(" + 8 + " 期海温距平 @2°)==");
{
  const M = JSON.parse(fs.readFileSync(R + "/data/processed/paleocean_meta.json", "utf8"));
  const sp = fs.readFileSync(R + "/data/processed/paleocean_spatial.bin");
  const ncell = M.meta.nlat * M.meta.nlon;
  ok("网格 90×180 与快照一致", ncell === 16200);
  ok("8 期字节布局", sp.length === M.meta.order.length * ncell, M.meta.order.join(","));
  const sgn = u => u > 127 ? u - 256 : u;
  /* 范围锚定公开全球值:TraCE 各期见上;LIG = CESM2 lig127k 年均全球 SST 距平 ≈0
     (观测 Turney 2021 +0.2±0.1 / Hoffman 2017 +0.5±0.3,模型分异大,纬向重分配为主);
     mPWP = Tierney 2025 中上新 SST 距平 ~+3(实测 2° 掩膜内 3.00) */
  const expect = { hs1: [-7.5, -4.5], ba: [-3.5, -1.2], yds: [-4, -1.8], eh: [-1.5, -0.3], mh: [-1.6, -0.3], lh: [-1.2, 0.1], lig: [-0.5, 0.5], mpwp: [2.4, 3.6] };
  for (const k of M.meta.order) {
    const blk = sp.subarray(M.meta.order.indexOf(k) * ncell, (M.meta.order.indexOf(k) + 1) * ncell);
    let n = 0, s = 0;
    for (let i = 0; i < ncell; i++) { const v = sgn(blk[i]); if (v === -127) continue; n++; s += v * M.meta.keys[k].scale; }
    const mean = s / Math.max(1, n);
    const e = expect[k];
    ok(k + " 海洋有值格 " + n + " 均值 " + mean.toFixed(2) + "°C ∈ [" + e[0] + ", " + e[1] + "]", n > 8000 && mean >= e[0] && mean <= e[1]);
  }
}

// ---------- 4. paleogeo(1° 古地理)vs 原始 CSV 全 11 期 ----------
console.log("== 4. paleogeo(11 期 1° 海陆分类)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/paleogeo.json", "utf8"));
  ok("11 期齐全", Object.keys(J.epochs).length === 11, Object.keys(J.epochs).join(","));
  const clsOf = e => {
    const raw = zlib.gunzipSync(Buffer.from(J.epochs[e].gz, "base64"));
    const out = new Uint8Array(raw.length * 4);
    for (let i = 0; i < raw.length; i++) { out[i * 4] = (raw[i] >> 6) & 3; out[i * 4 + 1] = (raw[i] >> 4) & 3; out[i * 4 + 2] = (raw[i] >> 2) & 3; out[i * 4 + 3] = raw[i] & 3; }
    return out;
  };
  const files = { e540: "e540", e450: "e450", e380: "e380", e300: "e300", e250: "e250", e200: "e200", e100: "e100", e66: "Map16_065Ma", e55: "Map14_055Ma", e50: "Map11_050Ma", e35: "Map10_035Ma" };
  for (const [k, f] of Object.entries(files)) {
    const rows = fs.readFileSync(R + "/data/raw/paleodems/" + f + ".csv", "latin1").split(/\r\n|\r|\n/);
    const cnt = [0, 0, 0, 0];
    let n = 0;
    for (const line of rows) {
      if (!line || line.startsWith("#")) continue;
      const fl = line.split(",");
      if (fl.length < 3) continue;
      const lon = +fl[0], lat = +fl[1];
      const gx = Math.floor(lon + 180), gy = Math.floor(lat + 90);
      if (!(gx >= 0 && gx < 360 && gy >= 0 && gy < 180)) continue;
      const e = +fl[2];
      const c = e <= -1000 ? 0 : e <= 0 ? 1 : e <= 1000 ? 2 : 3;
      cnt[c]++; n++;
    }
    const cells = clsOf(k);
    const pc = [0, 0, 0, 0];
    for (let i = 0; i < 64800; i++) pc[cells[i]]++;
    const srcPct = cnt.map(v => (100 * v / n).toFixed(1));
    const outPct = pc.map(v => (100 * v / 64800).toFixed(1));
    const match = srcPct.every((v, i) => Math.abs(v - outPct[i]) < 0.5);
    ok(k + " 类别分布与 CSV 独立重算一致(" + outPct.join("/") + "%)", match && n >= 64000, "CSV 覆盖 " + n + " 行");
  }
}

// ---------- 5. LR04 堆叠 vs 原始 TXT ----------
console.log("== 5. lr04(深海氧同位素,530 万年)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/lr04.json", "utf8"));
  const rows = fs.readFileSync(R + "/data/raw/lr04_stack.txt", "utf8").split("\n")
    .map(l => l.trim().split(/\s+/)).filter(f => f.length >= 3 && !isNaN(+f[0]) && !isNaN(+f[1]))
    .map(f => [+f[0], +f[1]]).sort((a, b) => a[0] - b[0]);
  const sample = rows.filter((_, i) => i % 5 === 0);
  let bad = 0;
  for (let i = 0; i < Math.min(sample.length, J.age_kyr.length); i++) {
    if (!near(J.age_kyr[i], +sample[i][0].toFixed(1), 0.06) || !near(J.d18o[i], +sample[i][1].toFixed(2), 0.011)) bad++;
  }
  ok("抽样点与源逐值一致(" + J.age_kyr.length + " 点)", bad === 0 && J.age_kyr.length === sample.length, "源 " + rows.length + " 行,不一致 " + bad);
  ok("年龄单调递增 0 → " + J.age_kyr[J.age_kyr.length - 1] + " kyr", J.age_kyr.every((v, i) => i === 0 || v >= J.age_kyr[i - 1]) && J.age_kyr[0] === 0);
  ok("d18O 值域 [2.5,5.5](冰期旋回合理)", Math.min(...J.d18o) >= 2.4 && Math.max(...J.d18o) <= 5.6, Math.min(...J.d18o).toFixed(2) + "…" + Math.max(...J.d18o).toFixed(2));
}

// ---------- 6. Zachos 汇编 vs 原始 TXT ----------
console.log("== 6. zachos(67 Ma 深时 δ18O)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/zachos.json", "utf8"));
  const rows = fs.readFileSync(R + "/data/raw/zachos2001.txt", "utf8").split("\n")
    .map(l => l.trim().split(/\s+/)).filter(f => f.length >= 7 && !isNaN(+f[1]) && +f[1] >= 0 && +f[1] <= 70 && !isNaN(+f[5]))
    .map(f => [+f[1] * 1000, +f[5]]).sort((a, b) => a[0] - b[0]);
  const sample = rows.filter((_, i) => i % 16 === 0);
  /* GNU sort 与 JS sort 在同岁多站行上的 tie-break 不同 + %.0f/Math.round 对 .5 边界方向不同 → 年龄 ±1.5 容差的成员校验 */
  let bad = 0;
  for (let i = 0; i < J.age_kyr.length; i++) {
    const hit = rows.some(r => Math.abs(r[0] - J.age_kyr[i]) <= 1.5 && near(r[1], J.d18o[i], 0.011));
    if (!hit) bad++;
  }
  ok("每个成品点都能在源中找到同龄同值行(" + J.age_kyr.length + " 点)", bad === 0 && J.age_kyr.length === sample.length, "不在源中 " + bad + "; 源 " + rows.length + " 行");
  ok("年龄跨度 0 → " + J.age_kyr[J.age_kyr.length - 1] + " kyr(≈67 Ma)", J.age_kyr[0] <= 5 && J.age_kyr[J.age_kyr.length - 1] > 65000);
}

// ---------- 7. EPICA 冰芯 vs 原始 TXT ----------
console.log("== 7. epica(80 万年冰芯 ΔT)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/epica_temp.json", "utf8"));
  const rows = fs.readFileSync(R + "/data/raw/epica_edc3_temp2007.txt", "utf8").split("\n")
    .map(l => l.trim().split(/\s+/)).filter(f => f.length >= 5 && !isNaN(+f[0]) && !isNaN(+f[4]))
    .map(f => [+(f[2] / 1000).toFixed(2), +(+f[4]).toFixed(2)]).sort((a, b) => a[0] - b[0]);
  const sample = rows.filter((_, i) => i % 12 === 0);
  let bad = 0;
  for (let i = 0; i < Math.min(sample.length, J.age_kyr.length); i++) {
    if (!near(J.age_kyr[i], sample[i][0], 0.011) || !near(J.dt_c[i], sample[i][1], 0.011)) bad++;
  }
  ok("抽样点与源逐值一致(" + J.age_kyr.length + " 点)", bad === 0, "不一致 " + bad + "; 源 " + rows.length + " 行");
  ok("ΔT 值域 [-12, +5](末次冰期 −8 量级合理)", Math.min(...J.dt_c) >= -12 && Math.max(...J.dt_c) <= 5, Math.min(...J.dt_c).toFixed(1) + "…" + Math.max(...J.dt_c).toFixed(1));
}

// ---------- 8. CO₂ 复合记录 vs 原始 TXT ----------
console.log("== 8. co2(南极冰芯 CO₂ 复合)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/co2_composite.json", "utf8"));
  const rows = fs.readFileSync(R + "/data/raw/antarctica_co2_composite2015.txt", "utf8").split("\n")
    .map(l => l.trim().split(/\s+/)).filter(f => f.length >= 3 && !isNaN(+f[0]) && !isNaN(+f[1]))
    .map(f => [+(f[0] / 1000).toFixed(2), +f[1]]).sort((a, b) => a[0] - b[0]);
  const sample = rows.filter((_, i) => i % 12 === 0);
  /* %.2f 年龄舍入边界 + 排序 tie-break → 年龄 ±0.02、ppm ±0.06 的成员校验 */
  let bad = 0;
  for (let i = 0; i < J.ppm.length; i++) {
    const hit = rows.some(r => Math.abs(r[0] - J.age_kyr[i]) <= 0.02 && near(r[1], J.ppm[i], 0.06));
    if (!hit) bad++;
  }
  ok("每个成品点都能在源中找到同龄同值行(" + J.ppm.length + " 点)", bad === 0 && J.ppm.length === sample.length, "不在源中 " + bad + "; 源 " + rows.length + " 行");
  const firstAge = J.age_kyr[0], firstPpm = J.ppm[0];
  ok("首点(最新)" + firstPpm + " ppm @ " + firstAge + " kyr(≈2001 年,复合记录末端)", firstAge <= 0.2 && firstPpm > 340 && firstPpm < 380);
  ok("CO₂ 值域 [170, 300] ppm(冰期-间冰期合理)", Math.min(...J.ppm) >= 160 && Math.max(...J.ppm.filter((v, i) => J.age_kyr[i] > 1)) <= 310);
}

// ---------- 9. 钻孔位置 ----------
console.log("== 9. drill_sites(8 个冰芯钻孔)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/drill_sites.json", "utf8"));
  ok("8 个站点", J.sites.length === 8, J.sites.map(s => s.n).join("、"));
  ok("坐标均在极区合理范围", J.sites.every(s => Math.abs(s.la) > 60 && Math.abs(s.lo) <= 180));
}

// ---------- 10. land_50m 海岸线 ----------
console.log("== 10. land_50m(海岸线)==");
{
  const J = JSON.parse(fs.readFileSync(R + "/data/processed/land_50m.json", "utf8"));
  ok("环数 ≥ 1000", J.length >= 1000, J.length + " 环");
  let bad = 0, pts = 0;
  for (const ring of J) for (const pt of ring) { pts++; if (!(pt[0] >= -180.1 && pt[0] <= 180.1 && pt[1] >= -90.1 && pt[1] <= 90.1)) bad++; }
  ok("全部坐标在经纬范围内(" + pts + " 点)", bad === 0, "越界 " + bad);
}

// ---------- 11. 构建产物完整性 ----------
console.log("== 11. dist 单文件完整性 ==");
{
  const buf = fs.readFileSync(R + "/dist/index.html");
  const s = buf.toString("utf8");
  const leftover = s.match(/__[A-Z_]+__/g);
  ok("无未替换占位符", !leftover, leftover ? leftover.join(",") : "干净");
  ok("体积 ≤ 1 MiB", buf.length <= 1048576, buf.length + " / 1048576");
  ok("包含 d3 引用与模块脚本", s.includes("d3@7.9.0") && s.includes('type="module"'));
}

console.log("\n===== 审计结果:通过 " + pass + ",失败 " + fail + " =====");
