import { TreeNode, PositionedNode, Edge } from '@/types/tree';

const RADII = [0, 250, 450, 600, 720];
const DEFAULT_COLOR = '#888888';

function countLeaves(node: TreeNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, c) => sum + countLeaves(c), 0);
}

function resolveColor(node: TreeNode, parentColor: string): string {
  return node.color || parentColor;
}

function nodeWidth(title: string, isRoot: boolean): number {
  if (isRoot) return 120;
  const w = title.length * 8 + 20;
  return Math.max(80, Math.min(w, 200));
}

function nodeHeight(isRoot: boolean): number {
  return isRoot ? 50 : 36;
}

export function layoutTree(tree: TreeNode): { nodes: PositionedNode[]; edges: Edge[] } {
  const nodes: PositionedNode[] = [];
  const edges: Edge[] = [];
  let idCounter = 0;

  function place(
    node: TreeNode,
    x: number,
    y: number,
    depth: number,
    angleStart: number,
    angleEnd: number,
    parentColor: string,
  ) {
    const color = resolveColor(node, parentColor);
    const isRoot = depth === 0;
    const w = nodeWidth(node.title, isRoot);
    const h = nodeHeight(isRoot);
    const id = node.id || `node-${idCounter++}`;

    nodes.push({ id, title: node.title, icon: node.icon, color, x, y, width: w, height: h });

    if (!node.children || node.children.length === 0) return;

    const radius = RADII[Math.min(depth + 1, RADII.length - 1)];
    const totalLeaves = node.children.reduce((s, c) => s + countLeaves(c), 0);
    let currentAngle = angleStart;

    for (const child of node.children) {
      const childLeaves = countLeaves(child);
      const share = (childLeaves / totalLeaves) * (angleEnd - angleStart);
      const midAngle = currentAngle + share / 2;
      const cx = x + radius * Math.cos(midAngle);
      const cy = y + radius * Math.sin(midAngle);

      edges.push({ fromX: x, fromY: y, toX: cx, toY: cy, color: resolveColor(child, color) });

      place(child, cx, cy, depth + 1, currentAngle, currentAngle + share, color);
      currentAngle += share;
    }
  }

  place(tree, 0, 0, 0, 0, 2 * Math.PI, DEFAULT_COLOR);
  return { nodes, edges };
}
