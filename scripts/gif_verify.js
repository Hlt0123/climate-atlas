// GIF89a 独立校验器:结构解析 + LZW 解码(与页面编码器互为对账,不共享代码)
// 用法:node scripts/gif_verify.js <file.gif> [期望帧数] [期望延时cs]
// 校验:签名/全局色表/NETSCAPE 循环/帧几何/帧延时/LZW 解码完整性/相邻帧内容变化
const fs = require("fs");

function decodeGif(u8) {
  const sig = u8.toString("latin1", 0, 6);
  if (sig !== "GIF89a" && sig !== "GIF87a") throw new Error("签名错误: " + JSON.stringify(sig));
  const w = u8[6] | (u8[7] << 8), h = u8[8] | (u8[9] << 8);
  const packed = u8[10];
  if (!(packed & 0x80)) throw new Error("无全局色表");
  const gctSize = 2 << (packed & 7);
  const gct = u8.subarray(13, 13 + gctSize * 3);
  let p = 13 + gctSize * 3;
  const frames = [];
  let pendingGce = null, loop = null;
  while (p < u8.length) {
    const b = u8[p];
    if (b === 0x3B) { p++; break; }
    if (b === 0x21) { /* 扩展块 */
      const label = u8[p + 1];
      p += 2;
      if (label === 0xF9) {
        const sz = u8[p];
        const disposal = (u8[p + 1] >> 2) & 7;
        const transpFlag = u8[p + 1] & 1;
        const delayCs = u8[p + 2] | (u8[p + 3] << 8);
        const transpIdx = transpFlag ? u8[p + 4] : -1;
        pendingGce = { delayCs, disposal, transpIdx };
        p += 1 + sz;
        if (u8[p] !== 0) throw new Error("GCE 后无块终结符 @" + p);
        p++;
      } else if (label === 0xFF) {
        const sz = u8[p++];
        const name = u8.toString("latin1", p, p + sz);
        p += sz;
        const data = [];
        while (u8[p] !== 0) { const n = u8[p++]; for (let i = 0; i < n; i++) data.push(u8[p + i]); p += n; }
        p++;
        if (name === "NETSCAPE2.0") loop = data[1] | (data[2] << 8);
      } else {
        while (u8[p] !== 0) p += u8[p] + 1;
        p++;
      }
      continue;
    }
    if (b === 0x2C) { /* 图像描述符 */
      const ix = u8[p + 1] | (u8[p + 2] << 8), iy = u8[p + 3] | (u8[p + 4] << 8);
      const iw = u8[p + 5] | (u8[p + 6] << 8), ih = u8[p + 7] | (u8[p + 8] << 8);
      const ip = u8[p + 9];
      p += 10;
      let lct = false;
      if (ip & 0x80) { const s = 2 << (ip & 7); lct = true; p += s * 3; }
      if (ip & 0x40) throw new Error("不支持隔行扫描帧");
      const minCode = u8[p++];
      const data = [];
      while (u8[p] !== 0) { const n = u8[p++]; if (p + n > u8.length) throw new Error("子块越界"); for (let i = 0; i < n; i++) data.push(u8[p + i]); p += n; }
      p++;
      frames.push(Object.assign({ ix, iy, iw, ih, minCode, lct, data: Uint8Array.from(data) }, pendingGce || {}));
      pendingGce = null;
      continue;
    }
    throw new Error("未知块 0x" + b.toString(16) + " @" + p);
  }
  if (p !== u8.length) throw new Error("trailer 后残余 " + (u8.length - p) + " 字节");
  return { w, h, gct, gctSize, loop, frames };
}

