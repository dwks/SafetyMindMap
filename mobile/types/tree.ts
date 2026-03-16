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
}

export interface Edge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
}
