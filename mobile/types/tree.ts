export interface TreeNode {
  id?: string;
  title: string;
  subtitle?: string;
  description?: string;
  url?: string;
  icon?: string;
  color?: string;
  default_expanded?: boolean;
  children?: TreeNode[];
}

export interface PositionedNode {
  id: string;
  title: string;
  icon?: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasChildren: boolean;
  isExpanded: boolean;
  side: 'left' | 'right' | 'root';
  depth: number;
  opacity?: number;
}

export interface Edge {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color: string;
  side: 'left' | 'right';
  opacity?: number;
}
