import React from 'react';
import { Path } from 'react-native-svg';
import { Edge } from '@/types/tree';

interface Props {
  edge: Edge;
}

export default function MindMapEdge({ edge }: Props) {
  // Quadratic bezier with control point at midpoint offset toward origin
  const mx = (edge.fromX + edge.toX) / 2;
  const my = (edge.fromY + edge.toY) / 2;

  const d = `M ${edge.fromX} ${edge.fromY} Q ${mx} ${my} ${edge.toX} ${edge.toY}`;

  return (
    <Path
      d={d}
      stroke={edge.color}
      strokeWidth={2}
      strokeOpacity={0.5}
      fill="none"
    />
  );
}
