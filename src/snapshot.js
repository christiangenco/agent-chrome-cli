/**
 * Snapshot engine — converts CDP's Accessibility.getFullAXTree() into a
 * compact, agent-friendly text representation with clickable refs.
 *
 * Output format matches agent-browser:
 *   - heading "Example Domain" [ref=e1] [level=1]
 *   - paragraph: Some text content
 *   - button "Submit" [ref=e2]
 *   - textbox "Email" [ref=e3]
 */

/** Roles that are interactive and should get refs */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'searchbox',
  'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);

/** Roles that provide structure/context (get refs for text extraction) */
const CONTENT_ROLES = new Set([
  'heading', 'cell', 'gridcell', 'columnheader', 'rowheader',
  'listitem', 'article', 'region', 'main', 'navigation',
]);

/** Roles that are purely structural (can be filtered in compact mode) */
const STRUCTURAL_ROLES = new Set([
  'generic', 'group', 'list', 'table', 'row', 'rowgroup', 'grid',
  'treegrid', 'menu', 'menubar', 'toolbar', 'tablist', 'tree',
  'directory', 'document', 'application', 'presentation', 'none',
  'Section', 'LabelText', 'section', 'label',
]);

/** Roles to always skip — they're noise */
const SKIP_ROLES = new Set([
  'InlineTextBox', 'LineBreak', 'RootWebArea', 'listMarker',
]);

/**
 * Normalize CDP role values to lowercase agent-browser-style names.
 * CDP returns things like "StaticText", "RootWebArea" — we want "text", etc.
 */
function normalizeRole(cdpRole) {
  const map = {
    'StaticText': 'text',
    'RootWebArea': 'document',
    'InlineTextBox': null, // skip
    'LineBreak': null,
    'GenericContainer': 'generic',
    'Section': 'section',
    'LabelText': 'label',
    'DescriptionList': 'list',
    'DescriptionListTerm': 'term',
    'DescriptionListDetail': 'definition',
    'WebArea': 'document',
  };
  if (map[cdpRole] !== undefined) return map[cdpRole];
  // Lowercase first letter for standard roles
  return cdpRole.charAt(0).toLowerCase() + cdpRole.slice(1);
}

/**
 * Get a property value from a CDP accessibility node.
 */
function getProp(node, name) {
  if (!node.properties) return undefined;
  const prop = node.properties.find(p => p.name === name);
  return prop?.value?.value;
}

/**
 * Build the accessibility tree from CDP's flat node array.
 * Returns a tree of {role, name, backendDOMNodeId, children, properties, value}.
 */
function buildTree(cdpNodes) {
  const nodeMap = new Map();

  for (const node of cdpNodes) {
    const rawRole = node.role?.value || '';
    const role = normalizeRole(rawRole);
    if (role === null) continue; // skip InlineTextBox, etc.

    nodeMap.set(node.nodeId, {
      nodeId: node.nodeId,
      role,
      rawRole: rawRole,
      name: node.name?.value || '',
      value: node.value?.value || '',
      backendDOMNodeId: node.backendDOMNodeId,
      childIds: node.childIds || [],
      children: [],
      properties: node.properties || [],
      description: node.description?.value || '',
    });
  }

  // Link children
  for (const node of nodeMap.values()) {
    for (const childId of node.childIds) {
      const child = nodeMap.get(childId);
      if (child) node.children.push(child);
    }
  }

  // Find root (first node, usually RootWebArea)
  if (cdpNodes.length === 0) return null;
  return nodeMap.get(cdpNodes[0].nodeId) || null;
}

/**
 * Collect all text content from a subtree (for showing inline text).
 */
function collectText(node) {
  if (node.role === 'text') return node.name;
  return node.children.map(collectText).filter(Boolean).join(' ');
}

/**
 * Check if a subtree has any interactive elements (for compact mode pruning).
 */
function hasInteractiveDescendant(node) {
  if (INTERACTIVE_ROLES.has(node.role)) return true;
  return node.children.some(hasInteractiveDescendant);
}

/**
 * Check if a subtree has any meaningful content.
 */
function hasMeaningfulContent(node) {
  if (INTERACTIVE_ROLES.has(node.role)) return true;
  if (CONTENT_ROLES.has(node.role) && node.name) return true;
  if (node.role === 'text' && node.name.trim()) return true;
  return node.children.some(hasMeaningfulContent);
}

/**
 * Render the tree to text lines.
 * @param {object} node - Tree node
 * @param {object} refs - Ref map to populate (mutated)
 * @param {object} opts - {interactive, compact, maxDepth}
 * @param {number} depth - Current depth
 * @param {object} counter - {n: number} for ref numbering
 * @returns {string[]} Lines of output
 */
