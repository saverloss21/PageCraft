import appData from './data/app-data.json'

export const cloneConfig = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

export const INITIAL_BLOCKS = cloneConfig(appData.initialBlocks)
export const COMPONENT_DEFINITIONS = cloneConfig(appData.components)
export const COMPONENT_GROUPS = cloneConfig(appData.componentGroups)
export const COMPONENT_GROUP_TYPES = cloneConfig(appData.componentGroupTypes)
export const VISUAL_RECIPE_ITEMS = cloneConfig(appData.visualRecipes)
export const VISUAL_RECIPES = Object.fromEntries(VISUAL_RECIPE_ITEMS.map((recipe) => [recipe.id, recipe.config]))
export const CONTENT_RECIPES = cloneConfig(appData.contentRecipes)
export const PAGE_THEMES = cloneConfig(appData.themes)
export const PAGE_TEMPLATES = cloneConfig(appData.templates)
export const DEFAULT_PAGE_META = cloneConfig(appData.defaultPageMeta)
export const EDITOR_OPTIONS = cloneConfig(appData.editorOptions)
export const ITEM_EDITORS = cloneConfig(appData.itemEditors)
export const CONTENT_RESET_FIELDS = cloneConfig(appData.blockDefaults.contentResetFields)
export const PAGE_SCHEMA_VERSION = appData.schemaVersion
export const DRAFT_STORAGE_KEY = appData.storage.draftKey
export const BLOCK_LIBRARY_STORAGE_KEY = appData.storage.blockLibraryKey
export const BLOCK_LIBRARY_LIMIT = appData.storage.blockLibraryLimit

export function createBlockDefaults(type) {
  return {
    ...cloneConfig(appData.blockDefaults.base),
    ...cloneConfig(appData.blockDefaults.types[type] ?? {}),
  }
}

export function createStyleDefaults(type) {
  return {
    ...appData.styleDefaults.base,
    ...(appData.styleDefaults.types[type] ?? {}),
  }
}

export function createNewItem(type) {
  const configured = appData.newItemDefaults.types[type]
  const fallbackKey = appData.newItemDefaults.contentTypes.includes(type)
    ? 'content'
    : appData.newItemDefaults.metricTypes.includes(type) ? 'metric' : 'person'
  return cloneConfig(configured ?? appData.newItemDefaults[fallbackKey])
}

export function itemEditorFor(type) {
  return ITEM_EDITORS[type] ?? { label: '内容项', fields: ['name', 'role'] }
}
