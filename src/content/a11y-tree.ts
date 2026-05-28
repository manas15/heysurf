import { A11yNode } from '../shared/types';

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'tab', 'switch', 'slider', 'spinbutton', 'searchbox',
  'option', 'menuitemcheckbox', 'menuitemradio',
]);

const SEMANTIC_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'P', 'LI', 'TD', 'TH', 'IMG', 'LABEL',
  'NAV', 'MAIN', 'HEADER', 'FOOTER', 'ARTICLE', 'SECTION', 'FORM',
  'TABLE', 'SUMMARY', 'DETAILS',
]);

const MAX_NODES = 500;
const MAX_DEPTH = 8;
const MAX_TEXT_LENGTH = 200;

let nodeCounter = 0;

function getAccessibleName(el: Element): string {
  // aria-label takes priority
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((id) => {
      const ref = document.getElementById(id);
      return ref?.textContent?.trim() || '';
    });
    const joined = parts.filter(Boolean).join(' ');
    if (joined) return joined;
  }

  // label[for] for inputs
  if (el.id && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  // Wrapping label
  const parentLabel = el.closest('label');
  if (parentLabel && parentLabel !== el) {
    const labelText = parentLabel.textContent?.trim();
    if (labelText) return labelText.slice(0, MAX_TEXT_LENGTH);
  }

  // placeholder
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.placeholder) return el.placeholder;
  }

  // title
  const title = el.getAttribute('title');
  if (title) return title.trim();

  // alt for images
  if (el instanceof HTMLImageElement && el.alt) return el.alt;

  // text content for simple elements
  const text = el.textContent?.trim();
  if (text) return text.slice(0, MAX_TEXT_LENGTH);

  return '';
}

function getRole(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;

  const tag = el.tagName;
  switch (tag) {
    case 'A': return el.hasAttribute('href') ? 'link' : '';
    case 'BUTTON': return 'button';
    case 'INPUT': {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      if (type === 'search') return 'searchbox';
      if (type === 'range') return 'slider';
      return 'textbox';
    }
    case 'SELECT': return 'combobox';
    case 'TEXTAREA': return 'textbox';
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return 'heading';
    case 'IMG': return 'img';
    case 'NAV': return 'navigation';
    case 'MAIN': return 'main';
    case 'HEADER': return 'banner';
    case 'FOOTER': return 'contentinfo';
    case 'FORM': return 'form';
    case 'TABLE': return 'table';
    case 'LI': return 'listitem';
    case 'UL': case 'OL': return 'list';
    case 'P': return 'paragraph';
    case 'ARTICLE': return 'article';
    case 'SECTION': return 'region';
    case 'TD': case 'TH': return 'cell';
    default: return '';
  }
}

function isVisible(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el instanceof HTMLElement) {
    if (el.hidden) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (parseFloat(style.opacity) === 0) return false;
  }
  return true;
}

function isRelevant(el: Element): boolean {
  const role = getRole(el);
  if (INTERACTIVE_ROLES.has(role)) return true;
  if (SEMANTIC_TAGS.has(el.tagName)) return true;
  if (el.getAttribute('role')) return true;
  if (el.getAttribute('aria-label')) return true;
  if (el.getAttribute('onclick') || el.getAttribute('tabindex')) return true;
  return false;
}

function getValue(el: Element): string | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return undefined;
    return el.value || undefined;
  }
  if (el instanceof HTMLTextAreaElement) return el.value || undefined;
  if (el instanceof HTMLSelectElement) return el.options[el.selectedIndex]?.text || undefined;
  return undefined;
}

function walkDOM(el: Element, depth: number): A11yNode | null {
  if (nodeCounter >= MAX_NODES) return null;
  if (depth > MAX_DEPTH) return null;
  if (!isVisible(el)) return null;

  const role = getRole(el);
  const relevant = isRelevant(el);

  // Walk children first
  const childNodes: A11yNode[] = [];
  for (const child of Array.from(el.children)) {
    const childNode = walkDOM(child, depth + 1);
    if (childNode) childNodes.push(childNode);
  }

  // Skip non-relevant nodes that have no relevant children
  if (!relevant && childNodes.length === 0) return null;

  // If not relevant but has children, promote children (flatten)
  if (!relevant && childNodes.length > 0) {
    if (childNodes.length === 1) return childNodes[0];
    // Create a generic group
    nodeCounter++;
    return {
      id: nodeCounter,
      role: 'group',
      name: '',
      children: childNodes,
    };
  }

  nodeCounter++;
  const node: A11yNode = {
    id: nodeCounter,
    role: role || el.tagName.toLowerCase(),
    name: getAccessibleName(el),
  };

  const value = getValue(el);
  if (value !== undefined) node.value = value;

  if (el === document.activeElement) node.focused = true;

  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') {
      node.checked = el.checked;
    }
  }

  if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
    node.disabled = true;
  }

  const desc = el.getAttribute('aria-description');
  if (desc) node.description = desc;

  if (childNodes.length > 0) {
    node.children = childNodes;
  }

  return node;
}

export function extractA11yTree(): A11yNode[] {
  nodeCounter = 0;
  const root = document.body;
  if (!root) return [];

  const children: A11yNode[] = [];
  for (const child of Array.from(root.children)) {
    const node = walkDOM(child, 0);
    if (node) children.push(node);
  }
  return children;
}

export function treeToString(nodes: A11yNode[]): string {
  const lines: string[] = [];

  function walk(node: A11yNode, indent: number) {
    const pad = '  '.repeat(indent);
    let line = `${pad}[${node.id}] ${node.role}`;
    if (node.name) line += ` "${node.name}"`;
    if (node.value !== undefined) line += ` value="${node.value}"`;
    if (node.focused) line += ' (focused)';
    if (node.checked !== undefined) line += node.checked ? ' (checked)' : ' (unchecked)';
    if (node.disabled) line += ' (disabled)';
    if (node.description) line += ` — ${node.description}`;
    lines.push(line);

    if (node.children) {
      for (const child of node.children) {
        walk(child, indent + 1);
      }
    }
  }

  for (const node of nodes) {
    walk(node, 0);
  }

  return lines.join('\n');
}
