/**
 * Static accessibility scan over renderer `.vue` templates.
 *
 * Parses each SFC template with the Vue compiler and reports patterns that
 * axe-core flags at runtime (button-name, aria-command-name, target-size) or
 * that break the icon conventions (string `mdi-*` icons need the webfont,
 * which VarLens does not ship — the app uses the `mdi-svg` icon set).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { NodeTypes, type ElementNode, type TemplateChildNode } from '@vue/compiler-dom'

export interface ScanFinding {
  file: string
  line: number
  rule: 'string-mdi-icon' | 'unnamed-icon-button' | 'clickable-icon'
  detail: string
}

const NAME_ATTRS = new Set(['aria-label', 'aria-labelledby', 'label', 'title'])
const NON_CONTENT_TAGS = new Set(['v-tooltip', 'v-badge'])

function listVueFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listVueFiles(full))
    else if (entry.endsWith('.vue')) out.push(full)
  }
  return out
}

function attrNames(el: ElementNode): Set<string> {
  const names = new Set<string>()
  for (const p of el.props) {
    if (p.type === NodeTypes.ATTRIBUTE) names.add(p.name)
    else if (p.type === NodeTypes.DIRECTIVE) {
      if (p.name === 'bind' && p.arg?.type === NodeTypes.SIMPLE_EXPRESSION) names.add(p.arg.content)
      if (p.name === 'on' && p.arg?.type === NodeTypes.SIMPLE_EXPRESSION)
        names.add(`@${p.arg.content}`)
    }
  }
  return names
}

function staticAttr(el: ElementNode, name: string): string | undefined {
  for (const p of el.props) {
    if (p.type === NodeTypes.ATTRIBUTE && p.name === name) return p.value?.content ?? ''
  }
  return undefined
}

/** True when the element renders visible text (which then names the button). */
function hasTextContent(children: TemplateChildNode[]): boolean {
  for (const child of children) {
    if (child.type === NodeTypes.TEXT && child.content.trim() !== '') return true
    if (child.type === NodeTypes.INTERPOLATION) return true
    if (child.type === NodeTypes.ELEMENT) {
      if (child.tag === 'v-icon' || NON_CONTENT_TAGS.has(child.tag)) continue
      if (child.tag === 'template' && child.props.some((p) => p.name === 'slot')) continue
      if (hasTextContent(child.children)) return true
    }
  }
  return false
}

function isIconOnlyButton(el: ElementNode, attrs: Set<string>): boolean {
  if (attrs.has('icon')) return !hasTextContent(el.children)
  const iconChildren = el.children.filter((c) => c.type === NodeTypes.ELEMENT && c.tag === 'v-icon')
  return iconChildren.length > 0 && !hasTextContent(el.children)
}

function visit(node: TemplateChildNode, file: string, findings: ScanFinding[]): void {
  if (node.type !== NodeTypes.ELEMENT) return
  const attrs = attrNames(node)
  const line = node.loc.start.line
  const icon = staticAttr(node, 'icon')
  if (icon !== undefined && icon.startsWith('mdi-')) {
    findings.push({ file, line, rule: 'string-mdi-icon', detail: `${node.tag} icon="${icon}"` })
  }
  for (const p of node.props) {
    if (
      p.type === NodeTypes.ATTRIBUTE &&
      /-icon$/.test(p.name) &&
      (p.value?.content ?? '').startsWith('mdi-')
    ) {
      findings.push({
        file,
        line,
        rule: 'string-mdi-icon',
        detail: `${p.name}="${p.value?.content}"`
      })
    }
  }
  if (node.tag === 'v-icon' && node.children.length > 0) {
    const text = node.children.find((c) => c.type === NodeTypes.TEXT)
    if (text && text.type === NodeTypes.TEXT && text.content.trim().startsWith('mdi-')) {
      findings.push({ file, line, rule: 'string-mdi-icon', detail: text.content.trim() })
    }
  }
  if (node.tag === 'v-btn' && isIconOnlyButton(node, attrs)) {
    const named = [...NAME_ATTRS].some((n) => attrs.has(n))
    if (!named) findings.push({ file, line, rule: 'unnamed-icon-button', detail: 'v-btn' })
  }
  if (node.tag === 'v-icon' && (attrs.has('@click') || attrs.has('@click.stop'))) {
    findings.push({ file, line, rule: 'clickable-icon', detail: 'v-icon with @click' })
  }
  for (const child of node.children) visit(child, file, findings)
}

export function scanTemplates(rootDir: string, repoRoot: string): ScanFinding[] {
  const findings: ScanFinding[] = []
  for (const file of listVueFiles(rootDir)) {
    const { descriptor } = parseSfc(readFileSync(file, 'utf8'), { filename: file })
    const ast = descriptor.template?.ast
    if (!ast) continue
    for (const child of ast.children) visit(child, relative(repoRoot, file), findings)
  }
  return findings
}
