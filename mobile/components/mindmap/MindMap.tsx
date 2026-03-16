import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle as SvgCircle } from 'react-native-svg';

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
  const [viewH, setViewH] = useState(screenH);
  const [debugTaps, setDebugTaps] = useState<Array<{
    raw: { x: number; y: number };       // e.x, e.y from gesture
    inverted: { x: number; y: number };   // after transform inversion
    svg: { x: number; y: number };        // in viewBox coordinates
    tx: number; ty: number; s: number;    // transform state at tap time
  }>>([]);

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

  const layoutRef = useRef<LayoutResult | null>(null);
  layoutRef.current = layout;

  const handleTapDebug = useCallback((
    rawX: number, rawY: number,
    invertedX: number, invertedY: number,
    tx: number, ty: number, s: number,
  ) => {
    const l = layoutRef.current;
    if (!l) return;

    const vbX = l.bounds.minX - VIEWBOX_PAD;
    const vbY = l.bounds.minY - VIEWBOX_PAD;
    const vbW = l.bounds.maxX - l.bounds.minX + VIEWBOX_PAD * 2;
    const vbH = l.bounds.maxY - l.bounds.minY + VIEWBOX_PAD * 2;

    const svgX = vbX + (invertedX / screenW) * vbW;
    const svgY = vbY + (invertedY / viewH) * vbH;

    // Keep last 5 taps for debug
    setDebugTaps((prev) => [
      ...prev.slice(-4),
      {
        raw: { x: rawX, y: rawY },
        inverted: { x: invertedX, y: invertedY },
        svg: { x: svgX, y: svgY },
        tx, ty, s,
      },
    ]);

    for (const node of l.nodes) {
      const hitPad = 4;
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
  }, [screenW, viewH, handleNodePress]);

  const halfW = screenW / 2;
  const halfH = viewH / 2;

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      const tx = translateX.value;
      const ty = translateY.value;
      const s = scale.value;
      const invertedX = (e.x - halfW - tx) / s + halfW;
      const invertedY = (e.y - halfH - ty) / s + halfH;
      runOnJS(handleTapDebug)(e.x, e.y, invertedX, invertedY, tx, ty, s);
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

  const composed = Gesture.Race(
    tapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: halfW + translateX.value },
      { translateY: halfH + translateY.value },
      { scale: scale.value },
      { translateX: -halfW },
      { translateY: -halfH },
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
        <Animated.View
          style={styles.fill}
          onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        >
          <Animated.View style={[{ width: screenW, height: viewH, backgroundColor: '#121212' }, animatedStyle]}>
            <Svg
              width={screenW}
              height={viewH}
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
            >
              {edges.map((edge, i) => (
                <MindMapEdge key={`e-${i}`} edge={edge} />
              ))}
              {nodes.map((node) => (
                <MindMapNode key={node.id} node={node} />
              ))}
              {/* Debug: blue circles at computed SVG coordinates */}
              {debugTaps.map((tap, i) => (
                <SvgCircle
                  key={`debug-svg-${i}`}
                  cx={tap.svg.x}
                  cy={tap.svg.y}
                  r={8}
                  fill="blue"
                  opacity={0.8}
                />
              ))}
            </Svg>
          </Animated.View>
          {/* Debug overlay: shows raw + computed coords */}
          <View style={styles.debugOverlay} pointerEvents="none">
            {debugTaps.slice(-3).map((tap, i) => (
              <ThemedText key={`debug-${i}`} style={styles.debugText}>
                raw=({Math.round(tap.raw.x)},{Math.round(tap.raw.y)})
                inv=({Math.round(tap.inverted.x)},{Math.round(tap.inverted.y)})
                svg=({Math.round(tap.svg.x)},{Math.round(tap.svg.y)})
                t=({Math.round(tap.tx)},{Math.round(tap.ty)}) s={tap.s.toFixed(2)}
              </ThemedText>
            ))}
          </View>
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
  debugOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 6,
    borderRadius: 6,
  },
  debugText: {
    fontSize: 10,
    color: '#0f0',
    fontFamily: 'monospace',
  },
});
