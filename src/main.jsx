import { Fragment, StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { strToU8, zipSync } from 'fflate'
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  ChevronDown,
  CircleCheck,
  ClipboardPaste,
  Command as CommandIcon,
  Copy,
  CornerDownLeft,
  Download,
  Eye,
  GripVertical,
  Image,
  LayoutTemplate,
  Languages,
  Link,
  Library,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Plus,
  Settings2,
  Sparkles,
  SquareMousePointer,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  Undo2,
  Redo2,
  Search,
  X,
} from 'lucide-react'
import {
  BLOCK_LIBRARY_LIMIT,
  BLOCK_LIBRARY_STORAGE_KEY,
  COMPONENT_DEFINITIONS,
  COMPONENT_GROUPS,
  COMPONENT_GROUP_TYPES,
  CONTENT_RECIPES,
  CONTENT_RESET_FIELDS,
  DEFAULT_PAGE_META,
  DRAFT_STORAGE_KEY,
  EDITOR_OPTIONS,
  INITIAL_BLOCKS,
  PAGE_SCHEMA_VERSION,
  PAGE_TEMPLATES,
  PAGE_THEMES,
  VISUAL_RECIPE_ITEMS,
  VISUAL_RECIPES,
  cloneConfig,
  createBlockDefaults,
  createNewItem,
  createStyleDefaults,
  itemEditorFor,
} from './app-config'
import {
  loadInterfaceLanguage,
  localizeCollection,
  localizeComponent,
  localizeContent,
  localizeGroups,
  localizeOptions,
  saveInterfaceLanguage,
  translateInterface,
} from './i18n'
import './styles.css'

const ICON_COMPONENTS = {
  layout: LayoutTemplate,
  sparkles: Sparkles,
  pointer: SquareMousePointer,
  image: Image,
  type: Type,
}
const initialBlocks = INITIAL_BLOCKS
const componentItems = COMPONENT_DEFINITIONS.map((item) => ({ ...item, icon: ICON_COMPONENTS[item.icon] ?? LayoutTemplate }))

const SUPPORTED_BLOCK_TYPES = new Set([...componentItems.map((item) => item.type), 'contact'])

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

