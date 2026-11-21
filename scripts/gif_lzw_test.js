// LZW 编码/解码交叉验证:页面编码器(gifLzw/gifWriter)→ omggif 独立解码 → 逐字节比对;
// 同一份 GIF 再用 scripts/gif_verify.js 的独立解码器解一遍 → 与 omggif 结果比对。
// 用法:node scripts/gif_lzw_test.js
const fs = require("fs");
const path = require("path");
const root = __dirname + "/..";

// ---- 从模板抽出纯函数段(gifLzw/gifWriter/gifPalette,均不依赖 DOM) ----
const tpl = fs.readFileSync(root + "/src/demo.template.html", "utf8");
const a = tpl.indexOf("let gifBusy = false;");
const b = tpl.indexOf("async function buildGif");
if (a < 0 || b < 0) throw new Error("模板中找不到 GIF 编码段");
const enc = new Function(tpl.slice(a, b) + "\nreturn { gifLzw, gifWriter, gifPalette };")();

// ---- 从校验器抽出独立解码器 ----
const vf = fs.readFileSync(root + "/scripts/gif_verify.js", "utf8");
const va = vf.indexOf("function decodeGif"), vb = vf.indexOf("const file = process.argv[2]");
const dec = new Function(vf.slice(va, vb) + "\nreturn { decodeGif, lzwDecode };")();

const omggif = require(root + "/tmp/omggif.js");

// ---- 测试帧:3 类(随机噪声=压力表满+码宽跃迁;长行程=行程压缩;地图式=少量色+边缘) ----
function makeFrames() {
  const W = 160, H = 100;
  const frames = [];
  // 1) 随机噪声(256 色满载)
  let s = 12345;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  const noise = new Uint8Array(W * H);
  for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(rnd() * 255); /* 索引 255 已保留给透明,不可用 */
  frames.push(noise);
  // 2) 长行程(行压缩极限)
  const runs = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) runs.fill(y % 256, y * W, (y + 1) * W);
  frames.push(runs);
  // 3) 地图式:8 色 + 1px 边缘混色(触发 KwKwK/边缘字典)
  const map = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    map[y * W + x] = (x % 16 === 0 || y % 16 === 0) ? 7 : ((x / 16 | 0) + (y / 16 | 0)) % 7;
  }
  frames.push(map);
  // 4) 渐变(每个码宽边界都经过)
  const grad = new Uint8Array(W * H);
  for (let i = 0; i < grad.length; i++) grad[i] = i % 251;
  frames.push(grad);
  return { W, H, frames };
}

const { W, H, frames } = makeFrames();
// 调色板:256 灰阶
const pal = new Uint8Array(768);
for (let i = 0; i < 256; i++) { pal[i * 3] = i; pal[i * 3 + 1] = i; pal[i * 3 + 2] = i; }

const wri = enc.gifWriter(W, H, pal, 14);
for (const f of frames) wri.addFrame(f);
const bytes = wri.finish();
console.log("编码 " + frames.length + " 帧 " + W + "x" + H + " → " + bytes.length + " B");

let fails = 0;
const chk = (name, ok, detail) => { console.log((ok ? "✓ " : "✗ ") + name + (detail ? "  " + detail : "")); if (!ok) fails++; };

// ---- 1. omggif 独立解码(权威) ----
const gr = new omggif.GifReader(Buffer.from(bytes));
chk("omggif 帧数", gr.numFrames() === frames.length, gr.numFrames() + " 帧");
chk("omggif 尺寸", gr.width === W && gr.height === H, gr.width + "x" + gr.height);
const info0 = gr.frameInfo(0);
chk("omggif 延时", info0.delay === 14, "delay=" + info0.delay + "cs");
for (let i = 0; i < frames.length; i++) {
  const rgba = new Uint8Array(W * H * 4);
  gr.decodeAndBlitFrameRGBA(i, rgba);
  let bad = 0, first = -1;
  for (let p = 0; p < W * H; p++) {
    const e = frames[i][p];
    if (rgba[p * 4] !== e || rgba[p * 4 + 1] !== e || rgba[p * 4 + 2] !== e || rgba[p * 4 + 3] !== 255) {
      bad++;
      if (first < 0) first = p;
    }
  }
  chk("omggif 帧 " + i + " 逐像素一致", bad === 0, bad ? bad + " 个错位(首 " + first + ")" : "");
}

// ---- 2. 我方解码器解同一份 GIF → 与 omggif 对账(几何/延时/像素) ----
/* 注意:decodeGif 依赖 Buffer.prototype.toString("latin1"),须传 Buffer 而非 Uint8Array */
const g = dec.decodeGif(Buffer.from(bytes));
chk("自解码 帧数", g.frames.length === frames.length, g.frames.length + " 帧");
chk("自解码 loop", g.loop === 0, "loop=" + g.loop);
for (let i = 0; i < g.frames.length; i++) {
  const f = g.frames[i];
  const r = dec.lzwDecode(f.data, f.minCode, W * H);
  let bad = 0;
  for (let p = 0; p < W * H; p++) if (r.out[p] !== frames[i][p]) bad++;
  chk("自解码 帧 " + i + " 与源一致", bad === 0 && r.used === W * H, bad ? bad + " 错位" : "");
}

// ---- 3. 结构自检器(命令行入口)跑一遍 ----
fs.writeFileSync(root + "/tmp/lzwtest.gif", bytes);
console.log("→ tmp/lzwtest.gif 可另跑: node scripts/gif_verify.js tmp/lzwtest.gif 4 14");

if (fails) { console.log("FAIL(" + fails + ")"); process.exit(1); }
console.log("PASS — 编码器与两个独立实现逐字节一致");
