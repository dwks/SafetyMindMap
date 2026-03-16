import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { API_BASE_URL } from '@/constants/api';
import { ThemedText } from '@/components/ThemedText';
import { TreeNode } from '@/types/tree';
import { layoutTree, LayoutResult } from './layout';
import MindMapEdge from './MindMapEdge';
import MindMapNode from './MindMapNode';

const VIEWBOX_PAD = 40;

function collectDefaultExpanded(node: TreeNode, set: Set<string>): void {
  if (node.default_expanded && node.id) set.add(node.id);
  if (node.children) {
    for (const child of node.children) collectDefaultExpanded(child, set);
  }
}

function assignIds(node: TreeNode, counter = { value: 0 }): void {
  if (!node.id) node.id = `node-${counter.value++}`;
  if (node.children) {
    for (const child of node.children) assignIds(child, counter);
  }
}

export default function MindMap() {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/tree`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: TreeNode) => {
        assignIds(data);
        const initial = new Set<string>();
        if (data.id) initial.add(data.id);
        collectDefaultExpanded(data, initial);
        setExpandedIds(initial);
        setTree(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  const handleNodePress = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const layout = useMemo(() => {
    if (!tree) return null;
    return layoutTree(tree, expandedIds);
  }, [tree, expandedIds]);

  // Keep layout in a ref so the tap handler always has current data
  const layoutRef = useRef<LayoutResult | null>(null);
  layoutRef.current = layout;

  // Hit-test tap against nodes, mapping screen coords to SVG viewBox coords
  const handleTap = useCallback((absX: number, absY: number) => {
    const l = layoutRef.current;
    if (!l) return;

    const vbX = l.bounds.minX - VIEWBOX_PAD;
    const vbY = l.bounds.minY - VIEWBOX_PAD;
    const vbW = l.bounds.maxX - l.bounds.minX + VIEWBOX_PAD * 2;
    const vbH = l.bounds.maxY - l.bounds.minY + VIEWBOX_PAD * 2;

    // Map screen point to SVG viewBox coordinates
    const svgX = vbX + (absX / screenW) * vbW;
    const svgY = vbY + (absY / screenH) * vbH;

    for (const node of l.nodes) {
      const hitPad = 4; // extra tap target padding
      if (
        svgX >= node.x - node.width / 2 - hitPad &&
        svgX <= node.x + node.width / 2 + hitPad &&
        svgY >= node.y - node.height / 2 - hitPad &&
        svgY <= node.y + node.height / 2 + hitPad
      ) {
        handleNodePress(node.id);
        return;
      }
    }
  }, [screenW, screenH, handleNodePress]);

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      // e.absoluteX/Y are window coordinates; undo pan/zoom transform
      const localX = (e.absoluteX - translateX.value) / scale.value;
      const localY = (e.absoluteY - translateY.value) / scale.value;
      runOnJS(handleTap)(localX, localY);
    });

  const panGesture = Gesture.Pan()
    .minDistance(10)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(3.0, Math.max(0.3, savedScale.value * e.scale));
    });

  const composed = Gesture.Exclusive(
    tapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  if (error) {
    return (
      <View style={styles.center}>
        <ThemedText>Error: {error}</ThemedText>
      </View>
    );
  }

  if (!tree || !layout) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <ThemedText style={{ marginTop: 12 }}>Loading mind map...</ThemedText>
      </View>
    );
  }

  const { nodes, edges, bounds } = layout;
  const vbX = bounds.minX - VIEWBOX_PAD;
  const vbY = bounds.minY - VIEWBOX_PAD;
  const vbW = bounds.maxX - bounds.minX + VIEWBOX_PAD * 2;
  const vbH = bounds.maxY - bounds.minY + VIEWBOX_PAD * 2;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[{ width: screenW, height: screenH }, animatedStyle]}>
          <Svg
            width={screenW}
            height={screenH}
            viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          >
            {edges.map((edge, i) => (
              <MindMapEdge key={`e-${i}`} edge={edge} />
            ))}
            {nodes.map((node) => (
              <MindMapNode key={node.id} node={node} />
            ))}
          </Svg>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