function renderNode(node, refs, opts, depth, counter) {
  if (!node) return [];
  if (SKIP_ROLES.has(node.rawRole)) {
    // Render children of root directly
    if (node.rawRole === 'RootWebArea') {
      return node.children.flatMap(c => renderNode(c, refs, opts, depth, counter));
    }
    return [];
  }

  // Max depth check
  if (opts.maxDepth !== undefined && depth > opts.maxDepth) return [];

  const role = node.role;
  const name = node.name;
  const isInteractive = INTERACTIVE_ROLES.has(role);
  const isContent = CONTENT_ROLES.has(role);
  const isStructural = STRUCTURAL_ROLES.has(role) || role === 'section' || role === 'label';
  const isText = role === 'text';

  // Interactive-only mode: skip non-interactive subtrees for rendering,
  // but still descend to find interactive elements
  if (opts.interactive) {
    if (isInteractive) {
      const ref = `e${++counter.n}`;
      refs[ref] = { backendDOMNodeId: node.backendDOMNodeId, role, name };
      const indent = '  '.repeat(depth);
      const namePart = name ? ` "${name}"` : '';
      let line = `${indent}- ${role}${namePart} [ref=${ref}]`;
      // Add extra info
      const extra = getExtraInfo(node);
      if (extra) line += ` ${extra}`;
      // Show current value for inputs
      if (node.value) line += `: ${node.value}`;
      return [line];
    }
    // Not interactive — descend but don't render this node
    return node.children.flatMap(c => renderNode(c, refs, opts, 0, counter));
  }

  // Compact mode: skip unnamed structural elements
  if (opts.compact && (isStructural || role === 'none') && !name) {
    if (!hasMeaningfulContent(node)) return [];
    // Has content — render children at this same depth (skip the wrapper)
    return node.children.flatMap(c => renderNode(c, refs, opts, depth, counter));
  }

  const indent = '  '.repeat(depth);
  const lines = [];

  // Text nodes: just show the text inline
  if (isText) {
    const text = name.trim();
    if (!text) return [];
    // In compact mode, skip text nodes that duplicate their parent's name
    // (e.g., link "Foo" > text "Foo" is redundant)
    if (opts.compact && opts._parentName && text === opts._parentName.trim()) return [];
    lines.push(`${indent}- text: ${text}`);
    return lines;
  }

  // Build the line for this node
  const shouldHaveRef = isInteractive || (isContent && name);
  let refStr = '';
  if (shouldHaveRef) {
    const ref = `e${++counter.n}`;
    refs[ref] = { backendDOMNodeId: node.backendDOMNodeId, role, name };
    refStr = ` [ref=${ref}]`;
  }

  const namePart = name ? ` "${name}"` : '';
  const extra = getExtraInfo(node);
  const extraStr = extra ? ` ${extra}` : '';

  // Check if all children are just text — if so, collapse to single line
  const childTexts = node.children.filter(c => c.role === 'text' && c.name.trim());
  const otherChildren = node.children.filter(c => c.role !== 'text' || !c.name.trim());
  const allChildrenAreText = otherChildren.length === 0 && childTexts.length > 0;

  if (allChildrenAreText && !isInteractive) {
    const text = childTexts.map(c => c.name.trim()).join(' ');
    lines.push(`${indent}- ${role}${namePart}${refStr}${extraStr}: ${text}`);
  } else if (node.value && isInteractive) {
    // Show current value for inputs
    lines.push(`${indent}- ${role}${namePart}${refStr}${extraStr}: ${node.value}`);
    // Still render non-text children
    const childOpts2 = opts.compact && name ? { ...opts, _parentName: name } : opts;
    for (const child of node.children) {
      if (child.role !== 'text') {
        lines.push(...renderNode(child, refs, childOpts2, depth + 1, counter));
      }
    }
  } else {
    lines.push(`${indent}- ${role}${namePart}${refStr}${extraStr}`);
    const childOpts = opts.compact && name ? { ...opts, _parentName: name } : opts;
    for (const child of node.children) {
      lines.push(...renderNode(child, refs, childOpts, depth + 1, counter));
    }
  }

  return lines;
}

/**
 * Get extra info string for a node (level, checked, etc.)
 */
function getExtraInfo(node) {
  const parts = [];
  const level = getProp(node, 'level');
  if (level !== undefined) parts.push(`[level=${level}]`);

  const checked = getProp(node, 'checked');
  if (checked !== undefined) parts.push(`[${checked === 'true' || checked === true ? 'checked' : 'unchecked'}]`);

  const selected = getProp(node, 'selected');
  if (selected === true || selected === 'true') parts.push('[selected]');

  const expanded = getProp(node, 'expanded');
  if (expanded !== undefined) parts.push(`[${expanded === true || expanded === 'true' ? 'expanded' : 'collapsed'}]`);

  const required = getProp(node, 'required');
  if (required === true || required === 'true') parts.push('[required]');

  const disabled = getProp(node, 'disabled');
  if (disabled === true || disabled === 'true') parts.push('[disabled]');

  return parts.join(' ');
}

/**
 * Get an enhanced snapshot of the page.
 * @param {CDP.Client} client - CDP client connected to a tab
 * @param {object} opts - {interactive?: boolean, compact?: boolean, maxDepth?: number, selector?: string}
 * @returns {Promise<{tree: string, refs: Record<string, {backendDOMNodeId: number, role: string, name: string}>}>}
 */
export async function getSnapshot(client, opts = {}) {
  const { Accessibility } = client;

  const { nodes } = await Accessibility.getFullAXTree();
  const root = buildTree(nodes);

  if (!root) {
    return { tree: '(empty page)', refs: {} };
  }

  const refs = {};
  const counter = { n: 0 };
  const lines = renderNode(root, refs, opts, 0, counter);

  const tree = lines.join('\n') || '(empty page)';
  return { tree, refs };
}
