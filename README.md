# 全球气候变迁图鉴 · Climate Atlas

深夜 side project:把公开气候数据放到同一张世界地图上,用「人类史」和「地质史」两个时间尺度看气候变率——仪器记录里那一小段陡峭的爬升,放进 80 万年的冰芯曲线里,才知道它有多反常。

## 目标

一张世界地图 + 两个时间尺度:

- **人类史(1880–2025)**:仪器观测的温度距平,先按纬度带着色(M0),升级为 1°×1° 格点逐年变化(M1)
- **地质史(0–80 万年)**:EPICA 冰芯重建温度 + 南极 CO₂ 复合记录,叠加关键气候快照(末次盛冰期、全新世中期、中上新世)

## 数据源(全部公开免费)

| 时段 | 数据集 | 来源 | 格式 |
|---|---|---|---|
| 1880–2025 | **GISTEMP v4 格点月值**(2°×2°,GHCNv4 陆地 + ERSSTv5 海洋),聚合到 **3°** 年帧 | NASA GISS | NetCDF3 |
| 1880–2025 | GISTEMP v4 纬度带年均温距平(地质史模式用) | NASA GISS | CSV |
| 0–800 ka | EPICA Dome C 冰芯温度重建(Jouzel et al. 2007) | NOAA NCEI 古气候库 | TXT |
| 0–5300 ka | LR04 深海氧同位素堆叠(Lisiecki and Raymo 2005,57 岩芯) | NOAA NCEI 古气候库 | TXT |
| 0–67 Ma | Zachos 全球底栖 δ18O 汇编(Zachos et al. 2001,IPCC AR4 图 6.1 数据) | NOAA NCEI 古气候库 | TXT |
| 快照格点 | PaleoClim v1 重建(Brown et al. 2018,CC-BY-NC-SA):LH 0.3 ka / MH 6 ka / EH 9 ka / YDS 12.9 ka / BA 14 ka / HS-1 17 ka / LIG 125 ka / mPWP 3 Ma,10′ 分辨率 bio1+bio12,聚合到 **2°** 格点。HS-1/BA/YDS 基于 TraCE-21ka 瞬变模拟降尺度 | paleoclim.org | GeoTIFF |
| LIG 海洋 | **PMIP4 CESM2 lig127k** 海表温度月值(gr 规则网格,模拟年份 651–700 年平均)− 同模型 piControl(700–800 年平均)距平;ESGF 匿名 HTTP | esgf-node.ornl.gov | NetCDF4 |
| mPWP 海洋 | **plioDA** 数据同化重建(Tierney et al. 2025,AGU Advances,CC-BY-4.0):3.25 Ma 减 0 Ma(现代基准)SST 距平,1° 网格 | Zenodo record 14532079 | NetCDF4(HDF5) |
| 海岸线 | Natural Earth 50m 陆地(制图底图,每环最多 400 点 + 0.01° 取整,基本全保真,530 KB) | naturalearthdata.com | GeoJSON |
| 现代基准 | CHELSA V1.2B bio1(10′) | chelsa-climate.org | GeoTIFF |
| 古地理 | PaleoDEMS(Scotese & Wright 2018,EarthByte):1° 古高程,取 540/450/380/300/250/200/100/66/55/50/35 Ma 共 11 期 | earthbyte.org | CSV |

> ⚠️ 陷阱:PaleoClim 的 `M2` 是**晚上新世 MIS M2 冰期事件(约 3.3 Ma)**,不是末次盛冰期;该数据集不包含 LGM,末次冰期最盛期用 **HS-1(约 17 ka)** 快照代替。
> ⚠️ 陷阱:PaleoDEMS 泥盆纪–三叠纪 4 期 CSV(e380/e300/e250/e200)是 **CR-only 行尾**——awk 会把整个文件读成一行,聚合结果退化为全「陆架」;build_data.sh 已先 `tr '\r' '\n'` 再聚合。
> ⚠️ 陷阱:`Uint8Array.toString("latin1")` 会**忽略编码参数**返回逗号数字串(Node 26)——二进制转字符串必须用 `Buffer.prototype.toString`;gif_verify.js 的 decodeGif 因此只接受 Buffer。
> ⚠️ 陷阱:GIF 全局色表声明 256 项(768 B)就必须写满 768 B——调色板数组按真实色数(255)分配会让后续所有块错位 3 字节,Chrome 侥幸可解但结构损坏。
> ⚠️ 陷阱:GIF LZW 码宽加宽时机——编码器「加表后 next > 1<<codeSize」与解码器「加表后 next == 1<<codeSize」配对(解码器加表滞后一步),错一位整个流报废;以 omggif 独立解码做仲裁。
| 0–800 ka | 南极冰芯 CO₂ 复合记录(Lüthi et al. 2008 / Bereiter et al. 2015) | NOAA NCEI | TXT |
| 深时快照 | LGM / 全新世中期 / 中上新世 各纬度带距平量级 | PMIP 模拟与古气候文献 | 手工整理,标注「示意」 |

