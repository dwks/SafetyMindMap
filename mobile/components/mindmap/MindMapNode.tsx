import React from 'react';
import { G, Rect, Text as SvgText, Circle } from 'react-native-svg';
import { PositionedNode } from '@/types/tree';

interface Props {
  node: PositionedNode;
  onPress?: (id: string) => void;
}

export default function MindMapNode({ node, onPress }: Props) {
  const label = node.icon ? `${node.icon} ${node.title}` : node.title;
  const fontSize = node.depth === 0 ? 14 : 11;
  const indicatorRadius = 8;

  // Position expand indicator on the child-facing edge
  const indicatorX =
    node.side === 'left'
      ? node.x - node.width / 2 - indicatorRadius - 2
      : node.x + node.width / 2 + indicatorRadius + 2;
  const indicatorY = node.y;

  const handlePress = () => onPress?.(node.id);

  return (
    <G opacity={node.opacity ?? 1}>
      <Rect
        x={node.x - node.width / 2}
        y={node.y - node.height / 2}
        width={node.width}
        height={node.height}
        rx={8}
        fill={node.color}
        onPress={handlePress}
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
      {node.hasChildren && (
        <>
          <Circle
            cx={indicatorX}
            cy={indicatorY}
            r={indicatorRadius}
            fill={node.color}
            stroke="white"
            strokeWidth={1.5}
            onPress={handlePress}
          />
          <SvgText
            x={indicatorX}
            y={indicatorY + 4}
            textAnchor="middle"
            fontSize={12}
            fill="white"
            fontWeight="bold"
          >
            {node.isExpanded ? '−' : '+'}
          </SvgText>
        </>
      )}
    </G>
  );
}
