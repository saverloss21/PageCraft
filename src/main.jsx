import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  Eye,
  GripVertical,
  Image,
  LayoutTemplate,
  Link,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  Settings2,
  Sparkles,
  SquareMousePointer,
  Trash2,
  Type,
  Undo2,
  Redo2,
  X,
} from 'lucide-react'
import './styles.css'

const initialBlocks = [
  { id: 'hero', type: 'hero', label: '首屏', title: '把想法，变成一个网站。', description: '无需写代码，从一个空白画布开始，做出属于你的独特页面。', cta: '开始创作' },
  { id: 'feature', type: 'feature', label: '特性区', title: '简单、自由、可分享', description: '像搭积木一样组合内容，随时预览，随时发布。' },
  { id: 'contact', type: 'contact', label: '联系区', title: '准备好开始了吗？', description: '创建你的第一个页面，让灵感被更多人看见。' },
]

const componentItems = [
  { type: 'hero', label: '首屏', icon: LayoutTemplate, note: '标题 + 行动按钮' },
  { type: 'feature', label: '特性区', icon: Sparkles, note: '介绍你的优势' },
  { type: 'image', label: '图片', icon: Image, note: '展示视觉内容' },
  { type: 'text', label: '文字', icon: Type, note: '补充一段内容' },
  { type: 'button', label: '按钮', icon: SquareMousePointer, note: '引导访客行动' },
]

const DRAFT_STORAGE_KEY = 'pagecraft:draft:v1'
const PAGE_SCHEMA_VERSION = 1

function loadDraft() {
  try {
    const stored = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!stored) return initialBlocks
    const document = JSON.parse(stored)
    return Array.isArray(document.blocks) && document.blocks.length > 0 ? document.blocks : initialBlocks
  } catch {
    return initialBlocks
  }
}