function safeHref(value = '') {
  const href = String(value).trim()
  return /^(https?:|mailto:|tel:|\/|#|page:)/i.test(href) ? href : ''
}

function safeAnchor(value = '') {
  return String(value).trim().replace(/^#/, '').replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 64)
}

function safeFileName(value = '') {
  return String(value).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, '-').replace(/[. ]+$/g, '').slice(0, 50) || 'pagecraft-site'
}

function pageLinkId(value = '') {
  const match = String(value).trim().match(/^page:([^#]+)(?:#.*)?$/i)
  return match ? match[1] : ''
}

function pageFileName(page, index) {
  return index === 0 ? 'index.html' : `${safeFileName(page.slug || page.id || `page-${index + 1}`)}.html`
}

function resolveSiteHref(value, pages = []) {
  const rawHref = safeHref(value)
  const targetId = pageLinkId(rawHref)
  if (!targetId) return rawHref
  const targetIndex = pages.findIndex((page) => page.id === targetId)
  if (targetIndex < 0) return ''
  const hash = String(rawHref).includes('#') ? `#${safeAnchor(String(rawHref).split('#').slice(1).join('#'))}` : ''
  return `${pageFileName(pages[targetIndex], targetIndex)}${hash}`
}

function uniqueBlockId(type, blocks = []) {
  const base = `${type}-${Date.now()}`
  const usedIds = new Set(blocks.map((block) => String(block.id)))
  let id = base
  let suffix = 2
  while (usedIds.has(id)) id = `${base}-${suffix++}`
  return id
}

function safeImageSource(value = '') {
  const source = String(value).trim()
  return /^(https?:\/\/|data:image\/)/i.test(source) ? source : ''
}

function safeCssImageSource(value = '') {
  return safeImageSource(value).replace(/["'()\\\n\r]/g, (character) => encodeURIComponent(character))
}

function auditPage(blocks, meta = DEFAULT_PAGE_META, sitePages = [], language = 'zh') {
  const en = language === 'en'
  const issues = []
  if (!blocks.length) {
    return [{ id: 'page-empty', blockId: null, title: en ? 'The page is empty' : '页面还是空的', detail: en ? 'Add at least a hero, text, or image section before exporting.' : '请至少添加一个首屏、文字或图片区块后再导出。' }]
  }
  if (!String(meta.title ?? '').trim()) {
    issues.push({ id: 'page-title', blockId: null, title: en ? 'Missing page title' : '缺少网页标题', detail: en ? 'The page title appears in browser tabs and search results. Add one before publishing.' : '网页标题会显示在浏览器标签和搜索结果中，建议补充后再发布。' })
  }
  if (!String(meta.description ?? '').trim()) {
    issues.push({ id: 'page-description', blockId: null, title: en ? 'Missing page description' : '缺少网页描述', detail: en ? 'A short description improves link previews and helps search engines understand the page.' : '补充一段简短描述，有助于分享预览和搜索引擎理解页面。' })
  }
  const anchors = new Set(blocks.map((block) => safeAnchor(block.anchor)).filter(Boolean))
  const pageIds = new Set(sitePages.map((page) => page.id))
  const addIssue = (block, kind, title, detail) => issues.push({ id: `${block.id}-${kind}-${issues.length}`, blockId: block.id, title, detail })
  blocks.forEach((block) => {
    const blockName = localizeComponent(componentItems.find((item) => item.type === block.type) ?? { type: block.type, label: block.label }, language).label ?? block.label
    if (!String(block.title ?? '').trim() && !['image', 'marquee'].includes(block.type)) {
      addIssue(block, 'title', en ? 'Missing section title' : '缺少区块标题', en ? `${blockName} does not have a recognizable title.` : `${block.label} 还没有可识别的标题。`)
    }
    if (block.imageUrl && ['image', 'split', 'immersive', 'fullscreen'].includes(block.type) && !String(block.altText ?? '').trim()) {
      addIssue(block, 'alt', en ? 'Add alternative text' : '建议补充替代文字', en ? `${blockName} is using its title as the image description.` : `${block.label} 正在用标题代替图片说明。`)
    }
    const embeddedImages = [block.imageUrl, block.backgroundImage, ...(block.items ?? []).map((item) => item.imageUrl)].filter((value) => String(value ?? '').startsWith('data:image/'))
    if (embeddedImages.some((value) => value.length > 2_000_000)) {
      addIssue(block, 'large-image', en ? 'Large embedded image' : '内嵌图片体积较大', en ? `${blockName} contains a large local image that may slow the exported HTML.` : `${block.label} 含有较大的本地图片，可能让导出的 HTML 加载变慢。`)
    }
    if (block.url && !safeHref(block.url)) {
      addIssue(block, 'url', en ? 'Invalid button link' : '按钮链接无效', en ? `${blockName} uses an unsupported link protocol.` : `${block.label} 的链接协议不受支持。`)
    }
    if (pageLinkId(block.url) && !pageIds.has(pageLinkId(block.url))) {
      addIssue(block, 'page-url', en ? 'Button points to a missing page' : '按钮指向不存在的页面', en ? `The internal page linked from ${blockName} may have been deleted.` : `${block.label} 的站内页面可能已被删除，请重新选择链接。`)
    }
    if (String(block.cta ?? '').trim() && ['nav', 'hero', 'feature', 'contact', 'button', 'split', 'immersive', 'fullscreen'].includes(block.type) && !String(block.url ?? '').trim()) {
      addIssue(block, 'missing-url', en ? 'Call to action has no link' : '行动按钮还没有链接', en ? `“${block.cta}” in ${blockName} is only visual until a link is added.` : `${block.label} 的“${block.cta}”目前只是视觉占位，填写链接后才能真正跳转。`)
    }
    if (['nav', 'footer'].includes(block.type)) {
      ;(block.items ?? []).forEach((item, index) => {
        const href = String(item.description ?? '').trim()
        const itemName = item.title || (en ? `Item ${index + 1}` : `第 ${index + 1} 项`)
        if (href && !safeHref(href)) addIssue(block, `link-${index}`, en ? 'Invalid menu link' : '菜单链接无效', en ? `“${itemName}” has an invalid link format.` : `“${itemName}”的链接格式不正确。`)
        if (pageLinkId(href) && !pageIds.has(pageLinkId(href))) addIssue(block, `page-link-${index}`, en ? 'Menu points to a missing page' : '菜单指向不存在的页面', en ? `The page linked from “${itemName}” may have been deleted.` : `“${itemName}”链接的页面可能已被删除。`)
        if (href.startsWith('#') && href.length > 1 && !anchors.has(safeAnchor(href))) {
          addIssue(block, `anchor-${index}`, en ? 'Anchor target not found' : '找不到锚点目标', en ? `“${itemName}” points to ${href}, but that anchor does not exist.` : `“${itemName}”指向 ${href}，但页面中没有这个锚点。`)
        }
      })
    }
  })
  if (!blocks.some((block) => block.type === 'footer')) {
    issues.push({ id: 'page-footer', blockId: null, title: en ? 'Consider adding a footer' : '建议添加页脚', detail: en ? 'Complete pages usually include contact details, copyright, or supporting links.' : '完整页面通常需要联系方式、版权或补充链接。' })
  }
  return issues
}

function readOptimizedImage(file, onSuccess, onError) {
  const reader = new FileReader()
  reader.onerror = onError
  reader.onload = () => {
    if (file.size <= 900 * 1024 || file.type === 'image/gif' || file.type === 'image/svg+xml') {
      onSuccess(reader.result)
      return
    }
    const image = new window.Image()
    image.onerror = onError
    image.onload = () => {
      const maxSide = 1600
      const ratio = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
      const context = canvas.getContext('2d')
      if (!context) {
        onSuccess(reader.result)
        return
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      onSuccess(canvas.toDataURL('image/webp', 0.82))
    }
    image.src = reader.result
  }
  reader.readAsDataURL(file)
}

function styleDefaults(block) {
  return createStyleDefaults(block?.type)
}

function styleValues(block) {
  return { ...styleDefaults(block), ...(block?.styles ?? {}) }
}

function darkBackgroundClass(block) {
  const styles = styleValues(block)
  const colors = styles.backgroundMode === 'gradient' ? [styles.gradientFrom, styles.gradientTo] : [styles.background]
  const validColors = colors.filter((color) => /^#[0-9a-f]{6}$/i.test(String(color)))
  if (!validColors.length) return ''
  const brightness = validColors.reduce((total, color) => {
    const red = Number.parseInt(color.slice(1, 3), 16)
    const green = Number.parseInt(color.slice(3, 5), 16)
    const blue = Number.parseInt(color.slice(5, 7), 16)
    return total + (red * 299 + green * 587 + blue * 114) / 1000
  }, 0) / validColors.length
  return brightness < 145 ? ' is-dark-background' : ''
}

function customColorClass(block) {
  const text = /^#[0-9a-f]{6}$/i.test(block?.styles?.textColor || '') ? ' has-block-text' : ''
  const accent = /^#[0-9a-f]{6}$/i.test(block?.styles?.accentColor || '') ? ' has-block-accent' : ''
  return `${text}${accent}`
}

function staticStyleDeclaration(block) {
  const custom = block.styles ?? {}
  const values = styleValues(block)
  const styles = []
  if (custom.backgroundMode === 'gradient') {
    styles.push(`background:linear-gradient(${Math.min(360, Math.max(0, Number(values.gradientAngle) || 0))}deg,${values.gradientFrom},${values.gradientTo})`)
  } else if (custom.background && /^#[0-9a-f]{6}$/i.test(custom.background)) {
    styles.push(`background:${custom.background}`)
  }
  if (/^#[0-9a-f]{6}$/i.test(custom.textColor || '')) styles.push(`--block-text:${custom.textColor}`)
  if (/^#[0-9a-f]{6}$/i.test(custom.accentColor || '')) styles.push(`--block-accent:${custom.accentColor}`)
  if (custom.radius !== undefined && Number.isFinite(Number(custom.radius))) styles.push(`border-radius:${Math.min(48, Math.max(0, Number(custom.radius)))}px`)
  if (['left', 'center', 'right'].includes(custom.align)) styles.push(`text-align:${custom.align}`)
  if (custom.paddingY !== undefined && Number.isFinite(Number(custom.paddingY))) styles.push(`padding-top:${Math.min(160, Math.max(20, Number(custom.paddingY)))}px`, `padding-bottom:${Math.min(160, Math.max(20, Number(custom.paddingY)))}px`)
  if (custom.minHeight !== undefined && Number.isFinite(Number(custom.minHeight))) styles.push(`min-height:${Math.min(900, Math.max(120, Number(custom.minHeight)))}px`)
  const backgroundImage = safeCssImageSource(block.backgroundImage)
  if (backgroundImage) {
    const overlay = Math.min(.9, Math.max(0, Number(block.backgroundOverlay) || 0))
    styles.push(`background-image:linear-gradient(rgba(12,15,24,${overlay}),rgba(12,15,24,${overlay})),url('${escapeHtml(backgroundImage)}')`)
    styles.push(`background-position:${backgroundPositionValue(block.backgroundPosition)}`)
    styles.push('background-size:cover')
  }
  return styles.join(';')
}

function staticAnchorAttribute(block) {
  const anchor = safeAnchor(block.anchor)
  return anchor ? ` id="${escapeHtml(anchor)}"` : ''
}

function staticInlineStyle(block) {
  const styles = staticStyleDeclaration(block)
  return `${staticAnchorAttribute(block)}${styles ? ` style="${styles}"` : ''}`
}

function effectClass(block) {
  return ['fade-up', 'zoom-in', 'blur-in'].includes(block.effect) ? ` effect-${block.effect}` : ''
}

function hoverClass(block) {
  const hover = block.hoverEffect ?? (block.effect === 'hover-lift' ? 'lift' : 'none')
  return ['lift', 'tilt', 'spotlight', 'glow', 'image-zoom'].includes(hover) ? ` hover-${hover}` : ''
}

function visualClass(block) {
  const preset = ['gradient', 'dark', 'glass', 'editorial'].includes(block.visualPreset) ? ` preset-${block.visualPreset}` : ''
  const background = safeImageSource(block.backgroundImage) ? ' has-background-image' : ''
  return `${preset}${background}`
}

function layoutClass(block) {
  return ['centered', 'offset', 'poster', 'frame', 'diagonal'].includes(block.layoutVariant) ? ` layout-${block.layoutVariant}` : ''
}

function decorationClass(block) {
  return ['orbs', 'grid', 'sparkles', 'labels'].includes(block.decoration) ? ` has-decorations decor-${block.decoration}` : ''
}

function elementEffectClass(block) {
  return ['stagger', 'mask', 'float', 'drift'].includes(block.elementEffect) ? ` element-${block.elementEffect}` : ''
}

function motionSpeedClass(block) {
  return ['fast', 'slow'].includes(block.motionSpeed) ? ` motion-${block.motionSpeed}` : ' motion-normal'
}

function buttonStyleClass(block) {
  return ` button-${['outline', 'soft', 'pill'].includes(block.buttonStyle) ? block.buttonStyle : 'solid'}`
}

function materialClass(block) {
  return ['noise', 'paper', 'scanlines', 'beams', 'mesh'].includes(block.material) ? ` material-${block.material}` : ''
}

function visibilityClass(block) {
  return ['desktop', 'mobile'].includes(block.visibility) ? ` visibility-${block.visibility}` : ' visibility-both'
}

function dividerClass(block) {
  return ['wave', 'slant', 'curve'].includes(block.sectionDivider) ? ` divider-${block.sectionDivider}` : ''
}

function sceneTransitionClass(block) {
  return ['circle', 'curtain', 'paper', 'dissolve'].includes(block.sceneTransition) ? ` scene-transition-${block.sceneTransition}` : ''
}

function staticDecorations(block) {
  const divider = dividerClass(block) ? `<div class="section-divider${dividerClass(block)}" aria-hidden="true"></div>` : ''
  const transition = sceneTransitionClass(block) ? '<span class="scene-transition-layer" aria-hidden="true"></span>' : ''
  if (!['orbs', 'grid', 'sparkles', 'labels'].includes(block.decoration)) return `${transition}${divider}`
  if (block.decoration === 'labels') {
    return `<div class="block-decorations" aria-hidden="true"><span>IDEA</span><span>CREATE</span><span>SHARE</span></div>${transition}${divider}`
  }
  return `<div class="block-decorations" aria-hidden="true"><span></span><span></span><span></span></div>${transition}${divider}`
}

function staticImageStyle(block) {
  const position = ['top left', 'top', 'top right', 'left', 'center', 'right', 'bottom left', 'bottom', 'bottom right'].includes(block.imagePosition) ? block.imagePosition : 'center'
  const fit = block.imageFit === 'contain' ? 'contain' : 'cover'
  const scale = Math.min(1.3, Math.max(1, Number(block.imageScale) || 1))
  return `object-position:${position};object-fit:${fit};transform:scale(${scale})`
}

function backgroundPositionValue(value) {
  return ['top', 'center', 'bottom', 'left', 'right'].includes(value) ? value : 'center'
}

function itemFields(type) {
  return itemEditorFor(type).fields
}

function pageTheme(value) {
  return PAGE_THEMES.some((theme) => theme.value === value) ? value : 'studio'
}

function cursorMode(value) {
  return ['dot', 'ring', 'glow'].includes(value) ? value : 'default'
}

function fontMode(value) {
  return ['serif', 'geometric', 'mono'].includes(value) ? value : 'modern'
}

function densityMode(value) {
  return ['compact', 'airy'].includes(value) ? value : 'balanced'
}

function typeScale(value) {
  return ['quiet', 'expressive'].includes(value) ? value : 'standard'
}

function themeAccent(theme) {
  return PAGE_THEMES.find((item) => item.value === pageTheme(theme))?.accent ?? PAGE_THEMES[0]?.accent ?? '#6557ef'
}

function staticButton(block, sitePages = []) {
  if (!block.cta) return ''
  const content = `${escapeHtml(block.cta)} <span>↗</span>`
  const href = resolveSiteHref(block.url, sitePages)
  const externalAttributes = /^https?:/i.test(href) ? ' target="_blank" rel="noreferrer"' : ''
  const className = `static-button${buttonStyleClass(block)}`
  return href ? `<a class="${className}" href="${escapeHtml(href)}"${externalAttributes}>${content}</a>` : `<span class="${className}">${content}</span>`
}

function renderStaticBlock(block, sitePages = []) {
  const type = escapeHtml(block.type || 'text')
  const title = escapeHtml(block.title || '')
  const description = escapeHtml(block.description || '')
  const imageSource = safeImageSource(block.imageUrl)
  const sectionClasses = `${effectClass(block)}${hoverClass(block)}${visualClass(block)}${layoutClass(block)}${decorationClass(block)}${elementEffectClass(block)}${motionSpeedClass(block)}${materialClass(block)}${visibilityClass(block)}${darkBackgroundClass(block)}${customColorClass(block)}${sceneTransitionClass(block)}`
  const decorations = staticDecorations(block)
  if (block.type === 'nav') {
    const menuId = `nav-menu-${escapeHtml(String(block.id || 'main').replace(/[^a-z0-9_-]/gi, '-'))}`
    const links = (block.items ?? []).map((item) => {
      const href = resolveSiteHref(item.description, sitePages)
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>` : `<span>${escapeHtml(item.title)}</span>`
    }).join('')
    return `<nav class="site-block block-nav${block.stickyNav !== false ? ' nav-sticky' : ''}${sectionClasses}"${staticInlineStyle(block)}>${decorations}<a class="nav-brand" href="${sitePages.length ? 'index.html' : '#'}">${title}</a><button class="nav-menu-toggle" type="button" aria-label="展开导航菜单" aria-expanded="false" aria-controls="${menuId}"><i></i><i></i><i></i></button><div class="nav-links" id="${menuId}">${links}</div>${staticButton(block, sitePages)}</nav>`
  }
  if (block.type === 'image') {
    return `<section class="site-block site-image block-${type}${sectionClasses}"${staticInlineStyle(block)}>${decorations}${imageSource ? `<img loading="lazy" decoding="async" style="${staticImageStyle(block)}" src="${escapeHtml(imageSource)}" alt="${escapeHtml(block.altText || block.title || '网页图片')}">` : '<div class="image-empty">等待上传图片</div>'}</section>`
  }
  if (block.type === 'split') {
    return `<section class="site-block block-split${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="split-copy"><span class="eyebrow">STORY IN MOTION</span><h1>${title}</h1><p>${description}</p>${staticButton(block, sitePages)}</div><div class="split-media">${imageSource ? `<img loading="lazy" decoding="async" style="${staticImageStyle(block)}" src="${escapeHtml(imageSource)}" alt="${escapeHtml(block.altText || block.title || '网页图片')}">` : '<div class="image-empty">等待上传图片</div>'}</div></section>`
  }
  if (block.type === 'marquee') {
    const label = escapeHtml(block.title || 'MAKE SOMETHING BEAUTIFUL')
    return `<section class="site-block block-marquee${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="marquee-track"><span>${label}</span><span>${label}</span><span>${label}</span></div></section>`
  }
  if (block.type === 'cards') {
    const cards = (block.items ?? []).map((item) => `<article class="visual-card"><span>✦</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></article>`).join('')
    return `<section class="site-block block-cards${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">WHAT WE DO</span><h1>${title}</h1><p>${description}</p></div><div class="cards-grid">${cards}</div></section>`
  }
  if (block.type === 'stats') {
    const stats = (block.items ?? []).map((item) => `<article class="stat-item"><strong>${escapeHtml(item.value)}</strong><span>${escapeHtml(item.label)}</span></article>`).join('')
    return `<section class="site-block block-stats${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">IN NUMBERS</span><h1>${title}</h1><p>${description}</p></div><div class="stats-grid">${stats}</div></section>`
  }
  if (block.type === 'team') {
    const people = (block.items ?? []).map((item) => `<article class="person-card"><div class="person-portrait"><span>${escapeHtml((item.name || '?').slice(0, 1))}</span></div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.role)}</p></article>`).join('')
    return `<section class="site-block block-team${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">THE PEOPLE</span><h1>${title}</h1><p>${description}</p></div><div class="team-grid">${people}</div></section>`
  }
  if (block.type === 'faq') {
    const questions = (block.items ?? []).map((item, index) => `<details class="faq-item"${index === 0 ? ' open' : ''}><summary><span>0${index + 1}</span><h3>${escapeHtml(item.title)}</h3><b aria-hidden="true">＋</b></summary><p>${escapeHtml(item.description)}</p></details>`).join('')
    return `<section class="site-block block-faq${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">QUESTIONS & ANSWERS</span><h1>${title}</h1><p>${description}</p></div><div class="faq-list">${questions}</div></section>`
  }
  if (block.type === 'tabs') {
    const tabsId = `tabs-${String(block.id || 'section').replace(/[^a-z0-9_-]/gi, '-')}`
    const tabs = (block.items ?? []).map((item, index) => `<button id="${tabsId}-tab-${index}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="${tabsId}-panel-${index}" tabindex="${index === 0 ? '0' : '-1'}" data-tab-index="${index}"><span>0${index + 1}</span>${escapeHtml(item.title)}</button>`).join('')
    const panels = (block.items ?? []).map((item, index) => `<article id="${tabsId}-panel-${index}" class="tab-panel" role="tabpanel" aria-labelledby="${tabsId}-tab-${index}" data-tab-panel="${index}"${index === 0 ? '' : ' hidden'}><span>0${index + 1} / EXPLORE</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><i aria-hidden="true">↗</i></article>`).join('')
    return `<section class="site-block block-tabs${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">EXPLORE THE DETAILS</span><h1>${title}</h1><p>${description}</p></div><div class="tabs-shell"><div class="tab-buttons" role="tablist">${tabs}</div><div class="tab-panels">${panels}</div></div></section>`
  }
  if (block.type === 'timeline') {
    const events = (block.items ?? []).map((item) => `<article class="timeline-item"><strong>${escapeHtml(item.value)}</strong><i></i><span>${escapeHtml(item.label)}</span></article>`).join('')
    return `<section class="site-block block-timeline${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">OUR JOURNEY</span><h1>${title}</h1><p>${description}</p></div><div class="timeline-list">${events}</div></section>`
  }
  if (block.type === 'bento') {
    const tiles = (block.items ?? []).map((item, index) => `<article class="bento-tile tile-${(index % 4) + 1}"><span>0${index + 1}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></div></article>`).join('')
    return `<section class="site-block block-bento${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">SELECTED IDEAS</span><h1>${title}</h1><p>${description}</p></div><div class="bento-grid">${tiles}</div></section>`
  }
  if (block.type === 'showcase') {
    const projects = (block.items ?? []).map((item, index) => {
      const source = safeImageSource(item.imageUrl)
      return `<article class="showcase-card project-${(index % 4) + 1}"><div class="project-visual">${source ? `<img loading="lazy" decoding="async" src="${escapeHtml(source)}" alt="${escapeHtml(item.title || '作品图片')}">` : ''}<span>0${index + 1}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></article>`
    }).join('')
    return `<section class="site-block block-showcase${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">FEATURED WORK</span><h1>${title}</h1><p>${description}</p></div><div class="showcase-rail">${projects}</div></section>`
  }
  if (block.type === 'sticky') {
    const stories = (block.items ?? []).map((item, index) => `<article class="sticky-card story-${(index % 4) + 1}" style="--story-index:${index}"><span>CHAPTER 0${index + 1}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p></article>`).join('')
    return `<section class="site-block block-sticky${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="sticky-intro"><span class="eyebrow">SCROLL TO EXPLORE</span><h1>${title}</h1><p>${description}</p></div><div class="sticky-stack">${stories}</div></section>`
  }
  if (block.type === 'collage') {
    const images = (block.items ?? []).map((item, index) => {
      const source = safeImageSource(item.imageUrl)
      return `<figure class="collage-item collage-${(index % 5) + 1}">${source ? `<img loading="lazy" decoding="async" src="${escapeHtml(source)}" alt="${escapeHtml(item.title || '拼贴图片')}">` : `<span>IMAGE 0${index + 1}</span>`}<figcaption><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></figcaption></figure>`
    }).join('')
    return `<section class="site-block block-collage${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">VISUAL ARCHIVE</span><h1>${title}</h1><p>${description}</p></div><div class="collage-stage">${images}</div></section>`
  }
  if (block.type === 'gallery') {
    const images = (block.items ?? []).map((item, index) => {
      const source = safeImageSource(item.imageUrl)
      return `<figure class="masonry-item masonry-${(index % 6) + 1}">${source ? `<img loading="lazy" decoding="async" src="${escapeHtml(source)}" alt="${escapeHtml(item.title || '画廊图片')}">` : `<span>FRAME ${String(index + 1).padStart(2, '0')}</span>`}<figcaption><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.description)}</small></figcaption></figure>`
    }).join('')
    return `<section class="site-block block-gallery${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">CURATED FRAGMENTS</span><h1>${title}</h1><p>${description}</p></div><div class="masonry-gallery">${images}</div></section>`
  }
  if (block.type === 'accordion') {
    const accordionId = `service-${String(block.id).replace(/[^a-z0-9_-]/gi, '-')}`
    const services = (block.items ?? []).map((item, index) => `<article class="${index === 0 ? 'active' : ''}"><button id="${accordionId}-button-${index}" type="button" aria-expanded="${index === 0}" aria-controls="${accordionId}-panel-${index}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(item.title)}</strong><i aria-hidden="true">${index === 0 ? '−' : '＋'}</i></button><div id="${accordionId}-panel-${index}" role="region" aria-labelledby="${accordionId}-button-${index}"${index === 0 ? '' : ' hidden'}><p>${escapeHtml(item.description)}</p><b aria-hidden="true">↗</b></div></article>`).join('')
    return `<section class="site-block block-accordion${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">HOW WE CAN HELP</span><h1>${title}</h1><p>${description}</p></div><div class="service-accordion">${services}</div></section>`
  }
  if (block.type === 'immersive') {
    const art = imageSource
      ? `<img class="immersive-art" decoding="async" fetchpriority="high" style="${staticImageStyle(block)}" src="${escapeHtml(imageSource)}" alt="${escapeHtml(block.altText || block.title || '沉浸式封面主视觉')}">`
      : '<div class="immersive-crystal" aria-hidden="true"><i></i><i></i><i></i></div>'
    return `<section class="site-block block-immersive${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="immersive-stage" aria-hidden="true"><span class="immersive-orbit orbit-one"></span><span class="immersive-orbit orbit-two"></span><div class="immersive-portal">${art}</div></div><div class="immersive-copy"><span class="eyebrow">ENTER THE STORY</span><h1>${title}</h1><p>${description}</p>${staticButton(block, sitePages)}</div><span class="immersive-scroll" aria-hidden="true"><i></i> SCROLL TO EXPLORE</span></section>`
  }
  if (block.type === 'fullscreen') {
    return `<section class="site-block block-fullscreen${sectionClasses}"${staticInlineStyle(block)}>${decorations}${imageSource ? `<img class="fullscreen-image" decoding="async" fetchpriority="high" style="${staticImageStyle(block)}" src="${escapeHtml(imageSource)}" alt="${escapeHtml(block.altText || block.title || '全屏项目图片')}">` : '<div class="fullscreen-fallback"><span>FULLSCREEN VISUAL</span></div>'}<div class="fullscreen-copy"><span class="eyebrow">FEATURED PROJECT</span><h1>${title}</h1><p>${description}</p>${staticButton(block, sitePages)}</div></section>`
  }
  if (block.type === 'compare') {
    const before = block.items?.[0] ?? {}
    const after = block.items?.[1] ?? {}
    const beforeSource = safeImageSource(before.imageUrl)
    const afterSource = safeImageSource(after.imageUrl)
    const position = Math.min(90, Math.max(10, Number(block.comparePosition) || 50))
    return `<section class="site-block block-compare${sectionClasses}"${staticAnchorAttribute(block)} style="--compare:${position}%;${staticStyleDeclaration(block)}">${decorations}<div class="section-heading"><span class="eyebrow">BEFORE / AFTER</span><h1>${title}</h1><p>${description}</p></div><div class="compare-frame">${beforeSource ? `<img class="compare-image compare-before" loading="lazy" decoding="async" src="${escapeHtml(beforeSource)}" alt="${escapeHtml(before.title || '调整前')}">` : '<div class="compare-placeholder compare-before">BEFORE</div>'}${afterSource ? `<img class="compare-image compare-after" loading="lazy" decoding="async" src="${escapeHtml(afterSource)}" alt="${escapeHtml(after.title || '调整后')}">` : '<div class="compare-placeholder compare-after">AFTER</div>'}<span class="compare-label label-before">${escapeHtml(before.title || 'BEFORE')}</span><span class="compare-label label-after">${escapeHtml(after.title || 'AFTER')}</span><i class="compare-handle"></i><input class="compare-range" type="range" min="10" max="90" value="${position}" aria-label="调整图片对比位置"></div></section>`
  }
  if (block.type === 'testimonials') {
    const reviews = (block.items ?? []).map((item, index) => `<article class="testimonial-card"><span>“</span><blockquote>${escapeHtml(item.title)}</blockquote><p>${escapeHtml(item.description)}</p><small>0${index + 1}</small></article>`).join('')
    return `<section class="site-block block-testimonials${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">WHAT PEOPLE SAY</span><h1>${title}</h1><p>${description}</p></div><div class="testimonial-rail">${reviews}</div></section>`
  }
  if (block.type === 'pricing') {
    const plans = (block.items ?? []).map((item, index) => `<article class="pricing-card${index === 1 ? ' is-featured' : ''}"><span>${index === 1 ? 'RECOMMENDED' : `PLAN 0${index + 1}`}</span><h3>${escapeHtml(item.title)}</h3><strong>${escapeHtml(item.value || (block.locale === 'en' ? 'Custom' : '定制'))}</strong><p>${escapeHtml(item.description)}</p><a href="#contact">${block.locale === 'en' ? 'Choose plan' : '选择方案'} <b>↗</b></a></article>`).join('')
    return `<section class="site-block block-pricing${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="section-heading"><span class="eyebrow">SIMPLE PRICING</span><h1>${title}</h1><p>${description}</p></div><div class="pricing-grid">${plans}</div></section>`
  }
  if (block.type === 'logos') {
    const logos = (block.items ?? []).map((item) => `<span>${escapeHtml(item.title)}</span>`).join('')
    return `<section class="site-block block-logos${sectionClasses}"${staticInlineStyle(block)}>${decorations}<p>${title}</p><div class="logo-track">${logos}${logos}</div></section>`
  }
  if (block.type === 'footer') {
    const links = (block.items ?? []).map((item) => {
      const href = resolveSiteHref(item.description, sitePages)
      return `<li>${href ? `<a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a>` : `<span>${escapeHtml(item.title)}</span>`}</li>`
    }).join('')
    return `<footer class="site-block block-footer${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="footer-brand"><span class="eyebrow">STAY CURIOUS</span><h1>${title}</h1><p>${description}</p></div><div class="footer-links"><strong>EXPLORE</strong><ul>${links}</ul></div><div class="footer-meta"><span>© ${new Date().getFullYear()} ${title}</span><span>Made with PageCraft</span></div></footer>`
  }
  if (block.type === 'quote') {
    return `<section class="site-block block-quote${sectionClasses}"${staticInlineStyle(block)}>${decorations}<span class="quote-mark">“</span><blockquote>${title}</blockquote><p>${description}</p></section>`
  }
  return `<section class="site-block block-${type}${sectionClasses}"${staticInlineStyle(block)}>${decorations}<div class="site-content"><span class="eyebrow">${block.type === 'hero' ? 'WELCOME TO PAGECRAFT' : block.type === 'contact' ? 'LET’S CREATE' : 'WHY PAGECRAFT'}</span><h1>${title}</h1><p>${description}</p>${block.type !== 'text' ? staticButton(block, sitePages) : ''}</div></section>`
}

function createStaticHtml(blocks, meta = DEFAULT_PAGE_META, sitePages = []) {
  const renderedBlocks = blocks.map((block) => renderStaticBlock(block, sitePages)).join('\n')
  const pageTitle = escapeHtml(meta.title || DEFAULT_PAGE_META.title)
  const pageDescription = escapeHtml(meta.description || DEFAULT_PAGE_META.description)
  const theme = pageTheme(meta.theme)
  const cursor = cursorMode(meta.cursor)
  const typographyClasses = `font-${fontMode(meta.fontMode)} density-${densityMode(meta.density)} type-${typeScale(meta.typeScale)}`
  const customAccent = /^#[0-9a-f]{6}$/i.test(meta.accentColor ?? '') ? meta.accentColor : ''
  const pageBackground = /^#[0-9a-f]{6}$/i.test(meta.pageBackground ?? '') ? meta.pageBackground : DEFAULT_PAGE_META.pageBackground
  const siteWidth = Math.min(1920, Math.max(720, Number(meta.siteWidth) || DEFAULT_PAGE_META.siteWidth))
  const sectionGap = Math.min(48, Math.max(0, Number(meta.sectionGap) || 0))
  const sectionRadius = Math.min(48, Math.max(0, Number(meta.sectionRadius) || 0))
  const pageVariables = `--page-background:${pageBackground};--page-site-width:${siteWidth}px;--page-section-gap:${sectionGap}px;--page-section-radius:${sectionRadius}px;${customAccent ? `--theme-accent:${customAccent};` : ''}`
  const documentAccent = customAccent || themeAccent(theme)
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${pageDescription}">
    <meta name="theme-color" content="${documentAccent}">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${pageTitle}">
    <meta property="og:description" content="${pageDescription}">
    <title>${pageTitle}</title>
    <style>
      :root { font-family: Arial, "Microsoft YaHei", sans-serif; color: #192031; background: #fff; scroll-behavior: smooth; }
      * { box-sizing: border-box; }
      body { --theme-bg: #f8f8fb; --theme-surface: #fff; --theme-ink: #192031; --theme-muted: #768194; --theme-accent: #6557ef; --theme-radius: 20px; margin: 0; color: var(--theme-ink); background: var(--page-background, var(--theme-bg)); }
      .page-frame { width: min(var(--page-site-width, 1440px), 100%); min-height: 100vh; display: flex; flex-direction: column; gap: var(--page-section-gap, 0); margin-inline: auto; padding-block: var(--page-section-gap, 0); }
      .page-scroll-progress { position: fixed; z-index: 9998; left: 0; right: 0; top: 0; height: 3px; pointer-events: none; background: #ffffff18; }.page-scroll-progress i { display: block; width: var(--page-progress, 0%); height: 100%; border-radius: 0 99px 99px 0; background: linear-gradient(90deg, var(--theme-accent), #d98bc2); box-shadow: 0 0 12px color-mix(in srgb, var(--theme-accent) 60%, transparent); }
      .custom-cursor { position: fixed; z-index: 9999; left: 0; top: 0; width: 1px; height: 1px; pointer-events: none; opacity: 0; transition: opacity .2s ease; }.custom-cursor.is-visible { opacity: 1; }.custom-cursor i, .custom-cursor b { position: absolute; left: 0; top: 0; display: block; border-radius: 50%; transform: translate(-50%, -50%); transition: width .2s ease, height .2s ease, background .2s ease, border-color .2s ease; }.custom-cursor i { width: 8px; height: 8px; background: var(--theme-accent); }.custom-cursor b { width: 34px; height: 34px; border: 1px solid color-mix(in srgb, var(--theme-accent) 70%, white); }.cursor-dot-visual b { display: none; }.cursor-ring-visual i { width: 5px; height: 5px; }.cursor-glow-visual i { width: 12px; height: 12px; background: #fff; }.cursor-glow-visual b { width: 54px; height: 54px; border: 0; background: color-mix(in srgb, var(--theme-accent) 32%, transparent); filter: blur(8px); }.custom-cursor.is-interactive b { width: 58px; height: 58px; }.custom-cursor.is-interactive i { width: 5px; height: 5px; }
      .site-block { width: 100%; min-height: 300px; padding: 90px max(8vw, 80px); display: flex; align-items: center; overflow: hidden; border-radius: var(--page-section-radius, 0); scroll-margin-top: 84px; }
      .site-content { width: min(720px, 100%); position: relative; z-index: 1; }
      .block-hero { min-height: 580px; background: linear-gradient(120deg, #f3f0ff, #fbfaff 48%, #eef6ff); }
      .block-feature { background: #fff; }
      .block-contact { min-height: 350px; color: #fff; background: #192031; }
      .block-button { background: #f7f8fa; }
      .block-nav { position: relative; z-index: 20; min-height: 80px; padding: 18px max(5vw, 42px); display: flex; justify-content: space-between; gap: 30px; color: #192031; background: #ffffffeb; backdrop-filter: blur(18px); }.block-nav.nav-sticky { position: sticky; z-index: 80; top: 0; }.nav-brand { color: inherit; font-size: 19px; font-weight: 800; letter-spacing: -.04em; text-decoration: none; }.nav-links { display: flex; align-items: center; justify-content: center; gap: 28px; margin-left: auto; }.nav-links a, .nav-links span { color: inherit; font-size: 13px; text-decoration: none; opacity: .72; }.nav-links a:hover { opacity: 1; }.block-nav .static-button { padding: 10px 14px; }.nav-menu-toggle { display: none; width: 40px; height: 40px; padding: 9px; border: 0; border-radius: 50%; color: inherit; background: color-mix(in srgb, currentColor 7%, transparent); cursor: pointer; }.nav-menu-toggle i { display: block; width: 18px; height: 1px; margin: 4px auto; background: currentColor; transition: transform .2s ease, opacity .2s ease; }.nav-menu-toggle[aria-expanded="true"] i:first-child { transform: translateY(5px) rotate(45deg); }.nav-menu-toggle[aria-expanded="true"] i:nth-child(2) { opacity: 0; }.nav-menu-toggle[aria-expanded="true"] i:last-child { transform: translateY(-5px) rotate(-45deg); }
      .site-image { min-height: 360px; padding: 48px max(8vw, 80px); background: #f5f3ff; }
      .site-image img { width: 100%; max-height: 620px; object-fit: cover; border-radius: 16px; }
      .block-split { display: grid; grid-template-columns: .9fr 1.1fr; gap: 7vw; min-height: 560px; background: #f7f8fa; }
      .split-copy { align-self: center; }
      .split-media { min-height: 360px; overflow: hidden; border-radius: 18px; background: #ece9ff; }
      .split-media img { width: 100%; height: 100%; min-height: 360px; object-fit: cover; }
      .block-marquee { min-height: 150px; padding: 28px 0; overflow: hidden; color: #fff; background: #6557ef; }
      .marquee-track { display: flex; width: max-content; gap: 54px; white-space: nowrap; font-size: clamp(38px, 6vw, 78px); font-weight: 800; letter-spacing: -.06em; animation: static-marquee 18s linear infinite; }
      .block-cards, .block-stats { display: block; background: #f5f4ff; }
      .section-heading { max-width: 720px; margin-bottom: 44px; }
      .cards-grid, .stats-grid { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
      .visual-card { min-height: 220px; padding: 28px; border: 1px solid #ffffff80; border-radius: 20px; background: #ffffffb8; box-shadow: 0 18px 44px #302b6b10; backdrop-filter: blur(14px); }
      .visual-card > span { color: #6557ef; font-size: 24px; }.visual-card h3 { margin: 28px 0 10px; font-size: 22px; }.visual-card p { margin: 0; font-size: 14px; }
      .stat-item { padding: 28px 0; border-top: 1px solid #d9d7e5; }.stat-item strong, .stat-item span { display: block; }.stat-item strong { font-size: clamp(42px, 6vw, 74px); letter-spacing: -.06em; }.stat-item span { margin-top: 8px; color: #7a8392; font-size: 13px; }
      .block-quote { min-height: 440px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; color: #fff; background: #151824; }.quote-mark { color: #8f84ff; font-size: 70px; line-height: .7; }.block-quote blockquote { max-width: 960px; margin: 28px 0 20px; font-size: clamp(34px, 5vw, 68px); font-weight: 700; line-height: 1.12; letter-spacing: -.05em; }.block-quote p { color: #aeb5c4; }
      .block-team { display: block; background: #f4f1ff; }.team-grid { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }.person-card { padding: 16px; border-radius: 22px; background: #ffffffa8; backdrop-filter: blur(14px); }.person-portrait { aspect-ratio: 4 / 5; display: grid; place-items: center; overflow: hidden; border-radius: 16px; background: radial-gradient(circle at 70% 20%, #f7b7da, transparent 35%), linear-gradient(145deg, #786cf0, #b9dcff); }.person-portrait span { color: #fff; font-size: clamp(54px, 8vw, 96px); font-weight: 800; opacity: .72; }.person-card h3 { margin: 18px 0 5px; font-size: 20px; }.person-card p { margin: 0; font-size: 13px; }
      .block-faq, .block-timeline { display: block; background: #fff; }.faq-list { width: 100%; border-top: 1px solid #dfe2e8; }.faq-item { padding: 0; border-bottom: 1px solid #dfe2e8; }.faq-item summary { display: grid; grid-template-columns: 45px 1fr 32px; gap: 20px; align-items: center; padding: 25px 0; cursor: pointer; list-style: none; }.faq-item summary::-webkit-details-marker { display: none; }.faq-item summary > span { color: #8b93a1; font-size: 12px; }.faq-item h3 { margin: 0; font-size: 20px; }.faq-item > p { margin: -4px 52px 25px 65px; font-size: 14px; animation: faq-answer-in .25s ease both; }.faq-item b { color: #6557ef; font-size: 22px; font-weight: 400; transition: transform .22s ease; }.faq-item[open] b { transform: rotate(45deg); }.faq-item summary:focus-visible { outline: 2px solid var(--theme-accent); outline-offset: 5px; border-radius: 5px; }.timeline-list { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; width: 100%; }.timeline-list::before { content: ""; position: absolute; left: 0; right: 0; top: 50px; height: 1px; background: #cfd3dd; }.timeline-item { position: relative; display: grid; gap: 20px; padding-right: 28px; }.timeline-item strong { color: #6557ef; font-size: 30px; }.timeline-item i { position: relative; z-index: 1; width: 12px; height: 12px; border: 3px solid #fff; border-radius: 50%; background: #6557ef; box-shadow: 0 0 0 1px #6557ef; }.timeline-item span { color: #525d6d; font-size: 15px; font-weight: 600; } @keyframes faq-answer-in { from { opacity: 0; transform: translateY(-5px); } }
      .block-tabs { display: block; background: #eef0f6; }.tabs-shell { display: grid; grid-template-columns: minmax(180px, .38fr) 1fr; gap: 28px; width: 100%; }.tab-buttons { display: grid; align-content: start; gap: 7px; }.tab-buttons button { display: flex; gap: 12px; align-items: center; padding: 17px 16px; border: 0; border-radius: 10px; color: #858e9d; background: transparent; text-align: left; font-size: 13px; cursor: pointer; }.tab-buttons button span { color: #b1b7c2; font-size: 10px; }.tab-buttons button[aria-selected="true"] { color: #fff; background: var(--theme-accent); box-shadow: 0 14px 34px #5147c52c; }.tab-buttons button[aria-selected="true"] span { color: #ffffffb8; }.tab-panel { position: relative; min-height: 390px; padding: 38px; overflow: hidden; border-radius: var(--theme-radius); color: #fff; background: radial-gradient(circle at 82% 18%, #e786b8, transparent 24%), linear-gradient(145deg, #282c43, #6557ef); box-shadow: 0 24px 70px #25294a22; animation: tab-panel-in .32s ease both; }.tab-panel[hidden] { display: none; }.tab-panel > span { color: #c8c3ff; font-size: 10px; font-weight: 800; letter-spacing: .12em; }.tab-panel h3 { max-width: 80%; margin: 130px 0 12px; color: #fff; font-size: clamp(34px, 5vw, 62px); }.tab-panel p { max-width: 70%; color: #d9dce8; font-size: 14px; }.tab-panel i { position: absolute; right: 30px; bottom: 28px; display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid #ffffff52; border-radius: 50%; font-style: normal; }.tab-buttons button:focus-visible { outline: 2px solid var(--theme-accent); outline-offset: 3px; } @keyframes tab-panel-in { from { opacity: 0; transform: translateY(10px) scale(.99); } }
      .block-bento, .block-showcase { display: block; background: #f1f0f7; }.bento-grid { display: grid; grid-template-columns: 1.15fr .85fr .85fr; grid-auto-rows: minmax(210px, auto); gap: 18px; width: 100%; }.bento-tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; min-height: 210px; padding: 26px; overflow: hidden; border: 1px solid #ffffffb0; border-radius: var(--theme-radius); background: linear-gradient(145deg, #fff, #ebe8ff); box-shadow: 0 20px 50px #2f2a5d12; }.bento-tile::after, .project-visual::after { content: ""; position: absolute; inset: -60%; opacity: 0; background: linear-gradient(115deg, transparent 38%, #ffffffa8 48%, transparent 58%); transform: translateX(-40%) rotate(10deg); transition: opacity .3s ease, transform .7s ease; }.bento-tile:hover::after, .showcase-card:hover .project-visual::after { opacity: 1; transform: translateX(40%) rotate(10deg); }.bento-tile.tile-1 { grid-row: span 2; background: radial-gradient(circle at 70% 20%, #ffb9dd, transparent 33%), linear-gradient(150deg, #6557ef, #23233b); color: #fff; }.bento-tile.tile-2 { grid-column: span 2; }.bento-tile.tile-4 { background: #171925; color: #fff; }.bento-tile > span { font-size: 11px; font-weight: 800; letter-spacing: .14em; opacity: .65; }.bento-tile h3 { margin: 0 0 8px; font-size: clamp(24px, 3vw, 40px); letter-spacing: -.045em; }.bento-tile p { margin: 0; font-size: 13px; }.showcase-rail { display: flex; gap: 22px; width: calc(100% + max(8vw, 80px)); overflow-x: auto; padding: 8px max(8vw, 80px) 28px 0; scroll-snap-type: x mandatory; scrollbar-width: thin; }.showcase-card { flex: 0 0 min(62vw, 560px); scroll-snap-align: start; }.project-visual { position: relative; aspect-ratio: 4 / 3; overflow: hidden; border-radius: var(--theme-radius); background: linear-gradient(145deg, #7b6ef2, #efafd0); transition: transform .45s cubic-bezier(.2,.8,.2,1); }.project-visual img { width: 100%; height: 100%; object-fit: cover; }.showcase-card:hover .project-visual { transform: scale(.98); }.project-2 .project-visual { background: radial-gradient(circle at 25% 25%, #f7c77c, transparent 28%), linear-gradient(145deg, #1b2032, #465173); }.project-3 .project-visual { background: radial-gradient(circle at 65% 30%, #a8e2d9, transparent 26%), linear-gradient(145deg, #f3efe3, #b1a6ff); }.project-4 .project-visual { background: linear-gradient(135deg, #ff866e, #ffca83 45%, #6557ef); }.project-visual > span { position: absolute; z-index: 1; left: 22px; top: 20px; color: #fff; font-size: 12px; font-weight: 800; }.showcase-card h3 { margin: 18px 0 6px; font-size: 24px; }.showcase-card p { margin: 0; font-size: 13px; }.block-sticky { align-items: flex-start; gap: 7vw; background: #151722; color: #fff; }.sticky-intro { position: sticky; top: 100px; flex: 0 0 38%; }.sticky-stack { flex: 1; display: grid; gap: 22px; }.sticky-card { position: sticky; top: calc(100px + var(--story-index) * 22px); min-height: 330px; padding: 34px; border: 1px solid #ffffff1f; border-radius: var(--theme-radius); background: linear-gradient(145deg, #292c40, #1b1d2b); box-shadow: 0 24px 60px #00000038; }.sticky-card.story-2 { background: linear-gradient(145deg, #554ac9, #252439); }.sticky-card.story-3 { background: linear-gradient(145deg, #9c4f78, #342536); }.sticky-card > span { color: #bcb5ff; font-size: 10px; font-weight: 800; letter-spacing: .15em; }.sticky-card h3 { margin: 120px 0 12px; color: #fff; font-size: 36px; }.sticky-card p { color: #c7ccda; }
      .block-collage { display: block; background: #f3efe8; }.collage-stage { display: grid; grid-template-columns: 1.2fr .8fr 1fr; grid-template-rows: repeat(2, minmax(220px, 32vw)); gap: 24px; width: 100%; }.collage-item { position: relative; min-width: 0; margin: 0; overflow: hidden; border-radius: var(--theme-radius); background: linear-gradient(145deg, #b5acf8, #f4bad5); }.collage-item.collage-1 { grid-row: span 2; transform: rotate(-2deg); }.collage-item.collage-2 { grid-column: span 2; transform: translateY(20px) rotate(1deg); }.collage-item.collage-4 { transform: translateY(-10px) rotate(2deg); }.collage-item img { width: 100%; height: 100%; object-fit: cover; transition: transform .7s cubic-bezier(.2,.8,.2,1); }.collage-item:hover img { transform: scale(1.07); }.collage-item > span { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 12px; font-weight: 800; letter-spacing: .15em; }.collage-item figcaption { position: absolute; left: 18px; right: 18px; bottom: 16px; display: flex; justify-content: space-between; gap: 10px; color: #fff; text-shadow: 0 2px 12px #0008; }.collage-item figcaption strong, .collage-item figcaption small { display: block; }.collage-item figcaption small { opacity: .75; }.block-fullscreen { min-height: 100svh; padding: 0; color: #fff; background: #151722; }.fullscreen-image, .fullscreen-fallback { position: absolute !important; z-index: 0 !important; inset: 0; width: 100%; height: 100%; object-fit: cover; }.fullscreen-fallback { display: grid; place-items: center; background: radial-gradient(circle at 70% 25%, #d85c9d, transparent 24%), linear-gradient(145deg, #1d2240, #6557ef); }.fullscreen-fallback span { font-size: 11px; font-weight: 800; letter-spacing: .2em; }.block-fullscreen::after { content: ""; position: absolute; z-index: 0; inset: 0; background: linear-gradient(90deg, #0b0d16cc, transparent 70%), linear-gradient(0deg, #0b0d1666, transparent 55%); }.fullscreen-copy { position: relative; z-index: 1; width: min(760px, 80%); margin: auto max(8vw, 80px); }.fullscreen-copy h1 { color: #fff; font-size: clamp(58px, 9vw, 120px); line-height: .92; }.fullscreen-copy p { color: #d8dce6; }
      .block-compare { display: block; background: #eef0f5; }.compare-frame { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: var(--theme-radius); background: #282d3b; box-shadow: 0 24px 70px #252a421f; }.compare-image, .compare-placeholder { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }.compare-before { filter: grayscale(1) contrast(.9); }.compare-after { clip-path: inset(0 calc(100% - var(--compare)) 0 0); }.compare-placeholder { display: grid; place-items: center; color: #ffffffc7; font-size: 13px; font-weight: 800; letter-spacing: .18em; background: linear-gradient(145deg, #303747, #788399); }.compare-placeholder.compare-after { background: radial-gradient(circle at 70% 25%, #f09ec6, transparent 28%), linear-gradient(145deg, #6557ef, #6dd4cf); }.compare-label { position: absolute; z-index: 2; top: 18px; padding: 7px 10px; border-radius: 999px; color: #fff; background: #11152280; font-size: 9px; font-weight: 800; letter-spacing: .12em; backdrop-filter: blur(8px); }.label-before { left: 18px; }.label-after { right: 18px; }.compare-handle { position: absolute; z-index: 3; left: var(--compare); top: 0; bottom: 0; width: 2px; background: #fff; box-shadow: 0 0 22px #0005; transform: translateX(-1px); }.compare-handle::after { content: "↔"; position: absolute; left: 50%; top: 50%; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 50%; color: #202535; background: #fff; font-style: normal; transform: translate(-50%, -50%); box-shadow: 0 8px 24px #0004; }.compare-range { position: absolute; z-index: 4; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ew-resize; }
      .block-testimonials, .block-pricing { display: block; background: #f4f2fa; }.testimonial-rail { display: flex; gap: 20px; width: calc(100% + max(8vw, 80px)); padding: 4px max(8vw, 80px) 26px 0; overflow-x: auto; scroll-snap-type: x mandatory; }.testimonial-card { flex: 0 0 min(48vw, 520px); min-height: 310px; padding: 30px; scroll-snap-align: start; border: 1px solid #ffffffa6; border-radius: var(--theme-radius); background: #ffffffba; box-shadow: 0 18px 48px #302b6b10; }.testimonial-card > span { color: var(--theme-accent); font-size: 46px; line-height: .7; }.testimonial-card blockquote { margin: 72px 0 24px; font-size: clamp(22px, 3vw, 34px); line-height: 1.3; letter-spacing: -.035em; }.testimonial-card p { margin: 0; font-size: 12px; }.testimonial-card small { float: right; color: #a1a8b4; }.pricing-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; width: 100%; }.pricing-card { min-height: 390px; display: flex; flex-direction: column; padding: 28px; border: 1px solid #dfe2e9; border-radius: var(--theme-radius); background: #fff; }.pricing-card.is-featured { color: #fff; border-color: #6557ef; background: linear-gradient(145deg, #6557ef, #302d54); transform: translateY(-18px); box-shadow: 0 24px 60px #4f45c52c; }.pricing-card > span { color: var(--theme-accent); font-size: 9px; font-weight: 800; letter-spacing: .13em; }.pricing-card.is-featured > span, .pricing-card.is-featured p { color: #d8d4ff; }.pricing-card h3 { margin: 30px 0 8px; font-size: 22px; }.pricing-card strong { font-size: 42px; letter-spacing: -.05em; }.pricing-card p { margin-top: 20px; font-size: 13px; }.pricing-card a { display: flex; justify-content: space-between; margin-top: auto; padding-top: 16px; border-top: 1px solid currentColor; color: inherit; font-size: 12px; font-weight: 700; text-decoration: none; }.block-logos { min-height: 160px; display: block; padding: 34px 0; background: #fff; }.block-logos > p { margin: 0 0 24px; padding: 0 max(8vw, 80px); font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }.logo-track { display: flex; width: max-content; gap: 65px; animation: static-logo-scroll 24s linear infinite; }.logo-track span { color: var(--theme-ink); font-size: clamp(24px, 3vw, 38px); font-weight: 800; letter-spacing: -.04em; opacity: .52; } @keyframes static-logo-scroll { to { transform: translateX(-50%); } }
      .block-footer { min-height: 500px; display: grid; grid-template-columns: 1.5fr .5fr; align-items: end; gap: 60px; color: #fff; background: #11131c; }.footer-brand h1 { max-width: 780px; color: #fff; font-size: clamp(44px, 7vw, 90px); }.footer-brand p { color: #aeb5c4; }.footer-links { align-self: center; }.footer-links > strong { color: #8f84ff; font-size: 10px; letter-spacing: .14em; }.footer-links ul { display: grid; gap: 12px; margin: 20px 0 0; padding: 0; list-style: none; }.footer-links a, .footer-links span { color: #dfe2e9; font-size: 14px; text-decoration: none; }.footer-meta { grid-column: 1 / -1; display: flex; justify-content: space-between; padding-top: 22px; border-top: 1px solid #ffffff1c; color: #858d9d; font-size: 11px; }
      .preset-gradient { background: radial-gradient(circle at 80% 10%, #d7d1ff 0, transparent 35%), linear-gradient(135deg, #f7f3ff, #eaf6ff); }
      .preset-dark { color: #fff; background: #11131c; }.preset-dark h1, .preset-dark h3, .preset-dark strong { color: #fff; }.preset-dark p, .preset-dark span { color: #aeb5c4; }
      .preset-glass { background: linear-gradient(135deg, #e9e4ff, #e8f7ff); }.preset-glass .visual-card, .preset-glass .site-content, .preset-glass .split-copy { padding: 28px; border: 1px solid #ffffffb0; border-radius: 22px; background: #ffffff80; backdrop-filter: blur(18px); }
      .preset-editorial h1, .preset-editorial blockquote { font-family: Georgia, serif; font-weight: 500; letter-spacing: -.045em; }.preset-editorial { border-top: 8px solid #171922; }
      .theme-editorial { --theme-bg: #ede8dc; --theme-surface: #f5f0e5; --theme-ink: #211f1a; --theme-muted: #716d63; --theme-accent: #9d2e24; --theme-radius: 2px; font-family: Georgia, "Noto Serif SC", serif; }.theme-editorial .site-block:not(.has-background-image):not(.preset-dark):not(.preset-gradient):not(.preset-glass) { color: var(--theme-ink); background: var(--theme-surface); }.theme-editorial .site-block:nth-of-type(even):not(.has-background-image):not(.preset-dark):not(.preset-gradient):not(.preset-glass) { background: #e7e0d2; }.theme-editorial h1 { font-weight: 500; }.theme-editorial .static-button { border-radius: 0; background: #9d2e24; }
      .theme-soft { --theme-bg: #f5f0fb; --theme-surface: #fffafd; --theme-ink: #373047; --theme-muted: #80778e; --theme-accent: #b45f9c; --theme-radius: 32px; }.theme-soft .site-block:not(.has-background-image):not(.preset-dark):not(.preset-gradient):not(.preset-glass) { background: radial-gradient(circle at 88% 12%, #f5cce2, transparent 26%), #fffafd; }.theme-soft .static-button { border-radius: 999px; background: #b45f9c; }
      .theme-brutal { --theme-bg: #f5f000; --theme-surface: #f5f000; --theme-ink: #111; --theme-muted: #333; --theme-accent: #ff4e2f; --theme-radius: 0px; font-family: Arial, sans-serif; }.theme-brutal .site-block:not(.has-background-image):not(.preset-dark) { color: #111; border-top: 3px solid #111; background: #f5f000; }.theme-brutal .site-block:nth-of-type(even):not(.has-background-image):not(.preset-dark) { background: #5be1ff; }.theme-brutal .visual-card, .theme-brutal .bento-tile, .theme-brutal .project-visual { border: 3px solid #111; border-radius: 0; box-shadow: 9px 9px 0 #111; }.theme-brutal .static-button { color: #111; border: 2px solid #111; border-radius: 0; background: #ff6a4e; box-shadow: 4px 4px 0 #111; }
      .theme-future { --theme-bg: #080b12; --theme-surface: #0d121d; --theme-ink: #e9fbff; --theme-muted: #7d9aa1; --theme-accent: #50f5cf; --theme-radius: 12px; }.theme-future .site-block:not(.has-background-image):not(.preset-gradient):not(.preset-glass) { color: #e9fbff; background-color: #0d121d; background-image: linear-gradient(#50f5cf0c 1px, transparent 1px), linear-gradient(90deg, #50f5cf0c 1px, transparent 1px); background-size: 32px 32px; }.theme-future h1, .theme-future h3, .theme-future strong { color: #e9fbff; }.theme-future p { color: #7d9aa1; }.theme-future .eyebrow { color: #50f5cf; }.theme-future .static-button { color: #07100e; background: #50f5cf; box-shadow: 0 0 28px #50f5cf55; }
      .theme-luxury { --theme-bg: #0c0c0c; --theme-surface: #111; --theme-ink: #f4efe4; --theme-muted: #aaa397; --theme-accent: #c7a96b; --theme-radius: 0px; font-family: Georgia, "Noto Serif SC", serif; }.theme-luxury .site-block:not(.has-background-image):not(.preset-gradient):not(.preset-glass) { color: #f4efe4; background: #111; border-bottom: 1px solid #ffffff17; }.theme-luxury h1, .theme-luxury h3, .theme-luxury strong { color: #f4efe4; font-weight: 500; }.theme-luxury p { color: #aaa397; }.theme-luxury .eyebrow { color: #c7a96b; }.theme-luxury .static-button { color: #111; border-radius: 0; background: #c7a96b; }
      .font-modern { font-family: Arial, "Microsoft YaHei", sans-serif; }.font-serif { font-family: Georgia, "Noto Serif SC", serif; }.font-geometric { font-family: "Arial Black", "Microsoft YaHei", sans-serif; }.font-geometric h1, .font-geometric h2, .font-geometric h3 { font-weight: 800; letter-spacing: -.065em; }.font-mono { font-family: "Cascadia Mono", Consolas, "Microsoft YaHei", monospace; }.font-mono h1, .font-mono h2, .font-mono h3 { letter-spacing: -.045em; }.density-compact .site-block:not(.block-nav):not(.block-logos):not(.block-fullscreen) { padding-top: 58px; padding-bottom: 58px; }.density-airy .site-block:not(.block-nav):not(.block-logos):not(.block-fullscreen) { padding-top: 128px; padding-bottom: 128px; }.type-quiet .site-block h1 { font-size: clamp(32px, 4.5vw, 60px); }.type-expressive .site-block h1 { font-size: clamp(52px, 8vw, 104px); line-height: .96; }.type-expressive .block-feature h1, .type-expressive .block-contact h1, .type-expressive .block-button h1 { font-size: clamp(42px, 6vw, 78px); }
      .layout-centered { text-align: center; }.layout-centered .site-content, .layout-centered .section-heading { margin-left: auto; margin-right: auto; }.layout-centered p { margin-left: auto; margin-right: auto; }.layout-offset .site-content, .layout-offset .section-heading { width: min(62%, 760px); margin-left: auto; }.layout-poster h1, .layout-poster blockquote { max-width: 1100px; font-size: clamp(58px, 9vw, 122px); line-height: .92; text-transform: uppercase; }.layout-poster .eyebrow { padding-bottom: 12px; border-bottom: 1px solid currentColor; }.layout-frame > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .footer-brand) { padding: clamp(22px, 4vw, 52px); border: 1px solid color-mix(in srgb, currentColor 24%, transparent); }.layout-diagonal > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .fullscreen-copy) { padding-left: clamp(18px, 4vw, 54px); border-left: 8px solid var(--block-accent, var(--theme-accent)); transform: rotate(-2deg); transform-origin: left center; }
      .block-gallery { display: block; min-height: 900px; background: #eee9df; }.masonry-gallery { position: relative; z-index: 1; columns: 3; column-gap: 20px; width: 100%; }.masonry-item { position: relative; min-height: 310px; margin: 0 0 20px; overflow: hidden; break-inside: avoid; border-radius: var(--theme-radius); background: linear-gradient(145deg, #252a3c, #7d70d8); }.masonry-item:nth-child(3n + 1) { min-height: 480px; }.masonry-item:nth-child(4n + 2) { min-height: 390px; }.masonry-item img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }.masonry-item > span { position: absolute; left: 22px; top: 20px; color: #ffffffb8; font-size: 9px; font-weight: 800; letter-spacing: .15em; }.masonry-item figcaption { position: absolute; z-index: 1; left: 0; right: 0; bottom: 0; padding: 70px 22px 20px; color: #fff; background: linear-gradient(transparent, #111522d9); }.masonry-item figcaption strong, .masonry-item figcaption small { display: block; }.masonry-item figcaption strong { font-size: 18px; }.masonry-item figcaption small { margin-top: 5px; color: #d7dbe4; font-size: 9px; }
      .block-accordion { min-height: 700px; display: grid; grid-template-columns: minmax(300px, .72fr) 1.28fr; align-items: start; gap: 7vw; background: #f3f0ff; }.service-accordion { position: relative; z-index: 1; border-top: 1px solid #cfd2dc; }.service-accordion article { border-bottom: 1px solid #cfd2dc; }.service-accordion button { width: 100%; min-height: 88px; display: grid; grid-template-columns: 45px 1fr 28px; align-items: center; gap: 10px; padding: 0 8px; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }.service-accordion button:focus-visible { outline: 2px solid var(--block-accent, var(--theme-accent)); outline-offset: -3px; }.service-accordion button span { color: var(--block-accent, var(--theme-accent)); font-size: 10px; }.service-accordion button strong { font-size: 22px; }.service-accordion button i { font-size: 24px; font-style: normal; font-weight: 300; text-align: right; }.service-accordion article > div { position: relative; padding: 0 50px 28px; }.service-accordion article > div[hidden] { display: none; }.service-accordion article > div p { max-width: 560px; margin: 0; }.service-accordion article > div b { position: absolute; right: 10px; bottom: 28px; color: var(--block-accent, var(--theme-accent)); font-size: 22px; }.service-accordion article.active { background: color-mix(in srgb, var(--block-accent, var(--theme-accent)) 7%, transparent); }
      .has-background-image { color: #fff; }.has-background-image h1, .has-background-image h3, .has-background-image strong { color: #fff; }.has-background-image p, .has-background-image span { color: #e1e5ed; }
      .is-dark-background > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .fullscreen-copy, .footer-brand) :is(h1, h2, h3, strong, blockquote), .is-dark-background > blockquote { color: #fff; }.is-dark-background > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .fullscreen-copy, .footer-brand) p, .is-dark-background > p { color: #dfe3ec; }.is-dark-background > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .fullscreen-copy, .footer-brand) .eyebrow { color: #c8c2ff; }
      .has-block-text > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .fullscreen-copy, .footer-brand) :is(h1, h2, h3, strong, blockquote, p), .has-block-text > :is(blockquote, p) { color: var(--block-text); }.has-block-accent.has-block-accent :is(.eyebrow, .quote-mark, .timeline-item strong, .faq-item b, .testimonial-card > span, .pricing-card > span) { color: var(--block-accent); }.has-block-accent .static-button:not(.button-outline):not(.button-soft) { background: var(--block-accent); }.has-block-accent .static-button.button-outline { color: var(--block-accent); border-color: var(--block-accent); }
      .image-empty { width: 100%; min-height: 260px; display: grid; place-items: center; border: 1px dashed #c9c3fb; border-radius: 16px; color: #9992c5; }
      .eyebrow { display: block; margin-bottom: 16px; color: #7067da; font-size: 11px; font-weight: 700; letter-spacing: .16em; }
      .block-contact .eyebrow { color: #aaa1ff; }
      h1 { margin: 0 0 16px; font-size: clamp(38px, 6vw, 74px); line-height: 1.12; letter-spacing: -.05em; }
      .block-feature h1, .block-contact h1, .block-button h1 { font-size: clamp(32px, 4vw, 52px); }
      p { max-width: 600px; margin: 0 0 28px; color: #768194; font-size: 16px; line-height: 1.75; }
      .block-contact p { color: #aeb6c5; }
      .static-button { display: inline-flex; gap: 18px; align-items: center; padding: 13px 16px 13px 19px; border-radius: 8px; color: #fff; background: #6557ef; font-size: 14px; font-weight: 700; text-decoration: none; }
      .static-button { transition: transform .18s ease-out, box-shadow .25s ease; will-change: transform; }
      .static-button span { font-size: 17px; }
      .has-custom-accent .static-button, .has-custom-accent .pricing-card.is-featured, .has-custom-accent .tab-buttons button[aria-selected="true"] { background: var(--theme-accent); }.has-custom-accent :is(.eyebrow, .quote-mark, .timeline-item strong, .faq-item b, .testimonial-card > span, .pricing-card > span) { color: var(--theme-accent); }
      .static-button.button-outline { color: var(--theme-accent); border: 1px solid var(--theme-accent); background: transparent; box-shadow: none; }.static-button.button-soft { color: var(--theme-accent); background: color-mix(in srgb, var(--theme-accent) 15%, white); box-shadow: none; }.static-button.button-pill { border-radius: 999px; }.preset-dark .static-button.button-outline, .has-background-image .static-button.button-outline { color: #fff; border-color: #ffffffb8; }.preset-dark .static-button.button-soft, .has-background-image .static-button.button-soft { color: #fff; background: #ffffff20; }
      @keyframes static-marquee { to { transform: translateX(-33.333%); } }
      @keyframes static-fade-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes static-zoom-in { from { opacity: 0; transform: scale(.94); } to { opacity: 1; transform: scale(1); } }
      @keyframes static-blur-in { from { opacity: 0; filter: blur(12px); } to { opacity: 1; filter: blur(0); } }
      .effect-fade-up { animation: static-fade-up .8s ease both paused; }
      .effect-zoom-in { animation: static-zoom-in .8s ease both paused; }
      .effect-blur-in { animation: static-blur-in .9s ease both paused; }
      .effect-visible { animation-play-state: running; }
      .effect-visible .bento-tile, .effect-visible .showcase-card, .effect-visible .sticky-card { animation: static-item-in .75s both; }.effect-visible :is(.bento-tile, .showcase-card, .sticky-card):nth-child(2) { animation-delay: .1s; }.effect-visible :is(.bento-tile, .showcase-card, .sticky-card):nth-child(3) { animation-delay: .2s; }.effect-visible :is(.bento-tile, .showcase-card, .sticky-card):nth-child(4) { animation-delay: .3s; } @keyframes static-item-in { from { opacity: 0; transform: translateY(24px) scale(.98); } to { opacity: 1; transform: none; } }
      .element-stagger :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item) { opacity: 0; }.element-stagger.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item) { animation: static-item-in .72s both; }.element-stagger.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item):nth-child(2) { animation-delay: .09s; }.element-stagger.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item):nth-child(3) { animation-delay: .18s; }.element-stagger.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item):nth-child(4) { animation-delay: .27s; }.element-stagger.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item):nth-child(5) { animation-delay: .36s; }.element-mask h1, .element-mask blockquote { clip-path: inset(0 0 100% 0); transform: translateY(24px); }.element-mask.effect-visible h1, .element-mask.effect-visible blockquote { animation: static-mask-in .9s cubic-bezier(.2,.8,.2,1) both; }.element-float.effect-visible :is(.visual-card, .person-card, .bento-tile, .collage-item) { animation: static-float 5s ease-in-out infinite alternate; }.element-float.effect-visible :is(.visual-card, .person-card, .bento-tile, .collage-item):nth-child(even) { animation-delay: -2.5s; animation-direction: alternate-reverse; }.element-drift.effect-visible :is(.fullscreen-image, .site-image img, .split-media img, .project-visual img, .collage-item img) { animation: static-drift 12s ease-in-out infinite alternate; } @keyframes static-mask-in { to { clip-path: inset(0); transform: none; } } @keyframes static-float { to { transform: translateY(-12px) rotate(.4deg); } } @keyframes static-drift { from { transform: scale(1.01) translate3d(-.8%, 0, 0); } to { transform: scale(1.08) translate3d(.8%, -1%, 0); } }
      .element-stagger .site-content > *, .element-stagger .split-copy > *, .element-stagger .fullscreen-copy > * { opacity: 0; }.element-stagger.effect-visible .site-content > *, .element-stagger.effect-visible .split-copy > *, .element-stagger.effect-visible .fullscreen-copy > * { animation: static-item-in .7s both; }.element-stagger.effect-visible :is(.site-content, .split-copy, .fullscreen-copy) > :nth-child(2) { animation-delay: .1s; }.element-stagger.effect-visible :is(.site-content, .split-copy, .fullscreen-copy) > :nth-child(3) { animation-delay: .2s; }.element-stagger.effect-visible :is(.site-content, .split-copy, .fullscreen-copy) > :nth-child(4) { animation-delay: .3s; }.element-float.effect-visible :is(.site-content, .split-copy, .section-heading, .fullscreen-copy, .footer-brand) { animation: static-float 5.5s ease-in-out infinite alternate; }
      .element-stagger :is(.testimonial-card, .pricing-card) { opacity: 0; }.element-stagger.effect-visible :is(.testimonial-card, .pricing-card) { animation: static-item-in .72s both; }.element-stagger.effect-visible :is(.testimonial-card, .pricing-card):nth-child(2) { animation-delay: .1s; }.element-stagger.effect-visible :is(.testimonial-card, .pricing-card):nth-child(3) { animation-delay: .2s; }
      .motion-fast:is(.effect-fade-up, .effect-zoom-in, .effect-blur-in), .motion-fast.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item, .testimonial-card, .pricing-card), .motion-fast.element-mask.effect-visible :is(h1, blockquote), .motion-fast.element-stagger.effect-visible :is(.site-content, .split-copy, .fullscreen-copy) > * { animation-duration: .48s !important; }.motion-slow:is(.effect-fade-up, .effect-zoom-in, .effect-blur-in), .motion-slow.effect-visible :is(.visual-card, .person-card, .faq-item, .timeline-item, .bento-tile, .showcase-card, .sticky-card, .collage-item, .testimonial-card, .pricing-card), .motion-slow.element-mask.effect-visible :is(h1, blockquote), .motion-slow.element-stagger.effect-visible :is(.site-content, .split-copy, .fullscreen-copy) > * { animation-duration: 1.15s !important; }.motion-fast.element-float.effect-visible :is(.visual-card, .person-card, .bento-tile, .collage-item, .site-content, .split-copy, .section-heading, .fullscreen-copy, .footer-brand) { animation-duration: 3.6s !important; }.motion-slow.element-float.effect-visible :is(.visual-card, .person-card, .bento-tile, .collage-item, .site-content, .split-copy, .section-heading, .fullscreen-copy, .footer-brand) { animation-duration: 7.5s !important; }.motion-fast.element-drift.effect-visible :is(.fullscreen-image, .site-image img, .split-media img, .project-visual img, .collage-item img) { animation-duration: 8s !important; }.motion-slow.element-drift.effect-visible :is(.fullscreen-image, .site-image img, .split-media img, .project-visual img, .collage-item img) { animation-duration: 18s !important; }
      .effect-hover-lift { transition: transform .3s ease, box-shadow .3s ease; }
      .effect-hover-lift:hover { transform: translateY(-8px); box-shadow: 0 18px 40px #262a4a1f; }
      .site-block { position: relative; --pointer-x: 50%; --pointer-y: 50%; --tilt-x: 0deg; --tilt-y: 0deg; --parallax-x: 0px; --parallax-y: 0px; --parallax-x-reverse: 0px; --parallax-y-reverse: 0px; }
      .site-block > :not(.block-decorations):not(.scene-transition-layer) { position: relative; z-index: 1; }
      .hover-lift > :not(.block-decorations), .hover-tilt > :not(.block-decorations) { transition: transform .28s ease, box-shadow .28s ease; }
      .hover-lift:hover > :not(.block-decorations) { transform: translateY(-10px); }
      .hover-tilt > :not(.block-decorations) { transform: perspective(900px) rotateX(var(--tilt-x)) rotateY(var(--tilt-y)); }
      .hover-spotlight::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(circle 220px at var(--pointer-x) var(--pointer-y), #ffffff78, transparent 70%); transition: opacity .25s ease; }
      .hover-spotlight:hover::after { opacity: 1; }
      .hover-glow { transition: box-shadow .3s ease; }.hover-glow:hover { box-shadow: inset 0 0 0 1px #a89fff, 0 0 55px #8f84ff42; }
      .hover-image-zoom img, .hover-image-zoom .site-content { transition: transform .6s cubic-bezier(.2,.8,.2,1); }.hover-image-zoom:hover img { transform: scale(1.08) !important; }.hover-image-zoom:not(:has(img)):hover .site-content { transform: scale(1.035); }
      .block-decorations { position: absolute; z-index: 0; inset: 0; overflow: hidden; pointer-events: none; }.block-decorations span { position: absolute; display: block; transition: transform .22s ease-out; }.block-decorations span:nth-child(1), .block-decorations span:nth-child(3) { transform: translate(var(--parallax-x), var(--parallax-y)); }.block-decorations span:nth-child(2) { transform: translate(var(--parallax-x-reverse), var(--parallax-y-reverse)); }.decor-orbs .block-decorations span { border-radius: 50%; filter: blur(1px); opacity: .7; }.decor-orbs .block-decorations span:nth-child(1) { width: 220px; height: 220px; right: 8%; top: 10%; background: linear-gradient(145deg, #9e93ff, #d9d4ff); }.decor-orbs .block-decorations span:nth-child(2) { width: 70px; height: 70px; right: 32%; bottom: 12%; background: #f2b986; }.decor-orbs .block-decorations span:nth-child(3) { width: 34px; height: 34px; left: 9%; top: 16%; background: #9ddbd2; }.decor-grid .block-decorations { opacity: .35; background-image: linear-gradient(#8f97aa33 1px, transparent 1px), linear-gradient(90deg, #8f97aa33 1px, transparent 1px); background-size: 38px 38px; mask-image: linear-gradient(to right, transparent, #000 25%, #000 75%, transparent); }.decor-sparkles .block-decorations span { width: 14px; height: 14px; border: 2px solid #8175f5; }.decor-sparkles .block-decorations span:nth-child(1) { right: 12%; top: 18%; rotate: 45deg; }.decor-sparkles .block-decorations span:nth-child(2) { width: 8px; height: 8px; left: 8%; bottom: 20%; rotate: 45deg; }.decor-sparkles .block-decorations span:nth-child(3) { right: 28%; bottom: 10%; border-radius: 50%; }.decor-labels .block-decorations span { padding: 8px 12px; border: 1px solid #8c83e866; border-radius: 999px; color: #6557ef; background: #ffffffb8; font-size: 10px; font-weight: 800; letter-spacing: .12em; backdrop-filter: blur(8px); }.decor-labels .block-decorations span:nth-child(1) { right: 9%; top: 16%; }.decor-labels .block-decorations span:nth-child(2) { right: 24%; bottom: 13%; }.decor-labels .block-decorations span:nth-child(3) { left: 7%; bottom: 18%; }
      .section-divider { position: absolute !important; z-index: 3 !important; left: 0; right: 0; bottom: -1px; height: 42px; pointer-events: none; background: var(--theme-bg); }.section-divider.divider-wave { clip-path: polygon(0 58%, 8% 30%, 17% 64%, 27% 24%, 38% 62%, 49% 30%, 60% 68%, 72% 26%, 84% 60%, 93% 32%, 100% 55%, 100% 100%, 0 100%); }.section-divider.divider-slant { height: 58px; clip-path: polygon(0 82%, 100% 8%, 100% 100%, 0 100%); }.section-divider.divider-curve { height: 52px; border-radius: 50% 50% 0 0 / 100% 100% 0 0; transform: scaleX(1.08); }
      .material-noise::before, .material-paper::before, .material-scanlines::before, .material-beams::before, .material-mesh::before { content: ""; position: absolute; z-index: 0; inset: 0; pointer-events: none; }.material-noise::before { opacity: .28; background-image: repeating-radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 1px 4px); background-size: 7px 7px; mix-blend-mode: soft-light; }.material-paper::before { opacity: .34; background-image: repeating-linear-gradient(7deg, #6d573308 0 1px, transparent 1px 5px), radial-gradient(circle at 30% 20%, #fff8, transparent 45%); mix-blend-mode: multiply; }.material-scanlines::before { opacity: .24; background: repeating-linear-gradient(0deg, #0000 0 3px, #6ef5da24 3px 4px); mix-blend-mode: screen; }.material-beams::before { opacity: .68; background: radial-gradient(circle 280px at var(--pointer-x) var(--pointer-y), #ffffff8c, transparent 62%), conic-gradient(from 210deg at var(--pointer-x) var(--pointer-y), transparent, #9d8cff38, transparent 28%); transition: background-position .15s ease; mix-blend-mode: soft-light; }.material-mesh::before { opacity: .72; background: radial-gradient(circle 260px at var(--pointer-x) var(--pointer-y), #f39bc766, transparent 68%), radial-gradient(circle at 15% 80%, #83d9e366, transparent 28%), radial-gradient(circle at 88% 20%, #9e8cff70, transparent 30%); filter: blur(12px); mix-blend-mode: multiply; }.block-fullscreen:is(.material-noise, .material-paper, .material-scanlines, .material-beams, .material-mesh)::before { z-index: 1; }.block-fullscreen .fullscreen-copy { z-index: 2; }
      .block-immersive { min-height: 100svh; padding: 0; isolation: isolate; color: #34384a; background: radial-gradient(circle at 72% 34%, #f6d7d2 0, transparent 26%), linear-gradient(145deg, #f5f0e7, #dbe4ed); }.immersive-stage { position: absolute !important; z-index: 0 !important; inset: 0; overflow: hidden; pointer-events: none; }.immersive-stage::before { content: ""; position: absolute; inset: 0; opacity: .42; background-image: linear-gradient(#565d7430 1px, transparent 1px), linear-gradient(90deg, #565d7430 1px, transparent 1px); background-size: 42px 42px; mask-image: radial-gradient(circle at 64% 45%, #000, transparent 67%); }.immersive-portal { position: absolute; left: 65%; top: 47%; width: min(43vw, 620px); aspect-ratio: .82; overflow: hidden; border: 1px solid #4f5568; border-radius: 48% 48% 44% 44% / 42% 42% 56% 56%; background: radial-gradient(circle at 50% 70%, #eac4b4, transparent 34%), linear-gradient(180deg, #edf3f5 0 52%, #69748b 52%); box-shadow: 0 36px 80px #3d405438, inset 0 0 0 12px #f6f1e780; transform: translate(calc(-50% + var(--parallax-x) * .55), calc(-50% + var(--parallax-y) * .55)); transition: transform .25s ease-out; }.immersive-portal::before, .immersive-portal::after { content: ""; position: absolute; z-index: 2; inset: 5%; border: 1px solid #ffffff8f; border-radius: inherit; pointer-events: none; }.immersive-portal::after { inset: 9%; border-color: #4f55683d; }.immersive-art { width: 100%; height: 100%; object-fit: cover; filter: saturate(.82) contrast(.96); }.immersive-crystal { position: absolute; inset: 18% 20%; filter: drop-shadow(0 28px 18px #31384a3b); }.immersive-crystal i { position: absolute; left: 50%; top: 50%; width: 35%; height: 70%; border: 1px solid #49617a; background: linear-gradient(110deg, #effaffb8, #9ec5df99 46%, #fff9); clip-path: polygon(50% 0, 100% 20%, 83% 88%, 50% 100%, 14% 86%, 0 20%); transform: translate(-50%, -50%); }.immersive-crystal i:nth-child(2) { left: 20%; top: 58%; width: 20%; height: 44%; opacity: .78; transform: translate(-50%, -50%) rotate(-7deg); }.immersive-crystal i:nth-child(3) { left: 82%; top: 50%; width: 17%; height: 36%; opacity: .65; transform: translate(-50%, -50%) rotate(8deg); }.immersive-orbit { position: absolute; left: 65%; top: 47%; border: 1px solid #565d746b; border-radius: 50%; transform: translate(calc(-50% + var(--parallax-x-reverse) * .45), calc(-50% + var(--parallax-y-reverse) * .45)); transition: transform .3s ease-out; }.orbit-one { width: min(58vw, 760px); aspect-ratio: 1; }.orbit-two { width: min(69vw, 900px); aspect-ratio: 1; border-style: dashed; opacity: .45; }.immersive-copy { z-index: 2; width: min(42%, 620px); margin: auto auto auto max(7vw, 80px); }.immersive-copy .eyebrow { color: #5f657a; }.immersive-copy h1 { max-width: 650px; margin: 14px 0 18px; color: inherit; font-size: clamp(60px, 7.5vw, 112px); line-height: .92; letter-spacing: -.065em; }.immersive-copy p { max-width: 450px; color: #6d7486; }.immersive-copy .static-button { color: #fff; background: #4f566d; }.immersive-scroll { position: absolute !important; z-index: 2 !important; left: max(7vw, 80px); bottom: 30px; display: flex; align-items: center; gap: 9px; color: #777e8f; font-size: 8px; font-weight: 800; letter-spacing: .16em; }.immersive-scroll i { width: 40px; height: 1px; overflow: hidden; background: #777e8f; }.immersive-scroll i::after { content: ""; display: block; width: 50%; height: 1px; background: #fff; animation: immersive-scroll-line 2.2s ease-in-out infinite; } @keyframes immersive-scroll-line { 50% { transform: translateX(100%); } }
      .scene-transition-layer { position: absolute !important; z-index: 30 !important; inset: 0; display: block; pointer-events: none; background: var(--theme-surface, #f4f0e8); }.scene-transition-circle .scene-transition-layer { clip-path: circle(150% at 50% 50%); }.scene-transition-circle.effect-visible .scene-transition-layer { animation: scene-circle-open 1.05s cubic-bezier(.76,0,.24,1) both; }.scene-transition-curtain .scene-transition-layer { transform-origin: right center; }.scene-transition-curtain.effect-visible .scene-transition-layer { animation: scene-curtain-open .9s cubic-bezier(.7,0,.2,1) both; }.scene-transition-paper .scene-transition-layer { border-bottom: 1px solid #686e7d; background-color: #f5f0e7; background-image: repeating-linear-gradient(0deg, #5960740d 0 1px, transparent 1px 4px); transform-origin: center top; }.scene-transition-paper.effect-visible .scene-transition-layer { animation: scene-paper-open 1.15s cubic-bezier(.6,0,.2,1) both; }.scene-transition-dissolve .scene-transition-layer { background: #eef0f4cc; backdrop-filter: blur(18px); }.scene-transition-dissolve.effect-visible .scene-transition-layer { animation: scene-dissolve-open .95s ease both; } @keyframes scene-circle-open { to { clip-path: circle(0 at 50% 50%); visibility: hidden; } } @keyframes scene-curtain-open { to { transform: scaleX(0); visibility: hidden; } } @keyframes scene-paper-open { to { opacity: 0; transform: perspective(900px) rotateX(-86deg) scaleY(.45); visibility: hidden; } } @keyframes scene-dissolve-open { to { opacity: 0; filter: blur(26px); visibility: hidden; } }
      @media (max-width: 640px) { .block-immersive { min-height: 92svh; }.immersive-portal { left: 58%; top: 34%; width: min(78vw, 390px); opacity: .84; }.immersive-copy { width: calc(100% - 48px); margin: auto 24px 70px; align-self: end; }.immersive-copy h1 { font-size: clamp(44px, 14vw, 72px); }.immersive-copy p { max-width: 90%; }.immersive-scroll { left: 24px; bottom: 24px; } }
      @media (prefers-reduced-motion: reduce) { .scene-transition-layer { display: none !important; } *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }
      @media (pointer: fine) { body:not(.cursor-default), body:not(.cursor-default) a, body:not(.cursor-default) button { cursor: none; } }
      @media (pointer: coarse) { .custom-cursor { display: none; } }
      @media (min-width: 641px) { .visibility-mobile { display: none !important; } }
      @media (max-width: 640px) { .site-block { min-height: 300px; padding: 64px 24px; } .block-nav { min-height: 72px; padding: 14px 20px; }.nav-links { display: none; }.block-nav .static-button { margin-left: auto; }.block-hero { min-height: 520px; } .site-image { padding: 24px; } .block-split { display: flex; flex-direction: column; gap: 28px; } .split-media, .split-media img { min-height: 280px; } .cards-grid, .stats-grid, .team-grid, .timeline-list { grid-template-columns: 1fr; }.timeline-list { gap: 28px; }.timeline-list::before { left: 5px; right: auto; top: 0; bottom: 0; width: 1px; height: auto; }.timeline-item { grid-template-columns: 65px 12px 1fr; align-items: center; gap: 12px; padding: 0; }.bento-grid { grid-template-columns: 1fr; }.bento-tile { grid-column: auto !important; grid-row: auto !important; min-height: 240px; }.showcase-rail { width: calc(100% + 24px); padding-right: 24px; }.showcase-card { flex-basis: 84vw; }.block-sticky { display: block; }.sticky-intro { position: relative; top: 0; margin-bottom: 38px; }.sticky-card { min-height: 280px; padding: 26px; }.sticky-card h3 { margin-top: 80px; }.collage-stage { grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 240px); gap: 12px; }.collage-item { grid-column: auto !important; grid-row: auto !important; transform: none !important; }.collage-item:first-child { grid-column: span 2 !important; }.block-fullscreen { min-height: 90svh; padding: 0; }.fullscreen-copy { width: calc(100% - 48px); margin: auto 24px; }.fullscreen-copy h1 { font-size: clamp(48px, 17vw, 80px); }.block-footer { display: block; min-height: 520px; }.footer-links { margin-top: 45px; }.footer-meta { margin-top: 55px; gap: 16px; }.layout-offset .site-content, .layout-offset .section-heading { width: 100%; margin-left: 0; }.layout-poster h1, .layout-poster blockquote { font-size: clamp(44px, 15vw, 76px); }.block-decorations { opacity: .55; } }
      @media (max-width: 640px) { .visibility-desktop { display: none !important; }.tabs-shell { grid-template-columns: 1fr; gap: 18px; }.tab-buttons { grid-template-columns: repeat(3, minmax(110px, 1fr)); overflow-x: auto; }.tab-buttons button { white-space: nowrap; }.tab-panel { min-height: 320px; padding: 26px; }.tab-panel h3 { margin-top: 90px; }.testimonial-card { flex-basis: 84vw; }.pricing-grid { grid-template-columns: 1fr; }.pricing-card.is-featured { transform: none; }.block-logos > p { padding: 0 24px; }.logo-track { gap: 38px; }.density-compact .site-block:not(.block-nav):not(.block-logos):not(.block-fullscreen) { padding-top: 44px; padding-bottom: 44px; }.density-airy .site-block:not(.block-nav):not(.block-logos):not(.block-fullscreen) { padding-top: 78px; padding-bottom: 78px; }.type-expressive .site-block h1 { font-size: clamp(44px, 15vw, 72px); }.type-quiet .site-block h1 { font-size: clamp(30px, 10vw, 46px); }.block-nav { gap: 10px; overflow: visible; }.nav-menu-toggle { position: relative; z-index: 2; display: block; margin-left: auto; }.block-nav .nav-links { position: absolute; z-index: 1; left: 14px; right: 14px; top: calc(100% + 8px); display: grid; gap: 2px; margin: 0; padding: 10px; opacity: 0; visibility: hidden; border: 1px solid #ffffffb8; border-radius: 16px; background: #fffffff2; box-shadow: 0 18px 45px #20243a24; backdrop-filter: blur(18px); transform: translateY(-8px) scale(.98); transform-origin: top; transition: opacity .2s ease, transform .2s ease, visibility .2s; }.block-nav .nav-links.is-open { opacity: 1; visibility: visible; transform: none; }.block-nav .nav-links a, .block-nav .nav-links span { padding: 12px 14px; border-radius: 10px; color: #192031; font-size: 14px; }.block-nav .nav-links a:hover { background: #f3f1ff; }.block-nav .static-button { margin-left: 0; } }
      @media (max-width: 640px) { .masonry-gallery { columns: 2; column-gap: 12px; }.masonry-item { min-height: 190px; margin-bottom: 12px; }.masonry-item:nth-child(3n + 1) { min-height: 280px; }.block-accordion { grid-template-columns: 1fr; gap: 30px; }.service-accordion button { min-height: 72px; }.layout-frame > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .footer-brand) { padding: 20px; }.layout-diagonal > :is(.site-content, .section-heading, .split-copy, .sticky-intro, .fullscreen-copy) { transform: rotate(-1deg); } }
    </style>
  </head>
  <body class="theme-${theme} cursor-${cursor} ${typographyClasses}${customAccent ? ' has-custom-accent' : ''}" style="${pageVariables}">
    ${meta.scrollProgress !== false ? '<div class="page-scroll-progress" aria-hidden="true"><i></i></div>' : ''}
    ${cursor !== 'default' ? `<div class="custom-cursor cursor-${cursor}-visual" aria-hidden="true"><i></i><b></b></div>` : ''}
    <main class="page-frame">
${renderedBlocks}
    </main>
    <script>
      const pageProgress = document.querySelector('.page-scroll-progress')
      if (pageProgress) {
        const updatePageProgress = () => {
          const scrollable = document.documentElement.scrollHeight - innerHeight
          const progress = scrollable > 0 ? Math.min(1, Math.max(0, scrollY / scrollable)) : 0
          pageProgress.style.setProperty('--page-progress', (progress * 100) + '%')
        }
        updatePageProgress()
        addEventListener('scroll', updatePageProgress, { passive: true })
        addEventListener('resize', updatePageProgress)
      }
      const customCursor = document.querySelector('.custom-cursor')
      if (customCursor && matchMedia('(pointer: fine)').matches) {
        document.addEventListener('pointermove', (event) => {
          customCursor.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)'
          customCursor.classList.add('is-visible')
          customCursor.classList.toggle('is-interactive', Boolean(event.target.closest('a, button, .showcase-card, .collage-item, .compare-range')))
        })
        document.documentElement.addEventListener('mouseleave', () => customCursor.classList.remove('is-visible'))
      }
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.querySelectorAll('.static-button').forEach((button) => {
          button.addEventListener('pointermove', (event) => {
            const rect = button.getBoundingClientRect()
            button.style.transform = 'translate(' + ((event.clientX - rect.left - rect.width / 2) * .18) + 'px,' + ((event.clientY - rect.top - rect.height / 2) * .22) + 'px)'
          })
          button.addEventListener('pointerleave', () => { button.style.transform = '' })
        })
      }
      document.querySelectorAll('.compare-range').forEach((range) => {
        range.addEventListener('input', () => {
          range.closest('.block-compare').style.setProperty('--compare', range.value + '%')
        })
      })
      document.querySelectorAll('.tabs-shell').forEach((shell) => {
        const buttons = [...shell.querySelectorAll('[data-tab-index]')]
        const panels = [...shell.querySelectorAll('[data-tab-panel]')]
        const activateTab = (activeIndex, focus = false) => {
          buttons.forEach((candidate, index) => {
            const active = String(index) === String(activeIndex)
            candidate.setAttribute('aria-selected', String(active))
            candidate.tabIndex = active ? 0 : -1
            if (active && focus) candidate.focus()
          })
          panels.forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== String(activeIndex) })
        }
        buttons.forEach((button) => {
          button.addEventListener('click', () => activateTab(button.dataset.tabIndex))
          button.addEventListener('keydown', (event) => {
            const current = Number(button.dataset.tabIndex)
            const next = event.key === 'ArrowRight' || event.key === 'ArrowDown'
              ? (current + 1) % buttons.length
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                ? (current - 1 + buttons.length) % buttons.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
            if (next === null) return
            event.preventDefault()
            activateTab(next, true)
          })
        })
      })
      document.querySelectorAll('.service-accordion').forEach((accordion) => {
        const rows = [...accordion.querySelectorAll(':scope > article')]
        const activateRow = (row, focus = false) => {
          rows.forEach((candidate) => {
            const active = candidate === row
            candidate.classList.toggle('active', active)
            candidate.querySelector('button').setAttribute('aria-expanded', String(active))
            candidate.querySelector('button i').textContent = active ? '−' : '＋'
            candidate.querySelector('div').hidden = !active
          })
          if (focus) row.querySelector('button').focus()
        }
        rows.forEach((row, index) => {
          const button = row.querySelector('button')
          button.addEventListener('click', () => activateRow(row))
          button.addEventListener('keydown', (event) => {
            const next = event.key === 'ArrowDown' || event.key === 'ArrowRight'
              ? (index + 1) % rows.length
              : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                ? (index - 1 + rows.length) % rows.length
                : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : null
            if (next === null || !rows.length) return
            event.preventDefault()
            activateRow(rows[next], true)
          })
        })
      })
      document.querySelectorAll('.nav-menu-toggle').forEach((toggle) => {
        const menu = document.getElementById(toggle.getAttribute('aria-controls'))
        if (!menu) return
        const closeMenu = () => {
          toggle.setAttribute('aria-expanded', 'false')
          toggle.setAttribute('aria-label', '展开导航菜单')
          menu.classList.remove('is-open')
        }
        toggle.addEventListener('click', () => {
          const isOpen = toggle.getAttribute('aria-expanded') === 'true'
          toggle.setAttribute('aria-expanded', String(!isOpen))
          toggle.setAttribute('aria-label', isOpen ? '展开导航菜单' : '收起导航菜单')
          menu.classList.toggle('is-open', !isOpen)
        })
        menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu))
        document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu() })
      })
      const revealSections = document.querySelectorAll('.effect-fade-up, .effect-zoom-in, .effect-blur-in, .element-stagger, .element-mask, .element-float, .element-drift, .scene-transition-circle, .scene-transition-curtain, .scene-transition-paper, .scene-transition-dissolve')
      if ('IntersectionObserver' in window) {
        const revealObserver = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return
            entry.target.classList.add('effect-visible')
            revealObserver.unobserve(entry.target)
          })
        }, { threshold: 0.16 })
        revealSections.forEach((section) => revealObserver.observe(section))
      } else {
        revealSections.forEach((section) => section.classList.add('effect-visible'))
      }
      document.querySelectorAll('.hover-tilt, .hover-spotlight, .has-decorations, .material-beams, .material-mesh, .block-immersive').forEach((section) => {
        section.addEventListener('pointermove', (event) => {
          const rect = section.getBoundingClientRect()
          const x = (event.clientX - rect.left) / rect.width
          const y = (event.clientY - rect.top) / rect.height
          section.style.setProperty('--pointer-x', (x * 100) + '%')
          section.style.setProperty('--pointer-y', (y * 100) + '%')
          section.style.setProperty('--tilt-x', ((.5 - y) * 8) + 'deg')
          section.style.setProperty('--tilt-y', ((x - .5) * 8) + 'deg')
          section.style.setProperty('--parallax-x', ((x - .5) * 24) + 'px')
          section.style.setProperty('--parallax-y', ((y - .5) * 24) + 'px')
          section.style.setProperty('--parallax-x-reverse', ((.5 - x) * 16) + 'px')
          section.style.setProperty('--parallax-y-reverse', ((.5 - y) * 16) + 'px')
        })
        section.addEventListener('pointerleave', () => {
          section.style.setProperty('--tilt-x', '0deg')
          section.style.setProperty('--tilt-y', '0deg')
          section.style.setProperty('--parallax-x', '0px')
          section.style.setProperty('--parallax-y', '0px')
          section.style.setProperty('--parallax-x-reverse', '0px')
          section.style.setProperty('--parallax-y-reverse', '0px')
        })
      })
    </script>
  </body>
</html>`
}

function normalizeBlocks(blocks) {
  const usedIds = new Set()
  const usedAnchors = new Set()
  return (Array.isArray(blocks) ? blocks : []).filter((block) => block && typeof block === 'object').slice(0, 200).map((block, index) => {
    const type = SUPPORTED_BLOCK_TYPES.has(block.type) ? block.type : 'text'
    const rawId = String(block.id || `${type}-${Date.now()}-${index}`)
    let id = rawId
    let idSuffix = 2
    while (usedIds.has(id)) id = `${rawId}-${idSuffix++}`
    usedIds.add(id)
    const rawAnchor = safeAnchor(block.anchor)
    let anchor = rawAnchor
    let anchorSuffix = 2
    while (anchor && usedAnchors.has(anchor)) anchor = `${rawAnchor}-${anchorSuffix++}`
    if (anchor) usedAnchors.add(anchor)
    const normalizedItems = Array.isArray(block.items)
      ? block.items.filter((item) => item && typeof item === 'object').slice(0, 50).map((item) => ({
        ...item,
        title: String(item.title ?? ''),
        description: String(item.description ?? ''),
        value: String(item.value ?? ''),
        label: String(item.label ?? ''),
        name: String(item.name ?? ''),
        role: String(item.role ?? ''),
        imageUrl: String(item.imageUrl ?? ''),
        altText: String(item.altText ?? ''),
      }))
      : []
    const sourceStyles = block.styles && typeof block.styles === 'object' && !Array.isArray(block.styles) ? block.styles : {}
    const normalizedStyles = {}
    if (/^#[0-9a-f]{6}$/i.test(sourceStyles.background ?? '')) normalizedStyles.background = sourceStyles.background
    if (sourceStyles.backgroundMode === 'gradient') normalizedStyles.backgroundMode = 'gradient'
    if (/^#[0-9a-f]{6}$/i.test(sourceStyles.gradientFrom ?? '')) normalizedStyles.gradientFrom = sourceStyles.gradientFrom
    if (/^#[0-9a-f]{6}$/i.test(sourceStyles.gradientTo ?? '')) normalizedStyles.gradientTo = sourceStyles.gradientTo
    if (Number.isFinite(Number(sourceStyles.gradientAngle))) normalizedStyles.gradientAngle = Math.min(360, Math.max(0, Number(sourceStyles.gradientAngle)))
    if (/^#[0-9a-f]{6}$/i.test(sourceStyles.textColor ?? '')) normalizedStyles.textColor = sourceStyles.textColor
    if (/^#[0-9a-f]{6}$/i.test(sourceStyles.accentColor ?? '')) normalizedStyles.accentColor = sourceStyles.accentColor
    if (Number.isFinite(Number(sourceStyles.radius))) normalizedStyles.radius = Math.min(48, Math.max(0, Number(sourceStyles.radius)))
    if (['left', 'center', 'right'].includes(sourceStyles.align)) normalizedStyles.align = sourceStyles.align
    if (Number.isFinite(Number(sourceStyles.paddingY))) normalizedStyles.paddingY = Math.min(160, Math.max(20, Number(sourceStyles.paddingY)))
    if (Number.isFinite(Number(sourceStyles.minHeight))) normalizedStyles.minHeight = Math.min(900, Math.max(120, Number(sourceStyles.minHeight)))
    return {
      ...block,
      id,
      type,
      label: String(block.label || componentItems.find((item) => item.type === type)?.label || '内容区'),
      locale: block.locale === 'en' ? 'en' : 'zh',
      title: String(block.title ?? ''),
      description: String(block.description ?? ''),
      cta: String(block.cta ?? ''),
      url: String(block.url ?? ''),
      imageUrl: String(block.imageUrl ?? ''),
      altText: String(block.altText ?? ''),
      imagePosition: ['top left', 'top', 'top right', 'left', 'center', 'right', 'bottom left', 'bottom', 'bottom right'].includes(block.imagePosition) ? block.imagePosition : 'center',
      imageFit: block.imageFit === 'contain' ? 'contain' : 'cover',
      imageScale: Math.min(1.3, Math.max(1, Number(block.imageScale) || 1)),
      backgroundImage: String(block.backgroundImage ?? ''),
      backgroundPosition: backgroundPositionValue(block.backgroundPosition),
      backgroundOverlay: Math.min(.9, Math.max(0, Number(block.backgroundOverlay) || 0)),
      comparePosition: Math.min(90, Math.max(10, Number(block.comparePosition) || 50)),
      anchor,
      items: normalizedItems,
      styles: normalizedStyles,
      effect: ['fade-up', 'zoom-in', 'blur-in', 'hover-lift'].includes(block.effect) ? block.effect : 'none',
      elementEffect: ['stagger', 'mask', 'float', 'drift'].includes(block.elementEffect) ? block.elementEffect : 'none',
      hoverEffect: ['lift', 'tilt', 'spotlight', 'glow', 'image-zoom'].includes(block.hoverEffect) ? block.hoverEffect : block.effect === 'hover-lift' ? 'lift' : 'none',
      visualPreset: ['gradient', 'dark', 'glass', 'editorial'].includes(block.visualPreset) ? block.visualPreset : 'none',
      layoutVariant: ['centered', 'offset', 'poster', 'frame', 'diagonal'].includes(block.layoutVariant) ? block.layoutVariant : 'default',
      decoration: ['orbs', 'grid', 'sparkles', 'labels'].includes(block.decoration) ? block.decoration : type === 'hero' ? 'orbs' : type === 'feature' ? 'sparkles' : type === 'contact' ? 'labels' : 'none',
      material: ['noise', 'paper', 'scanlines', 'beams', 'mesh'].includes(block.material) ? block.material : type === 'hero' ? 'mesh' : type === 'feature' ? 'paper' : type === 'contact' ? 'noise' : 'none',
      visibility: ['desktop', 'mobile'].includes(block.visibility) ? block.visibility : 'both',
      sectionDivider: ['wave', 'slant', 'curve'].includes(block.sectionDivider) ? block.sectionDivider : 'none',
      sceneTransition: ['circle', 'curtain', 'paper', 'dissolve'].includes(block.sceneTransition) ? block.sceneTransition : 'none',
      stickyNav: type === 'nav' ? block.stickyNav !== false : undefined,
      motionSpeed: ['fast', 'slow'].includes(block.motionSpeed) ? block.motionSpeed : 'normal',
      buttonStyle: ['outline', 'soft', 'pill'].includes(block.buttonStyle) ? block.buttonStyle : 'solid',
    }
  })
}

function normalizePageMeta(meta = {}, fallbackName = '') {
  const source = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
  return {
    ...DEFAULT_PAGE_META,
    title: String(source.title ?? fallbackName ?? DEFAULT_PAGE_META.title).slice(0, 60),
    description: String(source.description ?? DEFAULT_PAGE_META.description).slice(0, 160),
    canvasWidth: Math.min(1440, Math.max(640, Number(source.canvasWidth) || DEFAULT_PAGE_META.canvasWidth)),
    canvasHeight: Math.min(1200, Math.max(480, Number(source.canvasHeight) || DEFAULT_PAGE_META.canvasHeight)),
    siteWidth: Math.min(1920, Math.max(720, Number(source.siteWidth) || DEFAULT_PAGE_META.siteWidth)),
    pageBackground: /^#[0-9a-f]{6}$/i.test(source.pageBackground ?? '') ? source.pageBackground : DEFAULT_PAGE_META.pageBackground,
    sectionGap: Math.min(48, Math.max(0, Number(source.sectionGap) || 0)),
    sectionRadius: Math.min(48, Math.max(0, Number(source.sectionRadius) || 0)),
    theme: pageTheme(source.theme),
    cursor: cursorMode(source.cursor),
    fontMode: fontMode(source.fontMode),
    density: densityMode(source.density),
    typeScale: typeScale(source.typeScale),
    scrollProgress: source.scrollProgress !== false,
    accentColor: /^#[0-9a-f]{6}$/i.test(source.accentColor ?? '') ? source.accentColor : '',
  }
}

function pageSurfaceStyle(meta) {
  return {
    '--page-background': /^#[0-9a-f]{6}$/i.test(meta.pageBackground ?? '') ? meta.pageBackground : DEFAULT_PAGE_META.pageBackground,
    '--page-site-width': `${Math.min(1920, Math.max(720, Number(meta.siteWidth) || DEFAULT_PAGE_META.siteWidth))}px`,
    '--page-section-gap': `${Math.min(48, Math.max(0, Number(meta.sectionGap) || 0))}px`,
    '--page-section-radius': `${Math.min(48, Math.max(0, Number(meta.sectionRadius) || 0))}px`,
  }
}

function loadBlockLibrary() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BLOCK_LIBRARY_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    const usedIds = new Set()
    return parsed
      .filter((entry) => entry && typeof entry === 'object' && entry.block && SUPPORTED_BLOCK_TYPES.has(entry.block.type))
      .slice(0, BLOCK_LIBRARY_LIMIT)
      .map((entry, index) => {
        const baseId = String(entry.libraryId || `saved-block-${index}`)
        let libraryId = baseId
        let suffix = 2
        while (usedIds.has(libraryId)) libraryId = `${baseId}-${suffix++}`
        usedIds.add(libraryId)
        return {
          libraryId,
          name: String(entry.name || entry.block.title || entry.block.label || '已保存区块').slice(0, 50),
          savedAt: Number(entry.savedAt) || 0,
          block: entry.block,
        }
      })
  } catch {
    return []
  }
}

function buildTemplateBlocks(template, components = componentItems, language = 'zh') {
  const stamp = Date.now()
  return normalizeBlocks(template.blocks.map((block, index) => ({
    id: `${block.type}-${stamp}-${index}`,
    type: block.type,
    label: block.label ?? components.find((item) => item.type === block.type)?.label ?? (language === 'en' ? 'Content section' : '内容区'),
    locale: language === 'en' ? 'en' : 'zh',
    title: block.title ?? (language === 'en' ? 'New content' : '新的内容'),
    description: block.description ?? '',
    cta: block.cta ?? (block.type === 'nav' ? (language === 'en' ? 'Contact me' : '联系我') : (language === 'en' ? 'Learn more' : '了解更多')),
    url: block.url ?? '',
    imageUrl: block.imageUrl ?? '',
    altText: block.altText ?? '',
    imagePosition: 'center',
    imageFit: 'cover',
    imageScale: 1,
    effect: block.effect ?? (block.type === 'nav' ? 'none' : 'fade-up'),
    elementEffect: block.elementEffect ?? (['cards', 'bento', 'showcase', 'sticky', 'collage'].includes(block.type) ? 'stagger' : 'none'),
    hoverEffect: block.hoverEffect ?? (['cards', 'bento'].includes(block.type) ? 'lift' : 'none'),
    visualPreset: block.visualPreset ?? 'none',
    layoutVariant: block.layoutVariant ?? 'default',
    decoration: block.decoration ?? 'none',
    material: block.material ?? 'none',
    backgroundImage: '',
    backgroundPosition: 'center',
    backgroundOverlay: 0.25,
    comparePosition: block.comparePosition ?? 50,
    anchor: block.anchor ?? ({ hero: 'home', showcase: 'work', bento: 'services', cards: 'services', pricing: 'pricing', faq: 'faq', contact: 'contact', footer: 'contact' }[block.type] ?? ''),
    visibility: block.visibility ?? 'both',
    sectionDivider: block.sectionDivider ?? 'none',
    sceneTransition: block.sceneTransition ?? 'none',
    stickyNav: block.type === 'nav' ? block.stickyNav !== false : undefined,
    motionSpeed: block.motionSpeed ?? 'normal',
    buttonStyle: block.buttonStyle ?? 'solid',
    items: (block.items ?? []).map((item) => ({ ...item })),
    styles: { ...(block.styles ?? {}) },
  })))
}

function uniquePageId(pages, seed = 'page') {
  const used = new Set((pages ?? []).map((page) => String(page.id)))
  const base = safeAnchor(seed) || 'page'
  let id = base
  let suffix = 2
  while (used.has(id)) id = `${base}-${suffix++}`
  return id
}

function normalizeProjectDocument(document = {}) {
  const sourcePages = Array.isArray(document.pages) && document.pages.length
    ? document.pages
    : [{
        id: 'home',
        name: document.name || document.meta?.title || DEFAULT_PAGE_META.title,
        meta: document.meta,
        blocks: document.blocks,
      }]
  const usedIds = new Set()
  const usedSlugs = new Set()
  const pages = sourcePages.map((page, index) => {
    const source = page && typeof page === 'object' && !Array.isArray(page) ? page : {}
    const baseId = safeAnchor(source.id || source.slug || (index === 0 ? 'home' : `page-${index + 1}`)) || `page-${index + 1}`
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)
    const slugBase = safeAnchor(source.slug || id) || `page-${index + 1}`
    let slug = slugBase
    let slugSuffix = 2
    while (usedSlugs.has(slug)) slug = `${slugBase}-${slugSuffix++}`
    usedSlugs.add(slug)
    const name = String(source.name || source.meta?.title || `页面 ${index + 1}`).slice(0, 40)
    const blocks = normalizeBlocks(Array.isArray(source.blocks) && source.blocks.length ? source.blocks : index === 0 ? initialBlocks : [])
    return {
      id,
      name,
      slug,
      meta: normalizePageMeta(source.meta, name),
      blocks,
    }
  })
  const requestedActiveId = String(document.activePageId || '')
  const activePageId = pages.some((page) => page.id === requestedActiveId) ? requestedActiveId : pages[0].id
  return {
    version: PAGE_SCHEMA_VERSION,
    name: String(document.name || pages[0].name || 'PageCraft 网站').slice(0, 60),
    activePageId,
    pages,
  }
}

function loadProject(language = 'zh') {
  try {
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!stored) {
      if (language !== 'en') return normalizeProjectDocument({})
      const meta = localizeContent(cloneConfig(DEFAULT_PAGE_META), language)
      const blocks = localizeContent(cloneConfig(initialBlocks), language).map((block) => ({ ...block, locale: 'en' }))
      return normalizeProjectDocument({
        name: meta.title,
        pages: [{ id: 'home', name: meta.title, slug: 'home', meta, blocks }],
      })
    }
    return normalizeProjectDocument(JSON.parse(stored))
  } catch {
    return normalizeProjectDocument({})
  }
}

function PreviewCursor({ mode }) {
  const cursorRef = useRef(null)

  useEffect(() => {
    const cursor = cursorRef.current
    if (!cursor || mode === 'default' || !window.matchMedia('(pointer: fine)').matches) return undefined
    function handleMove(event) {
      cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`
      cursor.classList.add('is-visible')
      cursor.classList.toggle('is-interactive', Boolean(event.target.closest?.('a, button, .showcase-card, .collage-item, .compare-range')))
    }
    function handleLeave() {
      cursor.classList.remove('is-visible')
    }
    document.addEventListener('pointermove', handleMove)
    document.documentElement.addEventListener('mouseleave', handleLeave)
    const magneticButtons = [...document.querySelectorAll('.preview-page .block-cta')]
    const magneticCleanups = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? [] : magneticButtons.map((button) => {
      function handleMagnet(event) {
        const rect = button.getBoundingClientRect()
        button.style.transform = `translate(${(event.clientX - rect.left - rect.width / 2) * .18}px, ${(event.clientY - rect.top - rect.height / 2) * .22}px)`
      }
      function resetMagnet() {
        button.style.transform = ''
      }
      button.addEventListener('pointermove', handleMagnet)
      button.addEventListener('pointerleave', resetMagnet)
      return () => {
        button.removeEventListener('pointermove', handleMagnet)
        button.removeEventListener('pointerleave', resetMagnet)
      }
    })
    return () => {
      document.removeEventListener('pointermove', handleMove)
      document.documentElement.removeEventListener('mouseleave', handleLeave)
      magneticCleanups.forEach((cleanup) => cleanup())
    }
  }, [mode])

  if (mode === 'default') return null
  return <div ref={cursorRef} className={`custom-cursor cursor-${mode}-visual`} aria-hidden="true"><i /><b /></div>
}

function ScrollProgress() {
  const progressRef = useRef(null)
  useEffect(() => {
    function updateProgress() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0
      progressRef.current?.style.setProperty('--page-progress', `${progress * 100}%`)
    }
    updateProgress()
    window.addEventListener('scroll', updateProgress, { passive: true })
    window.addEventListener('resize', updateProgress)
    return () => {
      window.removeEventListener('scroll', updateProgress)
      window.removeEventListener('resize', updateProgress)
    }
  }, [])
  return <div ref={progressRef} className="page-scroll-progress" aria-hidden="true"><i /></div>
}

function collectPageImages(blocks) {
  const seen = new Set()
  const images = []
  function add(source, label, kind) {
    const value = String(source || '').trim()
    if (!value || seen.has(value)) return
    seen.add(value)
    images.push({ source: value, label: String(label || '未命名图片').slice(0, 50), kind })
  }
  blocks.forEach((block) => {
    add(block.imageUrl, block.title, '区块图片')
    add(block.backgroundImage, block.title, '背景图片')
    ;(block.items ?? []).forEach((item) => add(item.imageUrl, item.title || item.name || block.title, '内容图片'))
  })
  return images.slice(0, 24)
}

function collectPageColors(blocks, pageMeta) {
  const colors = []
  const seen = new Set()
  function add(value, label) {
    const color = String(value || '').toLowerCase()
    if (!/^#[0-9a-f]{6}$/i.test(color) || seen.has(color)) return
    seen.add(color)
    colors.push({ color, label })
  }
  add(pageMeta.accentColor, '品牌色')
  add(themeAccent(pageMeta.theme), '主题色')
  blocks.forEach((block) => {
    add(block.styles?.background, block.title || block.label || '区块颜色')
    add(block.styles?.gradientFrom, `${block.title || block.label} · 渐变起点`)
    add(block.styles?.gradientTo, `${block.title || block.label} · 渐变终点`)
    add(block.styles?.textColor, `${block.title || block.label} · 文字`)
    add(block.styles?.accentColor, `${block.title || block.label} · 强调`)
  })
  ;['#ffffff', '#192031', '#f3f0ff', '#6557ef'].forEach((color, index) => add(color, ['白色', '深墨色', '浅紫色', 'PageCraft 紫'][index]))
  return colors.slice(0, 12)
}

function PageImagePicker({ assets, current, onSelect, targets = [], target, onTargetChange }) {
  if (!assets.length) return null
  return <details className="page-image-picker">
    <summary><span><Image size={12} /> 本页图片</span><b>{assets.length}</b></summary>
    {targets.length > 1 && <label className="page-image-target"><span>应用到</span><select value={target} onChange={(event) => onTargetChange(event.target.value)}>{targets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
    <div className="page-image-grid">
      {assets.map((asset, index) => <button className={current === asset.source ? 'active' : ''} key={`${index}-${asset.source.slice(0, 24)}`} type="button" onClick={() => onSelect(asset.source)} title={`${asset.kind}：${asset.label}`} aria-label={`使用图片：${asset.label}`}><img src={asset.source} alt="" /><span>{asset.kind}</span></button>)}
    </div>
  </details>
}

function PageColorPicker({ colors, current, onSelect, targets, target, onTargetChange }) {
  return <details className="page-color-picker">
    <summary><span><span className="color-wheel" /> 本页配色</span><b>{colors.length}</b></summary>
    <label className="page-image-target page-color-target"><span>应用到</span><select value={target} onChange={(event) => onTargetChange(event.target.value)}>{targets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    <div className="page-color-grid">
      {colors.map((item) => <button className={String(current).toLowerCase() === item.color ? 'active' : ''} key={item.color} type="button" onClick={() => onSelect(item.color)} title={`${item.label} · ${item.color.toUpperCase()}`} aria-label={`应用颜色 ${item.color.toUpperCase()}`}><i style={{ background: item.color }} /><span>{item.color.toUpperCase()}</span></button>)}
    </div>
    <small>点击颜色，应用到上方选择的目标。</small>
  </details>
}

function CommandPalette({ blocks, components = componentItems, onAdd, onFocus, actions, onClose }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const resultsRef = useRef(null)
  const entries = useMemo(() => {
    const componentEntries = components.map((item) => ({ id: `add-${item.type}`, group: '添加区块', title: item.label, note: item.note, run: () => onAdd(item.type) }))
    const blockEntries = blocks.map((block, index) => ({ id: `focus-${block.id}`, group: '页面跳转', title: block.title || block.label || '未命名区块', note: `${String(index + 1).padStart(2, '0')} · ${block.label}`, run: () => onFocus(block.id) }))
    return [...actions, ...componentEntries, ...blockEntries]
  }, [actions, blocks, components, onAdd, onFocus])
  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return entries
    return entries.filter((entry) => `${entry.group} ${entry.title} ${entry.note || ''}`.toLocaleLowerCase('zh-CN').includes(keyword))
  }, [entries, query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function runEntry(entry) {
    if (!entry) return
    onClose()
    entry.run()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => filteredEntries.length ? (current + 1) % filteredEntries.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => filteredEntries.length ? (current - 1 + filteredEntries.length) % filteredEntries.length : 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runEntry(filteredEntries[activeIndex])
    }
  }

  return <div className="modal-backdrop command-backdrop" onClick={onClose}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="快捷命令" onClick={(event) => event.stopPropagation()} onKeyDown={handleKeyDown}>
      <label className="command-search"><Search size={18} /><input ref={inputRef} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={filteredEntries[activeIndex] ? `command-option-${activeIndex}` : undefined} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索区块、页面内容或操作…" /><kbd>ESC</kbd></label>
      <div className="command-results" id="command-results" role="listbox" ref={resultsRef}>
        {filteredEntries.map((entry, index) => <button id={`command-option-${index}`} role="option" aria-selected={activeIndex === index} className={activeIndex === index ? 'active' : ''} key={entry.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => runEntry(entry)}><span><small>{entry.group}</small><strong>{entry.title}</strong>{entry.note && <em>{entry.note}</em>}</span>{activeIndex === index && <CornerDownLeft size={14} />}</button>)}
        {!filteredEntries.length && <div className="command-empty"><Search size={20} /><strong>没有匹配的命令</strong><span>试试“图片”“设置”或页面里的标题。</span></div>}
      </div>
      <footer><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 执行</span><span>共 {entries.length} 条命令</span></footer>
    </section>
  </div>
}

function App() {
  const [language, setLanguage] = useState(loadInterfaceLanguage)
  const [initialProject] = useState(() => loadProject(language))
  const [pages, setPages] = useState(initialProject.pages)
  const [activePageId, setActivePageId] = useState(initialProject.activePageId)
  const initialPage = initialProject.pages.find((page) => page.id === initialProject.activePageId) ?? initialProject.pages[0]
  const [blocks, setBlocks] = useState(initialPage.blocks)
  const [pageMeta, setPageMeta] = useState(initialPage.meta)
  const [selectedId, setSelectedId] = useState(() => blocks[0]?.id ?? null)
  const [preview, setPreview] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [saved, setSaved] = useState(false)
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [draftStatus, setDraftStatus] = useState('saved')
  const [history, setHistory] = useState({ past: [], future: [] })
  const [device, setDevice] = useState('desktop')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [componentSearch, setComponentSearch] = useState('')
  const [componentGroup, setComponentGroup] = useState('all')
  const [insertAfterId, setInsertAfterId] = useState(null)
  const [inspectorTab, setInspectorTab] = useState('content')
  const [canvasZoom, setCanvasZoom] = useState(100)
  const [styleClipboard, setStyleClipboard] = useState(null)
  const [pageImageTarget, setPageImageTarget] = useState('block')
  const [pageColorTarget, setPageColorTarget] = useState('background')
  const [blockLibrary, setBlockLibrary] = useState(loadBlockLibrary)
  const [libraryError, setLibraryError] = useState('')
  const historyGroupRef = useRef({ key: '', time: 0 })

  const localizedComponents = useMemo(
    () => componentItems.map((item) => localizeComponent(item, language)),
    [language],
  )
  const localizedGroups = useMemo(() => localizeGroups(COMPONENT_GROUPS, language), [language])
  const localizedEditorOptions = useMemo(() => localizeOptions(EDITOR_OPTIONS, language), [language])
  const localizedVisualRecipes = useMemo(
    () => localizeCollection(VISUAL_RECIPE_ITEMS, 'visualRecipes', language),
    [language],
  )
  const localizedContentRecipes = useMemo(
    () => localizeCollection(CONTENT_RECIPES, 'contentRecipes', language),
    [language],
  )
  const localizedThemes = useMemo(() => localizeCollection(PAGE_THEMES, 'themes', language), [language])
  const localizedTemplates = useMemo(() => localizeCollection(PAGE_TEMPLATES, 'templates', language), [language])

  useEffect(() => {
    saveInterfaceLanguage(language)
    const root = document.getElementById('root')
    const applyLanguage = () => translateInterface(root, language)
    applyLanguage()
    const observer = new MutationObserver(applyLanguage)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [language])

  const selected = useMemo(() => blocks.find((block) => block.id === selectedId) ?? blocks[0], [blocks, selectedId])
  const filteredComponents = useMemo(() => {
    const keyword = componentSearch.trim().toLocaleLowerCase(language === 'en' ? 'en' : 'zh-CN')
    return localizedComponents.filter((item) => {
      const inGroup = componentGroup === 'all' || COMPONENT_GROUP_TYPES[componentGroup]?.includes(item.type)
      const matchesSearch = !keyword || `${item.label} ${item.note} ${item.type}`.toLocaleLowerCase(language === 'en' ? 'en' : 'zh-CN').includes(keyword)
      return inGroup && matchesSearch
    })
  }, [componentGroup, componentSearch, language, localizedComponents])
  const selectedSupportsImage = ['image', 'split', 'immersive', 'fullscreen'].includes(selected?.type)
  const selectedHasButton = ['nav', 'hero', 'feature', 'contact', 'button', 'split', 'immersive', 'fullscreen'].includes(selected?.type)
  const pageImages = useMemo(() => collectPageImages(blocks), [blocks])
  const pageColors = useMemo(() => collectPageColors(blocks, pageMeta), [blocks, pageMeta])
  const pageImageTargets = useMemo(() => {
    const targets = []
    if (selectedSupportsImage) targets.push({ value: 'block', label: '当前区块主图' })
    if (['showcase', 'collage', 'gallery', 'compare'].includes(selected?.type)) {
      ;(selected.items ?? []).forEach((item, index) => targets.push({ value: `item:${index}`, label: `${index + 1}. ${item.title || `图片 ${index + 1}`}` }))
    }
    targets.push({ value: 'background', label: '当前区块背景' })
    return targets
  }, [selected, selectedSupportsImage])
  const resolvedPageImageTarget = pageImageTargets.some((option) => option.value === pageImageTarget) ? pageImageTarget : pageImageTargets[0]?.value
  const currentTargetImage = resolvedPageImageTarget === 'block'
    ? selected?.imageUrl
    : resolvedPageImageTarget?.startsWith('item:')
      ? selected?.items?.[Number(resolvedPageImageTarget.split(':')[1])]?.imageUrl
      : selected?.backgroundImage
  const pageColorTargets = styleValues(selected).backgroundMode === 'gradient'
    ? [{ value: 'gradientFrom', label: '渐变起点' }, { value: 'gradientTo', label: '渐变终点' }, { value: 'textColor', label: '文字颜色' }, { value: 'accentColor', label: '强调颜色' }]
    : [{ value: 'background', label: '区块背景' }, { value: 'textColor', label: '文字颜色' }, { value: 'accentColor', label: '强调颜色' }]
  const resolvedPageColorTarget = pageColorTargets.some((option) => option.value === pageColorTarget) ? pageColorTarget : pageColorTargets[0].value
  const currentTargetColor = styleValues(selected)[resolvedPageColorTarget]
  const projectPages = useMemo(() => pages.map((page) => page.id === activePageId ? { ...page, meta: pageMeta, blocks } : page), [activePageId, blocks, pageMeta, pages])
  const activePage = projectPages.find((page) => page.id === activePageId) ?? projectPages[0]
  const pageIssues = useMemo(() => auditPage(blocks, pageMeta, projectPages, language), [blocks, language, pageMeta, projectPages])
  const pageDocument = useMemo(() => ({
    version: PAGE_SCHEMA_VERSION,
    name: projectPages[0]?.name || pageMeta.title,
    activePageId,
    pages: projectPages,
  }), [activePageId, pageMeta.title, projectPages])
  const pageDocumentRef = useRef(pageDocument)
  pageDocumentRef.current = pageDocument

  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(pageDocument))
        setStorageError('')
        setDraftStatus('saved')
      } catch {
        setStorageError('本地空间不足，请导出 JSON 备份或减少图片。')
        setDraftStatus('error')
      }
    }, 280)
    return () => window.clearTimeout(saveTimer)
  }, [pageDocument])

  useEffect(() => {
    function flushDraft() {
      try {
        window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(pageDocumentRef.current))
      } catch {
        // 页面正在关闭时无法可靠展示错误；编辑状态中的自动保存会继续提示。
      }
    }
    window.addEventListener('beforeunload', flushDraft)
    return () => window.removeEventListener('beforeunload', flushDraft)
  }, [])

  useEffect(() => {
    function handleKeyboard(event) {
      const commandKey = event.ctrlKey || event.metaKey
      if (commandKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (commandOpen) setCommandOpen(false)
        else if (!settingsOpen && !templatesOpen && !auditOpen && !pagesOpen && !preview) setCommandOpen(true)
        return
      }
      const target = event.target?.tagName
      if (target === 'INPUT' || target === 'TEXTAREA' || target === 'SELECT' || event.target?.isContentEditable) return
      if (settingsOpen || templatesOpen || auditOpen || pagesOpen || commandOpen || preview) return
      if (commandKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoBlocks()
        else undoBlocks()
      } else if (commandKey && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redoBlocks()
      } else if (commandKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelected()
      } else if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelected(-1)
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelected(1)
      } else if (event.key === 'Delete') {
        event.preventDefault()
        removeSelected()
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  })

  useEffect(() => {
    function handleImagePaste(event) {
      if (!selectedSupportsImage) return
      const imageFile = [...(event.clipboardData?.items ?? [])].find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
      if (!imageFile) return
      event.preventDefault()
      if (imageFile.size > 8 * 1024 * 1024) {
        setUploadError('粘贴失败：图片不能超过 8MB。')
        return
      }
      setUploadError('')
      readOptimizedImage(
        imageFile,
        (imageUrl) => updateSelected('imageUrl', imageUrl),
        () => setUploadError('粘贴失败，请换一张图片重试。'),
      )
    }
    window.addEventListener('paste', handleImagePaste)
    return () => window.removeEventListener('paste', handleImagePaste)
  }, [selectedId, selectedSupportsImage])

  function recordHistory(groupKey = '') {
    const now = Date.now()
    const grouped = groupKey && historyGroupRef.current.key === groupKey && now - historyGroupRef.current.time < 800
    historyGroupRef.current = groupKey ? { key: groupKey, time: now } : { key: '', time: 0 }
    if (!grouped) setHistory((current) => ({ past: [...current.past.slice(-99), { blocks, meta: pageMeta }], future: [] }))
    else setHistory((current) => ({ ...current, future: [] }))
  }

  function applyBlocks(nextBlocks, groupKey = '') {
    recordHistory(groupKey)
    setBlocks(nextBlocks)
    setSaved(false)
    setDraftStatus('saving')
  }

  function undoBlocks() {
    if (!history.past.length) return
    historyGroupRef.current = { key: '', time: 0 }
    setDraftStatus('saving')
    const previous = history.past[history.past.length - 1]
    setHistory({ past: history.past.slice(0, -1), future: [{ blocks, meta: pageMeta }, ...history.future] })
    setBlocks(Array.isArray(previous) ? previous : previous.blocks)
    if (!Array.isArray(previous) && previous.meta) setPageMeta(previous.meta)
  }

  function redoBlocks() {
    if (!history.future.length) return
    historyGroupRef.current = { key: '', time: 0 }
    setDraftStatus('saving')
    const next = history.future[0]
    setHistory({ past: [...history.past, { blocks, meta: pageMeta }], future: history.future.slice(1) })
    setBlocks(Array.isArray(next) ? next : next.blocks)
    if (!Array.isArray(next) && next.meta) setPageMeta(next.meta)
  }

  function updateSelected(field, value) {
    setSaved(false)
    applyBlocks(blocks.map((block) => (block.id === selectedId ? { ...block, [field]: value } : block)), `block:${selectedId}:${field}`)
  }

  function applyVisualRecipe(recipeName) {
    const recipe = VISUAL_RECIPES[recipeName]
    if (!selected || !recipe) return
    const { styles: recipeStyles, ...blockRecipe } = recipe
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, ...blockRecipe, ...(recipeStyles ? { styles: { ...(block.styles ?? {}), ...recipeStyles } } : {}) } : block))
  }

  function copySelectedDesign() {
    if (!selected) return
    setStyleClipboard({
      styles: { ...(selected.styles ?? {}) },
      visualPreset: selected.visualPreset ?? 'none',
      layoutVariant: selected.layoutVariant ?? 'default',
      decoration: selected.decoration ?? 'none',
      material: selected.material ?? 'none',
      sectionDivider: selected.sectionDivider ?? 'none',
      sceneTransition: selected.sceneTransition ?? 'none',
      effect: selected.effect ?? 'none',
      elementEffect: selected.elementEffect ?? 'none',
      hoverEffect: selected.hoverEffect ?? 'none',
      motionSpeed: selected.motionSpeed ?? 'normal',
      buttonStyle: selected.buttonStyle ?? 'solid',
    })
  }

  function pasteSelectedDesign() {
    if (!selected || !styleClipboard) return
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, ...styleClipboard, styles: { ...styleClipboard.styles } } : block))
  }

  function saveSelectedToLibrary() {
    if (!selected) return
    const entry = {
      libraryId: `saved-block-${Date.now()}`,
      name: String(selected.title || selected.label || '已保存区块').slice(0, 50),
      savedAt: Date.now(),
      block: JSON.parse(JSON.stringify(selected)),
    }
    commitBlockLibrary([entry, ...blockLibrary].slice(0, BLOCK_LIBRARY_LIMIT))
  }

  function commitBlockLibrary(nextLibrary) {
    try {
      window.localStorage.setItem(BLOCK_LIBRARY_STORAGE_KEY, JSON.stringify(nextLibrary))
      setBlockLibrary(nextLibrary)
      setLibraryError('')
      return true
    } catch {
      setLibraryError('保存库空间不足，可先删除含大图的收藏区块。')
      return false
    }
  }

  function insertLibraryBlock(entry) {
    if (!entry?.block || !SUPPORTED_BLOCK_TYPES.has(entry.block.type)) return
    const usedAnchors = new Set(blocks.map((block) => safeAnchor(block.anchor)).filter(Boolean))
    const anchorBase = safeAnchor(entry.block.anchor)
    let nextAnchor = anchorBase
    let anchorSuffix = 2
    while (nextAnchor && usedAnchors.has(nextAnchor)) nextAnchor = `${anchorBase}-${anchorSuffix++}`
    const [copy] = normalizeBlocks([{
      ...JSON.parse(JSON.stringify(entry.block)),
      id: uniqueBlockId(entry.block.type, blocks),
      anchor: nextAnchor,
    }])
    if (!copy) return
    const selectedIndex = blocks.findIndex((block) => block.id === (insertAfterId ?? selectedId))
    const next = [...blocks]
    next.splice(selectedIndex >= 0 ? selectedIndex + 1 : blocks.length, 0, copy)
    applyBlocks(next)
    setSelectedId(copy.id)
    setInsertAfterId(null)
  }

  function applyLibraryDesign(entry) {
    if (!selected || !entry?.block) return
    const source = entry.block
    const design = {
      styles: { ...(source.styles ?? {}) },
      visualPreset: source.visualPreset ?? 'none',
      layoutVariant: source.layoutVariant ?? 'default',
      decoration: source.decoration ?? 'none',
      material: source.material ?? 'none',
      sectionDivider: source.sectionDivider ?? 'none',
      sceneTransition: source.sceneTransition ?? 'none',
      effect: source.effect ?? 'none',
      elementEffect: source.elementEffect ?? 'none',
      hoverEffect: source.hoverEffect ?? 'none',
      motionSpeed: source.motionSpeed ?? 'normal',
      buttonStyle: source.buttonStyle ?? 'solid',
    }
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, ...design } : block))
  }

  function removeLibraryBlock(libraryId) {
    commitBlockLibrary(blockLibrary.filter((entry) => entry.libraryId !== libraryId))
  }

  function exportBlockLibrary() {
    if (!blockLibrary.length) return
    const payload = { type: 'pagecraft-block-library', version: 1, blocks: blockLibrary }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'pagecraft-block-library.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 100)
  }

  function importBlockLibrary(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      setLibraryError('区块库文件不能超过 20MB。')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result)
        const sourceEntries = Array.isArray(payload?.blocks) ? payload.blocks : Array.isArray(payload) ? payload : []
        const stamp = Date.now()
        const imported = sourceEntries
          .filter((entry) => {
            const block = entry?.block ?? entry
            return block && typeof block === 'object' && SUPPORTED_BLOCK_TYPES.has(block.type)
          })
          .slice(0, BLOCK_LIBRARY_LIMIT)
          .map((entry, index) => {
            const block = entry.block ?? entry
            return {
              libraryId: `imported-block-${stamp}-${index}`,
              name: String(entry.name || block.title || block.label || '导入区块').slice(0, 50),
              savedAt: stamp,
              block,
            }
          })
        if (!imported.length) throw new Error('empty library')
        commitBlockLibrary([...imported, ...blockLibrary].slice(0, BLOCK_LIBRARY_LIMIT))
      } catch {
        setLibraryError('无法导入：请选择 PageCraft 区块库 JSON。')
      }
    }
    reader.onerror = () => setLibraryError('区块库读取失败，请重新选择。')
    reader.readAsText(file)
  }

  function applyPageImage(source) {
    if (!selected) return
    if (resolvedPageImageTarget === 'block') {
      updateSelected('imageUrl', source)
    } else if (resolvedPageImageTarget?.startsWith('item:')) {
      updateSelectedItem(Number(resolvedPageImageTarget.split(':')[1]), 'imageUrl', source)
    } else {
      updateSelected('backgroundImage', source)
    }
  }

  function updateBlockField(blockId, field, value) {
    applyBlocks(blocks.map((block) => (block.id === blockId ? { ...block, [field]: value } : block)), `block:${blockId}:${field}`)
  }

  function updateSelectedStyle(field, value) {
    applyBlocks(blocks.map((block) => (block.id === selectedId ? { ...block, styles: { ...(block.styles ?? {}), [field]: value } } : block)), `style:${selectedId}:${field}`)
  }

  function resetSelectedStyle() {
    if (!selected) return
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, styles: {} } : block))
  }

  function loadPageIntoEditor(page) {
    if (!page) return
    setBlocks(page.blocks)
    setPageMeta(page.meta)
    setSelectedId(page.blocks[0]?.id ?? null)
    setInsertAfterId(null)
    setHistory({ past: [], future: [] })
    historyGroupRef.current = { key: '', time: 0 }
    setSaved(false)
    setDraftStatus('saving')
  }

  function switchPage(pageId) {
    if (pageId === activePageId) {
      setPagesOpen(false)
      return
    }
    const nextPages = projectPages
    const targetPage = nextPages.find((page) => page.id === pageId)
    if (!targetPage) return
    setPages(nextPages)
    setActivePageId(pageId)
    loadPageIntoEditor(targetPage)
    setPagesOpen(false)
  }

  function navigatePreviewLink(href) {
    const targetPageId = pageLinkId(href)
    if (targetPageId) switchPage(targetPageId)
  }

  function createPage() {
    const name = language === 'en' ? `New Page ${projectPages.length + 1}` : `新页面 ${projectPages.length + 1}`
    const id = uniquePageId(projectPages, `page-${projectPages.length + 1}`)
    const hero = normalizeBlocks([{
      ...localizeContent(createBlockDefaults('hero'), language),
      id: uniqueBlockId('hero', []),
      type: 'hero',
      label: localizedComponents.find((item) => item.type === 'hero')?.label ?? (language === 'en' ? 'Hero' : '首屏'),
      locale: language === 'en' ? 'en' : 'zh',
      title: name,
      description: language === 'en' ? 'Start designing this page here.' : '在这里开始设计这个页面。',
    }])
    const page = {
      id,
      name,
      slug: id,
      meta: normalizePageMeta({ ...pageMeta, title: name, description: '' }, name),
      blocks: hero,
    }
    setPages([...projectPages, page])
    setActivePageId(id)
    loadPageIntoEditor(page)
  }

  function updatePageIdentity(pageId, field, value) {
    const nextValue = field === 'slug'
      ? safeAnchor(value)
      : String(value).slice(0, 40)
    setPages(projectPages.map((page) => page.id === pageId ? { ...page, [field]: nextValue } : page))
    setDraftStatus('saving')
  }

  function duplicatePage(pageId) {
    const source = projectPages.find((page) => page.id === pageId)
    if (!source) return
    const name = `${source.name}${language === 'en' ? ' Copy' : ' 副本'}`.slice(0, 40)
    const id = uniquePageId(projectPages, `${source.slug || 'page'}-copy`)
    const copy = {
      ...JSON.parse(JSON.stringify(source)),
      id,
      name,
      slug: id,
      meta: normalizePageMeta({ ...source.meta, title: name }, name),
      blocks: normalizeBlocks(source.blocks.map((block) => ({ ...block, id: `${block.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }))),
    }
    setPages([...projectPages, copy])
    setActivePageId(id)
    loadPageIntoEditor(copy)
  }

  function deletePage(pageId) {
    if (projectPages.length <= 1) return
    const pageIndex = projectPages.findIndex((page) => page.id === pageId)
    if (pageIndex < 0) return
    const nextPages = projectPages.filter((page) => page.id !== pageId)
    setPages(nextPages)
    if (pageId === activePageId) {
      const nextPage = nextPages[Math.min(pageIndex, nextPages.length - 1)]
      setActivePageId(nextPage.id)
      loadPageIntoEditor(nextPage)
    }
  }

  function resetSelectedContent() {
    if (!selected) return
    const defaults = localizeContent(createBlockDefaults(selected.type), language)
    applyBlocks(blocks.map((block) => {
      if (block.id !== selectedId) return block
      const nextBlock = { ...block }
      CONTENT_RESET_FIELDS.forEach((field) => {
        nextBlock[field] = cloneConfig(defaults[field])
      })
      return nextBlock
    }))
  }

  function applyContentRecipe(recipeId) {
    if (!selected) return
    const recipe = CONTENT_RECIPES.find((item) => item.id === recipeId && item.types.includes(selected.type))
    if (!recipe) return
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, ...localizeContent(cloneConfig(recipe.content), language), locale: language === 'en' ? 'en' : 'zh' } : block))
  }

  function updateSelectedItem(index, field, value) {
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, items: (block.items ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) } : block), `item:${selectedId}:${index}:${field}`)
  }

  function addSelectedItem() {
    if (!selected) return
    const item = localizeContent(createNewItem(selected.type), language)
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, items: [...(selected.items ?? []), item] } : block))
  }

  function removeSelectedItem(index) {
    if (!selected || (selected.items ?? []).length <= 1) return
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, items: selected.items.filter((_, itemIndex) => itemIndex !== index) } : block))
  }

  function moveSelectedItem(index, direction) {
    if (!selected) return
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= (selected.items?.length ?? 0)) return
    const items = [...selected.items]
    ;[items[index], items[nextIndex]] = [items[nextIndex], items[index]]
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, items } : block))
  }

  function duplicateSelectedItem(index) {
    if (!selected?.items?.[index]) return
    const items = [...selected.items]
    items.splice(index + 1, 0, { ...selected.items[index] })
    applyBlocks(blocks.map((block) => block.id === selectedId ? { ...block, items } : block))
  }

  function updatePageMeta(field, value) {
    recordHistory(`meta:${field}`)
    setPageMeta((current) => ({ ...current, [field]: value }))
    setSaved(false)
    setDraftStatus('saving')
  }

  function addBlock(type, placement = 'after', referenceId = selectedId) {
    const item = localizedComponents.find((component) => component.type === type)
    const id = uniqueBlockId(type, blocks)
    const copy = {
      ...localizeContent(createBlockDefaults(type), language),
      id,
      type,
      label: item?.label ?? (language === 'en' ? 'Content section' : '内容区'),
      locale: language === 'en' ? 'en' : 'zh',
    }
    const next = [...blocks]
    const selectedIndex = blocks.findIndex((block) => block.id === referenceId)
    next.splice(placement === 'end' || selectedIndex < 0 ? blocks.length : selectedIndex + 1, 0, copy)
    applyBlocks(next)
    setSelectedId(id)
    setInsertAfterId(null)
  }

  function applyTemplate(template) {
    const nextBlocks = buildTemplateBlocks(localizeContent(template, language), localizedComponents, language)
    applyBlocks(nextBlocks)
    setPageMeta((current) => ({ ...current, theme: template.theme }))
    setSelectedId(nextBlocks[0]?.id ?? null)
    setTemplatesOpen(false)
  }

  function moveSelected(direction) {
    moveBlock(selectedId, direction)
  }

  function focusBlock(blockId) {
    setInsertAfterId(null)
    setSelectedId(blockId)
    window.requestAnimationFrame(() => {
      const target = [...document.querySelectorAll('[data-block-id]')].find((element) => element.dataset.blockId === blockId)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  function moveBlock(blockId, direction) {
    const index = blocks.findIndex((block) => block.id === blockId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) return
    const next = [...blocks]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    applyBlocks(next)
  }

  function removeSelected() {
    if (!selected) return
    const index = blocks.findIndex((block) => block.id === selectedId)
    const nextBlocks = blocks.filter((block) => block.id !== selectedId)
    applyBlocks(nextBlocks)
    setSelectedId(nextBlocks[Math.max(0, index - 1)]?.id ?? null)
  }

  function duplicateSelected() {
    if (!selected) return
    const index = blocks.findIndex((block) => block.id === selectedId)
    const usedAnchors = new Set(blocks.map((block) => safeAnchor(block.anchor)).filter(Boolean))
    const anchorBase = safeAnchor(selected.anchor)
    let duplicateAnchor = anchorBase ? `${anchorBase}-copy` : ''
    let anchorSuffix = 2
    while (duplicateAnchor && usedAnchors.has(duplicateAnchor)) duplicateAnchor = `${anchorBase}-copy-${anchorSuffix++}`
    const duplicate = {
      ...selected,
      id: uniqueBlockId(selected.type, blocks),
      label: `${selected.label} 副本`,
      anchor: duplicateAnchor,
      styles: { ...(selected.styles ?? {}) },
      items: (selected.items ?? []).map((item) => ({ ...item })),
    }
    const next = [...blocks]
    next.splice(index + 1, 0, duplicate)
    applyBlocks(next)
    setSelectedId(duplicate.id)
  }

  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) return
    const fromIndex = blocks.findIndex((block) => block.id === draggedId)
    const toIndex = blocks.findIndex((block) => block.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const next = [...blocks]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    applyBlocks(next)
    setSelectedId(draggedId)
    setDraggedId(null)
    setDragOverId(null)
  }

  function exportDocument() {
    const blob = new Blob([JSON.stringify(pageDocument, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFileName(pageDocument.name)}-pagecraft-site.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function importDocument(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 30 * 1024 * 1024) {
      setDocumentError('无法导入：JSON 文件不能超过 30MB。请先压缩图片或拆分页面。')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const document = JSON.parse(reader.result)
        const hasLegacyPage = Array.isArray(document.blocks) && document.blocks.length > 0
        const hasPages = Array.isArray(document.pages) && document.pages.length > 0
        if (!hasLegacyPage && !hasPages) {
          throw new Error('invalid document')
        }
        const project = normalizeProjectDocument(document)
        const targetPage = project.pages.find((page) => page.id === project.activePageId) ?? project.pages[0]
        if (!targetPage) throw new Error('empty document')
        setPages(project.pages)
        setActivePageId(targetPage.id)
        loadPageIntoEditor(targetPage)
        setDocumentError('')
      } catch {
        setDocumentError('无法导入：请选择由 PageCraft 导出的 JSON 文件。')
      }
    }
    reader.onerror = () => setDocumentError('文件读取失败，请重新选择。')
    reader.readAsText(file)
  }

  function exportStaticHtml() {
    const blob = new Blob([createStaticHtml(blocks, pageMeta, projectPages)], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFileName(pageMeta.title)}.html`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 100)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  function exportSiteZip() {
    const files = {}
    projectPages.forEach((page, index) => {
      files[pageFileName(page, index)] = strToU8(createStaticHtml(page.blocks, page.meta, projectPages))
    })
    files['README.txt'] = strToU8([
      'PageCraft 网站包',
      '',
      '上传本压缩包中解压后的全部文件即可部署网站。',
      '首页文件：index.html',
      `页面数量：${projectPages.length}`,
      '',
      ...projectPages.map((page, index) => `- ${page.name}: ${pageFileName(page, index)}`),
    ].join('\n'))
    const archive = zipSync(files, { level: 6 })
    const blob = new Blob([archive], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeFileName(pageDocument.name)}-website.zip`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 100)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  function handleImageUpload(event, field = 'imageUrl') {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('请选择图片文件。')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('原始图片请控制在 8MB 以内。')
      return
    }
    readOptimizedImage(file, (source) => {
      updateSelected(field, source)
      setUploadError('')
    }, () => setUploadError('图片读取失败，请重试。'))
  }

  function handleItemImageUpload(event, index) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setUploadError('请选择图片文件。')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setUploadError('单张原始图片请控制在 8MB 以内。')
      return
    }
    readOptimizedImage(file, (source) => {
      updateSelectedItem(index, 'imageUrl', source)
      setUploadError('')
    }, () => setUploadError('图片读取失败，请重试。'))
  }

  if (preview) {
    return (
      <div className={`preview-shell theme-${pageTheme(pageMeta.theme)} cursor-${cursorMode(pageMeta.cursor)} font-${fontMode(pageMeta.fontMode)} density-${densityMode(pageMeta.density)} type-${typeScale(pageMeta.typeScale)} ${pageMeta.accentColor ? 'has-custom-accent' : ''}`} style={pageMeta.accentColor ? { '--theme-accent': pageMeta.accentColor } : undefined}>
        {pageMeta.scrollProgress && <ScrollProgress />}
        <PreviewCursor mode={cursorMode(pageMeta.cursor)} />
        <div className="preview-topbar">
          <div className="brand compact"><span className="brand-mark">✦</span><span>PageCraft</span></div>
          <span className="preview-pill"><Eye size={14} /> 预览模式</span>
          <button className="language-switch" data-i18n-skip onClick={() => setLanguage((current) => current === 'zh' ? 'en' : 'zh')} aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'} title={language === 'zh' ? 'Switch to English' : '切换到中文'}><Languages size={15} />{language === 'zh' ? 'EN' : '中文'}</button>
          <button className="ghost-button" onClick={() => setPreview(false)}><X size={16} /> 返回编辑</button>
        </div>
        <div className={`preview-page theme-${pageTheme(pageMeta.theme)} font-${fontMode(pageMeta.fontMode)} density-${densityMode(pageMeta.density)} type-${typeScale(pageMeta.typeScale)} ${pageMeta.accentColor ? 'has-custom-accent' : ''}`} style={{ ...pageSurfaceStyle(pageMeta), ...(pageMeta.accentColor ? { '--theme-accent': pageMeta.accentColor } : {}) }}>
          {blocks.map((block) => <BlockPreview key={block.id} block={block} preview onNavigatePage={navigatePreviewLink} />)}
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand"><span className="brand-mark">✦</span><span>PageCraft</span></div>
          <div className="divider" />
          <button className="project-name" onClick={() => setPagesOpen(true)} title="管理网站页面"><span>{activePage?.name || pageMeta.title || '未命名页面'}</span><small>{projectPages.length} 页</small><ChevronDown size={14} /></button>
          <span className={`status-dot ${draftStatus === 'saving' ? 'is-saving' : ''} ${storageError ? 'has-error' : ''}`} role="status" aria-live="polite" title={storageError || '草稿会自动保存在当前浏览器'}><span /> {storageError ? '保存空间不足' : draftStatus === 'saving' ? '正在保存…' : '已自动保存'}</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="撤销 (Ctrl/Cmd + Z)" aria-label="撤销" disabled={!history.past.length} onClick={undoBlocks}><Undo2 size={17} /></button>
          <button className="icon-button" title="重做 (Ctrl/Cmd + Shift + Z)" aria-label="重做" disabled={!history.future.length} onClick={redoBlocks}><Redo2 size={17} /></button>
          <button className="icon-button" title="快捷命令 (Ctrl/Cmd + K)" aria-label="打开快捷命令" onClick={() => setCommandOpen(true)}><CommandIcon size={17} /></button>
          <div className="divider" />
          <button className="language-switch" data-i18n-skip onClick={() => setLanguage((current) => current === 'zh' ? 'en' : 'zh')} aria-label={language === 'zh' ? 'Switch to English' : '切换到中文'} title={language === 'zh' ? 'Switch to English' : '切换到中文'}><Languages size={15} />{language === 'zh' ? 'EN' : '中文'}</button>
          <button className="secondary-button" onClick={() => setTemplatesOpen(true)}><Sparkles size={15} /> 模板</button>
          <button className={`secondary-button audit-button ${pageIssues.length ? 'has-issues' : 'is-clean'}`} onClick={() => setAuditOpen(true)}>{pageIssues.length ? <TriangleAlert size={15} /> : <CircleCheck size={15} />} 检查{pageIssues.length ? <b>{pageIssues.length}</b> : ''}</button>
          <button className="secondary-button" onClick={() => setPreview(true)}><Eye size={16} /> 预览</button>
          <button className="primary-button" onClick={exportSiteZip}><Download size={15} />{saved ? '已导出' : '导出整站'}</button>
          <div className="avatar">你</div>
        </div>
      </header>

      <main className="workspace">
        {leftOpen && <aside className="sidebar left-sidebar">
          <div className="sidebar-heading"><span>添加内容</span><button className="close-panel" aria-label="收起内容面板" onClick={() => setLeftOpen(false)}><PanelLeft size={16} /></button></div>
          <p className="sidebar-hint">点击组件，添加到当前区块之后</p>
          {insertAfterId && <div className="insertion-target"><span><Plus size={13} /> 将新区块插入到“{blocks.find((block) => block.id === insertAfterId)?.label || '当前区块'}”之后</span><button onClick={() => setInsertAfterId(null)}>取消</button></div>}
          <details className="layer-outline">
            <summary><span><GripVertical size={14} /> 页面大纲</span><b>{blocks.length}</b></summary>
            <div className="layer-outline-list">{blocks.map((block, index) => <div className={`layer-outline-row ${selectedId === block.id ? 'active' : ''}`} key={block.id}><button className="layer-outline-select" onClick={() => focusBlock(block.id)}><small>{String(index + 1).padStart(2, '0')}</small><span><strong>{localizedComponents.find((item) => item.type === block.type)?.label ?? block.label}</strong><em>{block.title || '未命名区块'}</em></span></button><span className="layer-outline-actions"><button disabled={index === 0} title="向上移动" onClick={() => moveBlock(block.id, -1)}><ArrowUp size={12} /></button><button disabled={index === blocks.length - 1} title="向下移动" onClick={() => moveBlock(block.id, 1)}><ArrowDown size={12} /></button></span></div>)}</div>
          </details>
          <details className="saved-block-library" open={blockLibrary.length > 0}>
            <summary><span><Library size={14} /> 我的区块</span><b>{blockLibrary.length}</b></summary>
            {blockLibrary.length > 0 ? <div className="saved-block-list">
              {blockLibrary.map((entry) => <div className="saved-block-row" key={entry.libraryId}>
                <button className="saved-block-insert" onClick={() => insertLibraryBlock(entry)} title="插入到当前区块之后"><span>{localizedComponents.find((item) => item.type === entry.block.type)?.label || (language === 'en' ? 'Section' : '区块')}</span><strong>{entry.name}</strong></button>
                <button className="saved-block-design" onClick={() => applyLibraryDesign(entry)} title="只应用设计到当前区块" aria-label={`应用 ${entry.name} 的设计`}><Sparkles size={11} /></button>
                <button className="saved-block-remove" onClick={() => removeLibraryBlock(entry.libraryId)} title="从我的区块中移除" aria-label={`移除 ${entry.name}`}><X size={12} /></button>
              </div>)}
            </div> : <div className="saved-block-empty"><BookmarkPlus size={15} /><span>选中一个区块，在右侧点击收藏即可复用。</span></div>}
            {libraryError && <small className="saved-block-error">{libraryError}</small>}
            <div className="saved-block-tools"><button type="button" disabled={!blockLibrary.length} onClick={exportBlockLibrary}><Download size={11} /> 备份</button><label><Upload size={11} /> 导入<input type="file" accept="application/json,.json" onChange={importBlockLibrary} /></label></div>
          </details>
          <PageImagePicker assets={pageImages} current={currentTargetImage} targets={pageImageTargets} target={resolvedPageImageTarget} onTargetChange={setPageImageTarget} onSelect={applyPageImage} />
          <PageColorPicker colors={pageColors} current={currentTargetColor} targets={pageColorTargets} target={resolvedPageColorTarget} onTargetChange={setPageColorTarget} onSelect={(color) => updateSelectedStyle(resolvedPageColorTarget, color)} />
          <label className="component-search"><Search size={15} /><input type="search" value={componentSearch} onChange={(event) => setComponentSearch(event.target.value)} placeholder="搜索区块，例如图片、价格…" /><span>{filteredComponents.length}</span></label>
          <div className="component-filters" aria-label="组件分类">
            {localizedGroups.map((group) => <button key={group.value} className={componentGroup === group.value ? 'active' : ''} onClick={() => setComponentGroup(group.value)}>{group.label}</button>)}
          </div>
          <div className="component-grid">
            {filteredComponents.map(({ type, label, icon: Icon, note }) => (
              <button className="component-card" key={type} onClick={() => addBlock(type, 'after', insertAfterId ?? selectedId)}>
                <span className="component-icon"><Icon size={19} /></span>
                <span className="component-label">{label}</span>
                <span className="component-note">{note}</span>
                <Plus className="component-plus" size={15} />
              </button>
            ))}
            {!filteredComponents.length && <div className="component-empty"><Search size={18} /><strong>没有找到区块</strong><span>换个关键词，或查看“全部”分类。</span><button onClick={() => { setComponentSearch(''); setComponentGroup('all') }}>清除筛选</button></div>}
          </div>
          <div className="sidebar-tip"><Sparkles size={17} /><div><strong>从灵感开始</strong><span>以后可以让 AI 帮你生成页面</span></div></div>
          <div className="sidebar-bottom"><button className="help-link" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> 页面设置</button><span>v0.1.0</span></div>
        </aside>}

        <section className="canvas-area">
          {!leftOpen && <button className="floating-panel-button left" aria-label="展开内容面板" onClick={() => setLeftOpen(true)}><PanelLeft size={17} /></button>}
          {!rightOpen && <button className="floating-panel-button right" aria-label="展开属性面板" onClick={() => setRightOpen(true)}><PanelRight size={17} /></button>}
          <div className="canvas-toolbar"><span className="canvas-label"><MousePointer2 size={14} /> 画布</span><span className="device-switcher"><button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}>桌面端</button><button className={device === 'tablet' ? 'active' : ''} onClick={() => setDevice('tablet')}>平板端</button><button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}>移动端</button></span><span className="canvas-view-controls"><span className="canvas-dimensions">{device === 'mobile' ? '390' : device === 'tablet' ? '768' : pageMeta.canvasWidth} × {pageMeta.canvasHeight}px</span><label>缩放<select value={canvasZoom} onChange={(event) => setCanvasZoom(Number(event.target.value))}>{[50, 60, 75, 90, 100].map((value) => <option value={value} key={value}>{value}%</option>)}</select></label></span></div>
          <div className="canvas-scroll">
            <div className={`website-canvas theme-${pageTheme(pageMeta.theme)} font-${fontMode(pageMeta.fontMode)} density-${densityMode(pageMeta.density)} type-${typeScale(pageMeta.typeScale)} ${pageMeta.accentColor ? 'has-custom-accent' : ''} ${device === 'mobile' ? 'is-mobile' : device === 'tablet' ? 'is-tablet' : ''}`} style={{ width: device === 'mobile' ? '390px' : device === 'tablet' ? '768px' : `${pageMeta.canvasWidth ?? DEFAULT_PAGE_META.canvasWidth}px`, minHeight: `${pageMeta.canvasHeight ?? DEFAULT_PAGE_META.canvasHeight}px`, zoom: canvasZoom / 100, ...pageSurfaceStyle(pageMeta), ...(pageMeta.accentColor ? { '--theme-accent': pageMeta.accentColor } : {}) }}>
              {blocks.map((block) => <Fragment key={block.id}><BlockPreview block={block} displayLabel={localizedComponents.find((item) => item.type === block.type)?.label ?? block.label} language={language} device={device} selected={!preview && block.id === selectedId} dragging={draggedId === block.id} dragOver={dragOverId === block.id} onClick={() => { setInsertAfterId(null); setSelectedId(block.id) }} onDragStart={() => setDraggedId(block.id)} onDragOver={() => setDragOverId(block.id)} onDrop={() => handleDrop(block.id)} onDragEnd={() => { setDraggedId(null); setDragOverId(null) }} onUpdate={(field, value) => updateBlockField(block.id, field, value)} /><button className={`canvas-insert-point ${insertAfterId === block.id ? 'active' : ''}`} aria-label={`在${block.label}之后插入区块`} title="在这里插入区块" onClick={() => { setInsertAfterId(block.id); setSelectedId(block.id); setLeftOpen(true) }}><Plus size={13} /><span>在这里插入</span></button></Fragment>)}
              {!blocks.length && <div className="empty-canvas-state"><span><Sparkles size={20} /></span><h3>从第一个区块开始</h3><p>从左侧选择一个分区，或者先添加一段文字，再慢慢建立页面节奏。</p></div>}
              <button className="canvas-add" onClick={() => addBlock('text', 'end')}><Plus size={16} /> 在页面末尾添加内容区</button>
            </div>
          </div>
        </section>

        {rightOpen && <aside className={`sidebar right-sidebar inspector-tab-${inspectorTab}`}>
          <div className="sidebar-heading"><span>属性</span><button className="close-panel" aria-label="收起属性面板" onClick={() => setRightOpen(false)}><PanelRight size={16} /></button></div>
          <div className="selected-info"><span className="selected-icon"><Settings2 size={15} /></span><div><strong>{selected ? localizedComponents.find((item) => item.type === selected.type)?.label ?? selected.label : '未选择区块'}</strong><span>{selected ? '已选中区块' : '请先添加内容'}</span></div><button className="more-button" title="保存到我的区块" aria-label="保存到我的区块" disabled={!selected} onClick={saveSelectedToLibrary}><BookmarkPlus size={15} /></button><button className="more-button" title="复制区块" aria-label="复制区块" disabled={!selected} onClick={duplicateSelected}><Copy size={15} /></button><button className="more-button" title="复制当前设计" aria-label="复制当前设计" disabled={!selected} onClick={copySelectedDesign}><Sparkles size={14} /></button><button className={`more-button ${styleClipboard ? 'is-ready' : ''}`} title={styleClipboard ? '粘贴设计到当前区块' : '请先复制一个区块的设计'} aria-label="粘贴设计到当前区块" disabled={!styleClipboard || !selected} onClick={pasteSelectedDesign}><ClipboardPaste size={14} /></button><button className="more-button danger" title="删除区块" aria-label="删除区块" disabled={!selected} onClick={removeSelected}><Trash2 size={15} /></button></div>
          <div className="inspector-tabs" role="tablist" aria-label="属性分类">{localizedEditorOptions.inspectorTabs.map(([value, label]) => <button role="tab" aria-selected={inspectorTab === value} className={inspectorTab === value ? 'active' : ''} key={value} onClick={() => setInspectorTab(value)}>{label}</button>)}</div>
          <div className="device-visibility-control"><label>快速风格配方</label><div className="visual-recipe-buttons">{localizedVisualRecipes.map(({ id, label }) => <button key={id} onClick={() => applyVisualRecipe(id)}><Sparkles size={10} />{label}</button>)}</div><small>一次应用配色、构图、材质、装饰和动效，仍可逐项微调或撤销。</small><label className="visibility-label">区块过渡</label><div className="divider-options">{localizedEditorOptions.sectionDividers.map(([value, label]) => <button className={(selected?.sectionDivider ?? 'none') === value ? 'active' : ''} key={value} onClick={() => updateSelected('sectionDivider', value)}>{label}</button>)}</div><label className="visibility-label">设备显示</label><div>{localizedEditorOptions.visibility.map(([value, label]) => <button className={(selected?.visibility ?? 'both') === value ? 'active' : ''} key={value} onClick={() => updateSelected('visibility', value)}>{label}</button>)}</div><small>导出后会按访客屏幕宽度自动显示或隐藏。</small></div>
          <div className="inspector-section"><label>内容</label>{selectedSupportsImage && <div className="field"><span>图片</span><label className="upload-button"><Image size={15} /><span>{selected?.imageUrl ? '更换图片' : '上传图片'}</span><input type="file" accept="image/*" onChange={handleImageUpload} /></label>{selected?.imageUrl && <button className="remove-image" onClick={() => updateSelected('imageUrl', '')}>移除当前图片</button>}{uploadError && <small className="upload-error">{uploadError}</small>}</div>}<div className="field"><span>{selected?.type === 'image' ? '图片说明' : '标题'}</span><input value={selected?.title ?? ''} onChange={(event) => updateSelected('title', event.target.value)} /></div><div className="field textarea-field"><span>描述</span><textarea value={selected?.description ?? ''} onChange={(event) => updateSelected('description', event.target.value)} rows="3" /></div><div className="field"><span>区块锚点 <small className="inline-field-help">导航可填写 #{safeAnchor(selected?.anchor) || '名称'}</small></span><input value={selected?.anchor ?? ''} placeholder="例如：work" onChange={(event) => updateSelected('anchor', safeAnchor(event.target.value))} /></div>{selectedSupportsImage && <><div className="field"><span>图片位置</span><div className="image-position-grid">{['top left', 'top', 'top right', 'left', 'center', 'right', 'bottom left', 'bottom', 'bottom right'].map((position) => <button key={position} className={(selected?.imagePosition ?? 'center') === position ? 'active' : ''} onClick={() => updateSelected('imagePosition', position)} title={position}><i /></button>)}</div></div><div className="field-row"><div className="field"><span>裁剪</span><select value={selected?.imageFit ?? 'cover'} onChange={(event) => updateSelected('imageFit', event.target.value)}><option value="cover">填充</option><option value="contain">完整显示</option></select></div><div className="field"><span>缩放</span><input className="range-input" type="range" min="1" max="1.3" step="0.05" value={selected?.imageScale ?? 1} onChange={(event) => updateSelected('imageScale', event.target.value)} /></div></div></>}{selectedHasButton && <div className="field"><span>按钮文字</span><input value={selected?.cta ?? ''} onChange={(event) => updateSelected('cta', event.target.value)} /></div>}{selectedHasButton && <div className="field"><span>按钮链接</span><input type="url" placeholder="https://example.com" value={selected?.url ?? ''} onChange={(event) => updateSelected('url', event.target.value)} /></div>}</div>
          <div className="inspector-section content-reset-section"><label>内容起点</label>{localizedContentRecipes.some((recipe) => recipe.types.includes(selected?.type)) && <div className="content-recipe-buttons">{localizedContentRecipes.filter((recipe) => recipe.types.includes(selected?.type)).map((recipe) => <button type="button" key={recipe.id} onClick={() => applyContentRecipe(recipe.id)}><Sparkles size={11} />{recipe.label}</button>)}</div>}<button className="reset-content-button" type="button" disabled={!selected} onClick={resetSelectedContent}><Undo2 size={13} /><span>恢复此类区块的默认内容</span></button><small>内容配方和默认值来自 JSON；当前视觉设计会保留，并可撤销。</small></div>
          {['cards', 'stats', 'team', 'faq', 'timeline', 'bento', 'showcase', 'sticky', 'collage', 'compare', 'nav', 'footer'].includes(selected?.type) && <div className="inspector-section"><label>{selected.type === 'cards' ? '卡片内容' : selected.type === 'stats' ? '数据内容' : selected.type === 'team' ? '人物内容' : selected.type === 'faq' ? '问题内容' : selected.type === 'timeline' ? '时间节点' : selected.type === 'bento' ? '网格内容' : selected.type === 'showcase' ? '作品内容' : selected.type === 'collage' ? '拼贴图片' : selected.type === 'compare' ? '对比图片（前／后）' : selected.type === 'nav' ? '导航菜单（名称／链接）' : selected.type === 'footer' ? '页脚链接（名称／链接）' : '故事章节'}</label><div className="item-editor-list">{(selected.items ?? []).map((item, index) => <div className="item-editor" key={index}><span>0{index + 1}</span><button className="item-remove" title="删除这一项" disabled={selected.type === 'compare' || (selected.items ?? []).length <= 1} onClick={() => removeSelectedItem(index)}><X size={13} /></button><input value={item[itemFields(selected.type)[0]] ?? ''} onChange={(event) => updateSelectedItem(index, itemFields(selected.type)[0], event.target.value)} /><textarea rows="2" value={item[itemFields(selected.type)[1]] ?? ''} onChange={(event) => updateSelectedItem(index, itemFields(selected.type)[1], event.target.value)} />{['showcase', 'collage', 'compare'].includes(selected.type) && <label className="item-image-upload"><Image size={13} /><span>{item.imageUrl ? '更换图片' : '添加图片'}</span><input type="file" accept="image/*" onChange={(event) => handleItemImageUpload(event, index)} /></label>}{item.imageUrl && ['showcase', 'collage', 'compare'].includes(selected.type) && <button className="item-image-remove" onClick={() => updateSelectedItem(index, 'imageUrl', '')}>移除图片</button>}</div>)}</div>{uploadError && <small className="upload-error">{uploadError}</small>}{selected.type !== 'compare' && <button className="add-item-button" onClick={addSelectedItem}><Plus size={14} /> 添加一项</button>}</div>}
          {['testimonials', 'pricing', 'logos'].includes(selected?.type) && <div className="inspector-section"><label>{selected.type === 'testimonials' ? '评价内容（评价／署名）' : selected.type === 'pricing' ? '价格方案' : '品牌名称'}</label><div className="item-editor-list">{(selected.items ?? []).map((item, index) => <div className="item-editor" key={index}><span>0{index + 1}</span><button className="item-remove" title="删除这一项" disabled={(selected.items ?? []).length <= 1} onClick={() => removeSelectedItem(index)}><X size={13} /></button><input value={item.title ?? ''} onChange={(event) => updateSelectedItem(index, 'title', event.target.value)} />{selected.type === 'pricing' && <input className="item-price-input" value={item.value ?? ''} onChange={(event) => updateSelectedItem(index, 'value', event.target.value)} placeholder="价格" />} {selected.type !== 'logos' && <textarea rows="2" value={item.description ?? ''} onChange={(event) => updateSelectedItem(index, 'description', event.target.value)} />}</div>)}</div><button className="add-item-button" onClick={addSelectedItem}><Plus size={14} /> 添加一项</button></div>}
          {selected?.type === 'tabs' && <div className="inspector-section"><label>标签页内容（名称／说明）</label><div className="item-editor-list">{(selected.items ?? []).map((item, index) => <div className="item-editor" key={index}><span>0{index + 1}</span><button className="item-remove" title="删除这一项" disabled={(selected.items ?? []).length <= 1} onClick={() => removeSelectedItem(index)}><X size={13} /></button><input value={item.title ?? ''} onChange={(event) => updateSelectedItem(index, 'title', event.target.value)} /><textarea rows="2" value={item.description ?? ''} onChange={(event) => updateSelectedItem(index, 'description', event.target.value)} /></div>)}</div><button className="add-item-button" onClick={addSelectedItem}><Plus size={14} /> 添加标签页</button></div>}
          {['gallery', 'accordion'].includes(selected?.type) && <div className="inspector-section"><label>{selected.type === 'gallery' ? '画廊图片与说明' : '可展开服务内容'}</label><div className="item-editor-list">{(selected.items ?? []).map((item, index) => <div className="item-editor" key={index}><span>{String(index + 1).padStart(2, '0')}</span><button className="item-remove" title="删除这一项" disabled={(selected.items ?? []).length <= 1} onClick={() => removeSelectedItem(index)}><X size={13} /></button><input value={item.title ?? ''} onChange={(event) => updateSelectedItem(index, 'title', event.target.value)} /><textarea rows="2" value={item.description ?? ''} onChange={(event) => updateSelectedItem(index, 'description', event.target.value)} />{selected.type === 'gallery' && <label className="item-image-upload"><Image size={13} /><span>{item.imageUrl ? '更换图片' : '添加图片'}</span><input type="file" accept="image/*" onChange={(event) => handleItemImageUpload(event, index)} /></label>}{selected.type === 'gallery' && item.imageUrl && <button className="item-image-remove" onClick={() => updateSelectedItem(index, 'imageUrl', '')}>移除图片</button>}</div>)}</div>{uploadError && <small className="upload-error">{uploadError}</small>}<button className="add-item-button" onClick={addSelectedItem}><Plus size={14} /> 添加一项</button></div>}
          {selectedSupportsImage && <div className="inspector-section image-accessibility"><label>图片可访问性</label><div className="paste-image-hint"><Upload size={13} /><span>已选中图片区块，可直接按 Ctrl + V 粘贴图片</span></div><div className="field"><span>替代文字</span><input value={selected?.altText ?? ''} placeholder="描述图片中真正重要的信息" onChange={(event) => updateSelected('altText', event.target.value)} /><small className="field-tip image-alt-tip">留空时会使用区块标题；纯装饰图片可填写简短说明。</small></div></div>}
          {(selected?.items?.length ?? 0) > 1 && <div className="inspector-section item-order-section"><label>内容项顺序</label><div>{selected.items.map((item, index) => <div key={index}><span><small>{String(index + 1).padStart(2, '0')}</small><strong>{item.title || item.name || item.label || item.value || `第 ${index + 1} 项`}</strong></span><i><button title="复制这一项" onClick={() => duplicateSelectedItem(index)}><Copy size={11} /></button><button disabled={index === 0} title="向前移动" onClick={() => moveSelectedItem(index, -1)}><ArrowUp size={11} /></button><button disabled={index === selected.items.length - 1} title="向后移动" onClick={() => moveSelectedItem(index, 1)}><ArrowDown size={11} /></button></i></div>)}</div></div>}
          {selectedHasButton && <div className="inspector-section button-style-section"><label>行动按钮外观</label><div className="button-style-options">{localizedEditorOptions.buttonStyles.map(([value, label]) => <button className={(selected.buttonStyle ?? 'solid') === value ? 'active' : ''} key={value} onClick={() => updateSelected('buttonStyle', value)}>{label}</button>)}</div><small className="field-tip">会应用到当前区块的主行动按钮，并保留主题强调色。</small></div>}
          {selected?.type === 'nav' && <div className="inspector-section nav-behavior-section"><label>导航行为</label><button className={`setting-toggle ${selected.stickyNav !== false ? 'active' : ''}`} type="button" role="switch" aria-checked={selected.stickyNav !== false} onClick={() => updateSelected('stickyNav', selected.stickyNav === false)}><i /><span>{selected.stickyNav !== false ? '滚动时吸附在页面顶部' : '跟随页面正常滚动'}</span></button><small className="field-tip">移动端会自动显示可展开菜单，不会再隐藏导航链接。</small></div>}
          <div className="inspector-section"><label>背景与视觉</label><div className="field-row"><div className="field"><span>视觉预设</span><select value={selected?.visualPreset ?? 'none'} onChange={(event) => updateSelected('visualPreset', event.target.value)}><option value="none">基础</option><option value="gradient">柔和渐变</option><option value="dark">深色沉浸</option><option value="glass">玻璃质感</option><option value="editorial">编辑排版</option></select></div><div className="field"><span>排版构图</span><select value={selected?.layoutVariant ?? 'default'} onChange={(event) => updateSelected('layoutVariant', event.target.value)}><option value="default">经典</option><option value="centered">居中焦点</option><option value="offset">偏移留白</option><option value="poster">海报标题</option><option value="frame">画框聚焦</option><option value="diagonal">斜向张力</option></select></div></div><div className="field-row"><div className="field"><span>细节装饰</span><select value={selected?.decoration ?? 'none'} onChange={(event) => updateSelected('decoration', event.target.value)}><option value="none">无</option><option value="orbs">漂浮光球</option><option value="grid">设计网格</option><option value="sparkles">闪光符号</option><option value="labels">悬浮标签</option></select></div><div className="field"><span>表面材质</span><select value={selected?.material ?? 'none'} onChange={(event) => updateSelected('material', event.target.value)}><option value="none">无</option><option value="noise">胶片颗粒</option><option value="paper">纸张纹理</option><option value="scanlines">扫描线</option><option value="beams">鼠标光束</option><option value="mesh">动态渐变</option></select></div></div><div className="field"><span>背景图片</span><label className="upload-button"><Image size={15} /><span>{selected?.backgroundImage ? '更换背景图' : '上传背景图'}</span><input type="file" accept="image/*" onChange={(event) => handleImageUpload(event, 'backgroundImage')} /></label>{selected?.backgroundImage && <button className="remove-image" onClick={() => updateSelected('backgroundImage', '')}>移除背景图片</button>}{uploadError && <small className="upload-error">{uploadError}</small>}</div>{selected?.backgroundImage && <div className="field-row"><div className="field"><span>背景位置</span><select value={selected?.backgroundPosition ?? 'center'} onChange={(event) => updateSelected('backgroundPosition', event.target.value)}><option value="top">顶部</option><option value="center">居中</option><option value="bottom">底部</option><option value="left">左侧</option><option value="right">右侧</option></select></div><div className="field"><span>暗色遮罩</span><input className="range-input" type="range" min="0" max=".9" step=".05" value={selected?.backgroundOverlay ?? .25} onChange={(event) => updateSelected('backgroundOverlay', event.target.value)} /></div></div>}</div>
          <div className="inspector-section"><label>动效</label><div className="field"><span>运动节奏</span><div className="motion-speed-options">{localizedEditorOptions.motionSpeeds.map(([value, label]) => <button className={(selected?.motionSpeed ?? 'normal') === value ? 'active' : ''} key={value} onClick={() => updateSelected('motionSpeed', value)}>{label}</button>)}</div></div><div className="field"><span>进入动画</span><select value={selected?.effect === 'hover-lift' ? 'none' : selected?.effect ?? 'none'} onChange={(event) => updateSelected('effect', event.target.value)}><option value="none">无</option><option value="fade-up">淡入上移</option><option value="zoom-in">缩放出现</option><option value="blur-in">模糊变清晰</option></select></div><div className="field"><span>内部元素编排</span><select value={selected?.elementEffect ?? 'none'} onChange={(event) => updateSelected('elementEffect', event.target.value)}><option value="none">无</option><option value="stagger">子项依次进入</option><option value="mask">标题遮罩揭示</option><option value="float">轻微持续漂浮</option><option value="drift">图片缓慢漫游</option></select></div><div className="field"><span>鼠标接触</span><select value={selected?.hoverEffect ?? (selected?.effect === 'hover-lift' ? 'lift' : 'none')} onChange={(event) => updateSelected('hoverEffect', event.target.value)}><option value="none">无</option><option value="lift">内容上浮</option><option value="tilt">3D 跟随倾斜</option><option value="spotlight">聚光跟随</option><option value="glow">边缘发光</option><option value="image-zoom">图片／内容放大</option></select></div><small className="field-tip">运动节奏会同时影响进入、序列和持续动画；系统“减少动态效果”设置仍优先。</small></div>
          {(selectedHasButton || ['nav', 'footer'].includes(selected?.type)) && <div className="inspector-section site-link-section">
            <label>站内页面链接</label>
            {selectedHasButton && <div className="field"><span>主按钮跳转</span><select value={pageLinkId(selected?.url) ? selected.url : 'custom'} onChange={(event) => updateSelected('url', event.target.value === 'custom' ? '' : event.target.value)}><option value="custom">手动网址或当前页锚点</option>{projectPages.map((page, pageIndex) => <option value={`page:${page.id}`} key={page.id}>{page.name} · {pageFileName(page, pageIndex)}</option>)}</select></div>}
            {['nav', 'footer'].includes(selected?.type) && <div className="site-link-item-list">{(selected.items ?? []).map((item, index) => <label key={index}><span>{item.title || `链接 ${index + 1}`}</span><select value={pageLinkId(item.description) ? item.description : 'custom'} onChange={(event) => updateSelectedItem(index, 'description', event.target.value === 'custom' ? '' : event.target.value)}><option value="custom">手动网址或当前页锚点</option>{projectPages.map((page, pageIndex) => <option value={`page:${page.id}`} key={page.id}>{page.name} · {pageFileName(page, pageIndex)}</option>)}</select></label>)}</div>}
            <small className="field-tip">选择页面后，预览可直接切页；整站导出会自动转换为对应 HTML 文件路径。</small>
          </div>}
          <div className="inspector-section scene-transition-section">
            <label>场景转场</label>
            <div className="scene-transition-options">{localizedEditorOptions.sceneTransitions.map(([value, label]) => <button className={(selected?.sceneTransition ?? 'none') === value ? 'active' : ''} key={value} onClick={() => updateSelected('sceneTransition', value)}><i className={`transition-preview-${value}`} /><span>{label}</span></button>)}</div>
            <small className="field-tip">区块进入视口时揭开画面；“减少动态效果”开启后会自动变为瞬间显示。</small>
          </div>
          <div className="inspector-section advanced-style-section">
            <label>样式</label>
            <div className="field"><span>背景类型</span><div className="background-mode-options">{localizedEditorOptions.backgroundModes.map(([value, label]) => <button key={value} className={styleValues(selected).backgroundMode === value ? 'active' : ''} onClick={() => updateSelectedStyle('backgroundMode', value)}>{label}</button>)}</div></div>
            {styleValues(selected).backgroundMode === 'gradient' ? <>
              <div className="gradient-color-row"><label><span>起点</span><input type="color" value={styleValues(selected).gradientFrom} onChange={(event) => updateSelectedStyle('gradientFrom', event.target.value)} /></label><i style={{ background: `linear-gradient(${styleValues(selected).gradientAngle}deg, ${styleValues(selected).gradientFrom}, ${styleValues(selected).gradientTo})` }} /><label><span>终点</span><input type="color" value={styleValues(selected).gradientTo} onChange={(event) => updateSelectedStyle('gradientTo', event.target.value)} /></label></div>
              <div className="field"><span>渐变方向 <output>{styleValues(selected).gradientAngle}°</output></span><input className="range-input" type="range" min="0" max="360" step="5" value={styleValues(selected).gradientAngle} onChange={(event) => updateSelectedStyle('gradientAngle', event.target.value)} /></div>
            </> : <div className="field"><span>背景颜色</span><label className="color-input"><input type="color" value={styleValues(selected).background} onChange={(event) => updateSelectedStyle('background', event.target.value)} /><span>{styleValues(selected).background.toUpperCase()}</span></label></div>}
            <div className="field-row color-override-row"><div className="field"><span>文字颜色</span><label className="color-input"><input type="color" value={styleValues(selected).textColor || (darkBackgroundClass(selected) ? '#ffffff' : '#192031')} onChange={(event) => updateSelectedStyle('textColor', event.target.value)} /><span>{styleValues(selected).textColor ? styleValues(selected).textColor.toUpperCase() : '自动'}</span></label><button disabled={!styleValues(selected).textColor} onClick={() => updateSelectedStyle('textColor', '')}>恢复自动</button></div><div className="field"><span>区块强调色</span><label className="color-input"><input type="color" value={styleValues(selected).accentColor || themeAccent(pageMeta.theme)} onChange={(event) => updateSelectedStyle('accentColor', event.target.value)} /><span>{styleValues(selected).accentColor ? styleValues(selected).accentColor.toUpperCase() : '主题'}</span></label><button disabled={!styleValues(selected).accentColor} onClick={() => updateSelectedStyle('accentColor', '')}>恢复主题</button></div></div>
            <div className="field-row"><div className="field"><span>圆角</span><label className="unit-input"><input type="number" min="0" max="48" value={styleValues(selected).radius} onChange={(event) => updateSelectedStyle('radius', event.target.value)} /><em>px</em></label></div><div className="field"><span>对齐方式</span><div className="align-options">{localizedEditorOptions.alignments.map(([value, label]) => <button key={value} className={styleValues(selected).align === value ? 'active' : ''} onClick={() => updateSelectedStyle('align', value)}>{label}</button>)}</div></div></div>
            <div className="field"><span>上下留白 <output>{styleValues(selected).paddingY}px</output></span><input className="range-input" type="range" min="20" max="160" step="4" value={styleValues(selected).paddingY} onChange={(event) => updateSelectedStyle('paddingY', event.target.value)} /></div>
            <div className="field"><span>区块高度 <output>{styleValues(selected).minHeight}px</output></span><input className="range-input" type="range" min="120" max="900" step="20" value={styleValues(selected).minHeight} onChange={(event) => updateSelectedStyle('minHeight', event.target.value)} /></div>
            <button className="reset-style-button" type="button" disabled={!Object.keys(selected?.styles ?? {}).length} onClick={resetSelectedStyle}>重置当前区块样式</button>
          </div>
          <div className="inspector-section layer-actions"><label>区块位置</label><button onClick={() => moveSelected(-1)}><ArrowUp size={15} /> 向上移动 <small>Alt + ↑</small></button><button onClick={() => moveSelected(1)}><ArrowDown size={15} /> 向下移动 <small>Alt + ↓</small></button><span className="shortcut-hint">复制 Ctrl/Cmd + D · 删除 Delete</span></div>
          <div className="sidebar-bottom document-actions"><button className="help-link" onClick={exportSiteZip}><Download size={16} /> 导出整站 ZIP</button><button className="help-link" onClick={exportStaticHtml}><Download size={16} /> 导出当前页</button><button className="help-link" onClick={exportDocument}><Link size={16} /> 导出整站 JSON</button><label className="help-link import-document"><Upload size={16} /> 导入 JSON<input type="file" accept="application/json,.json" onChange={importDocument} /></label>{documentError && <small className="document-error">{documentError}</small>}</div>
        </aside>}
      </main>
      {settingsOpen && <PageSettingsModal meta={pageMeta} themes={localizedThemes} editorOptions={localizedEditorOptions} onChange={updatePageMeta} onClose={() => setSettingsOpen(false)} />}
      {pagesOpen && <PageManagerModal pages={projectPages} activePageId={activePageId} onSwitch={switchPage} onCreate={createPage} onRename={(pageId, name) => updatePageIdentity(pageId, 'name', name)} onDuplicate={duplicatePage} onDelete={deletePage} onClose={() => setPagesOpen(false)} />}
      {templatesOpen && <TemplateLibraryModal templates={localizedTemplates} onApply={applyTemplate} onClose={() => setTemplatesOpen(false)} />}
      {auditOpen && <PageAuditModal issues={pageIssues} onSelect={(blockId) => { setAuditOpen(false); if (blockId) focusBlock(blockId) }} onClose={() => setAuditOpen(false)} />}
      {commandOpen && <CommandPalette blocks={blocks} components={localizedComponents} onAdd={addBlock} onFocus={focusBlock} onClose={() => setCommandOpen(false)} actions={[
        { id: 'action-preview', group: '页面操作', title: '进入预览', note: '查看接近发布后的页面效果', run: () => setPreview(true) },
        { id: 'action-export-site', group: '页面操作', title: '导出整站', note: '生成包含全部页面的 ZIP 网站包', run: exportSiteZip },
        { id: 'action-export', group: '页面操作', title: '导出当前页', note: '生成当前页面的独立静态 HTML', run: exportStaticHtml },
        { id: 'action-audit', group: '页面操作', title: '发布检查', note: `${pageIssues.length} 个待确认细节`, run: () => setAuditOpen(true) },
        { id: 'action-templates', group: '页面操作', title: '打开模板库', note: '从完整页面方向开始', run: () => setTemplatesOpen(true) },
        { id: 'action-settings', group: '页面操作', title: '页面设置', note: '主题、画布、字体与 SEO', run: () => setSettingsOpen(true) },
      ]} />}
    </div>
  )
}

function ImageVisual({ block }) {
  const imageStyle = { objectPosition: block.imagePosition ?? 'center', objectFit: block.imageFit ?? 'cover', transform: `scale(${Math.min(1.3, Math.max(1, Number(block.imageScale) || 1))})` }
  return <div className="image-placeholder">{block.imageUrl ? <img loading="lazy" decoding="async" src={block.imageUrl} alt={block.altText || block.title || '网页图片'} style={imageStyle} /> : <><Image size={30} /><span>在右侧上传图片</span></>}</div>
}

function BlockDecorations({ variant, divider, transition }) {
  const hasDecorations = ['orbs', 'grid', 'sparkles', 'labels'].includes(variant)
  const hasDivider = ['wave', 'slant', 'curve'].includes(divider)
  const hasTransition = ['circle', 'curtain', 'paper', 'dissolve'].includes(transition)
  if (!hasDecorations && !hasDivider && !hasTransition) return null
  const labels = variant === 'labels' ? ['IDEA', 'CREATE', 'SHARE'] : ['', '', '']
  return <>{hasDecorations && <div className="block-decorations" aria-hidden="true">{labels.map((label, index) => <span key={index}>{label}</span>)}</div>}{hasTransition && <span className="scene-transition-layer" aria-hidden="true" />}{hasDivider && <div className={`section-divider divider-${divider}`} aria-hidden="true" />}</>
}

function PreviewButton({ block, preview, onNavigatePage }) {
  if (!block.cta) return null
  return <button className={`block-cta${buttonStyleClass(block)}`} onClick={(event) => {
    if (!preview) return
    event.stopPropagation()
    const href = safeHref(block.url)
    if (!href) return
    if (pageLinkId(href)) {
      onNavigatePage?.(href)
    } else if (href.startsWith('#')) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' })
    } else if (/^https?:/i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer')
    } else {
      window.location.href = href
    }
  }}>{block.cta}<span>↗</span></button>
}

function BlockContent({ block, preview, onUpdate, onNavigatePage }) {
  const [activeTab, setActiveTab] = useState(0)
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => {
    setActiveTab((current) => Math.min(current, Math.max(0, (block.items?.length ?? 1) - 1)))
  }, [block.items?.length])
  useEffect(() => {
    setNavOpen(false)
  }, [block.id, preview])
  useEffect(() => {
    if (!navOpen) return undefined
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [navOpen])

  if (block.type === 'nav') {
    const menuId = `nav-menu-${String(block.id).replace(/[^a-z0-9_-]/gi, '-')}`
    return <><a className="nav-brand" href="#" onClick={(event) => { if (!preview) event.preventDefault() }}>{block.title}</a><button className="nav-menu-toggle" type="button" aria-label={navOpen ? '收起导航菜单' : '展开导航菜单'} aria-expanded={navOpen} aria-controls={menuId} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setNavOpen((current) => !current) }}><i /><i /><i /></button><div className={`nav-links ${navOpen ? 'is-open' : ''}`} id={menuId}>{(block.items ?? []).map((item, index) => <a key={index} href={pageLinkId(item.description) ? '#' : safeHref(item.description) || '#'} onClick={(event) => { if (!preview || pageLinkId(item.description)) event.preventDefault(); if (preview && pageLinkId(item.description)) onNavigatePage?.(item.description); setNavOpen(false) }}>{item.title}</a>)}</div><PreviewButton block={block} preview={preview} onNavigatePage={onNavigatePage} /></>
  }
  if (block.type === 'image') return <ImageVisual block={block} />
  if (block.type === 'split') return <div className="split-layout"><div className="split-copy"><span className="eyebrow">STORY IN MOTION</span><h1>{block.title}</h1><p>{block.description}</p><PreviewButton block={block} preview={preview} onNavigatePage={onNavigatePage} /></div><div className="split-media"><ImageVisual block={block} /></div></div>
  if (block.type === 'marquee') return <div className="marquee-track"><span>{block.title || 'MAKE SOMETHING BEAUTIFUL'}</span><span>{block.title || 'MAKE SOMETHING BEAUTIFUL'}</span><span>{block.title || 'MAKE SOMETHING BEAUTIFUL'}</span></div>
  if (block.type === 'cards') return <><div className="section-heading"><span className="eyebrow">WHAT WE DO</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="cards-grid">{(block.items ?? []).map((item, index) => <article className="visual-card" key={index}><span>✦</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></>
  if (block.type === 'stats') return <><div className="section-heading"><span className="eyebrow">IN NUMBERS</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="stats-grid">{(block.items ?? []).map((item, index) => <article className="stat-item" key={index}><strong>{item.value}</strong><span>{item.label}</span></article>)}</div></>
  if (block.type === 'team') return <><div className="section-heading"><span className="eyebrow">THE PEOPLE</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="team-grid">{(block.items ?? []).map((item, index) => <article className="person-card" key={index}><div className="person-portrait"><span>{(item.name || '?').slice(0, 1)}</span></div><h3>{item.name}</h3><p>{item.role}</p></article>)}</div></>
  if (block.type === 'faq') return <><div className="section-heading"><span className="eyebrow">QUESTIONS & ANSWERS</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="faq-list">{(block.items ?? []).map((item, index) => <details className="faq-item" defaultOpen={!preview || index === 0} key={index}><summary><span>0{index + 1}</span><h3>{item.title}</h3><b aria-hidden="true">＋</b></summary><p>{item.description}</p></details>)}</div></>
  if (block.type === 'tabs') {
    const items = block.items ?? []
    const activeItem = items[activeTab] ?? items[0]
    const tabsId = `tabs-${String(block.id).replace(/[^a-z0-9_-]/gi, '-')}`
    function handleTabKey(event, index) {
      const next = event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
      if (next === null || !items.length) return
      event.preventDefault()
      event.stopPropagation()
      const tabList = event.currentTarget.parentElement
      setActiveTab(next)
      window.requestAnimationFrame(() => tabList?.querySelectorAll('[role="tab"]')[next]?.focus())
    }
    return <><div className="section-heading"><span className="eyebrow">EXPLORE THE DETAILS</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="tabs-shell"><div className="tab-buttons" role="tablist">{items.map((item, index) => <button id={`${tabsId}-tab-${index}`} type="button" role="tab" aria-selected={activeTab === index} aria-controls={`${tabsId}-panel-${index}`} tabIndex={activeTab === index ? 0 : -1} key={index} onClick={(event) => { event.stopPropagation(); setActiveTab(index) }} onKeyDown={(event) => handleTabKey(event, index)}><span>0{index + 1}</span>{item.title}</button>)}</div><div className="tab-panels">{activeItem && <article id={`${tabsId}-panel-${activeTab}`} className="tab-panel" role="tabpanel" aria-labelledby={`${tabsId}-tab-${activeTab}`} key={activeTab}><span>0{activeTab + 1} / EXPLORE</span><h3>{activeItem.title}</h3><p>{activeItem.description}</p><i aria-hidden="true">↗</i></article>}</div></div></>
  }
  if (block.type === 'timeline') return <><div className="section-heading"><span className="eyebrow">OUR JOURNEY</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="timeline-list">{(block.items ?? []).map((item, index) => <article className="timeline-item" key={index}><strong>{item.value}</strong><i /><span>{item.label}</span></article>)}</div></>
  if (block.type === 'bento') return <><div className="section-heading"><span className="eyebrow">SELECTED IDEAS</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="bento-grid">{(block.items ?? []).map((item, index) => <article className={`bento-tile tile-${(index % 4) + 1}`} key={index}><span>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.description}</p></div></article>)}</div></>
  if (block.type === 'showcase') return <><div className="section-heading"><span className="eyebrow">FEATURED WORK</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="showcase-rail">{(block.items ?? []).map((item, index) => <article className={`showcase-card project-${(index % 4) + 1}`} key={index}><div className="project-visual">{item.imageUrl && <img loading="lazy" decoding="async" src={item.imageUrl} alt={item.title || '作品图片'} />}<span>0{index + 1}</span></div><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></>
  if (block.type === 'sticky') return <><div className="sticky-intro"><span className="eyebrow">SCROLL TO EXPLORE</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="sticky-stack">{(block.items ?? []).map((item, index) => <article className={`sticky-card story-${(index % 4) + 1}`} style={{ '--story-index': index }} key={index}><span>CHAPTER 0{index + 1}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></>
  if (block.type === 'collage') return <><div className="section-heading"><span className="eyebrow">VISUAL ARCHIVE</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="collage-stage">{(block.items ?? []).map((item, index) => <figure className={`collage-item collage-${(index % 5) + 1}`} key={index}>{item.imageUrl ? <img loading="lazy" decoding="async" src={item.imageUrl} alt={item.title || '拼贴图片'} /> : <span>IMAGE 0{index + 1}</span>}<figcaption><strong>{item.title}</strong><small>{item.description}</small></figcaption></figure>)}</div></>
  if (block.type === 'gallery') return <><div className="section-heading"><span className="eyebrow">CURATED FRAGMENTS</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="masonry-gallery">{(block.items ?? []).map((item, index) => <figure className={`masonry-item masonry-${(index % 6) + 1}`} key={index}>{item.imageUrl ? <img loading="lazy" decoding="async" src={item.imageUrl} alt={item.title || '画廊图片'} /> : <span>FRAME {String(index + 1).padStart(2, '0')}</span>}<figcaption><strong>{item.title}</strong><small>{item.description}</small></figcaption></figure>)}</div></>
  if (block.type === 'accordion') {
    const items = block.items ?? []
    const accordionId = `service-${String(block.id).replace(/[^a-z0-9_-]/gi, '-')}`
    function handleAccordionKey(event, index) {
      const next = event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? (index + 1) % items.length
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? (index - 1 + items.length) % items.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
      if (next === null || !items.length) return
      event.preventDefault()
      event.stopPropagation()
      const accordion = event.currentTarget.closest('.service-accordion')
      setActiveTab(next)
      window.requestAnimationFrame(() => accordion?.querySelectorAll(':scope > article > button')[next]?.focus())
    }
    return <><div className="section-heading"><span className="eyebrow">HOW WE CAN HELP</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="service-accordion">{items.map((item, index) => <article className={activeTab === index ? 'active' : ''} key={index}><button id={`${accordionId}-button-${index}`} type="button" aria-expanded={activeTab === index} aria-controls={`${accordionId}-panel-${index}`} onClick={(event) => { event.stopPropagation(); setActiveTab(index) }} onKeyDown={(event) => handleAccordionKey(event, index)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.title}</strong><i aria-hidden="true">{activeTab === index ? '−' : '＋'}</i></button><div id={`${accordionId}-panel-${index}`} role="region" aria-labelledby={`${accordionId}-button-${index}`} hidden={activeTab !== index}><p>{item.description}</p><b aria-hidden="true">↗</b></div></article>)}</div></>
  }
  if (block.type === 'immersive') return <><div className="immersive-stage" aria-hidden="true"><span className="immersive-orbit orbit-one" /><span className="immersive-orbit orbit-two" /><div className="immersive-portal">{block.imageUrl ? <img className="immersive-art" decoding="async" fetchPriority="high" src={block.imageUrl} alt={block.altText || block.title || '沉浸式封面主视觉'} style={{ objectPosition: block.imagePosition ?? 'center', objectFit: block.imageFit ?? 'cover', transform: `scale(${Math.min(1.3, Math.max(1, Number(block.imageScale) || 1))})` }} /> : <div className="immersive-crystal"><i /><i /><i /></div>}</div></div><div className="immersive-copy"><span className="eyebrow">ENTER THE STORY</span><h1>{block.title}</h1><p>{block.description}</p><PreviewButton block={block} preview={preview} onNavigatePage={onNavigatePage} /></div><span className="immersive-scroll" aria-hidden="true"><i /> SCROLL TO EXPLORE</span></>
  if (block.type === 'fullscreen') return <>{block.imageUrl ? <img className="fullscreen-image" decoding="async" fetchPriority="high" src={block.imageUrl} alt={block.altText || block.title || '全屏项目图片'} style={{ objectPosition: block.imagePosition ?? 'center', objectFit: block.imageFit ?? 'cover', transform: `scale(${Math.min(1.3, Math.max(1, Number(block.imageScale) || 1))})` }} /> : <div className="fullscreen-fallback"><span>FULLSCREEN VISUAL</span></div>}<div className="fullscreen-copy"><span className="eyebrow">FEATURED PROJECT</span><h1>{block.title}</h1><p>{block.description}</p><PreviewButton block={block} preview={preview} onNavigatePage={onNavigatePage} /></div></>
  if (block.type === 'compare') {
    const before = block.items?.[0] ?? {}
    const after = block.items?.[1] ?? {}
    const position = Math.min(90, Math.max(10, Number(block.comparePosition) || 50))
    function updateCompare(event) {
      event.currentTarget.closest('.block-compare')?.style.setProperty('--compare', `${event.currentTarget.value}%`)
    }
    function saveCompare(event) {
      onUpdate?.('comparePosition', Number(event.currentTarget.value))
    }
    return <><div className="section-heading"><span className="eyebrow">BEFORE / AFTER</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="compare-frame">{before.imageUrl ? <img className="compare-image compare-before" loading="lazy" decoding="async" src={before.imageUrl} alt={before.title || '调整前'} /> : <div className="compare-placeholder compare-before">BEFORE</div>}{after.imageUrl ? <img className="compare-image compare-after" loading="lazy" decoding="async" src={after.imageUrl} alt={after.title || '调整后'} /> : <div className="compare-placeholder compare-after">AFTER</div>}<span className="compare-label label-before">{before.title || 'BEFORE'}</span><span className="compare-label label-after">{after.title || 'AFTER'}</span><i className="compare-handle" /><input key={position} className="compare-range" type="range" min="10" max="90" defaultValue={position} aria-label="调整图片对比位置" onInput={updateCompare} onPointerUp={saveCompare} onKeyUp={saveCompare} /></div></>
  }
  if (block.type === 'testimonials') return <><div className="section-heading"><span className="eyebrow">WHAT PEOPLE SAY</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="testimonial-rail">{(block.items ?? []).map((item, index) => <article className="testimonial-card" key={index}><span>“</span><blockquote>{item.title}</blockquote><p>{item.description}</p><small>0{index + 1}</small></article>)}</div></>
  if (block.type === 'pricing') return <><div className="section-heading"><span className="eyebrow">SIMPLE PRICING</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="pricing-grid">{(block.items ?? []).map((item, index) => <article className={`pricing-card ${index === 1 ? 'is-featured' : ''}`} key={index}><span>{index === 1 ? 'RECOMMENDED' : `PLAN 0${index + 1}`}</span><h3>{item.title}</h3><strong>{item.value || (block.locale === 'en' ? 'Custom' : '定制')}</strong><p>{item.description}</p><button>{block.locale === 'en' ? 'Choose plan' : '选择方案'} <b>↗</b></button></article>)}</div></>
  if (block.type === 'logos') return <><p className="logos-heading">{block.title}</p><div className="logo-track">{[...(block.items ?? []), ...(block.items ?? [])].map((item, index) => <span key={index}>{item.title}</span>)}</div></>
  if (block.type === 'footer') return <><div className="footer-brand"><span className="eyebrow">STAY CURIOUS</span><h1>{block.title}</h1><p>{block.description}</p></div><div className="footer-links"><strong>EXPLORE</strong><ul>{(block.items ?? []).map((item, index) => <li key={index}><a href={pageLinkId(item.description) ? '#' : safeHref(item.description) || '#'} onClick={(event) => { if (!preview || pageLinkId(item.description)) event.preventDefault(); if (preview && pageLinkId(item.description)) onNavigatePage?.(item.description) }}>{item.title}</a></li>)}</ul></div><div className="footer-meta"><span>© {new Date().getFullYear()} {block.title}</span><span>Made with PageCraft</span></div></>
  if (block.type === 'quote') return <><span className="quote-mark">“</span><blockquote>{block.title}</blockquote><p>{block.description}</p></>
  return <div className="block-content"><span className="eyebrow">{block.type === 'hero' ? 'WELCOME TO PAGECRAFT' : block.type === 'contact' ? 'LET’S CREATE' : 'WHY PAGECRAFT'}</span><h1>{block.title}</h1><p>{block.description}</p>{block.type !== 'text' && <PreviewButton block={block} preview={preview} onNavigatePage={onNavigatePage} />}</div>
}

function BlockPreview({ block, displayLabel = block.label, language = 'zh', selected, onClick, preview, device, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd, onUpdate, onNavigatePage }) {
  const blockRef = useRef(null)
  const contentRevealEffect = ['fade-up', 'zoom-in', 'blur-in'].includes(block.effect) || ['stagger', 'mask', 'float', 'drift'].includes(block.elementEffect)
  const revealEffect = contentRevealEffect || Boolean(sceneTransitionClass(block))
  const [revealed, setRevealed] = useState(!preview || !revealEffect)

  useEffect(() => {
    if (!preview || !revealEffect || !blockRef.current || typeof IntersectionObserver === 'undefined') {
      setRevealed(true)
      return undefined
    }
    setRevealed(false)
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setRevealed(true)
      observer.disconnect()
    }, { threshold: 0.2 })
    observer.observe(blockRef.current)
    return () => observer.disconnect()
  }, [preview, revealEffect, block.effect])

  const backgroundImage = safeCssImageSource(block.backgroundImage)
  const hiddenOnDevice = !preview && ((device === 'mobile' && block.visibility === 'desktop') || (device !== 'mobile' && block.visibility === 'mobile'))
  const className = `website-block block-${block.type}${block.type === 'nav' && block.stickyNav !== false ? ' nav-sticky' : ''}${revealed ? effectClass(block) : contentRevealEffect ? ' effect-pre-reveal' : ''}${hoverClass(block)}${visualClass(block)}${layoutClass(block)}${decorationClass(block)}${elementEffectClass(block)}${motionSpeedClass(block)}${materialClass(block)}${visibilityClass(block)}${darkBackgroundClass(block)}${customColorClass(block)}${sceneTransitionClass(block)}${revealed ? ' element-visible' : ''} ${selected ? 'is-selected' : ''} ${hiddenOnDevice ? 'is-device-hidden' : ''} ${dragging ? 'is-dragging' : ''} ${dragOver ? 'is-drop-target' : ''}`
  const customStyle = block.styles ?? {}
  const visualStyles = styleValues(block)
  const overlay = Math.min(.9, Math.max(0, Number(block.backgroundOverlay) || 0))
  const customBackground = customStyle.backgroundMode === 'gradient'
    ? { background: `linear-gradient(${Math.min(360, Math.max(0, Number(visualStyles.gradientAngle) || 0))}deg, ${visualStyles.gradientFrom}, ${visualStyles.gradientTo})` }
    : customStyle.background ? { background: customStyle.background } : {}
  const inlineStyle = { '--compare': `${Math.min(90, Math.max(10, Number(block.comparePosition) || 50))}%`, ...customBackground, ...(/^#[0-9a-f]{6}$/i.test(customStyle.textColor || '') ? { '--block-text': customStyle.textColor } : {}), ...(/^#[0-9a-f]{6}$/i.test(customStyle.accentColor || '') ? { '--block-accent': customStyle.accentColor } : {}), ...(customStyle.radius !== undefined ? { borderRadius: `${Math.min(48, Math.max(0, Number(customStyle.radius) || 0))}px` } : {}), ...(customStyle.align ? { textAlign: customStyle.align } : {}), ...(customStyle.paddingY !== undefined ? { paddingTop: `${Math.min(160, Math.max(20, Number(customStyle.paddingY) || 20))}px`, paddingBottom: `${Math.min(160, Math.max(20, Number(customStyle.paddingY) || 20))}px` } : {}), ...(customStyle.minHeight !== undefined ? { minHeight: `${Math.min(900, Math.max(120, Number(customStyle.minHeight) || 120))}px` } : {}), ...(backgroundImage ? { backgroundImage: `linear-gradient(rgba(12,15,24,${overlay}), rgba(12,15,24,${overlay})), url("${backgroundImage}")`, backgroundPosition: block.backgroundPosition ?? 'center', backgroundSize: 'cover' } : {}) }
  function handlePointerMove(event) {
    if (block.type !== 'immersive' && !['tilt', 'spotlight'].includes(block.hoverEffect) && !['orbs', 'grid', 'sparkles', 'labels'].includes(block.decoration) && !['beams', 'mesh'].includes(block.material)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    event.currentTarget.style.setProperty('--pointer-x', `${x * 100}%`)
    event.currentTarget.style.setProperty('--pointer-y', `${y * 100}%`)
    event.currentTarget.style.setProperty('--tilt-x', `${(.5 - y) * 8}deg`)
    event.currentTarget.style.setProperty('--tilt-y', `${(x - .5) * 8}deg`)
    event.currentTarget.style.setProperty('--parallax-x', `${(x - .5) * 24}px`)
    event.currentTarget.style.setProperty('--parallax-y', `${(y - .5) * 24}px`)
    event.currentTarget.style.setProperty('--parallax-x-reverse', `${(.5 - x) * 16}px`)
    event.currentTarget.style.setProperty('--parallax-y-reverse', `${(.5 - y) * 16}px`)
  }
  function handlePointerLeave(event) {
    event.currentTarget.style.setProperty('--tilt-x', '0deg')
    event.currentTarget.style.setProperty('--tilt-y', '0deg')
    event.currentTarget.style.setProperty('--parallax-x', '0px')
    event.currentTarget.style.setProperty('--parallax-y', '0px')
    event.currentTarget.style.setProperty('--parallax-x-reverse', '0px')
    event.currentTarget.style.setProperty('--parallax-y-reverse', '0px')
  }
  return <section ref={blockRef} id={safeAnchor(block.anchor) || undefined} data-block-id={block.id} tabIndex={preview ? undefined : 0} aria-label={preview ? undefined : `${displayLabel}: ${block.title || (language === 'en' ? 'Untitled section' : '未命名区块')}`} className={className} style={inlineStyle} onClick={onClick} onKeyDown={(event) => { if (!preview && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onClick?.() } }} onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} onDragOver={(event) => { event.preventDefault(); onDragOver?.() }} onDrop={(event) => { event.preventDefault(); onDrop?.() }}>
    <BlockDecorations variant={block.decoration} divider={block.sectionDivider} transition={block.sceneTransition} />
    {selected && <span className="selection-tag">{displayLabel}</span>}
    {hiddenOnDevice && <span className="device-hidden-tag">{language === 'en' ? 'Hidden on this device' : '此设备隐藏'}</span>}
    {!preview && <span className="drag-handle" title={language === 'en' ? 'Drag to reorder' : '拖拽排序'} draggable onDragStart={(event) => { event.stopPropagation(); onDragStart?.() }} onDragEnd={(event) => { event.stopPropagation(); onDragEnd?.() }}><GripVertical size={15} /></span>}
    <BlockContent block={block} preview={preview} onUpdate={onUpdate} onNavigatePage={onNavigatePage} />
  </section>
}

function PageManagerModal({ pages, activePageId, onSwitch, onCreate, onRename, onDuplicate, onDelete, onClose }) {
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  return <div className="modal-backdrop" onClick={onClose}>
    <section className="page-manager-modal" role="dialog" aria-modal="true" aria-labelledby="page-manager-title" onClick={(event) => event.stopPropagation()}>
      <div className="settings-header"><div><span className="settings-kicker">SITE PAGES</span><h2 id="page-manager-title">网站页面</h2></div><button className="close-panel" aria-label="关闭页面管理" onClick={onClose}><X size={17} /></button></div>
      <p className="settings-intro">每个页面拥有独立区块、主题设置与 SEO 信息。切换页面不会丢失当前编辑内容。</p>
      <div className="page-manager-list">
        {pages.map((page, index) => <article className={`page-manager-row ${page.id === activePageId ? 'active' : ''}`} key={page.id}>
          <button className="page-manager-select" onClick={() => onSwitch(page.id)}>
            <small>{String(index + 1).padStart(2, '0')}</small>
            <span><strong>{page.name || '未命名页面'}</strong><em>{pageFileName(page, index)} · {page.blocks.length} 个区块</em></span>
            {page.id === activePageId && <b>正在编辑</b>}
          </button>
          <label className="page-name-editor"><span>页面名称</span><input value={page.name} maxLength="40" onChange={(event) => onRename(page.id, event.target.value)} /></label>
          <div className="page-manager-actions">
            <button onClick={() => onDuplicate(page.id)} title="复制页面"><Copy size={14} /> 复制</button>
            <button className="danger" disabled={pages.length <= 1} onClick={() => onDelete(page.id)} title={pages.length <= 1 ? '网站至少保留一个页面' : '删除页面'}><Trash2 size={14} /> 删除</button>
          </div>
        </article>)}
      </div>
      <footer className="page-manager-footer"><span>共 {pages.length} 个页面</span><button className="primary-button" onClick={onCreate}><Plus size={15} /> 新建页面</button></footer>
    </section>
  </div>
}

function PageSettingsModal({ meta, themes = PAGE_THEMES, editorOptions = EDITOR_OPTIONS, onChange, onClose }) {
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
      <div className="settings-header"><div><span className="settings-kicker">PAGE SETTINGS</span><h2 id="settings-title">页面设置</h2></div><button className="close-panel" aria-label="关闭页面设置" onClick={onClose}><X size={17} /></button></div>
      <p className="settings-intro">这些信息会写入导出的网页，也会作为浏览器标签页和搜索引擎的基础描述。</p>
      <div className="theme-settings"><label>整页设计语言</label><div className="theme-grid">{themes.map((theme) => <button key={theme.value} className={`theme-choice theme-swatch-${theme.value} ${pageTheme(meta.theme) === theme.value ? 'active' : ''}`} onClick={() => onChange('theme', theme.value)}><i /><span><strong>{theme.label}</strong><small>{theme.note}</small></span></button>)}</div></div>
      <div className="accent-settings"><label>品牌强调色</label><div><label><input type="color" value={meta.accentColor || themeAccent(meta.theme)} onChange={(event) => onChange('accentColor', event.target.value)} /><span>{(meta.accentColor || themeAccent(meta.theme)).toUpperCase()}</span></label><button disabled={!meta.accentColor} onClick={() => onChange('accentColor', '')}>恢复主题默认</button></div></div>
      <div className="cursor-settings"><label>预览与导出光标</label><div className="cursor-options">{editorOptions.cursors.map(([value, label]) => <button key={value} className={cursorMode(meta.cursor) === value ? 'active' : ''} onClick={() => onChange('cursor', value)}><i className={`cursor-demo-${value}`} />{label}</button>)}</div></div>
      <div className="experience-settings"><div><span><strong>页面滚动进度</strong><small>在页面顶部显示当前浏览位置</small></span><button role="switch" aria-checked={meta.scrollProgress !== false} className={meta.scrollProgress !== false ? 'active' : ''} onClick={() => onChange('scrollProgress', meta.scrollProgress === false)}><i /></button></div></div>
      <div className="typography-settings"><label>全局排版节奏</label><div className="typography-grid"><div><span>字体气质</span><select value={fontMode(meta.fontMode)} onChange={(event) => onChange('fontMode', event.target.value)}><option value="modern">现代无衬线</option><option value="serif">杂志衬线</option><option value="geometric">几何标题</option><option value="mono">代码等宽</option></select></div><div><span>页面密度</span><select value={densityMode(meta.density)} onChange={(event) => onChange('density', event.target.value)}><option value="compact">紧凑</option><option value="balanced">均衡</option><option value="airy">宽松</option></select></div><div><span>标题尺度</span><select value={typeScale(meta.typeScale)} onChange={(event) => onChange('typeScale', event.target.value)}><option value="quiet">克制</option><option value="standard">标准</option><option value="expressive">表达型</option></select></div></div></div>
      <div className="page-surface-settings">
        <label>页面外观与边界</label>
        <div className="page-surface-grid">
          <div className="surface-color-field"><span>外层背景</span><label><input type="color" value={meta.pageBackground} onChange={(event) => onChange('pageBackground', event.target.value)} /><output>{meta.pageBackground.toUpperCase()}</output></label></div>
          <div className="settings-range-field"><label htmlFor="site-width">发布页最大宽度</label><output>{meta.siteWidth}px</output><input id="site-width" type="range" min="720" max="1920" step="20" value={meta.siteWidth} onChange={(event) => onChange('siteWidth', Number(event.target.value))} /></div>
          <div className="settings-range-field"><label htmlFor="section-gap">区块间距</label><output>{meta.sectionGap}px</output><input id="section-gap" type="range" min="0" max="48" step="2" value={meta.sectionGap} onChange={(event) => onChange('sectionGap', Number(event.target.value))} /></div>
          <div className="settings-range-field"><label htmlFor="section-radius">区块圆角</label><output>{meta.sectionRadius}px</output><input id="section-radius" type="range" min="0" max="48" step="2" value={meta.sectionRadius} onChange={(event) => onChange('sectionRadius', Number(event.target.value))} /></div>
        </div>
        <small>间距与圆角设为 0 时，区块会保持传统的无缝长页面。</small>
      </div>
      <div className="settings-size-grid"><div className="settings-range-field"><label htmlFor="canvas-width">桌面画布宽度</label><output>{meta.canvasWidth}px</output><input id="canvas-width" type="range" min="640" max="1440" step="10" value={meta.canvasWidth} onChange={(event) => onChange('canvasWidth', Number(event.target.value))} /></div><div className="settings-range-field"><label htmlFor="canvas-height">画布最小高度</label><output>{meta.canvasHeight}px</output><input id="canvas-height" type="range" min="480" max="1200" step="20" value={meta.canvasHeight} onChange={(event) => onChange('canvasHeight', Number(event.target.value))} /></div></div>
      <div className="settings-field"><label htmlFor="page-title">网页标题</label><input id="page-title" value={meta.title} maxLength="60" onChange={(event) => onChange('title', event.target.value)} placeholder="例如：我的个人主页" /><span>{meta.title.length}/60</span></div>
      <div className="settings-field"><label htmlFor="page-description">网页描述</label><textarea id="page-description" value={meta.description} maxLength="160" rows="4" onChange={(event) => onChange('description', event.target.value)} placeholder="用一句话介绍这个网页" /><span>{meta.description.length}/160</span></div>
      <div className="settings-actions"><button className="secondary-button" onClick={onClose}>完成</button></div>
    </section>
  </div>
}

function TemplateLibraryModal({ templates = PAGE_TEMPLATES, onApply, onClose }) {
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="template-modal" role="dialog" aria-modal="true" aria-labelledby="template-title" onClick={(event) => event.stopPropagation()}>
      <div className="settings-header"><div><span className="settings-kicker">START WITH A DIRECTION</span><h2 id="template-title">完整页面模板</h2></div><button className="close-panel" aria-label="关闭模板库" onClick={onClose}><X size={17} /></button></div>
      <p className="settings-intro">模板会替换当前区块并自动应用对应主题。替换后可用撤销完整恢复原页面和主题；重要作品仍建议先导出 JSON 备份。</p>
      <div className="template-list">{templates.map((template) => <article className={`template-card template-${template.id}`} key={template.id}><div className="template-preview">{template.blocks.slice(0, 6).map((block, index) => <i className={`mini-${block.type}`} key={`${block.type}-${index}`} />)}</div><div className="template-copy"><span>{template.accent}</span><h3>{template.name}</h3><p>{template.note}</p><small>{template.blocks.length} 个完整分区</small></div><button className="template-use" onClick={() => onApply(template)}>使用这个模板 <span>↗</span></button></article>)}</div>
    </section>
  </div>
}

function PageAuditModal({ issues, onSelect, onClose }) {
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="audit-modal" role="dialog" aria-modal="true" aria-labelledby="audit-title" onClick={(event) => event.stopPropagation()}>
      <div className="settings-header"><div><span className="settings-kicker">BEFORE YOU EXPORT</span><h2 id="audit-title">页面发布检查</h2></div><button className="close-panel" aria-label="关闭发布检查" onClick={onClose}><X size={17} /></button></div>
      {issues.length ? <><p className="settings-intro">发现 {issues.length} 个值得确认的细节。它们不会阻止导出，但修正后页面会更可靠。</p><div className="audit-list">{issues.map((issue, index) => <button key={issue.id} onClick={() => onSelect(issue.blockId)} disabled={!issue.blockId}><span><TriangleAlert size={14} /></span><div><small>{String(index + 1).padStart(2, '0')}</small><strong>{issue.title}</strong><p>{issue.detail}</p></div>{issue.blockId && <b>定位 ↗</b>}</button>)}</div></> : <div className="audit-clean"><CircleCheck size={34} /><h3>页面已经准备好了</h3><p>没有发现失效链接、缺失标题或明显的可访问性问题。</p></div>}
      <div className="settings-actions"><button className="secondary-button" onClick={onClose}>完成</button></div>
    </section>
  </div>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
