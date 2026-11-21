// 构建后压缩:模块 JS 经 terser 混淆压缩,CSS 去空白,全文去空行/缩进
// 用法:node scripts/minify_build.js dist/index.html
// 安全边界:HTML 文本区不动(避免内联元素间距变化);模板字符串感知
const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const file = process.argv[2];
if (!file) throw new Error("用法: node scripts/minify_build.js <dist/index.html>");
let s = fs.readFileSync(file, "utf8");
const before = Buffer.byteLength(s);

// ---------- 1. 模块 <script type="module"> → terser ----------
const OPEN = '<script type="module">';
const CLOSE = "</script>";
const a = s.indexOf(OPEN), b = s.indexOf(CLOSE, a);
if (a < 0 || b < 0) throw new Error("找不到模块脚本");
const js = s.slice(a + OPEN.length, b);
const tmp = path.join(__dirname, "..", "dist", "_module.js");
fs.writeFileSync(tmp, js);
execSync(`npx terser ${JSON.stringify(tmp)} --module --compress passes=2 --mangle -o ${JSON.stringify(path.join(__dirname, "..", "dist", "_module.min.js"))}`, { stdio: "inherit", cwd: path.join(__dirname, "..") });
const jsMin = fs.readFileSync(path.join(__dirname, "..", "dist", "_module.min.js"), "utf8");
fs.unlinkSync(tmp);
fs.unlinkSync(path.join(__dirname, "..", "dist", "_module.min.js"));
if (!jsMin.endsWith("\n")) /* terser 末尾必有换行 */ ;
s = s.slice(0, a + OPEN.length) + jsMin.replace(/\n+$/, "") + s.slice(b);
console.log("terser: " + js.length + " → " + jsMin.length + " bytes");

// ---------- 2. CSS 压缩(<style> 块去空白) ----------
const sa = s.indexOf("<style>"), sb = s.indexOf("</style>", sa);
let css = s.slice(sa + 7, sb);
css = css
  .split("\n").map(l => l.trim()).filter(l => l).join("\n")
  .replace(/\s*([{}:;,])\s*/g, "$1")
  .replace(/;}/g, "}");
s = s.slice(0, sa + 7) + "\n" + css + s.slice(sb);
console.log("css: " + (sb - sa - 7) + " → " + css.length + " bytes");

// ---------- 3. 全文:去空行 + 去行首缩进(模板字符串感知;HTML 行保留空白节点) ----------
const lines = s.split("\n");
let inTpl = false, inScript = false;
const outLines = [];
for (let line of lines) {
  const bt = (line.match(/`/g) || []).length;
  const startsTpl = !inTpl && bt % 2 === 1 && /`/.test(line);
  const t = line.trim();
  // JS 区(模块后)空行/整行 // 注释移除;CSS/HTML 区仅去缩进
  if (!inTpl && t === "") { if (bt === 0) { /* 空行:仅当不在模板字符串内部时移除 */ } }
  let out = line;
  if (!inTpl) {
    if (t === "") out = "";
    else if (t.startsWith("//")) out = "";
    else out = line.replace(/^ +/, "");
  }
  if (bt % 2 === 1) inTpl = !inTpl;
  outLines.push(out);
}
s = outLines.join("\n");

// ---------- 4. 完整性自检 ----------
let bal = 0; for (const ch of s) bal += ch === "{" ? 1 : ch === "}" ? -1 : 0;
if (bal !== 0) throw new Error("括号失衡 " + bal);
if (/__[A-Z_]+__/.test(s)) throw new Error("残留占位符");
if (!s.includes("ca-map-cells") || !s.includes("CA_GRID_SPATIAL_GZ")) throw new Error("关键标记丢失");
fs.writeFileSync(file, s);
const after = Buffer.byteLength(s);
console.log("total: " + before + " → " + after + " (省 " + (before - after) + " bytes)");
