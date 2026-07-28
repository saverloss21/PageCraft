import { readFile } from 'node:fs/promises'

const sourceUrl = new URL('../src/data/app-data.json', import.meta.url)
const localeSourceUrl = new URL('../src/data/i18n.json', import.meta.url)
const data = JSON.parse(await readFile(sourceUrl, 'utf8'))
const localeData = JSON.parse(await readFile(localeSourceUrl, 'utf8'))
const errors = []

function requireArray(value, path) {
  if (!Array.isArray(value)) {
    errors.push(`${path} 必须是数组`)
    return []
  }
  return value
}

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path} 必须是对象`)
    return {}
  }
  return value
}

function checkUnique(items, field, path) {
  const seen = new Set()
  items.forEach((item, index) => {
    const value = item?.[field]
    if (typeof value !== 'string' || !value.trim()) errors.push(`${path}[${index}].${field} 不能为空`)
    else if (seen.has(value)) errors.push(`${path} 中存在重复的 ${field}: ${value}`)
    else seen.add(value)
  })
  return seen
}

const components = requireArray(data.components, 'components')
const componentTypes = checkUnique(components, 'type', 'components')
const allowedIcons = new Set(['layout', 'sparkles', 'pointer', 'image', 'type'])
components.forEach((component, index) => {
  if (!component.label || !component.note) errors.push(`components[${index}] 缺少 label 或 note`)
  if (!allowedIcons.has(component.icon)) errors.push(`components[${index}].icon 不受支持: ${component.icon}`)
})

const languages = requireObject(localeData.languages, 'i18n.languages')
if (!languages.zh || !languages.en) errors.push('i18n.languages 必须包含 zh 和 en')
if (!localeData.storageKey) errors.push('i18n.storageKey 不能为空')
const localizedComponents = requireObject(localeData.components, 'i18n.components')
componentTypes.forEach((type) => {
  const translation = requireObject(localizedComponents[type], `i18n.components.${type}`)
  if (!translation.label || !translation.note) errors.push(`i18n.components.${type} 缺少英文 label 或 note`)
})
const localizedOptions = requireObject(localeData.options, 'i18n.options')
Object.entries(requireObject(data.editorOptions, 'editorOptions')).forEach(([group, options]) => {
  if (!Array.isArray(options)) return
  const optionTranslations = requireObject(localizedOptions[group], `i18n.options.${group}`)
  options.forEach(([value]) => {
    if (!optionTranslations[value]) errors.push(`i18n.options.${group} 缺少 ${value} 的英文名称`)
  })
})
if (!Object.keys(requireObject(localeData.ui, 'i18n.ui')).length) errors.push('i18n.ui 不能为空')
if (!Object.keys(requireObject(localeData.content, 'i18n.content')).length) errors.push('i18n.content 不能为空')

const groups = requireArray(data.componentGroups, 'componentGroups')
const groupValues = checkUnique(groups, 'value', 'componentGroups')
const groupTypes = requireObject(data.componentGroupTypes, 'componentGroupTypes')
const groupedTypeCounts = new Map()
Object.entries(groupTypes).forEach(([group, types]) => {
  if (!groupValues.has(group)) errors.push(`componentGroupTypes.${group} 没有对应的组件分类`)
  requireArray(types, `componentGroupTypes.${group}`).forEach((type) => {
    if (!componentTypes.has(type)) errors.push(`componentGroupTypes.${group} 引用了未知区块: ${type}`)
    groupedTypeCounts.set(type, (groupedTypeCounts.get(type) ?? 0) + 1)
  })
})
componentTypes.forEach((type) => {
  const count = groupedTypeCounts.get(type) ?? 0
  if (count === 0) errors.push(`组件 ${type} 没有被分配到任何分类`)
  if (count > 1) errors.push(`组件 ${type} 被重复分配到 ${count} 个分类`)
})

const recipes = requireArray(data.visualRecipes, 'visualRecipes')
checkUnique(recipes, 'id', 'visualRecipes')
const recipeEnums = {
  visualPreset: new Set(['none', 'gradient', 'dark', 'glass', 'editorial']),
  layoutVariant: new Set(['default', 'centered', 'offset', 'poster', 'frame', 'diagonal']),
  decoration: new Set(['none', 'orbs', 'grid', 'sparkles', 'labels']),
  material: new Set(['none', 'noise', 'paper', 'scanlines', 'beams', 'mesh']),
  sectionDivider: new Set(['none', 'wave', 'slant', 'curve']),
  effect: new Set(['none', 'fade-up', 'zoom-in', 'blur-in']),
  elementEffect: new Set(['none', 'stagger', 'mask', 'float', 'drift']),
  hoverEffect: new Set(['none', 'lift', 'tilt', 'spotlight', 'glow', 'image-zoom']),
  motionSpeed: new Set(['fast', 'normal', 'slow']),
}
recipes.forEach((recipe, index) => {
  if (!recipe.label) errors.push(`visualRecipes[${index}].label 不能为空`)
  const config = requireObject(recipe.config, `visualRecipes[${index}].config`)
  Object.entries(recipeEnums).forEach(([field, allowed]) => {
    if (config[field] !== undefined && !allowed.has(config[field])) errors.push(`visualRecipes[${index}].config.${field} 不受支持: ${config[field]}`)
  })
  ;['background', 'gradientFrom', 'gradientTo', 'textColor', 'accentColor'].forEach((field) => {
    const color = config.styles?.[field]
    if (color !== undefined && color !== '' && !/^#[0-9a-f]{6}$/i.test(color)) errors.push(`visualRecipes[${index}].config.styles.${field} 颜色格式错误`)
  })
})
const contentRecipes = requireArray(data.contentRecipes, 'contentRecipes')
checkUnique(contentRecipes, 'id', 'contentRecipes')
contentRecipes.forEach((recipe, index) => {
  if (!recipe.label) errors.push(`contentRecipes[${index}].label 不能为空`)
  requireArray(recipe.types, `contentRecipes[${index}].types`).forEach((type) => {
    if (!componentTypes.has(type)) errors.push(`contentRecipes[${index}] 引用了未知区块: ${type}`)
  })
  requireObject(recipe.content, `contentRecipes[${index}].content`)
})

const themes = requireArray(data.themes, 'themes')
const themeValues = checkUnique(themes, 'value', 'themes')
themes.forEach((theme, index) => {
  if (!/^#[0-9a-f]{6}$/i.test(theme.accent ?? '')) errors.push(`themes[${index}].accent 必须是六位十六进制颜色`)
})
if (!themeValues.has(data.defaultPageMeta?.theme)) errors.push('defaultPageMeta.theme 必须引用 themes 中的主题')
const defaultPageMeta = requireObject(data.defaultPageMeta, 'defaultPageMeta')
if (!/^#[0-9a-f]{6}$/i.test(defaultPageMeta.pageBackground ?? '')) errors.push('defaultPageMeta.pageBackground 必须是六位十六进制颜色')
;[
  ['siteWidth', 720, 1920],
  ['sectionGap', 0, 48],
  ['sectionRadius', 0, 48],
].forEach(([field, min, max]) => {
  const value = defaultPageMeta[field]
  if (!Number.isFinite(value) || value < min || value > max) errors.push(`defaultPageMeta.${field} 必须是 ${min} 到 ${max} 之间的数字`)
})

const blockDefaults = requireObject(data.blockDefaults, 'blockDefaults')
const baseBlockDefaults = requireObject(blockDefaults.base, 'blockDefaults.base')
requireArray(blockDefaults.contentResetFields, 'blockDefaults.contentResetFields').forEach((field) => {
  if (!(field in baseBlockDefaults)) errors.push(`blockDefaults.contentResetFields 引用了不存在的基础字段: ${field}`)
})
const typedDefaults = requireObject(blockDefaults.types, 'blockDefaults.types')
Object.keys(typedDefaults).forEach((type) => {
  if (!componentTypes.has(type)) errors.push(`blockDefaults.types 引用了未知区块: ${type}`)
})
const styleDefaults = requireObject(data.styleDefaults, 'styleDefaults')
requireObject(styleDefaults.base, 'styleDefaults.base')
Object.keys(requireObject(styleDefaults.types, 'styleDefaults.types')).forEach((type) => {
  if (!componentTypes.has(type)) errors.push(`styleDefaults.types 引用了未知区块: ${type}`)
})
Object.entries(requireObject(data.itemEditors, 'itemEditors')).forEach(([type, editor]) => {
  if (!componentTypes.has(type)) errors.push(`itemEditors 引用了未知区块: ${type}`)
  if (!editor.label || !Array.isArray(editor.fields) || editor.fields.length < 2) errors.push(`itemEditors.${type} 缺少 label 或 fields`)
})
const newItemDefaults = requireObject(data.newItemDefaults, 'newItemDefaults')
Object.keys(requireObject(newItemDefaults.types, 'newItemDefaults.types')).forEach((type) => {
  if (!componentTypes.has(type)) errors.push(`newItemDefaults.types 引用了未知区块: ${type}`)
})
;['contentTypes', 'metricTypes'].forEach((field) => {
  requireArray(newItemDefaults[field], `newItemDefaults.${field}`).forEach((type) => {
    if (!componentTypes.has(type)) errors.push(`newItemDefaults.${field} 引用了未知区块: ${type}`)
  })
})

const editorOptions = requireObject(data.editorOptions, 'editorOptions')
const sceneTransitions = requireArray(editorOptions.sceneTransitions, 'editorOptions.sceneTransitions')
const sceneTransitionValues = new Set()
sceneTransitions.forEach((option, index) => {
  if (!Array.isArray(option) || option.length < 2 || typeof option[0] !== 'string' || typeof option[1] !== 'string') {
    errors.push(`editorOptions.sceneTransitions[${index}] 必须包含值和名称`)
    return
  }
  if (sceneTransitionValues.has(option[0])) errors.push(`editorOptions.sceneTransitions 存在重复值: ${option[0]}`)
  sceneTransitionValues.add(option[0])
})
if (!sceneTransitionValues.has('none')) errors.push('editorOptions.sceneTransitions 必须包含 none')
const configuredSceneTransition = baseBlockDefaults.sceneTransition
if (!sceneTransitionValues.has(configuredSceneTransition)) errors.push('blockDefaults.base.sceneTransition 必须引用 editorOptions.sceneTransitions')

requireArray(data.initialBlocks, 'initialBlocks').forEach((block, index) => {
  if (!componentTypes.has(block.type)) errors.push(`initialBlocks[${index}] 引用了未知区块: ${block.type}`)
})

const templates = requireArray(data.templates, 'templates')
checkUnique(templates, 'id', 'templates')
templates.forEach((template, templateIndex) => {
  if (!themeValues.has(template.theme)) errors.push(`templates[${templateIndex}].theme 不受支持: ${template.theme}`)
  requireArray(template.blocks, `templates[${templateIndex}].blocks`).forEach((block, blockIndex) => {
    if (!componentTypes.has(block.type)) errors.push(`templates[${templateIndex}].blocks[${blockIndex}] 引用了未知区块: ${block.type}`)
  })
})

if (!Number.isInteger(data.schemaVersion) || data.schemaVersion < 1) errors.push('schemaVersion 必须是正整数')
if (!data.storage?.draftKey || !data.storage?.blockLibraryKey) errors.push('storage 缺少草稿或区块库键名')

if (errors.length) {
  console.error(`PageCraft 数据校验失败（${errors.length} 项）：`)
  errors.forEach((error) => console.error(`- ${error}`))
  process.exitCode = 1
} else {
  console.log(`PageCraft 数据校验通过：${components.length} 个组件、${templates.length} 个模板、${recipes.length} 套视觉配方、${contentRecipes.length} 套内容配方、${Object.keys(languages).length} 种界面语言。`)
}
