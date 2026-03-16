import React from 'react';
import { Path } from 'react-native-svg';
import { Edge } from '@/types/tree';

interface Props {
  edge: Edge;
}

export default function MindMapEdge({ edge }: Props) {
  const cpOffset = Math.abs(edge.endX - edge.startX) * 0.4;

  const d = `M ${edge.startX},${edge.startY} C ${edge.startX + (edge.side === 'right' ? cpOffset : -cpOffset)},${edge.startY} ${edge.endX + (edge.side === 'right' ? -cpOffset : cpOffset)},${edge.endY} ${edge.endX},${edge.endY}`;

  return (
    <Path
      d={d}
      stroke={edge.color}
      strokeWidth={2}
      strokeOpacity={(edge.opacity ?? 1) * 0.5}
      fill="none"
    />
  );
}