/* 标准 GIF LZW 解码器(独立实现;解码器在其表长达到 1<<codeSize 时加宽码宽) */
function lzwDecode(bytes, minCode, nPix) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  const prefix = new Int32Array(4096).fill(-1);
  const suffix = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) suffix[i] = i;
  let bitBuf = 0, bitCnt = 0, pos = 0;
  const out = new Uint8Array(nPix);
  let op = 0, prev = -1;
  const read = () => {
    while (bitCnt < codeSize) {
      if (pos >= bytes.length) return eoi;
      bitBuf |= bytes[pos++] << bitCnt;
      bitCnt += 8;
    }
    const c = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize; bitCnt -= codeSize;
    return c;
  };
  const firstOf = code => { let c = code; while (prefix[c] !== -1) c = prefix[c]; return suffix[c]; };
  const emitStr = code => {
    const stack = [];
    let c = code;
    while (c > eoi) { stack.push(suffix[c]); c = prefix[c]; }
    stack.push(c);
    for (let i = stack.length - 1; i >= 0 && op < nPix; i--) out[op++] = stack[i];
  };
  for (;;) {
    const code = read();
    if (code === eoi) break;
    if (code === clear) { codeSize = minCode + 1; next = eoi + 1; prev = -1; continue; }
    if (code < 0 || code >= 4096) throw new Error("非法码 " + code);
    if (prev === -1) {
      if (code >= clear) throw new Error("clear 后首码非根: " + code);
      emitStr(code); prev = code; continue;
    }
    let kw = false;
    if (code < next) emitStr(code);
    else if (code === next && next < 4096) { kw = true; emitStr(prev); out[op++] = firstOf(prev); }
    else throw new Error("码超前: " + code + " > next " + next);
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = kw ? firstOf(prev) : firstOf(code);
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = code;
  }
  return { out, used: op };
}

const file = process.argv[2];
if (!file) { console.error("用法: node scripts/gif_verify.js <file.gif> [期望帧数] [期望延时cs]"); process.exit(2); }
const expectFrames = +(process.argv[3] || 0);
const expectDelay = +(process.argv[4] || 0);
const buf = fs.readFileSync(file);
const g = decodeGif(buf);
console.log("尺寸 " + g.w + "x" + g.h + " · 帧 " + g.frames.length + " · GCT " + g.gctSize + " 色 · loop=" + g.loop);
const failures = [];
const chk = (name, ok, detail) => { console.log((ok ? "✓ " : "✗ ") + name + (detail ? "  " + detail : "")); if (!ok) failures.push(name); };
chk("帧数", !expectFrames || g.frames.length === expectFrames, expectFrames ? "期望 " + expectFrames : "未指定");
chk("NETSCAPE 无限循环", g.loop === 0, "loop=" + g.loop);
chk("GCT 256 色", g.gctSize === 256, "gctSize=" + g.gctSize);
let ok = true;
const frameHash = [];
for (let i = 0; i < g.frames.length; i++) {
  const f = g.frames[i];
  if (f.delayCs !== (expectDelay || f.delayCs)) { ok = false; console.log("  ✗ 帧 " + i + " 延时 " + f.delayCs + "cs ≠ 期望 " + expectDelay); }
  if (f.disposal !== 1) { ok = false; console.log("  ✗ 帧 " + i + " disposal=" + f.disposal + " ≠ 1"); }
  if (f.ix || f.iy || f.iw !== g.w || f.ih !== g.h) { ok = false; console.log("  ✗ 帧 " + i + " 几何 " + f.ix + "," + f.iy + " " + f.iw + "x" + f.ih); }
  if (f.lct) { ok = false; console.log("  ✗ 帧 " + i + " 出现局部色表"); }
  try {
    const r = lzwDecode(f.data, f.minCode, g.w * g.h);
    if (r.used !== g.w * g.h) { ok = false; console.log("  ✗ 帧 " + i + " LZW 不完整 " + r.used + "/" + g.w * g.h); }
    let hh = 2166136261;
    for (let k = 0; k < r.out.length; k += 7) hh = ((hh ^ r.out[k]) * 16777619) >>> 0;
    frameHash.push(hh);
  } catch (e) { ok = false; console.log("  ✗ 帧 " + i + " LZW 异常: " + e.message); }
}
chk("帧延时/disposal/几何/LZW 完整性", ok);
let diff = 0;
for (let i = 1; i < frameHash.length; i++) if (frameHash[i] !== frameHash[i - 1]) diff++;
chk("相邻帧内容变化", diff >= Math.floor(frameHash.length * 0.9), diff + "/" + (frameHash.length - 1));
console.log("文件 " + buf.length + " B · 平均 " + Math.round(buf.length / Math.max(1, g.frames.length)) + " B/帧");
if (failures.length) { console.log("FAIL: " + failures.join("; ")); process.exit(1); }
console.log("PASS");
