import localeData from './data/i18n.json'

export const LANGUAGE_STORAGE_KEY = localeData.storageKey
export const SUPPORTED_LANGUAGES = Object.keys(localeData.languages)

const englishToChineseUi = Object.fromEntries(
  Object.entries(localeData.ui).map(([chinese, english]) => [english, chinese]),
)

function translateDynamicText(value, language) {
  const text = String(value)
  const patterns = language === 'en'
    ? [
        [/^(\d+) 页$/, '$1 pages'],
        [/^共 (\d+) 条命令$/, '$1 commands'],
        [/^共 (\d+) 个页面$/, '$1 pages'],
        [/^(\d+) 个区块$/, '$1 sections'],
        [/^(\d+) 个完整分区$/, '$1 complete sections'],
        [/^(\d+) 个待确认细节$/, '$1 details to review'],
        [/^发现 (\d+) 个值得确认的细节。它们不会阻止导出，但修正后页面会更可靠。$/, '$1 details are worth reviewing. They do not block export, but fixing them will make the page more reliable.'],
      ]
    : [
        [/^(\d+) pages$/, '$1 页'],
        [/^(\d+) commands$/, '共 $1 条命令'],
        [/^(\d+) sections$/, '$1 个区块'],
        [/^(\d+) complete sections$/, '$1 个完整分区'],
        [/^(\d+) details to review$/, '$1 个待确认细节'],
        [/^(\d+) details are worth reviewing\. They do not block export, but fixing them will make the page more reliable\.$/, '发现 $1 个值得确认的细节。它们不会阻止导出，但修正后页面会更可靠。'],
      ]
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(text)) return text.replace(pattern, replacement)
  }
  return text
}

export function loadInterfaceLanguage() {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (SUPPORTED_LANGUAGES.includes(saved)) return saved
  } catch {
    // Browser privacy settings may disable localStorage.
  }
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function saveInterfaceLanguage(language) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Language switching still works for the current session.
  }
}

export function localizeComponent(item, language) {
  if (language !== 'en') return item
  return { ...item, ...(localeData.components[item.type] ?? {}) }
}

export function localizeGroups(groups, language) {
  if (language !== 'en') return groups
  return groups.map((group) => ({ ...group, label: localeData.groups[group.value] ?? group.label }))
}

export function localizeCollection(items, collection, language) {
  if (language !== 'en') return items
  const translations = localeData.collections[collection] ?? {}
  return items.map((item) => {
    const localized = translations[item.id ?? item.value]
    return typeof localized === 'string' ? { ...item, label: localized } : { ...item, ...(localized ?? {}) }
  })
}

export function localizeOptions(options, language) {
  if (language !== 'en') return options
  return Object.fromEntries(Object.entries(options).map(([group, values]) => [
    group,
    Array.isArray(values)
      ? values.map(([value, label]) => [value, localeData.options[group]?.[value] ?? label])
      : values,
  ]))
}

export function localizeContent(value, language) {
  if (language !== 'en') return value
  if (typeof value === 'string') return localeData.content[value] ?? value
  if (Array.isArray(value)) return value.map((item) => localizeContent(item, language))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localizeContent(item, language)]))
}

function shouldSkipNode(node) {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  return !element || Boolean(element.closest(
    '[data-i18n-skip], .site-block, .project-name > span:first-child, .layer-outline-select em, .saved-block-row strong',
  ))
}

function translateExact(value, language) {
  const source = String(value)
  const leading = source.match(/^\s*/)?.[0] ?? ''
  const trailing = source.match(/\s*$/)?.[0] ?? ''
  const text = source.trim()
  if (!text) return source
  const translated = language === 'en'
    ? localeData.ui[text] ?? translateDynamicText(text, language)
    : englishToChineseUi[text] ?? translateDynamicText(text, language)
  return translated === text ? source : `${leading}${translated}${trailing}`
}

export function translateInterface(root, language) {
  if (!root) return
  document.documentElement.lang = localeData.languages[language]?.htmlLang ?? 'zh-CN'
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes = []
  while (walker.nextNode()) textNodes.push(walker.currentNode)
  textNodes.forEach((node) => {
    if (shouldSkipNode(node)) return
    const translated = translateExact(node.nodeValue, language)
    if (translated !== node.nodeValue) node.nodeValue = translated
  })
  root.querySelectorAll('[placeholder], [title], [aria-label]').forEach((element) => {
    if (shouldSkipNode(element)) return
    ;['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      if (!element.hasAttribute(attribute)) return
      const current = element.getAttribute(attribute)
      const translated = translateExact(current, language)
      if (translated !== current) element.setAttribute(attribute, translated)
    })
  })
}
