import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { API_BASE_URL } from '@/constants/api';
import { ThemedText } from '@/components/ThemedText';
import { TreeNode } from '@/types/tree';
import { layoutTree } from './layout';
import MindMapEdge from './MindMapEdge';
import MindMapNode from './MindMapNode';

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
        // Root is always expanded, plus any default_expanded nodes
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

  const composed = Gesture.Simultaneous(panGesture, pinchGesture);

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
  const pad = 40;
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const vbW = bounds.maxX - bounds.minX + pad * 2;
  const vbH = bounds.maxY - bounds.minY + pad * 2;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={composed}>
        <Animated.View style={[styles.fill, animatedStyle]}>
          <Svg
            width={screenW}
            height={screenH}
            viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          >
            {edges.map((edge, i) => (
              <MindMapEdge key={`e-${i}`} edge={edge} />
            ))}
            {nodes.map((node) => (
              <MindMapNode key={node.id} node={node} onPress={handleNodePress} />
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
