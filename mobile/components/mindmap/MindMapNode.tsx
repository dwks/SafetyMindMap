import React from 'react';
import { G, Rect, Text as SvgText } from 'react-native-svg';
import { PositionedNode } from '@/types/tree';

interface Props {
  node: PositionedNode;
}

export default function MindMapNode({ node }: Props) {
  const label = node.icon ? `${node.icon} ${node.title}` : node.title;
  const fontSize = node.width > 100 ? 14 : 11;

  return (
    <G>
      <Rect
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={8}
        fill={node.color}
      />
      <SvgText
        x={node.x}
        y={node.y + fontSize * 0.35}
        textAnchor="middle"
        fontSize={fontSize}
        fill="white"
        fontWeight="600"
      >
        {label}
      </SvgText>
    </G>
  );
}
