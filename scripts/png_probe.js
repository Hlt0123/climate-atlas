// 压缩方案实验:对量化格点字节流比较 gzip(1D)vs PNG 式 2D 预测滤波 + DEFLATE
// 用法:node scripts/png_probe.js
const fs = require("fs");
const zlib = require("zlib");

const root = __dirname + "/..";
const b = b64 => (s => { const u = Buffer.alloc(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; })(Buffer.from(b64, "base64").toString("binary"));
const gz = buf => zlib.gzipSync(buf, { level: 9 }).length;
const def = buf => zlib.deflateSync(buf, { level: 9 }).length;
const b64len = n => Math.ceil(n * 4 / 3);

function upFilter(w, h, raw) { // 每行减上一行(同列),首行原样
  const out = Buffer.alloc(raw.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = y === 0 ? raw[i] : (raw[i] - raw[i - w]) & 255;
  }
  return out;
}
function paethFilter(w, h, raw) { // 每行选 5 种滤波器中压缩最优者(近似:选 L1 残差和最小者)
  const out = Buffer.alloc(raw.length + h);
  for (let y = 0; y < h; y++) {
    const row = raw.subarray(y * w, (y + 1) * w);
    const trials = [];
    for (let ft = 0; ft < 5; ft++) {
      const f = Buffer.alloc(w);
      let cost = 0;
      for (let x = 0; x < w; x++) {
        const a = x > 0 ? row[x - 1] : 0, b2 = y > 0 ? raw[(y - 1) * w + x] : 0, c = (x > 0 && y > 0) ? raw[(y - 1) * w + x - 1] : 0;
        const v = row[x];
        let r;
        if (ft === 0) r = v;
        else if (ft === 1) r = v - a;
        else if (ft === 2) r = v - b2;
        else if (ft === 3) r = v - ((a + b2) >> 1);
        else { const p = a + b2 - c, pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c); r = v - (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c); }
        f[x] = r & 255;
        cost += (r & 255) < 128 ? (r & 255) : 256 - (r & 255);
      }
      trials.push({ ft, f, cost });
    }
    trials.sort((p, q) => p.cost - q.cost);
    out[y * (w + 1)] = trials[0].ft;
    trials[0].f.copy(out, y * (w + 1) + 1);
  }
  return out;
}

const G = JSON.parse(fs.readFileSync(root + "/data/processed/gistemp_grid.json", "utf8"));
const dF = b64 => { const s = Buffer.from(b64, "base64"); return s; };
const gridRaw = Buffer.concat([...G.frames.map(dF), ...["jan", "apr", "jul", "oct"].map(k => dF(G.seasons[k].values))]);
const S = JSON.parse(fs.readFileSync(root + "/data/processed/paleoclim_snapshots.json", "utf8"));
const snapRaw = Buffer.concat(Object.entries(S.periods).flatMap(([, p]) => [dF(p.temp.values), dF(p.precip.values)]));
const w = G.meta.lons.length, h = gridRaw.length / w;
const sw = S.meta.lons.length, sh = snapRaw.length / sw;

console.log("GISTEMP 空间帧 " + w + "x" + h + " raw=" + gridRaw.length);
console.log("  gzip(b64)     :", b64len(gz(gridRaw)), "(现状 ≈)");
console.log("  up+defl(b64)  :", b64len(def(upFilter(w, h, gridRaw))));
console.log("  paeth+defl(b64):", b64len(def(paethFilter(w, h, gridRaw))));
console.log("Snapshots " + sw + "x" + sh + " raw=" + snapRaw.length);
console.log("  gzip(b64)     :", b64len(gz(snapRaw)));
console.log("  up+defl(b64)  :", b64len(def(upFilter(sw, sh, snapRaw))));
console.log("  paeth+defl(b64):", b64len(def(paethFilter(sw, sh, snapRaw))));