function App() {
  const [blocks, setBlocks] = useState(loadDraft)
  const [selectedId, setSelectedId] = useState(() => loadDraft()[0]?.id ?? null)
  const [preview, setPreview] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [saved, setSaved] = useState(false)
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  const selected = useMemo(() => blocks.find((block) => block.id === selectedId) ?? blocks[0], [blocks, selectedId])
  const pageDocument = useMemo(() => ({ version: PAGE_SCHEMA_VERSION, name: '我的第一个网站', blocks }), [blocks])

  useEffect(() => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(pageDocument))
  }, [pageDocument])

  function updateSelected(field, value) {
    setSaved(false)
    setBlocks((current) => current.map((block) => (block.id === selectedId ? { ...block, [field]: value } : block)))
  }

  function addBlock(type) {
    const item = componentItems.find((component) => component.type === type)
    const id = `${type}-${Date.now()}`
    const copy = {
      id,
      type,
      label: item?.label ?? '内容区',
      title: type === 'button' ? '了解更多' : type === 'text' ? '写下你的故事' : '一个新的内容区',
      description: type === 'image' ? '替换成你的图片或作品集。' : '编辑这里的文字，表达你的想法。',
      cta: type === 'button' ? '点击这里' : '开始创作',
    }
    setBlocks((current) => [...current, copy])
    setSelectedId(id)
    setSaved(false)
  }

  function moveSelected(direction) {
    moveBlock(selectedId, direction)
  }

  function moveBlock(blockId, direction) {
    const index = blocks.findIndex((block) => block.id === blockId)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) return
    const next = [...blocks]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    setBlocks(next)
  }

  function removeSelected() {
    if (!selected) return
    const index = blocks.findIndex((block) => block.id === selectedId)
    const nextBlocks = blocks.filter((block) => block.id !== selectedId)
    setBlocks(nextBlocks)
    setSelectedId(nextBlocks[Math.max(0, index - 1)]?.id ?? null)
    setSaved(false)
  }

  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) return
    const fromIndex = blocks.findIndex((block) => block.id === draggedId)
    const toIndex = blocks.findIndex((block) => block.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const next = [...blocks]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setBlocks(next)
    setSelectedId(draggedId)
    setDraggedId(null)
    setDragOverId(null)
    setSaved(false)
  }

  function exportDocument() {
    const blob = new Blob([JSON.stringify(pageDocument, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'pagecraft-page.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function saveDraft() {
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2200)
  }

  if (preview) {
    return (
      <div className="preview-shell">
        <div className="preview-topbar">
          <div className="brand compact"><span className="brand-mark">✦</span><span>PageCraft</span></div>
          <span className="preview-pill"><Eye size={14} /> 预览模式</span>
          <button className="ghost-button" onClick={() => setPreview(false)}><X size={16} /> 返回编辑</button>
        </div>
        <div className="preview-page">
          {blocks.map((block) => <BlockPreview key={block.id} block={block} preview />)}
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
          <div className="project-name">我的第一个网站 <ChevronDown size={14} /></div>
          <span className="status-dot"><span /> 已保存</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="撤销"><Undo2 size={17} /></button>
          <button className="icon-button muted" title="重做"><Redo2 size={17} /></button>
          <div className="divider" />
          <button className="secondary-button" onClick={() => setPreview(true)}><Eye size={16} /> 预览</button>
          <button className="primary-button" onClick={saveDraft}>{saved ? <Check size={16} /> : <Play size={15} />}{saved ? '已保存' : '发布网站'}</button>
          <div className="avatar">你</div>
        </div>
      </header>

      <main className="workspace">
        {leftOpen && <aside className="sidebar left-sidebar">
          <div className="sidebar-heading"><span>添加内容</span><button className="close-panel" onClick={() => setLeftOpen(false)}><PanelLeft size={16} /></button></div>
          <p className="sidebar-hint">点击组件，将它添加到画布中</p>
          <div className="component-grid">
            {componentItems.map(({ type, label, icon: Icon, note }) => (
              <button className="component-card" key={type} onClick={() => addBlock(type)}>
                <span className="component-icon"><Icon size={19} /></span>
                <span className="component-label">{label}</span>
                <span className="component-note">{note}</span>
                <Plus className="component-plus" size={15} />
              </button>
            ))}
          </div>
          <div className="sidebar-tip"><Sparkles size={17} /><div><strong>从灵感开始</strong><span>以后可以让 AI 帮你生成页面</span></div></div>
          <div className="sidebar-bottom"><button className="help-link"><CircleHelp size={16} /> 使用帮助</button><span>v0.1.0</span></div>
        </aside>}

        <section className="canvas-area">
          {!leftOpen && <button className="floating-panel-button left" onClick={() => setLeftOpen(true)}><PanelLeft size={17} /></button>}
          {!rightOpen && <button className="floating-panel-button right" onClick={() => setRightOpen(true)}><PanelRight size={17} /></button>}
          <div className="canvas-toolbar"><span className="canvas-label"><MousePointer2 size={14} /> 画布</span><span className="device-switcher"><button className="active">桌面端</button><button>移动端</button></span><span className="zoom">100%</span></div>
          <div className="canvas-scroll">
            <div className="website-canvas">
              {blocks.map((block) => <BlockPreview key={block.id} block={block} selected={!preview && block.id === selectedId} dragging={draggedId === block.id} dragOver={dragOverId === block.id} onClick={() => setSelectedId(block.id)} onDragStart={() => setDraggedId(block.id)} onDragOver={() => setDragOverId(block.id)} onDrop={() => handleDrop(block.id)} onDragEnd={() => { setDraggedId(null); setDragOverId(null) }} />)}
              <button className="canvas-add" onClick={() => addBlock('text')}><Plus size={16} /> 添加内容区</button>
            </div>
          </div>
        </section>

        {rightOpen && <aside className="sidebar right-sidebar">
          <div className="sidebar-heading"><span>属性</span><button className="close-panel" onClick={() => setRightOpen(false)}><PanelRight size={16} /></button></div>
          <div className="selected-info"><span className="selected-icon"><Settings2 size={15} /></span><div><strong>{selected?.label ?? '内容区'}</strong><span>已选中区块</span></div><button className="more-button" title="删除区块" onClick={removeSelected}><Trash2 size={15} /></button></div>
          <div className="inspector-section"><label>内容</label><div className="field"><span>标题</span><input value={selected?.title ?? ''} onChange={(event) => updateSelected('title', event.target.value)} /></div><div className="field textarea-field"><span>描述</span><textarea value={selected?.description ?? ''} onChange={(event) => updateSelected('description', event.target.value)} rows="3" /></div>{selected?.type !== 'text' && <div className="field"><span>按钮文字</span><input value={selected?.cta ?? ''} onChange={(event) => updateSelected('cta', event.target.value)} /></div>}</div>
          <div className="inspector-section"><label>样式</label><div className="field-row"><div className="field"><span>背景</span><div className="color-input"><i /><span>#F5F7FF</span></div></div><div className="field"><span>圆角</span><div className="unit-input"><span>16</span><em>px</em></div></div></div><div className="field"><span>对齐方式</span><div className="align-options"><button className="active">左</button><button>中</button><button>右</button></div></div></div>
          <div className="inspector-section layer-actions"><label>区块位置</label><button onClick={() => moveSelected(-1)}><ArrowUp size={15} /> 向上移动</button><button onClick={() => moveSelected(1)}><ArrowDown size={15} /> 向下移动</button></div>
          <div className="sidebar-bottom"><button className="help-link" onClick={exportDocument}><Link size={16} /> 导出 JSON</button><button className="help-link"><Eye size={16} /> SEO 设置</button></div>
        </aside>}
      </main>
    </div>
  )
}

function BlockPreview({ block, selected, onClick, preview, dragging, dragOver, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const className = `website-block block-${block.type} ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${dragOver ? 'is-drop-target' : ''}`
  return <section className={className} draggable={!preview} onClick={onClick} onDragStart={onDragStart} onDragOver={(event) => { event.preventDefault(); onDragOver?.() }} onDrop={(event) => { event.preventDefault(); onDrop?.() }} onDragEnd={onDragEnd}>
    {selected && <span className="selection-tag">{block.label}</span>}
    {!preview && <span className="drag-handle" title="拖拽排序"><GripVertical size={15} /></span>}
    {block.type === 'image' ? <div className="image-placeholder"><Image size={30} /><span>点击替换图片</span></div> : <div className="block-content"><span className="eyebrow">{block.type === 'hero' ? 'WELCOME TO PAGECRAFT' : block.type === 'contact' ? 'LET’S CREATE' : 'WHY PAGECRAFT'}</span><h1>{block.title}</h1><p>{block.description}</p>{block.type !== 'text' && <button className="block-cta">{block.cta}<span>↗</span></button>}</div>}
    {preview && block.type === 'hero' && <div className="hero-orb orb-one" />}
    {preview && block.type === 'hero' && <div className="hero-orb orb-two" />}
  </section>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