> 注意:GISTEMP 距平基准是 1951–1980,EPICA ΔT 基准是「距今」,两者基线不同,图上要分开标注。

## 架构

纯静态、零构建,浏览器直接打开;数据管线用 bash + awk(Git Bash 自带,本机无需 Python/Node):

```
data/raw/          原始下载文件(fetch_data.sh 产出)
data/processed/    清洗后的紧凑 JSON(build_data.sh / make_land.ps1 / 浏览器转换页 产出)
src/demo.template.html  页面模板,__DATA__ / __LAND__ / __GRID__ 为数据注入点
scripts/fetch_data.sh        下载原始数据
scripts/build_data.sh        气候文本数据 → JSON
scripts/make_land.ps1        Natural Earth 海岸线简化(-Scale 110/50)
scripts/make_grid.js         ★ Node 端 NetCDF3 解码器:GISTEMP → 3° 年帧,原始字节流 + 元数据 JSON
scripts/make_ocean.js        TraCE-21K-II 海温 → 6 期快照海洋距平(T42→2°,int8)
scripts/make_ocean_lig_mpwp.py ★ Python(netCDF4)端:LIG=CESM2 lig127k−piControl 距平、mPWP=plioDA 距平 → 追加 2 期海洋 block
scripts/convert_paleoclim.html  ★ 浏览器端 GeoTIFF 解码器(geotiff.js,PaleoClim 快照)
scripts/serve.ps1            本地服务器(GET 文件 / POST /save 落盘)
scripts/build_demo.sh        模板 + JSON → 单文件演示页 dist/index.html
scripts/audit_data.js        ★ 数据审计:每项成品数据与原始文件独立对账(52 项校验)
scripts/gif_lzw_test.js      ★ GIF 编码器交叉验证:页面 LZW 输出 → omggif 独立解码 → 逐字节比对
scripts/gif_verify.js        ★ GIF89a 结构校验 + 独立 LZW 解码器(帧数/延时/几何/解码完整性)
```

格点转换流程:`node scripts/make_grid.js --res 3`(Node 直接解析 NetCDF3 classic,
月值聚合为年均 → 3° 最近邻分箱 → int8 量化 → 空间字节流 + 元数据 JSON),构建脚本
gzip 后注入,浏览器 DecompressionStream 解压。分辨率升级实测记录(见
`scripts/png_probe.js` / probe 模式):差分编码比 plain gzip 差 12–15%(年际量化噪声),
PNG/2D 预测滤波仅省 0–11%,2°(818 KB 帧)超出单文件预算,3° 为现实上限。

## 里程碑

