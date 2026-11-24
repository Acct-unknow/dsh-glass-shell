毛玻璃外壳（dsh-glass-shell）把 DSH 的外壳换成磨砂玻璃。

它覆盖了两类东西：

1. **外壳骨架**：应用框架本身透明，侧边栏列与中间列各画一层半透明底色；这两层后面是一个固定的背景层，用来放纯色、图片或由当前主题生成的渐变，虚化（blur + saturate）也做在这个背景层上，所以面板看上去就是毛玻璃，而不需要给宿主容器加 backdrop-filter。
2. **主题 token**：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1..3`、`--dsw-alias-bg-overlay`、`--dsw-specific-sidebar-fill`、`--dsw-specific-input-major`、`--dsw-specific-bubble`、`--dsw-specific-menu`、代码块与卡片底色等，全部换成分层半透明色；明暗主题各一套，切换主题时不需要重新设置。

输入卡单独用真正的 `backdrop-filter`，因为它盖在滚动的对话文字上。

渐变的两支颜色既可以取色，也可以直接填 `#rrggbb`（回车或输入框失焦时提交，解析失败就静默退回当前值，不会把面板卡在非法状态）。

取色有两个入口：面板里的取色器和色号输入框只能取页面内的颜色；想让取色跳出窗口，用的是浏览器的 **EyeDropper API**（`new window.EyeDropper().open()`，Chromium 95+）。在 DSH 桌面版（Electron/Chromium）里它是系统级吸管：点一下屏幕任意位置，包括别的窗口和桌面，都能取到那一像素的颜色。接口不存在时按钮会给提示，不会静默失败；按 Esc 取消取色不会改动任何设置。渐变的起始色、结束色各自带一个屏幕取色按钮，取到的颜色只写到那一边，方向与另一边都不动。

取过的颜色会进「最近使用」（去重、最多 14 个），点色块即时生效；「存当前色」把颜色收进「我的常用」（最多 24 个，可删除）。渐变模式下可以用「纯色 / 起始 / 结束」开关决定色块改的是哪一个颜色。收藏的渐变（两色 + 方向）也记在同一份数据里（键 `dsh-glass-shell.palette.v1` 的 `gradients` 数组，最多 12 组），在设置页默认折叠成一条标题（带数量），点标题条就展开（原生 `<details>`，不依赖 React 状态），竖着列成 34×34 的渐变大色块（旁边跟色号和方向名），点色块整套恢复。同理「最近使用 / 我的常用」也默认折叠、展开后竖排 34×34 大色块 + 色号，尺寸写在 inline style 上（`width/height:34px`、`flex:0 0 auto`），外面的 flex 布局挤不小它们；渐变的两支颜色下面还各挂一排常用色，点一下只改这一边。这些数据都存在浏览器 `localStorage`，不随插件目录走。

背景层的渐变是浏览器原生 `linear-gradient(to ...)`，方向与两种颜色都直接来自设置；渐变与纯色共用同一套「背景层 + 面板半透明」的渲染路径，所以玻璃质感完全一致，只是背后不再是一块平色。

设置页在「设置 → 毛玻璃」：总开关、背景虚化 0–48px、面板透明度 0–100%、背景饱和度 80–220%、折射玻璃模式开关与折射强度 0–100%、背景来源（跟随主题 / 纯色 / 渐变 / 图片）、渐变的两种颜色与 8 个方向、屏幕取色、最近使用与我的常用、图片填充方式与暗化、恢复默认。设置即时生效并保存在浏览器 `localStorage`，上传的图片会在本地压缩后再存。

折射玻璃模式：在 `body` 里插入一个 0×0 的 `<svg>`，里面是 `#dsh-glass-shell-refract` 滤镜——`feImage`（程序生成的圆角法线贴图）→ `feGaussianBlur`（= 背景虚化 / 2）→ `feDisplacementMap`（scale = 折射强度 / 100 × 40px）→ `feColorMatrix`（饱和度）。面板通过 `backdrop-filter: url(#dsh-glass-shell-refract)` 引用它，所以面板自身可以完全不画底色，只折射背后的内容。滤镜区域按元素包围盒铺开（`filterUnits="objectBoundingBox"`），位移与模糊用像素，保证各向同性。

配置同步：host 半端（`index.js`）只做一件事——把客户端状态镜像到插件目录。它 `inject: ['webServer']`，用 `ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-glass-shell', handler }), 'dsh-glass-shell: store route')` 注册路由；`handler` 是 Node 经典 `(req, res)`：`GET` 读 `store.json`（不存在时返回 `{version:1,savedAt:0,empty:true}`），`POST`/`PUT` 读请求体（上限 8MB）、盖上服务端 `savedAt`、写 `.tmp` 后 `rename` 原子替换。客户端启动时 `GET` 一次：目录里的 `savedAt` 比本机记录的新（新机器记录为 0）就用它覆盖 localStorage，否则把本机这份 `POST` 上去；之后任何设置/图片/色板改动都走 800ms 防抖的 `POST`。图片超过 400 万字符时不会写进快照，避免文件过大。路由不可用时所有 `fetch` 失败都被吞掉，插件退回纯 `localStorage`。
