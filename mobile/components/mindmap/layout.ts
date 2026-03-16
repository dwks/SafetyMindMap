import { TreeNode, PositionedNode, Edge } from '@/types/tree';

const H_GAP = 160;
const V_PADDING = 10;
const DEFAULT_COLOR = '#888888';

function nodeWidth(title: string, isRoot: boolean): number {
  if (isRoot) return 140;
  const w = title.length * 8 + 24;
  return Math.max(80, Math.min(w, 200));
}

function nodeHeight(isRoot: boolean): number {
  return isRoot ? 50 : 36;
}

function resolveColor(node: TreeNode, parentColor: string): string {
  return node.color || parentColor;
}

function assignIds(node: TreeNode, counter = { value: 0 }): void {
  if (!node.id) node.id = `node-${counter.value++}`;
  if (node.children) {
    for (const child of node.children) assignIds(child, counter);
  }
}

function measureSubtree(node: TreeNode, expandedSet: Set<string>): number {
  const isRoot = !node.color && node.id === node.id; // always measure
  const h = nodeHeight(false); // leaf/collapsed height

  if (!node.children || node.children.length === 0) return h;
  if (!expandedSet.has(node.id!)) return h;

  let total = 0;
  for (const child of node.children) {
    if (total > 0) total += V_PADDING;
    total += measureSubtree(child, expandedSet);
  }
  return Math.max(h, total);
}

export interface LayoutResult {
  nodes: PositionedNode[];
  edges: Edge[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export function layoutTree(tree: TreeNode, expandedIds: Set<string>): LayoutResult {
  assignIds(tree);

  const nodes: PositionedNode[] = [];
  const edges: Edge[] = [];

  const rootW = nodeWidth(tree.title, true);
  const rootH = nodeHeight(true);
  const isRootExpanded = expandedIds.has(tree.id!);
  const hasChildren = !!(tree.children && tree.children.length > 0);

  nodes.push({
    id: tree.id!,
    title: tree.title,
    icon: tree.icon,
    color: resolveColor(tree, DEFAULT_COLOR),
    x: 0,
    y: 0,
    width: rootW,
    height: rootH,
    hasChildren,
    isExpanded: isRootExpanded,
    side: 'root',
    depth: 0,
  });

  if (!hasChildren || !isRootExpanded) {
    return { nodes, edges, bounds: { minX: -rootW / 2, maxX: rootW / 2, minY: -rootH / 2, maxY: rootH / 2 } };
  }

  const children = tree.children!;
  const mid = Math.ceil(children.length / 2);
  const rightChildren = children.slice(0, mid);
  const leftChildren = children.slice(mid);

  const rootColor = resolveColor(tree, DEFAULT_COLOR);

  // Layout right side
  const rightStartX = rootW / 2 + H_GAP;
  layoutSide(rightChildren, rightStartX, 'right', rootColor, 0, rootH, tree.id!, rootW, expandedIds, nodes, edges);

  // Layout left side
  const leftStartX = -rootW / 2 - H_GAP;
  layoutSide(leftChildren, leftStartX, 'left', rootColor, 0, rootH, tree.id!, rootW, expandedIds, nodes, edges);

  // Compute bounds
  let minX = -rootW / 2, maxX = rootW / 2, minY = -rootH / 2, maxY = rootH / 2;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.width / 2);
    maxX = Math.max(maxX, n.x + n.width / 2);
    minY = Math.min(minY, n.y - n.height / 2);
    maxY = Math.max(maxY, n.y + n.height / 2);
  }

  return { nodes, edges, bounds: { minX, maxX, minY, maxY } };
}

function layoutSide(
  children: TreeNode[],
  startX: number,
  side: 'left' | 'right',
  parentColor: string,
  parentY: number,
  parentH: number,
  parentId: string,
  parentW: number,
  expandedIds: Set<string>,
  nodes: PositionedNode[],
  edges: Edge[],
) {
  // Measure total height needed for this group
  let totalHeight = 0;
  const heights: number[] = [];
  for (const child of children) {
    const h = measureSubtree(child, expandedIds);
    heights.push(h);
    totalHeight += h;
  }
  totalHeight += (children.length - 1) * V_PADDING;

  // Stack children centered on parentY
  let currentY = parentY - totalHeight / 2;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const subtreeH = heights[i];
    const childCenterY = currentY + subtreeH / 2;

    placeSubtree(child, startX, childCenterY, side, parentColor, 1, parentId, parentW, parentY, expandedIds, nodes, edges);

    currentY += subtreeH + V_PADDING;
  }
}

function placeSubtree(
  node: TreeNode,
  x: number,
  yCenter: number,
  side: 'left' | 'right',
  parentColor: string,
  depth: number,
  parentId: string,
  parentW: number,
  parentY: number,
  expandedIds: Set<string>,
  nodes: PositionedNode[],
  edges: Edge[],
) {
  const color = resolveColor(node, parentColor);
  const w = nodeWidth(node.title, false);
  const h = nodeHeight(false);
  const hasChildren = !!(node.children && node.children.length > 0);
  const isExpanded = expandedIds.has(node.id!);

  // x is the parent-facing edge; compute center from it
  const centerX = side === 'right' ? x + w / 2 : x - w / 2;

  nodes.push({
    id: node.id!,
    title: node.title,
    icon: node.icon,
    color,
    x: centerX,
    y: yCenter,
    width: w,
    height: h,
    hasChildren,
    isExpanded,
    side,
    depth,
  });

  // Edge from parent edge to this node's parent-facing edge
  const parentNode = nodes.find(n => n.id === parentId);
  const startX = parentNode
    ? side === 'right'
      ? parentNode.x + parentNode.width / 2
      : parentNode.x - parentNode.width / 2
    : 0;

  edges.push({
    startX,
    startY: parentY,
    endX: x,
    endY: yCenter,
    color,
    side,
  });

  // Place children if expanded
  if (!hasChildren || !isExpanded) return;

  const children = node.children!;
  let totalHeight = 0;
  const heights: number[] = [];
  for (const child of children) {
    const ch = measureSubtree(child, expandedIds);
    heights.push(ch);
    totalHeight += ch;
  }
  totalHeight += (children.length - 1) * V_PADDING;

  // nextX is the parent-facing edge for the next level of children
  const nextX = side === 'right' ? x + w + H_GAP : x - w - H_GAP;
  let currentY = yCenter - totalHeight / 2;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const subtreeH = heights[i];
    const childCenterY = currentY + subtreeH / 2;

    placeSubtree(child, nextX, childCenterY, side, color, depth + 1, node.id!, w, yCenter, expandedIds, nodes, edges);

    currentY += subtreeH + V_PADDING;
  }
}