- **M0 原型 demo**:8 纬度带世界地图(1880–2025 播放)+ 80 万年冰芯曲线(CO₂ 可切换)+ 3 个地质快照 ✅
- **M1 格点化** ✅(年报 4° 格点,146 帧,canvas 渲染 + 色标图例;月值/2° 原生分辨率、季节动画为后续项)
- **M2 地质史扩充** ✅:LR04(530 万年)+ Zachos(6500 万年,530 万年/6500 万年可切换,PETM 与冰盖形成注记);**快照格点化** ✅:全新世中期 / 末次间冰期 / HS-1 冷期 / 中上新世四期 PaleoClim 真实重建(各时期 − 现代距平,4° 聚合,悬停读数)。剩余:快照逐条引用
- **M3 叙事与发布**:事件叙事层 ✅(迷你时间线 + 快照逐条来源);**消冰序列播放器** ✅(HS-1 → BA → 新仙女木 → 全新世早/中期 → 前工业晚期 → 2025 观测帧);数据细化 ✅(**四季帧**:2000–2025 年 1/4/7/10 月平均距平,GISTEMP 月值;降水维度:八期 PaleoClim bio12 快照,相对现代的 % 距平,BrBG 色标);古地理快照 ✅(6500 万年模式下自动显示 65/56/35 Ma PaleoDEMS 陆海重建,切回 530 万年自动恢复快照)。**季节×年份热力图** ✅(8 纬度带 × 12 月 × 146 年月值矩阵,GISTEMP 月值;带选择器、悬停读数、点击跳年份)。**钻孔位置地图** ◐(8 个主要冰芯钻孔已上线,悬停读站名与坐标;LR04 57 站海洋岩芯待站点表——PANGAEA/NOAA/Wayback 无公开脚本化来源,需要论文 Table S1);**古地理扩展至 5.4 亿年** ✅(11 期 PaleoDEMS 时代下拉:寒武纪大爆发 → 奥陶纪末 → 泥盆纪 → 盘古大陆 → 二叠纪末 → 三叠纪 → 白垩纪温室 → 恐龙灭绝 → PETM → 始新世 → E-O 转折;**1° 原生分辨率**,2bit 打包 + gzip,沿「陆地 vs 海洋」类边界推导古海岸线描边)。**数据存储优化** ✅:GISTEMP 格点、PaleoClim 快照、50m 海岸线整体 gzip → base64,浏览器 DecompressionStream 原生解压(顶层 await);古地理 1° 原生 2bit+gzip。曾试验 PNG(2D 预测滤波 + DEFLATE)方案(`scripts/png_probe.js`),实测对量化距平场仅省 0–11%(Chrome canvas 编码器不用滤波时反而更大),不如 gzip,弃用。最终单文件 **983 KB**(预算余量 65 KB)。**分辨率细化** ✅:古地理 6°→**1°**(渲染改 ImageData+drawImage,等距投影下几何精确)、快照 4°→**2°**、海岸线 110m→**50m**。**修复悬停纵向翻转**:地图悬停行号此前按「自北向南」计算而数据行序为「自南向北」,悬停读数与高亮框一直读的是南北镜像位置;已统一为南起行序并回归验证(悬停 84°N 显示 84°N)。**渲染缓存** ✅:格点绘制的列 x/行 y 投影数组缓存(每次重绘从 O(格点) 次投影降为 O(行+列)),古地理每时代缓存着色小图 + 投影空间描边画布(切换时代 = 两次 drawImage,尺寸/主题变化自动失效)。**canvas 颜色修复** ✅:cssVar 返回的 light-dark() 原始串被 canvas 视为非法 fillStyle,nodata 格静默沿用邻居颜色;已解析为具体颜色并监听主题切换清缓存。**海洋数据接入** ✅:TraCE-21K-II 年均海温(NCAR/Wisc 公开 NetCDF,T42 格)→ 6 期快照海洋距平(hs1 −5.9°C / ba −2.3 / yds −2.8 / eh −0.8 / mh −0.9 / lh −0.6,vs ≈1990),22 KB 注入;悬停区分「PaleoClim 重建(陆)/ 海温距平(海)」并按期标注来源;审计扩至 60 项。**LIG/mPWP 海洋数据接入** ✅:LIG = **PMIP4 CESM2 lig127k** 海温(ESGF 匿名 HTTP,gr 规则网格,模拟年 651–700 年平均 − piControl 700–800 年平均,全球年均 SST 距平 ≈0,符合观测 +0.2~0.5 且 LIG 信号以纬向/季节重分配为主);mPWP = **plioDA** 数据同化重建(Tierney et al. 2025 AGU Advances,Zenodo CC-BY-4.0,3.25 Ma − 0 Ma,全球 +3.00°C,北大西洋放大 +6);新增管线 `make_ocean_lig_mpwp.py`(本机 Python 3.12 + netCDF4 解 NetCDF4/HDF5),445 MB 原始数据经 2° 最近邻分箱 + int8(scale 0.1 对齐陆层)追加至 paleocean blocks(8 期,29.6 KB 注入);悬停按期显示来源(PMIP4 CESM2 / plioDA / TraCE-21K-II);快照按钮 tooltip 补海洋来源;PaleoClim 与模型海岸线差异处诚实留灰(LIG 1721 格 / mPWP 783 格);审计扩至 **62 项**(新增两期全球均值锚定公开文献)。注意:TraCE 的 TS 是大气格网表面温度,海冰格为冰面温度(HS-1 北欧海极冷值 −25 属此,已核原始数据为真实模型输出)。**GIF 导出** ✅:人史「🎬 GIF」(1880→2025 逐年 146 帧,140ms/帧)与消冰序列「🎬 GIF」(6 快照 + 2025 收尾帧,850ms/帧)两个按钮,纯前端编码零依赖——自研可变码宽 LZW + GIF89a 写入器(`gifLzw`/`gifWriter`,约 2 KB),导出捕获绕开 paintCells 的 +0.6 重叠抗锯齿接缝、逐格取整边界铺 LUT 纯色(接缝混色曾把 256 色调色板撑爆:23.4 MB/最差偏差 102),调色板高频色直取 + 罕见色贪心补足(最终最差偏差 ≤19,不可感知);导出宽度上限 720px(960 实测 11.3 MB → 720 为 7.6 MB),yieldUi 用 MessageChannel(后台标签页 setTimeout 节流至 ~1Hz 会拖慢导出)。**验证闭环**:编码器输出经 omggif 独立解码逐字节一致(随机噪声/长行程/地图式/渐变 4 类压力帧)+ 自研结构校验器(帧数/延时/disposal/几何/LZW 完整性)+ Chrome ImageDecoder 146 帧逐帧像素比对(93.7% 逐像素相等,余为海岸线 AA 边缘 ≤19 的最近邻映射)+ GIF 帧与页面截图目视对齐;曾试验 GIF 透明索引差分帧,实测零收益(GISTEMP 格点含海洋,年际 ~80% 像素换色阶,破坏 LZW 长行程),已撤;修消冰 GIF 两遍扫描 bug(第 1 遍以人史收尾帧结束,第 2 遍未回位 geo 模式 → 7 帧全同)。**GitHub Pages 部署** ✅(仓库 github.com/Hlt0123/climate-atlas,main/docs 目录,在线版单文件即全量)。**页面逻辑完全重构(章节化)** ✅:以「模拟首访用户」走查为依据(首屏地图无 caption、播放控件折叠线下、地质史面板四类心智模型混排、页面核心论点只活在 README),把两个 tab 重构为**五个章节**(序·两个尺度 / 人类史 / 冰期与消冰 / 更暖的过去 / 深时曲线),每章回答一个访客问题;**地图内常驻 caption 条**(全球距平读数 + 色标移入地图底缘,首屏自明);**序章 hero 大数字由数据动态计算**(2025 +1.18°C vs EPICA 自然变率 ±7.3°C,不硬编码);**章节状态机** `setChapter` 统一入口(章节联动 mode/snap/metric/epoch/pgeo),hash 路由 `#c0-#c4` 分享/刷新保视图,键盘 ←/→ 翻年、空格播放、0-4 切章;渲染/数据内核(绘制、悬停数学、GIF 编码、缓存)不动,回归全绿 + GIF 实测 146 帧。

## 运行

**在线版(GitHub Pages):https://hlt0123.github.io/climate-atlas/ — 单文件即全量,直接打开**

```bash
bash scripts/fetch_data.sh   # 下载原始数据(气候文本 ~1 MB;海洋 NetCDF ~445 MB 可选)
bash scripts/build_data.sh   # 处理气候数据为 JSON
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make_land.ps1  # 海岸线简化(约 35 KB)
node scripts/make_grid.js --res 3   # GISTEMP .nc → 3° 年帧(需 Node)
python -I scripts/make_ocean_lig_mpwp.py  # LIG/mPWP 海洋距平(需 Python 3.10+ 与 netCDF4)
bash scripts/build_demo.sh   # 组装单文件演示页到 dist/index.html(并同步 docs/ 供 Pages)
```

本地预览(任选其一):直接双击 `dist/index.html`,或

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/serve.ps1
# 浏览器打开 http://127.0.0.1:8791/
```
