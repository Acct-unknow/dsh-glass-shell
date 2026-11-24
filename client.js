/**
 * dsh-glass-shell —— 浏览器半端（毛玻璃外壳 + 设置页）
 * ============================================================================
 * 目标：把 shell 的侧边栏、输入卡、卡片与弹层换成磨砂玻璃，并且
 *   · 模糊强度 / 面板透明度可调；
 *   · 背景可跟随主题、自选颜色，或上传一张自己的图片；
 *   · 全部设置即时生效、存在本机（localStorage），刷新与重装都还在。
 *
 * 实现要点（为什么这么做）：
 *   1. **玻璃靠 token**：DSH 的 shell 表面全部用 `--dsw-alias-*` /
 *      `--dsw-specific-*` 画背景。theme 的调色板是「普通」样式表规则
 *      （`body{--dsw-alias-bg-base:#fff}`），所以用带 `!important` 的
 *      样式表就能压过它，明暗两套各写一条（`body[data-ds-dark-theme]`）。
 *   2. **背景靠一个固定层**：#dsh-glass-shell-wall 是 fixed、z-index:-1 的
 *      div，直接垫在 body 后面；body 自身背景清成透明。图片/纯色/主题
 *      渐变都画在这一层，虚化也用它的 `filter: blur()` 做 —— 这样面板
 *      只要半透明，看上去就是「毛玻璃」，而且不需要给 shell 容器加
 *      backdrop-filter（那会生成 containing block，可能弄坏宿主的浮层）。
 *   3. **输入卡例外**：它盖在滚动的对话文字上，用真正的
 *      `backdrop-filter` 才能把从下面滚过的文字虚掉。
 *   4. **设置页**走官方的 `settings.section` 槽位（同 dsh-bili-scroll /
 *      dsh-meme），不用自己糊浮动按钮。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-glass-shell',
  factory: (require) => {
    'use strict'

    const React = require('react')
    const h = React.createElement

    /* ─────────────────────────── 常量 ─────────────────────────── */

    const SETTINGS_KEY = 'dsh-glass-shell.settings.v1'
    const IMAGE_KEY = 'dsh-glass-shell.image.v1'
    const SVG_ID = 'dsh-glass-shell-svg'
    const FILTER_ID = 'dsh-glass-shell-refract'
    // 折射只作用在「面板」上：两列、右栏、输入卡、弹层。
    const REFRACT_SELECTOR = '[class*="sidebarCol"], [class*="centerCol"], [data-rightbar-col],'
      + ' [data-composer-card], [role="dialog"], [role="alertdialog"], [data-menu-material]'
    const WALL_ID = 'dsh-glass-shell-wall'
    const CSS_ID = 'dsh-glass-shell-css'
    const PAGE_CSS_ID = 'dsh-glass-shell-page-css'

    // 常用底色：深色系配玻璃最出效果，浅色系给亮色主题用。
    // 8 个渐变方向：值是 CSS 关键字；label/箭头进设置页的 3×3 方向键盘。
    const GRAD_DIRS = [
      ['ul', '左上', '↖'], ['u', '向上', '↑'], ['ur', '右上', '↗'],
      ['l', '向左', '←'], null, ['r', '向右', '→'],
      ['dl', '左下', '↙'], ['d', '向下', '↓'], ['dr', '右下', '↘'],
    ]

    const GRAD_CSS = {
      r: 'to right', l: 'to left', d: 'to bottom', u: 'to top',
      dr: 'to bottom right', dl: 'to bottom left', ur: 'to top right', ul: 'to top left',
    }

    const PRESET_COLORS = ['#0e1626', '#1c1f26', '#10261f', '#241a3a', '#3a241c', '#e8eef7', '#f4efe6', '#f7e7ee']

    const DEFAULTS = Object.freeze({
      enabled: true,
      blur: 26,
      transparency: 42,
      saturation: 135,
      bgMode: 'theme', // theme | color | gradient | image
      bgColor: '#0e1626',
      gradA: '#f9d423',
      gradB: '#7c3aed',
      gradDir: 'dr', // ul u ur l r dl d dr（与 GRAD_CSS / GRAD_DIRS 的键一致）
      bgFit: 'cover', // cover | contain
      bgDim: 18,
      glass: false, // 折射玻璃模式（SVG 位移滤镜）
      refract: 45, // 0-100，映射到位移强度
    })

    const COPY = {
      zh: {
        navLabel: '毛玻璃',
        title: '毛玻璃外壳',
        intro: '侧边栏、输入框、卡片和弹层都会变成磨砂玻璃：背景层负责颜色/图片与虚化，面板只保留半透明底色。',
        enable: '启用毛玻璃',
        blur: '背景虚化',
        transparency: '面板透明度',
        glassMode: '折射玻璃模式',
        refract: '折射强度',
        glassNote: '开启后，面板不再靠半透明底色「糊」背景，而是把身后的像素真正掰弯（SVG 位移滤镜）：透明度拉到 100% 就只剩折射边缘。强度是像素级的，模糊也在滤镜里算，所以面板大小、宽高比都不会把画面拉变形；0 等于关掉位移。若显示异常，关掉这个开关即可。',
        saturation: '背景饱和度',
        background: '背景来源',
        modeTheme: '跟随主题',
        modeColor: '纯色',
        modeGradient: '渐变',
        modeImage: '图片',
        gradFrom: '起始颜色',
        gradTo: '结束颜色',
        gradDir: '渐变方向',
        gradHint: '点箭头选方向；色块在哪边，渐变就从那边开始。想反过来，点对角的箭头就行。',
        expand: '展开',
        collapse: '收起',
        gradSaved: '我的渐变',
        gradientsEmpty: '还没有收藏的渐变。调好两色和方向后点「存当前渐变」，这一整组就收进来了。',
        saveGradient: '存当前渐变',
        gradChips: '常用色（点一下设成这一边）',
        color: '背景颜色',
        image: '背景图片',
        pick: '选择图片',
        replace: '更换图片',
        clear: '清除',
        fit: '填充方式',
        fitCover: '铺满',
        fitContain: '完整',
        dim: '图片暗化',
        reset: '恢复默认',
        note: '「面板透明度」越高，玻璃越透、背景越明显；文字颜色始终跟随当前主题，不会跟着背景走。设置即时生效并保存在本机浏览器里。',
        noImage: '还没有图片',
        processing: '正在处理图片…',
        imageReady: '图片已保存。',
        imageFailed: '图片处理失败：',
        storageFull: '图片太大，浏览器本地存储放不下：这次已生效，但重启后会丢失，换一张小一点的图吧。',
        modeNote: '「跟随主题」用当前主题底色做一个很淡的渐变，不改变整体观感；想要明显的玻璃感，选「纯色」或「图片」。',
        quickColor: '直接选个颜色',
        quickColorNote: '点一下色块，背景立刻变成这个纯色（自动切到「纯色」并启用毛玻璃）；也可以在右边输入 #rrggbb。',
        recent: '最近使用',
        favorites: '我的常用',
        favoritesEmpty: '还没有收藏的颜色。挑好颜色后点「存当前色」就收进来了。',
        saveColor: '存当前色',
        forget: '从常用里删掉',
        eyeDropper: '屏幕取色',
        eyeUnsupported: '这个内核没提供 EyeDropper 接口，取不到窗口外的颜色。可以先用上面的取色器或直接贴色号；想跨窗口取色，装个系统取色小工具再把色号贴进来也行。',
        targetBg: '纯色',
        targetA: '渐变起始',
        targetB: '渐变结束',
        paletteHint: '点「最近使用」或「我的常用」里的色块会立刻生效；渐变模式下用右边的「纯色 / 起始 / 结束」决定改哪一个。最近使用最多留 14 个，常用最多 24 个。',
        resetNote: '把全部选项恢复成默认值（背景跟随主题）。',
        syncNote: '颜色、渐变和色板同时写进插件目录里的 store.json；换机器时把整个 glass-shell 文件夹拷走，装好就能看到现在这套配置。',
      },
      en: {
        navLabel: 'Glass',
        title: 'Glass shell',
        intro: 'The sidebar, composer, cards and overlays become frosted glass: the backdrop layer owns the colour or image plus the blur, panels keep only a translucent fill.',
        enable: 'Enable glass shell',
        blur: 'Backdrop blur',
        transparency: 'Panel transparency',
        glassMode: 'Refraction glass',
        refract: 'Refraction strength',
        glassNote: 'Panels stop faking it with a translucent fill and actually bend the pixels behind them (SVG displacement filter). At 100% transparency only the refracting rim remains. Strength is in pixels and the blur runs inside the same filter, so panel size and aspect ratio will not smear the result. 0 disables the warp. Turn it off if it renders oddly.',
        saturation: 'Backdrop saturation',
        background: 'Backdrop source',
        modeTheme: 'Theme',
        modeColor: 'Colour',
        modeGradient: 'Gradient',
        modeImage: 'Image',
        gradFrom: 'From',
        gradTo: 'To',
        gradDir: 'Direction',
        gradHint: 'Pick an arrow for the direction. Flip it by choosing the opposite corner.',
        expand: 'Show',
        collapse: 'Hide',
        gradSaved: 'Saved gradients',
        gradientsEmpty: 'No saved gradients yet. Dial in the two colours and direction, then press “Save gradient”.',
        saveGradient: 'Save gradient',
        gradChips: 'Saved colours (click to use on this side)',
        color: 'Backdrop colour',
        image: 'Backdrop image',
        pick: 'Choose image',
        replace: 'Replace image',
        clear: 'Remove',
        fit: 'Image fit',
        fitCover: 'Cover',
        fitContain: 'Contain',
        dim: 'Image dimming',
        reset: 'Reset to defaults',
        note: 'Higher transparency makes the glass see-through, so the backdrop shows more. Text keeps the current theme colours. Changes apply immediately and are stored in this browser.',
        noImage: 'No image yet',
        processing: 'Processing image…',
        imageReady: 'Image saved.',
        imageFailed: 'Could not process the image: ',
        storageFull: 'This image does not fit in browser storage: it applies now but is lost after a reload. Try a smaller image.',
        modeNote: 'Theme mode paints a very subtle gradient from the current theme background. Pick Colour or Image for a visible glass effect.',
        quickColor: 'Pick a colour',
        quickColorNote: 'One click turns the backdrop into that solid colour (switches to Colour and enables the glass shell). You can also type #rrggbb on the right.',
        recent: 'Recent',
        favorites: 'Saved',
        favoritesEmpty: 'Nothing saved yet. Pick a colour and press “Save colour”.',
        saveColor: 'Save colour',
        forget: 'Remove from saved',
        eyeDropper: 'Pick from screen',
        eyeUnsupported: 'This runtime exposes no EyeDropper API, so colours outside the window cannot be sampled. Use the picker or paste a hex value instead.',
        paletteHint: 'Clicking a recent or saved swatch applies it right away; in Gradient mode use the switch on the right to choose solid / start / end. Recent keeps 14, saved keeps 24.',
        targetBg: 'Solid',
        targetA: 'Gradient start',
        targetB: 'Gradient end',
        resetNote: 'Restore every option to its default (backdrop follows the theme).',
        syncNote: 'Colours, gradients and palettes are mirrored into store.json inside the plugin folder, so copying that folder carries this exact setup to another machine.',
      },
    }

    /* ─────────────────────────── 小工具 ─────────────────────────── */

    const clamp = (value, min, max, fallback) => {
      const number = Number(value)
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
    }

    function parseColor(input) {
      const text = String(input || '').trim()
      let match = /^#([0-9a-f]{3,8})$/i.exec(text)
      if (match) {
        let hex = match[1]
        if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(char => char + char).join('')
        if (hex.length >= 6) {
          return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
        }
        return null
      }
      match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text)
      if (match) return [Math.round(Number(match[1])), Math.round(Number(match[2])), Math.round(Number(match[3]))]
      return null
    }

    const toHex = rgb => '#' + rgb.map(channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')

    const shade = (rgb, factor) => rgb.map(channel => Math.max(0, Math.min(255, Math.round(channel * factor))))
    const rgbText = rgb => 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')'
    const rgbaText = (rgb, alpha) => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha.toFixed(3) + ')'

    function safeGet(key) {
      try { return localStorage.getItem(key) } catch { return null }
    }

    function safeSet(key, value) {
      try { localStorage.setItem(key, value); return true } catch { return false }
    }

    function normalize(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const mode = source.bgMode === 'color' || source.bgMode === 'image' || source.bgMode === 'gradient'
        ? source.bgMode
        : 'theme'
      return Object.freeze({
        enabled: source.enabled !== false,
        blur: Math.round(clamp(source.blur, 0, 48, DEFAULTS.blur)),
        transparency: Math.round(clamp(source.transparency, 0, 100, DEFAULTS.transparency)),
        saturation: Math.round(clamp(source.saturation, 80, 220, DEFAULTS.saturation)),
        bgMode: mode,
        bgColor: parseColor(source.bgColor) ? String(source.bgColor) : DEFAULTS.bgColor,
        gradA: parseColor(source.gradA) ? toHex(parseColor(source.gradA)) : DEFAULTS.gradA,
        gradB: parseColor(source.gradB) ? toHex(parseColor(source.gradB)) : DEFAULTS.gradB,
        gradDir: GRAD_CSS[source.gradDir] ? source.gradDir : DEFAULTS.gradDir,
        bgFit: source.bgFit === 'contain' ? 'contain' : 'cover',
        bgDim: Math.round(clamp(source.bgDim, 0, 85, DEFAULTS.bgDim)),
        glass: source.glass === true,
        refract: Math.round(clamp(source.refract, 0, 100, DEFAULTS.refract)),
      })
    }

    function loadSettings() {
      const stored = safeGet(SETTINGS_KEY)
      if (!stored) return normalize(DEFAULTS)
      try { return normalize(JSON.parse(stored)) } catch { return normalize(DEFAULTS) }
    }

    /* ─────────────────────────── 状态 ─────────────────────────── */

    let state = loadSettings()
    let savedImage = safeGet(IMAGE_KEY) || ''
    const listeners = new Set()
    let themeCache = { key: '', base: '' }

    function notify() {
      for (const listener of [...listeners]) {
        try { listener() } catch (error) { console.warn('[glass-shell] listener failed', error) }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    function update(patch) {
      state = normalize(Object.assign({}, state, patch))
      if (!safeSet(SETTINGS_KEY, JSON.stringify(state))) {
        console.warn('[glass-shell] could not persist settings')
      }
      scheduleStoreSync()
      paint()
      notify()
    }

    function updateImage(dataUrl) {
      savedImage = dataUrl || ''
      if (savedImage) safeSet(IMAGE_KEY, savedImage)
      else { try { localStorage.removeItem(IMAGE_KEY) } catch { /* ignore */ } }
      scheduleStoreSync()
      paint()
      notify()
    }

    /* ───────────────── 取色历史 / 常用色 ───────────────── */

    const PALETTE_KEY = 'dsh-glass-shell.palette.v1'
    const RECENT_LIMIT = 14
    const FAVORITE_LIMIT = 24
    const GRADIENT_LIMIT = 12

    function cleanColorList(value, limit) {
      if (!Array.isArray(value)) return []
      const seen = new Set()
      const out = []
      for (const item of value) {
        const rgb = parseColor(item)
        if (!rgb) continue
        const hex = toHex(rgb)
        if (seen.has(hex)) continue
        seen.add(hex)
        out.push(hex)
        if (out.length >= limit) break
      }
      return out
    }

    // 收藏的渐变：{ a, b, dir }，a/b 是十六进制，dir 是 GRAD_CSS 的键
    function cleanGradientList(value, limit) {
      if (!Array.isArray(value)) return []
      const seen = new Set()
      const out = []
      for (const item of value) {
        if (!item || typeof item !== 'object') continue
        const from = parseColor(item.a)
        const to = parseColor(item.b)
        if (!from || !to) continue
        const dir = GRAD_CSS[item.dir] ? item.dir : 'dr'
        const entry = { a: toHex(from), b: toHex(to), dir }
        const key = gradientKey(entry.a, entry.b, entry.dir)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(entry)
        if (out.length >= limit) break
      }
      return out
    }

    function gradientKey(a, b, dir) { return dir + '|' + a + '|' + b }

    function loadPalette() {
      const stored = safeGet(PALETTE_KEY)
      if (!stored) return { recent: [], favorites: [], gradients: [] }
      try {
        const raw = JSON.parse(stored)
        return {
          recent: cleanColorList(raw.recent, RECENT_LIMIT),
          favorites: cleanColorList(raw.favorites, FAVORITE_LIMIT),
          gradients: cleanGradientList(raw.gradients, GRADIENT_LIMIT),
        }
      } catch { return { recent: [], favorites: [], gradients: [] } }
    }

    let palette = loadPalette()

    function savePalette() {
      if (!safeSet(PALETTE_KEY, JSON.stringify(palette))) {
        console.warn('[glass-shell] could not persist the colour palette')
      }
      scheduleStoreSync()
    }

    /* ───────────────── 与插件目录同步（store.json） ───────────────── */
    // 状态平时只住在浏览器 localStorage 里，换机器就丢了；host 半端（index.js）把它
    // 镜像成 glass-shell/store.json，拷贝/打包整个目录即可带走当前配置。

    const STORE_KEY = 'dsh-glass-shell.store.v1'
    const STORE_URL = '/dsh-glass-shell/store.json'
    const STORE_IMAGE_LIMIT = 4_000_000

    let storeTimer = null
    let storePulling = false
    let storeAlive = true

    function localStamp() {
      const raw = safeGet(STORE_KEY)
      const value = raw ? Number(raw) : 0
      return Number.isFinite(value) && value > 0 ? value : 0
    }

    function markStamp(value) {
      const stamp = Number(value)
      safeSet(STORE_KEY, String(Number.isFinite(stamp) && stamp > 0 ? stamp : 0))
    }

    function currentBundle() {
      const bundle = { version: 1, settings: state, palette: palette, image: savedImage || '' }
      if (bundle.image.length > STORE_IMAGE_LIMIT) bundle.image = ''
      return bundle
    }

    function pushStore() {
      if (!storeAlive || typeof fetch !== 'function') return
      const payload = Object.assign(currentBundle(), { savedAt: Date.now() })
      let request
      try {
        request = fetch(STORE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } catch { return }
      Promise.resolve(request)
        .then(response => (response && response.ok ? response.json() : null))
        .then(result => { if (result && result.ok) markStamp(result.savedAt || payload.savedAt) })
        .catch(() => { /* 没装 host 半端时没有这个路由，安静跳过 */ })
    }

    function scheduleStoreSync() {
      if (!storeAlive) return
      if (storeTimer) clearTimeout(storeTimer)
      storeTimer = setTimeout(() => { storeTimer = null; pushStore() }, 800)
    }

    function adoptStore(remote) {
      if (!remote || typeof remote !== 'object') return false
      if (remote.settings && typeof remote.settings === 'object') {
        state = normalize(remote.settings)
        safeSet(SETTINGS_KEY, JSON.stringify(state))
      }
      if (remote.palette && typeof remote.palette === 'object') {
        if (safeSet(PALETTE_KEY, JSON.stringify(remote.palette))) palette = loadPalette()
      }
      if (typeof remote.image === 'string') {
        savedImage = remote.image
        if (savedImage) safeSet(IMAGE_KEY, savedImage)
        else { try { localStorage.removeItem(IMAGE_KEY) } catch { /* ignore */ } }
      }
      markStamp(remote.savedAt)
      paint()
      notify()
      return true
    }

    function syncStore() {
      if (!storeAlive || storePulling || typeof fetch !== 'function') return
      storePulling = true
      let request
      try { request = fetch(STORE_URL, { cache: 'no-store' }) } catch { storePulling = false; return }
      Promise.resolve(request)
        .then(response => (response && response.ok ? response.json() : null))
        .then(remote => {
          const stamp = remote && Number(remote.savedAt) ? Number(remote.savedAt) : 0
          // 插件目录里还没有快照（第一次装）：把本机这份写过去，store.json 就出现了。
          if (!stamp) { scheduleStoreSync(); return }
          // 插件目录里的快照更新（例如刚从另一台机器拷过来）就用它覆盖本机；
          // 否则把本机这份推上去。
          if (stamp > localStamp()) adoptStore(remote)
          else scheduleStoreSync()
        })
        .catch(() => { /* 路由不存在：只在本机用 localStorage */ })
        .then(() => { storePulling = false })
    }

    function recordColor(value) {
      const rgb = parseColor(value)
      if (!rgb) return
      const hex = toHex(rgb)
      if (palette.recent[0] === hex) return
      palette = Object.assign({}, palette, {
        recent: [hex, ...palette.recent.filter(item => item !== hex)].slice(0, RECENT_LIMIT),
      })
      savePalette()
      notify()
    }

    function toggleFavorite(value) {
      const rgb = parseColor(value)
      if (!rgb) return
      const hex = toHex(rgb)
      palette = Object.assign({}, palette, {
        favorites: palette.favorites.includes(hex)
          ? palette.favorites.filter(item => item !== hex)
          : [hex, ...palette.favorites].slice(0, FAVORITE_LIMIT),
      })
      savePalette()
      notify()
    }

    function saveGradient(a, b, dir) {
      const from = parseColor(a)
      const to = parseColor(b)
      if (!from || !to) return
      const entry = { a: toHex(from), b: toHex(to), dir: GRAD_CSS[dir] ? dir : 'dr' }
      const key = gradientKey(entry.a, entry.b, entry.dir)
      const rest = palette.gradients.filter(item => gradientKey(item.a, item.b, item.dir) !== key)
      palette = Object.assign({}, palette, { gradients: [entry, ...rest].slice(0, GRADIENT_LIMIT) })
      savePalette()
      notify()
    }

    function forgetGradient(key) {
      const rest = palette.gradients.filter(item => gradientKey(item.a, item.b, item.dir) !== key)
      if (rest.length === palette.gradients.length) return
      palette = Object.assign({}, palette, { gradients: rest })
      savePalette()
      notify()
    }

    function forgetFavorite(hex) {
      if (!palette.favorites.includes(hex)) return
      palette = Object.assign({}, palette, { favorites: palette.favorites.filter(item => item !== hex) })
      savePalette()
      notify()
    }

    /* ───────────────── 主题底色 / 背景层 ───────────────── */

    function themeBaseColor() {
      const body = document.body
      const dark = body.hasAttribute('data-ds-dark-theme')
      const source = document.documentElement.getAttribute('data-ds-theme-source') || ''
      const key = (dark ? 'dark' : 'light') + '|' + source
      if (themeCache.key === key && themeCache.base) return themeCache.base

      // ⚠️ 我们自己的样式表会把 body 背景改成透明，所以量底色时必须先摘掉它，
      //    量完立刻挂回去（同一个任务内，不会产生可见闪动）。
      const style = document.getElementById(CSS_ID)
      const removed = style !== null
      if (removed) style.remove()
      let measured = ''
      try { measured = getComputedStyle(body).backgroundColor || '' } catch { /* ignore */ }
      if (removed) document.head.appendChild(style)

      const base = parseColor(measured) ? measured : dark ? '#151517' : '#f9fafb'
      themeCache = { key, base }
      return base
    }

    function backdropSpec(settings) {
      const useImage = settings.bgMode === 'image' && savedImage !== ''
      if (useImage) {
        return {
          color: settings.bgColor,
          image: 'url("' + savedImage + '")',
          size: settings.bgFit === 'contain' ? 'contain' : 'cover',
          dim: settings.bgDim / 100,
        }
      }
      if (settings.bgMode === 'gradient') {
        const from = parseColor(settings.gradA) || [249, 212, 35]
        const to = parseColor(settings.gradB) || [124, 58, 237]
        // 两色平均当作底色，壁纸加载不上时也不会闪白。
        const mid = [0, 1, 2].map(i => Math.round((from[i] + to[i]) / 2))
        return {
          color: rgbText(mid),
          image: 'linear-gradient(' + GRAD_CSS[settings.gradDir] + ', ' + rgbText(from) + ' 0%, ' + rgbText(to) + ' 100%)',
          size: 'cover',
          dim: 0,
        }
      }
      const themeLike = settings.bgMode !== 'color'
      const base = parseColor(themeLike ? themeBaseColor() : settings.bgColor) || [245, 246, 248]
      // 很淡的渐变：让「虚化」在跟随主题时也有东西可糊，同时不改变整体观感。
      // 纯色模式给足对比，玻璃的层次才明显。
      const strong = !themeLike
      const highlight = shade(base, strong ? 1.32 : 1.06)
      const shadeDeep = shade(base, strong ? 0.52 : 0.88)
      return {
        color: rgbText(base),
        image: 'radial-gradient(120% 95% at 16% 0%, ' + rgbText(highlight) + ' 0%, rgba(0,0,0,0) 58%),'
          + 'linear-gradient(160deg, ' + rgbText(base) + ' 28%, ' + rgbText(shadeDeep) + ' 100%)',
        size: 'cover',
        dim: 0,
      }
    }

    /* ─────────────────────────── 玻璃 CSS ─────────────────────────── */

    function buildCss(settings) {
      // 上限放到 100%：alpha = 0，面板完全不画底色，只剩背景（和折射玻璃的边缘）。
      const alpha = Math.min(0.995, Math.max(0, 1 - settings.transparency / 100))
      const blur = Math.round(settings.blur)
      const saturation = Math.round(settings.saturation)
      const backdrop = backdropSpec(settings)
      const cardBlur = Math.max(10, blur)
      const menuBlur = Math.max(14, blur)

      const light = [252, 252, 253]
      const dark = [22, 24, 30]
      // 面板越往内层越实：mix(k) 把「还能透多少」按比例花掉，k=0 与底色一样透，
      // k=1 完全不透明。菜单/弹层 k 大一些好读，卡片小一些才有玻璃感。
      const mix = k => Math.min(0.99, Math.max(0, alpha + (1 - alpha) * k))

      const tokens = (tint, baseAlpha) => {
        const g = k => rgbaText(tint, Math.min(0.99, Math.max(0, baseAlpha + (1 - baseAlpha) * k)))
        return [
          // 画布底色整族置透明：frame / centerCol / bottomRow / 会话根 / dock 面板
          // 都画这一份底色，逐层叠起来玻璃就看不见了。真正的玻璃只画在「列」上。
          '  --dsw-alias-bg-base: transparent !important;',
          '  --dsw-alias-bg-layer-1: ' + g(0.16) + ' !important;',
          '  --dsw-alias-bg-layer-2: ' + g(0.28) + ' !important;',
          '  --dsw-alias-bg-layer-3: ' + g(0.40) + ' !important;',
          '  --dsw-alias-bg-overlay: ' + g(0.72) + ' !important;',
          '  --dsw-alias-bg-module-platform: ' + g(0.22) + ' !important;',
          '  --dsw-alias-bg-multi-select: ' + g(0.22) + ' !important;',
          '  --dsw-alias-card-fill: ' + g(0.22) + ' !important;',
          '  --dsw-alias-card-fill-hover: ' + g(0.32) + ' !important;',
          '  --dsw-alias-markdown-code-block: ' + g(0.28) + ' !important;',
          '  --dsw-alias-markdown-code-block-banner: ' + g(0.42) + ' !important;',
          '  --dsw-alias-markdown-inline-code: ' + g(0.28) + ' !important;',
          '  --dsw-specific-sidebar-fill: transparent !important;',
          '  --dsw-specific-sidebar-glass-fill: transparent !important;',
          '  --dsw-specific-sidebar-glass-collapsed-fill: transparent !important;',
          '  --dsw-specific-sidebar-wash-top: transparent !important;',
          '  --dsw-specific-sidebar-wash-bottom: transparent !important;',
          '  --dsw-specific-input-major: ' + g(0.52) + ' !important;',
          '  --dsw-specific-login-input: ' + g(0.22) + ' !important;',
          '  --dsw-specific-bubble: ' + g(0.32) + ' !important;',
          '  --dsw-specific-bubble-highlight: ' + g(0.52) + ' !important;',
          '  --dsw-specific-menu: ' + g(0.64) + ' !important;',
          '  --dsw-specific-selector: ' + g(0.38) + ' !important;',
          '  --dsw-specific-tip: ' + g(0.44) + ' !important;',
          '  --dsw-alias-menu-surface-fill: ' + g(0.64) + ' !important;',
          '  --dsw-alias-menu-group-header-fill: ' + g(0.64) + ' !important;',
        ].join('\n')
      }

      const centerFill = rgbaText(light, mix(0.10))
      const centerFillDark = rgbaText(dark, mix(0.10))
      const sideFill = rgbaText(light, mix(0.03))
      const sideFillDark = rgbaText(dark, mix(0.03))

      const lines = [
        '/* dsh-glass-shell — generated, do not edit */',
        'html, html body { background: transparent !important; }',
        '',
        '#' + WALL_ID + ' {',
        '  position: fixed;',
        '  inset: -64px;',
        '  z-index: -1;',
        '  pointer-events: none;',
        '  background-color: ' + backdrop.color + ';',
        '  background-image: ' + backdrop.image + ';',
        '  background-size: ' + backdrop.size + ';',
        '  background-position: center center;',
        '  background-repeat: no-repeat;',
        '  filter: blur(' + blur + 'px) saturate(' + saturation + '%);',
        '  transform: translateZ(0);',
        '}',
        '#' + WALL_ID + '::after {',
        '  content: "";',
        '  position: absolute;',
        '  inset: 0;',
        '  background: #000;',
        '  opacity: ' + backdrop.dim.toFixed(3) + ';',
        '}',
        '',
        '/* 玻璃色板：明/暗两套（theme 的调色板写在普通规则里，!important 压过去） */',
        'html body {',
        tokens(light, alpha),
        '}',
        'html body[data-ds-dark-theme] {',
        tokens(dark, alpha),
        '}',
        '',
        '/* 外壳骨架：框架本身透明，两个列各自画一层玻璃 */',
        'div:has(> [data-shell-overlay]) { background: transparent !important; }',
        'div:has(> [data-shell-overlay])::before { background: transparent !important; }',
        '[class*="sidebarCol"] {',
        '  background: ' + sideFill + ' !important;',
        '  border-right: 0.5px solid var(--dsw-alias-border-l1) !important;',
        '}',
        '[class*="centerCol"] { background: ' + centerFill + ' !important; }',
        'body[data-ds-dark-theme] [class*="sidebarCol"] { background: ' + sideFillDark + ' !important; }',
        'body[data-ds-dark-theme] [class*="centerCol"] { background: ' + centerFillDark + ' !important; }',
        '[data-shell-bottom] { background: transparent !important; }',
        '[data-rightbar-col] { background: ' + centerFill + ' !important; }',
        'body[data-ds-dark-theme] [data-rightbar-col] { background: ' + centerFillDark + ' !important; }',
        // 对话根画的是 --dsw-alias-bg-base（已置透明），不再需要单独清。
        '',
        '/* 输入卡：它盖在滚动文字上，用真 backdrop-filter 才糊得动下面的内容 */',
        '[data-composer-card] {',
        '  -webkit-backdrop-filter: blur(' + cardBlur + 'px) saturate(' + saturation + '%);',
        '  backdrop-filter: blur(' + cardBlur + 'px) saturate(' + saturation + '%);',
        '}',
        '',
        '/* 弹层 / 菜单：主题本来就给菜单配了毛玻璃，这里让强度跟着滑杆走 */',
        '[role="dialog"], [role="alertdialog"], [data-menu-material] {',
        '  -webkit-backdrop-filter: blur(' + menuBlur + 'px) saturate(' + saturation + '%);',
        '  backdrop-filter: blur(' + menuBlur + 'px) saturate(' + saturation + '%);',
        '}',
      ]

      if (settings.glass) {
        // 折射玻璃：整个背景效果搬进一个 SVG 滤镜（模糊 + 位移 + 饱和），
        // 这样面板本身可以完全不画底色，只「掰弯」身后的东西。
        // url() 形式的 backdrop-filter 是 Chromium 的能力，万一不支持就退回纯模糊。
        const useFilter = supportsUrlBackdrop()
        lines.push(
          '',
          '/* 折射玻璃模式：只对背景做折射，面板自身不加重色 */',
          REFRACT_SELECTOR + ' {',
          useFilter
            ? '  -webkit-backdrop-filter: url(#' + FILTER_ID + ');'
            : '  -webkit-backdrop-filter: blur(' + cardBlur + 'px) saturate(' + saturation + '%);',
          useFilter
            ? '  backdrop-filter: url(#' + FILTER_ID + ');'
            : '  backdrop-filter: blur(' + cardBlur + 'px) saturate(' + saturation + '%);',
          '}',
        )
      }

      return lines.join('\n')
    }

    /* ─────────────────────────── 折射玻璃（SVG 位移滤镜） ─────────────────────────── */

    // 生成一张 96×96 的法线贴图：圆角矩形的「斜面」高度场求梯度，
    // 中心平坦（编码成 128,128 = 不位移），四边和圆角处把背景往里挤，
    // 于是面板边缘看起来像一块有厚度的玻璃。
    let lensCache = ''

    function lensMap() {
      if (lensCache) return lensCache
      try {
        const size = 96
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d')
        if (!context) return ''
        const radius = 0.22
        const bevel = 0.20
        const height = (u, v) => {
          const qx = Math.abs(u - 0.5) - (0.5 - radius)
          const qy = Math.abs(v - 0.5) - (0.5 - radius)
          const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
          const sdf = outside + Math.min(Math.max(qx, qy), 0) - radius
          const inside = Math.max(0, -sdf)
          const t = Math.min(1, inside / bevel)
          return t * t * (3 - 2 * t)
        }
        const image = context.createImageData(size, size)
        const step = 1 / size
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const u = (x + 0.5) / size
            const v = (y + 0.5) / size
            // 梯度指向「高度增加」的方向，也就是从边缘指向内部。
            const gx = height(u + step, v) - height(u - step, v)
            const gy = height(u, v + step) - height(u, v - step)
            const length = Math.hypot(gx, gy) || 1
            // 取反：从内部指向边缘，位移方向朝外，边缘被「掰」成凹透镜。
            const nx = -gx / length
            const ny = -gy / length
            const weight = Math.min(1, Math.hypot(gx, gy) / (0.55 * step))
            const offset = (y * size + x) * 4
            image.data[offset] = Math.round(128 + nx * 127 * weight)
            image.data[offset + 1] = Math.round(128 + ny * 127 * weight)
            image.data[offset + 2] = 255
            image.data[offset + 3] = 255
          }
        }
        context.putImageData(image, 0, 0)
        lensCache = canvas.toDataURL('image/png')
        return lensCache
      } catch (error) {
        console.warn('[glass-shell] could not build the refraction map', error)
        return ''
      }
    }

    // 滤镜区域按面板包围盒铺（x/y/width/height 是 bbox 比例），但位移和模糊的数值用像素：
    // 这样同一个「折射强度」在任何尺寸的面板、任何宽高比上都是各向同性的。
    function filterMarkup(settings) {
      const map = lensMap()
      const soft = (Math.max(0, settings.blur) / 2).toFixed(2)
      const warp = (settings.refract / 100 * 40).toFixed(2)
      const saturate = (settings.saturation / 100).toFixed(2)
      return '<filter id="' + FILTER_ID + '" filterUnits="objectBoundingBox"'
        + ' x="-0.2" y="-0.2" width="1.4" height="1.4" color-interpolation-filters="sRGB">'
        + '<feImage href="' + map + '" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>'
        + '<feGaussianBlur in="SourceGraphic" stdDeviation="' + soft + '" result="soft"/>'
        + '<feDisplacementMap in="soft" in2="map" scale="' + warp + '" xChannelSelector="R" yChannelSelector="G" result="warp"/>'
        + '<feColorMatrix in="warp" type="saturate" values="' + saturate + '"/>'
        + '</filter>'
    }

    // backdrop-filter 能否直接引用 SVG 滤镜（Chromium 支持；不支持时退回纯模糊）。
    let urlBackdropSupport
    function supportsUrlBackdrop() {
      if (urlBackdropSupport === undefined) {
        urlBackdropSupport = typeof CSS === 'undefined' || typeof CSS.supports !== 'function'
          ? true
          : CSS.supports('backdrop-filter', 'url(#' + FILTER_ID + ')')
            || CSS.supports('-webkit-backdrop-filter', 'url(#' + FILTER_ID + ')')
      }
      return urlBackdropSupport
    }

    let filterSignature = ''

    function syncFilter() {
      const svg = document.getElementById(SVG_ID)
      if (!state.enabled || !state.glass || !supportsUrlBackdrop()) {
        svg?.remove()
        filterSignature = ''
        return
      }
      const signature = [state.blur, state.saturation, state.refract].join('|')
      if (svg && signature === filterSignature) return
      const host = svg || (() => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        node.id = SVG_ID
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('focusable', 'false')
        node.setAttribute('width', '0')
        node.setAttribute('height', '0')
        node.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none'
        document.body.appendChild(node)
        return node
      })()
      host.innerHTML = filterMarkup(state)
      filterSignature = signature
    }

    /* ─────────────────────────── 背景层生命周期 ─────────────────────────── */

    let rafId = 0

    function ensureNodes() {
      const body = document.body
      if (!body || !document.head) return false
      if (!document.getElementById(WALL_ID)) {
        const wall = document.createElement('div')
        wall.id = WALL_ID
        wall.setAttribute('aria-hidden', 'true')
        body.appendChild(wall)
      }
      if (!document.getElementById(CSS_ID)) {
        const style = document.createElement('style')
        style.id = CSS_ID
        style.setAttribute('data-plugin-css', 'dsh-glass-shell')
        document.head.appendChild(style)
      }
      syncFilter()
      return true
    }

    function removeSurface() {
      document.getElementById(SVG_ID)?.remove()
      filterSignature = ''
      document.getElementById(WALL_ID)?.remove()
      document.getElementById(CSS_ID)?.remove()
    }

    function paint() {
      if (!document.body) return
      if (!state.enabled) {
        removeSurface()
        return
      }
      try {
        if (!ensureNodes()) return
        const style = document.getElementById(CSS_ID)
        if (!style) return
        const next = buildCss(state)
        if (style.textContent !== next) style.textContent = next
      } catch (error) {
        console.warn('[glass-shell] could not build the glass stylesheet', error)
      }
    }

    function schedulePaint(retheme) {
      if (retheme) themeCache = { key: '', base: '' }
      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0
        paint()
      })
    }

    let observer = null
    let readyListener = null

    function start() {
      paint()
      if (observer || typeof MutationObserver !== 'function') return
      observer = new MutationObserver(() => schedulePaint(true))
      // 只是主题切换（明暗 / 跟随系统）需要重画；body 的 class 变化太频繁，别监听。
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-theme-source'] })
    }

    function stop() {
      observer?.disconnect()
      observer = null
      if (readyListener) {
        document.removeEventListener('DOMContentLoaded', readyListener)
        readyListener = null
      }
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0 }
      if (storeTimer) { clearTimeout(storeTimer); storeTimer = null }
      removeSurface()
      listeners.clear()
    }

    /* ─────────────────────────── 设置页样式 ─────────────────────────── */

    const PAGE_CSS = `
[data-gs-page]{display:flex;flex-direction:column;gap:16px;padding:2px 2px 10px;max-width:720px;box-sizing:border-box;}
[data-gs-intro]{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}
[data-gs-card]{display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:14px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);}
[data-gs-row]{display:grid;grid-template-columns:180px minmax(0,1fr) 64px;gap:12px;align-items:center;min-height:28px;}
[data-gs-row][data-gs-wide]{grid-template-columns:180px minmax(0,1fr);}
[data-gs-label]{font-size:13px;color:var(--dsw-alias-label-primary);}
[data-gs-value]{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;}
[data-gs-note]{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary);}
[data-gs-title]{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}
[data-gs-actions]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
input[data-gs-range]{-webkit-appearance:none;appearance:none;width:100%;height:16px;margin:0;background:transparent;cursor:pointer;}
input[data-gs-range]::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:var(--dsw-alias-border-l3);}
input[data-gs-range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;margin-top:-5px;
  border:0;border-radius:50%;background:var(--dsw-alias-label-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-base),0 1px 3px rgba(0,0,0,.35);}
button[data-gs-switch]{position:relative;width:40px;height:22px;padding:0;border:0;border-radius:11px;cursor:pointer;
  background:var(--dsw-alias-border-l3);transition:background .15s;}
button[data-gs-switch] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
button[data-gs-switch][data-on]{background:var(--dsw-alias-state-business-primary,#3b82f6);}
button[data-gs-switch][data-on] i{left:21px;}
[data-gs-seg]{display:inline-flex;gap:2px;padding:3px;border-radius:10px;width:max-content;
  background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);}
[data-gs-seg] button{padding:5px 12px;border:0;border-radius:7px;background:transparent;cursor:pointer;font-family:inherit;
  font-size:12px;color:var(--dsw-alias-label-secondary);}
[data-gs-seg] button[data-on]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground);}
[data-gs-btn]{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;font-size:12px;
  font-family:inherit;cursor:pointer;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
[data-gs-btn]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));}
[data-gs-btn][data-primary]{background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent;color:#fff;}
[data-gs-image]{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
[data-gs-thumb]{display:block;width:126px;height:70px;object-fit:cover;border-radius:10px;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}
[data-gs-empty]{font-size:11px;color:var(--dsw-alias-label-tertiary);}
[data-gs-swatches]{display:flex;flex-wrap:wrap;gap:9px;align-items:center;}
[data-gs-swatch]{position:relative;flex:0 0 auto;width:26px;height:26px;padding:0;border-radius:50%;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.16));transition:transform .12s ease;}
[data-gs-swatch]:hover{transform:scale(1.09);}
[data-gs-swatch][data-on]{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary,#3b82f6);}
[data-gs-swatch][data-on]:focus-visible,[data-gs-swatch]:focus-visible{outline:none;}
[data-gs-colors]{display:flex;flex-direction:column;gap:10px;min-width:0;}
[data-gs-palette-tools]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
[data-gs-palette-group]{display:block;min-width:0;margin-top:4px;}
[data-gs-list-head]{display:flex;align-items:center;gap:8px;cursor:pointer;
  list-style:none;padding:2px 0;user-select:none;}
[data-gs-list-head]::-webkit-details-marker{display:none;}
[data-gs-list-head]::marker{content:'';}
[data-gs-caret]{display:inline-block;width:12px;font-size:12px;line-height:1;
  color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;}
[data-gs-palette-group][open] [data-gs-caret]{transform:rotate(90deg);}
[data-gs-list-count]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);
  font-variant-numeric:tabular-nums;}
[data-gs-list]{display:flex;flex-direction:column;gap:6px;margin-top:6px;padding-left:20px;}
[data-gs-color-row],[data-gs-grad-row]{display:flex;align-items:center;gap:10px;min-height:40px;}
[data-gs-color-code],[data-gs-grad-code]{font-size:11px;line-height:16px;
  color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,monospace);}
[data-gs-grad-dir-name]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}
[data-gs-color-row] [data-gs-remove],[data-gs-grad-row] [data-gs-remove]{margin-left:auto;width:22px;height:22px;
  padding:0;display:flex;align-items:center;justify-content:center;border-radius:50%;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);
  color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1;cursor:pointer;opacity:.8;
  transition:opacity .12s ease,background .12s ease;}
[data-gs-color-row] [data-gs-remove]:hover,[data-gs-grad-row] [data-gs-remove]:hover{
  opacity:1;background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff;border-color:transparent;}
[data-gs-palette-label]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);min-width:46px;}
[data-gs-empty]{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}
[data-gs-palette-item]{position:relative;display:inline-flex;flex:0 0 auto;}
[data-gs-palette-item] [data-gs-remove]{position:absolute;top:-5px;right:-5px;width:15px;height:15px;padding:0;display:flex;
align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--dsw-alias-border-l2);
background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;
cursor:pointer;opacity:0;transition:opacity .12s ease;}
[data-gs-palette-item]:hover [data-gs-remove],[data-gs-palette-item] [data-gs-remove]:focus-visible{opacity:1;}
[data-gs-palette-item] [data-gs-remove]:hover{background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff;border-color:transparent;}
[data-gs-palette-tools] [data-gs-segmented]{flex:0 0 auto;}
[data-gs-grad-chips]{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
[data-gs-grad-chips] [data-gs-grad-chip]{flex:0 0 auto;width:18px;height:18px;padding:0;border-radius:5px;
border:1px solid var(--dsw-alias-border-l2);cursor:pointer;transition:transform .1s ease;}
[data-gs-grad-chips] [data-gs-grad-chip]:hover{transform:scale(1.12);}
[data-gs-grad-chips] [data-gs-grad-chip]:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#3b82f6);}
[data-gs-grad-actions]{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;}
[data-gs-grad-tools]{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;}
[data-gs-grad-tools] [data-gs-btn]{padding:4px 9px;font-size:11px;}
[data-gs-grad-saved]{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
[data-gs-grad-tile]{flex:0 0 auto;width:34px;height:34px;padding:0;border-radius:9px;
border:1px solid var(--dsw-alias-border-l2);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);
cursor:pointer;transition:transform .12s ease;}
[data-gs-grad-tile]:hover{transform:scale(1.06);}
[data-gs-grad-tile]:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#3b82f6);}
[data-gs-color]{padding:0;border:1px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;}
[data-gs-color]::-webkit-color-swatch-wrapper{padding:0;}
[data-gs-color]::-webkit-color-swatch{border:none;border-radius:50%;}
[data-gs-hex]{width:94px;height:28px;padding:0 8px;border-radius:8px;font:inherit;font-size:12px;
  font-family:var(--ds-font-family-code,ui-monospace,monospace);color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l2);background:transparent;}
[data-gs-hex]:focus{outline:none;border-color:var(--dsw-alias-state-business-primary,#3b82f6);}
[data-gs-grads]{display:flex;align-items:center;gap:18px;flex-wrap:wrap;}
[data-gs-grad-body]{display:flex;flex-direction:column;gap:10px;flex:1 1 220px;min-width:200px;}
[data-gs-grad-picks]{display:flex;gap:16px;flex-wrap:wrap;}
[data-gs-grad-pick]{display:inline-flex;align-items:center;gap:8px;font-size:12px;
  color:var(--dsw-alias-label-secondary);}
[data-gs-grad-swatch]{display:inline-flex;cursor:pointer;}
[data-gs-grad-pick] input[data-gs-hex]{width:88px;height:26px;font-size:11px;}
[data-gs-fill]{flex:0 0 auto;width:34px;height:34px;padding:0;border-radius:50%;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l2);background:transparent;}
[data-gs-fill]::-webkit-color-swatch-wrapper{padding:0;}
[data-gs-fill]::-webkit-color-swatch{border:none;border-radius:50%;}
[data-gs-fill]::-moz-color-swatch{border:none;border-radius:50%;}
[data-gs-grad-preview]{height:42px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12);}
[data-gs-dirs]{display:grid;grid-template-columns:repeat(3,28px);gap:5px;justify-content:start;}
[data-gs-dir]{width:28px;height:28px;padding:0;border-radius:8px;cursor:pointer;font-family:inherit;
  font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;
  border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}
[data-gs-dir]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary);}
[data-gs-dir][data-on]{background:var(--dsw-alias-state-business-primary,#3b82f6);border-color:transparent;color:#fff;}
[data-gs-dir-gap]{width:28px;height:28px;}
@media (prefers-reduced-motion:reduce){[data-gs-swatch]{transition:none;}}
[data-gs-notice]{font-size:11px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#f59e0b);}
@media (prefers-reduced-motion: reduce){button[data-gs-switch],button[data-gs-switch] i{transition:none;}}
`

    function ensurePageCss() {
      if (!document.head || document.getElementById(PAGE_CSS_ID)) return
      const style = document.createElement('style')
      style.id = PAGE_CSS_ID
      style.setAttribute('data-plugin-css', 'dsh-glass-shell/page')
      style.textContent = PAGE_CSS
      document.head.appendChild(style)
    }

    /* ─────────────────────── 图片压缩（本地存储有大小限制） ─────────────────────── */

    function compressImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('read failed'))
        reader.onload = () => {
          const image = new Image()
          image.onerror = () => reject(new Error('decode failed'))
          image.onload = () => {
            try {
              let longest = Math.min(2200, Math.max(image.width, image.height))
              for (let attempt = 0; attempt < 4; attempt += 1) {
                const scale = Math.min(1, longest / Math.max(image.width, image.height))
                const width = Math.max(1, Math.round(image.width * scale))
                const height = Math.max(1, Math.round(image.height * scale))
                const canvas = document.createElement('canvas')
                canvas.width = width
                canvas.height = height
                const context = canvas.getContext('2d')
                if (!context) throw new Error('canvas unavailable')
                context.drawImage(image, 0, 0, width, height)
                let dataUrl = canvas.toDataURL('image/webp', 0.86)
                if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.86)
                if (dataUrl.length <= 1_600_000) { resolve(dataUrl); return }
                longest = Math.round(longest * 0.72)
              }
              reject(new Error('too large'))
            } catch (error) {
              reject(error)
            }
          }
          image.src = String(reader.result)
        }
        reader.readAsDataURL(file)
      })
    }

    /* ─────────────────────────── 设置页组件 ─────────────────────────── */

    const currentLang = () => {
      const lang = document.documentElement.lang || navigator.language || 'en'
      return String(lang).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    const copyFor = lang => (lang === 'zh' ? COPY.zh : COPY.en)

    function useCopy() {
      const [lang, setLang] = React.useState(currentLang)
      React.useEffect(() => {
        if (typeof MutationObserver !== 'function') return undefined
        const observer = new MutationObserver(() => setLang(currentLang()))
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        return () => observer.disconnect()
      }, [])
      return copyFor(lang)
    }

    function Row(props) {
      return h('div', { 'data-gs-row': '', 'data-gs-wide': props.wide ? '' : undefined },
        h('span', { 'data-gs-label': '' }, props.label),
        h('div', null, props.children),
        props.wide ? null : h('span', { 'data-gs-value': '' }, props.value === undefined ? '' : props.value))
    }

    function Slider(props) {
      return h('input', {
        type: 'range',
        'data-gs-range': '',
        min: String(props.min),
        max: String(props.max),
        step: String(props.step === undefined ? 1 : props.step),
        value: String(props.value),
        'aria-label': props.label,
        onChange: event => props.onChange(Number(event.target.value)),
      })
    }

    function Segmented(props) {
      return h('div', { 'data-gs-seg': '', role: 'group' },
        props.options.map(option => h('button', {
          key: option[0],
          type: 'button',
          'data-on': option[0] === props.value ? '' : undefined,
          'aria-pressed': option[0] === props.value ? 'true' : 'false',
          onClick: () => props.onChange(option[0]),
        }, option[1])))
    }

    function Panel() {
      const copy = useCopy()
      const [, bump] = React.useReducer(counter => counter + 1, 0)
      React.useEffect(() => subscribe(bump), [])
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [hexDraft, setHexDraft] = React.useState(state.bgColor)
      React.useEffect(() => { setHexDraft(state.bgColor) }, [state.bgColor])
      const [gradADraft, setGradADraft] = React.useState(state.gradA)
      const [gradBDraft, setGradBDraft] = React.useState(state.gradB)
      React.useEffect(() => { setGradADraft(state.gradA) }, [state.gradA])
      React.useEffect(() => { setGradBDraft(state.gradB) }, [state.gradB])
      // 历史色块应用到哪儿：纯色背景 / 渐变起始 / 渐变结束（纯色模式下只能是 bg）
      const [target, setTarget] = React.useState('bg')
      const settings = state
      const image = savedImage

      const pickFile = async event => {
        const input = event.target
        const file = input.files && input.files[0]
        input.value = ''
        if (!file) return
        setBusy(true)
        setNotice('')
        try {
          const dataUrl = await compressImage(file)
          const fits = dataUrl.length <= 1_600_000
          const stored = safeSet(IMAGE_KEY, dataUrl)
          savedImage = dataUrl
          state = normalize(Object.assign({}, state, { bgMode: 'image', enabled: true }))
          safeSet(SETTINGS_KEY, JSON.stringify(state))
          paint()
          notify()
          setNotice(stored ? (fits ? copy.imageReady : copy.storageFull) : copy.storageFull)
        } catch (error) {
          setNotice(copy.imageFailed + (error && error.message ? error.message : String(error)))
        } finally {
          setBusy(false)
        }
      }

      const backgroundRow = h(Row, { label: copy.background, wide: true },
        h(Segmented, {
          value: settings.bgMode,
          options: [['theme', copy.modeTheme], ['color', copy.modeColor], ['gradient', copy.modeGradient], ['image', copy.modeImage]],
          onChange: mode => {
            setNotice('')
            if (mode !== 'gradient') setTarget('bg')
            update({ bgMode: mode })
          },
        }))

      // 一眼可见的取色区：点色块 = 立刻把这个纯色设为背景（顺带切到纯色模式并启用）。
      const applyColor = value => {
        const rgb = parseColor(value)
        if (!rgb) return false
        const hex = toHex(rgb)
        recordColor(hex)
        setHexDraft(hex)
        setNotice('')
        update({ bgColor: hex, bgMode: 'color', enabled: true })
        return true
      }

      const commitHex = () => {
        if (!applyColor(hexDraft)) setHexDraft(settings.bgColor)
      }

      // 只有渐变模式下 target 才有意义；切回别的模式时按纯色处理，避免误改渐变起始/结束色
      const activeTarget = settings.bgMode === 'gradient' ? target : 'bg'
      const targetColor = () => activeTarget === 'a' ? settings.gradA : activeTarget === 'b' ? settings.gradB : settings.bgColor

      // 历史 / 常用色块：按当前 target 应用。纯色模式下 target 恒为 bg，行为与预设色块一致。
      // which: 'a' | 'b' 改渐变某一边，其余一律当纯色背景
      const applyTo = (which, value) => {
        const rgb = parseColor(value)
        if (!rgb) return
        const hex = toHex(rgb)
        recordColor(hex)
        if (which === 'a') useGradient({ gradA: hex })
        else if (which === 'b') useGradient({ gradB: hex })
        else applyColor(hex)
      }

      const applySwatch = value => applyTo(activeTarget, value)

      // 屏幕取色：EyeDropper 是浏览器接口，在 Chromium 里是系统级吸管，能取到窗口外的像素。
      // which 由调用的按钮决定：纯色按钮给 activeTarget，渐变每一支各自传 'a' / 'b'。
      const pickFromScreen = async which => {
        const Ctor = typeof window !== 'undefined' ? window.EyeDropper : undefined
        if (typeof Ctor !== 'function') {
          setNotice(copy.eyeUnsupported)
          return
        }
        setNotice('')
        try {
          const result = await new Ctor().open()
          if (result && result.sRGBHex) applyTo(which, result.sRGBHex)
        } catch { /* 按 Esc 取消，保持安静 */ }
      }

      // 34×34 的尺寸直接写进 inline style：外面怎么 flex 挤压，都不会被压成一条细线
      const blockBox = radius => ({
        width: '34px',
        height: '34px',
        minWidth: '34px',
        minHeight: '34px',
        flex: '0 0 auto',
        boxSizing: 'border-box',
        borderRadius: radius,
        padding: '0',
      })

      const paletteSwatch = (hex, kind) => h('button', {
        key: hex,
        type: 'button',
        'data-gs-swatch': '',
        'data-gs-palette-swatch': kind,
        style: Object.assign(blockBox('10px'), { background: hex }),
        title: hex,
        'aria-label': hex,
        onClick: () => applySwatch(hex),
      })

      const removeButton = (onClick, extra) => h('button', Object.assign({
        type: 'button',
        'data-gs-remove': '',
        title: copy.forget,
        'aria-label': copy.forget,
        onClick,
      }, extra || {}), '\u00d7')

      const colorLine = (hex, kind) => h('div', { key: hex, 'data-gs-color-row': '' },
        h('span', { 'data-gs-palette-item': '' }, paletteSwatch(hex, kind)),
        h('span', { 'data-gs-color-code': '' }, hex),
        kind === 'favorite' ? removeButton(() => forgetFavorite(hex)) : null)

      const favoriteItem = hex => colorLine(hex, 'favorite')
      const recentItem = hex => colorLine(hex, 'recent')

      // 折叠块用原生 <details>/<summary>：开合完全由浏览器负责，不依赖 React 状态，
      // 所以不管面板被重渲染几次，点一下一定开/合。
      const listBlock = (key, label, rows, emptyText, groupAttrs) => h('details',
        Object.assign({ 'data-gs-palette-group': key }, groupAttrs || {}),
        h('summary', {
          'data-gs-list-head': '',
          // 双保险：万一宿主把 summary 的默认开合拦掉了（preventDefault），这里自己翻一下
          onClick: event => {
            const box = event.currentTarget && event.currentTarget.parentElement
            if (!box) return
            event.preventDefault()
            box.open = !box.open
          },
        },
        h('span', { 'data-gs-caret': '', 'aria-hidden': 'true' }, '\u203a'),
          h('span', { 'data-gs-palette-label': '' }, label),
          h('span', { 'data-gs-list-count': '' }, String(rows.length))),
        rows.length
          ? h('div', { 'data-gs-list': key }, rows)
          : h('span', { 'data-gs-empty': '' }, emptyText))

      const slotRow = children => h('div', { 'data-gs-swatches': '' }, children)

      const colorRow = h(Row, { label: copy.quickColor, wide: true },
        h('div', { 'data-gs-colors': '' },
          slotRow([
            PRESET_COLORS.map(hex => h('button', {
              key: hex,
              type: 'button',
              'data-gs-swatch': '',
              'data-on': settings.bgMode === 'color' && String(settings.bgColor).toLowerCase() === hex ? '' : undefined,
              style: { background: hex },
              title: hex,
              'aria-label': hex,
              onClick: () => applyColor(hex),
            })),
            h('input', {
              type: 'color',
              'data-gs-swatch': '',
              'data-gs-color': '',
              value: settings.bgColor,
              title: copy.hex,
              'aria-label': copy.hex,
              onChange: event => applyColor(event.target.value),
            }),
            h('input', {
              type: 'text',
              'data-gs-hex': '',
              value: hexDraft,
              spellCheck: false,
              placeholder: '#rrggbb',
              'aria-label': copy.hex,
              onChange: event => setHexDraft(event.target.value),
              onBlur: commitHex,
              onKeyDown: event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitHex()
                }
              },
            }),
          ]),
          h('div', { 'data-gs-palette-tools': '' },
            h('button', {
              type: 'button',
              'data-gs-btn': '',
              'data-primary': '',
              'data-gs-eye': '',
              onClick: () => pickFromScreen(activeTarget),
            }, copy.eyeDropper),
            settings.bgMode === 'gradient'
              ? h(Segmented, {
                value: target,
                options: [['bg', copy.targetBg], ['a', copy.targetA], ['b', copy.targetB]],
                onChange: value => setTarget(value),
              })
              : null,
            h('button', {
              type: 'button',
              'data-gs-btn': '',
              'data-gs-fav': '',
              onClick: () => toggleFavorite(targetColor()),
            }, copy.saveColor)),
          h('p', { 'data-gs-note': '' }, copy.paletteHint),
          palette.recent.length
            ? listBlock('recent', copy.recent, palette.recent.map(recentItem), '')
            : null,
          listBlock('favorites', copy.favorites, palette.favorites.map(favoriteItem), copy.favoritesEmpty)))

      // 渐变：两种颜色 + 8 个方向。只动 gradient 自己的字段，纯色模式的 bgColor 完全不受影响。
      const asHex = (value, fallback) => {
        const rgb = parseColor(value)
        return rgb ? toHex(rgb) : fallback
      }

      const useGradient = patch => {
        setNotice('')
        update(Object.assign({ bgMode: 'gradient', enabled: true }, patch))
      }

      // 渐变的两支色号输入：回车 / 失焦生效；写错了退回当前值（与纯色那个 hex 输入同一套路）。
      const commitGradient = (which, value) => {
        const fallback = which === 'a' ? settings.gradA : settings.gradB
        const rgb = parseColor(value)
        if (!rgb) {
          if (which === 'a') setGradADraft(fallback)
          else setGradBDraft(fallback)
          return
        }
        const hex = toHex(rgb)
        recordColor(hex)
        useGradient(which === 'a' ? { gradA: hex } : { gradB: hex })
      }

      const gradHex = which => h('input', {
        type: 'text',
        'data-gs-hex': '',
        'data-gs-grad-hex': which,
        value: which === 'a' ? gradADraft : gradBDraft,
        spellCheck: false,
        placeholder: '#rrggbb',
        'aria-label': which === 'a' ? copy.gradFrom : copy.gradTo,
        onChange: event => (which === 'a' ? setGradADraft : setGradBDraft)(event.target.value),
        onBlur: event => commitGradient(which, event.target.value),
        onKeyDown: event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitGradient(which, event.currentTarget.value)
          }
        },
      })

      // 渐变的两支颜色下面各挂一排「常用色」小块：点一下直接设成这一边的颜色
      const gradChips = which => {
        const list = []
        for (const hex of palette.favorites.concat(palette.recent)) {
          if (list.includes(hex)) continue
          list.push(hex)
          if (list.length >= 10) break
        }
        if (!list.length) return null
        return h('div', { 'data-gs-grad-chips': which, role: 'group', 'aria-label': copy.gradChips },
          list.map(hex => h('button', {
            key: hex,
            type: 'button',
            'data-gs-grad-chip': which,
            'data-color': hex,
            style: { background: hex },
            title: hex,
            'aria-label': hex,
            onClick: () => {
              recordColor(hex)
              useGradient(which === 'a' ? { gradA: hex } : { gradB: hex })
            },
          })))
      }

      // 渐变每一支自己的屏幕取色按钮：只改这一边
      const gradEye = which => h('button', {
        type: 'button',
        'data-gs-btn': '',
        'data-gs-grad-eye': which,
        title: copy.eyeDropper,
        'aria-label': copy.eyeDropper,
        onClick: () => pickFromScreen(which),
      }, copy.eyeDropper)

      // 收藏的渐变：整组（两色 + 方向）存下来，显示成一块真的渐变小块
      const applySavedGradient = item => {
        recordColor(item.a)
        recordColor(item.b)
        setGradADraft(item.a)
        setGradBDraft(item.b)
        useGradient({ gradA: item.a, gradB: item.b, gradDir: item.dir })
      }

      const dirLabel = dir => {
        const hit = GRAD_DIRS.find(entry => entry && entry[0] === dir)
        return hit ? hit[1] : dir
      }

      const savedGradientTile = item => {
        const key = gradientKey(item.a, item.b, item.dir)
        return h('div', { key, 'data-gs-grad-row': '' },
          h('span', { 'data-gs-palette-item': '' },
            h('button', {
              type: 'button',
              'data-gs-grad-tile': item.dir + '|' + item.a + '|' + item.b,
              style: Object.assign(blockBox('10px'), {
                backgroundImage: 'linear-gradient(' + GRAD_CSS[item.dir] + ', ' + item.a + ' 0%, ' + item.b + ' 100%)',
              }),
              title: item.a + ' → ' + item.b + ' (' + dirLabel(item.dir) + ')',
              'aria-label': item.a + ' → ' + item.b,
              onClick: () => applySavedGradient(item),
            })),
          h('span', { 'data-gs-grad-code': '' }, item.a + ' → ' + item.b),
          h('span', { 'data-gs-grad-dir-name': '' }, dirLabel(item.dir)),
          removeButton(() => forgetGradient(key)))
      }

      const savedGradients = listBlock('gradients', copy.gradSaved, palette.gradients.map(savedGradientTile),
        copy.gradientsEmpty, { 'data-gs-grad-saved': '' })

      const gradientRow = h(Row, { label: copy.modeGradient, wide: true },
        h('div', { 'data-gs-grads': '' },
          h('div', { 'data-gs-grad-body': '' },
            h('div', { 'data-gs-grad-picks': '' },
              h('div', { 'data-gs-grad-pick': '' },
                h('label', { 'data-gs-grad-swatch': '' },
                  h('input', {
                    type: 'color',
                    'data-gs-fill': '',
                    'data-gs-grad-a': '',
                    value: settings.gradA,
                    'aria-label': copy.gradFrom,
                    onChange: event => {
                      const hex = asHex(event.target.value, settings.gradA)
                      recordColor(hex)
                      useGradient({ gradA: hex })
                    },
                  })),
                h('span', { 'data-gs-grad-name': '' }, copy.gradFrom),
                gradHex('a'),
                h('div', { 'data-gs-grad-tools': 'a' }, gradEye('a')),
                gradChips('a')),
              h('div', { 'data-gs-grad-pick': '' },
                h('label', { 'data-gs-grad-swatch': '' },
                  h('input', {
                    type: 'color',
                    'data-gs-fill': '',
                    'data-gs-grad-b': '',
                    value: settings.gradB,
                    'aria-label': copy.gradTo,
                    onChange: event => {
                      const hex = asHex(event.target.value, settings.gradB)
                      recordColor(hex)
                      useGradient({ gradB: hex })
                    },
                  })),
                h('span', { 'data-gs-grad-name': '' }, copy.gradTo),
                gradHex('b'),
                h('div', { 'data-gs-grad-tools': 'b' }, gradEye('b')),
                gradChips('b'))),
            h('div', {
              'data-gs-grad-preview': '',
              'aria-label': copy.gradDir,
              style: { backgroundImage: 'linear-gradient(' + GRAD_CSS[settings.gradDir] + ', ' + settings.gradA + ' 0%, ' + settings.gradB + ' 100%)' },
            })),
          h('div', { 'data-gs-dirs': '', role: 'group', 'aria-label': copy.gradDir },
            GRAD_DIRS.map((item, index) => item
              ? h('button', {
                key: item[0],
                type: 'button',
                'data-gs-dir': item[0],
                'data-on': settings.gradDir === item[0] ? '' : undefined,
                title: item[1],
                'aria-label': item[1],
                'aria-pressed': settings.gradDir === item[0] ? 'true' : 'false',
                onClick: () => useGradient({ gradDir: item[0] }),
              }, item[2])
              : h('span', { key: 'gap-' + index, 'data-gs-dir-gap': '' }))),
          h('div', { 'data-gs-grad-actions': '' },
            h('button', {
              type: 'button',
              'data-gs-btn': '',
              'data-primary': '',
              'data-gs-grad-save': '',
              onClick: () => saveGradient(settings.gradA, settings.gradB, settings.gradDir),
            }, copy.saveGradient)),
          savedGradients))

      const imageRow = h(Row, { label: copy.image, wide: true },
        h('div', { 'data-gs-image': '' },
          image
            ? h('img', { 'data-gs-thumb': '', src: image, alt: copy.image })
            : h('span', { 'data-gs-empty': '' }, copy.noImage),
          h('label', { 'data-gs-btn': '', 'data-primary': '' },
            busy ? copy.processing : image ? copy.replace : copy.pick,
            h('input', {
              type: 'file',
              accept: 'image/*',
              style: { display: 'none' },
              onChange: pickFile,
            })),
          image
            ? h('button', {
              type: 'button',
              'data-gs-btn': '',
              onClick: () => {
                updateImage('')
                update({ bgMode: 'theme' })
                setNotice('')
              },
            }, copy.clear)
            : null))

      const fitRow = h(Row, { label: copy.fit, wide: true },
        h(Segmented, {
          value: settings.bgFit,
          options: [['cover', copy.fitCover], ['contain', copy.fitContain]],
          onChange: fit => update({ bgFit: fit }),
        }))

      return h('div', { 'data-gs-page': '' },
        h('div', null,
          h('div', { 'data-gs-title': '' }, copy.title),
          h('p', { 'data-gs-intro': '' }, copy.intro)),

        h('div', { 'data-gs-card': '' },
          h('div', { 'data-gs-row': '', 'data-gs-wide': '' },
            h('span', { 'data-gs-label': '' }, copy.enable),
            h('div', null, h('button', {
              type: 'button',
              'data-gs-switch': '',
              'data-on': settings.enabled ? '' : undefined,
              'aria-pressed': settings.enabled ? 'true' : 'false',
              'aria-label': copy.enable,
              onClick: () => update({ enabled: !settings.enabled }),
            }, h('i')))),
          h(Row, { label: copy.blur, value: settings.blur + 'px' },
            h(Slider, { label: copy.blur, value: settings.blur, min: 0, max: 48, onChange: value => update({ blur: value }) })),
          h(Row, { label: copy.transparency, value: settings.transparency + '%' },
            h(Slider, { label: copy.transparency, value: settings.transparency, min: 0, max: 100, onChange: value => update({ transparency: value }) })),
          h('div', { 'data-gs-row': '', 'data-gs-wide': '' },
            h('span', { 'data-gs-label': '' }, copy.glassMode),
            h('div', null, h('button', {
              type: 'button',
              'data-gs-switch': '',
              'data-gs-glass': '',
              'data-on': settings.glass ? '' : undefined,
              'aria-pressed': settings.glass ? 'true' : 'false',
              'aria-label': copy.glassMode,
              onClick: () => update({ glass: !settings.glass }),
            }, h('i')))),
          settings.glass
            ? h(Row, { label: copy.refract, value: settings.refract + '%' },
              h(Slider, { label: copy.refract, value: settings.refract, min: 0, max: 100, onChange: value => update({ refract: value }) }))
            : null,
          settings.glass ? h('p', { 'data-gs-note': '', 'data-gs-glass-note': '' }, copy.glassNote) : null,
          h(Row, { label: copy.saturation, value: settings.saturation + '%' },
            h(Slider, { label: copy.saturation, value: settings.saturation, min: 80, max: 220, onChange: value => update({ saturation: value }) }))),

        h('div', { 'data-gs-card': '' },
          backgroundRow,
          settings.bgMode === 'gradient' ? gradientRow : null,
          settings.bgMode === 'gradient' ? h('p', { 'data-gs-note': '' }, copy.gradHint) : null,
          colorRow,
          h('p', { 'data-gs-note': '' }, copy.quickColorNote),
          settings.bgMode === 'image' ? imageRow : null,
          settings.bgMode === 'image' ? fitRow : null,
          settings.bgMode === 'image'
            ? h(Row, { label: copy.dim, value: settings.bgDim + '%' },
              h(Slider, { label: copy.dim, value: settings.bgDim, min: 0, max: 85, onChange: value => update({ bgDim: value }) }))
            : null,
          settings.bgMode === 'theme' ? h('p', { 'data-gs-note': '' }, copy.modeNote) : null),

        notice ? h('p', { 'data-gs-notice': '' }, notice) : null,

        h('div', { 'data-gs-actions': '' },
          h('button', {
            type: 'button',
            'data-gs-btn': '',
            onClick: () => {
              update(Object.assign({}, DEFAULTS))
              setNotice('')
            },
          }, copy.reset),
          h('span', { 'data-gs-note': '' }, copy.resetNote)),

        h('p', { 'data-gs-note': '', 'data-gs-sync-note': '' }, copy.syncNote),
        h('p', { 'data-gs-note': '' }, copy.note))
    }

    /* ─────────────────────────── 生命周期 ─────────────────────────── */

    function boot() {
      try {
        ensurePageCss()
        if (document.body) { start(); syncStore(); return }
        readyListener = () => { readyListener = null; start(); syncStore() }
        document.addEventListener('DOMContentLoaded', readyListener, { once: true })
      } catch (error) {
        console.warn('[glass-shell] boot failed', error)
      }
    }

    return {
      name: 'dsh-glass-shell-client',
      inject: ['slots'],
      apply(ctx) {
        boot()
        ctx.effect(() => () => stop(), 'dsh-glass-shell: glass surface')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) {
          console.warn('[glass-shell] slots service is unavailable; the settings page is not registered')
          return
        }
        try {
          slots.inject('settings.section', () => slots.register(
            {
              name: 'settings.section',
              id: 'dsh-glass-shell',
              order: 34,
              label: copyFor(currentLang()).navLabel,
            },
            () => h(Panel),
          ))
        } catch (error) {
          console.warn('[glass-shell] could not register the settings section', error)
        }
      },
    }
  },
})
