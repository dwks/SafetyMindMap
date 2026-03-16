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
    ex: number; ey: number;               // e.x, e.y from gesture
    absX: number; absY: number;           // e.absoluteX, e.absoluteY
    svgInverted: { x: number; y: number };  // blue: with transform inversion
    svgDirect: { x: number; y: number };    // red: raw e.x/e.y mapped directly
    tx: number; ty: number; s: number;
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

  const computeViewBox = useCallback((l: LayoutResult) => {
    const contentW = l.bounds.maxX - l.bounds.minX + VIEWBOX_PAD * 2;
    const contentH = l.bounds.maxY - l.bounds.minY + VIEWBOX_PAD * 2;
    const aspect = screenW / viewH;
    const cAspect = contentW / contentH;
    if (aspect > cAspect) {
      const vbH = contentH;
      const vbW = contentH * aspect;
      return { vbX: l.bounds.minX - VIEWBOX_PAD - (vbW - contentW) / 2, vbY: l.bounds.minY - VIEWBOX_PAD, vbW, vbH };
    } else {
      const vbW = contentW;
      const vbH = contentW / aspect;
      return { vbX: l.bounds.minX - VIEWBOX_PAD, vbY: l.bounds.minY - VIEWBOX_PAD - (vbH - contentH) / 2, vbW, vbH };
    }
  }, [screenW, viewH]);

  const handleTapDebug = useCallback((
    ex: number, ey: number,
    absX: number, absY: number,
    invertedX: number, invertedY: number,
    tx: number, ty: number, s: number,
  ) => {
    const l = layoutRef.current;
    if (!l) return;

    const { vbX, vbY, vbW, vbH } = computeViewBox(l);

    // Blue: with transform inversion
    const svgInvX = vbX + (invertedX / screenW) * vbW;
    const svgInvY = vbY + (invertedY / viewH) * vbH;

    // Red: raw e.x/e.y mapped directly (no inversion)
    const svgDirX = vbX + (ex / screenW) * vbW;
    const svgDirY = vbY + (ey / viewH) * vbH;

    setDebugTaps((prev) => [
      ...prev.slice(-4),
      {
        ex, ey, absX, absY,
        svgInverted: { x: svgInvX, y: svgInvY },
        svgDirect: { x: svgDirX, y: svgDirY },
        tx, ty, s,
      },
    ]);
  }, [screenW, viewH, computeViewBox]);

  const halfW = screenW / 2;
  const halfH = viewH / 2;

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      const tx = translateX.value;
      const ty = translateY.value;
      const s = scale.value;
      const invertedX = (e.x - halfW - tx) / s + halfW;
      const invertedY = (e.y - halfH - ty) / s + halfH;
      runOnJS(handleTapDebug)(e.x, e.y, e.absoluteX, e.absoluteY, invertedX, invertedY, tx, ty, s);
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

  // Expand viewBox to match the screen aspect ratio so the linear
  // pixel→viewBox mapping used by hit-testing is exact (no preserveAspectRatio distortion).
  const contentW = bounds.maxX - bounds.minX + VIEWBOX_PAD * 2;
  const contentH = bounds.maxY - bounds.minY + VIEWBOX_PAD * 2;
  const screenAspect = screenW / viewH;
  const contentAspect = contentW / contentH;

  let vbX: number, vbY: number, vbW: number, vbH: number;
  if (screenAspect > contentAspect) {
    // Screen is wider — expand viewBox width, center horizontally
    vbH = contentH;
    vbW = contentH * screenAspect;
    vbX = bounds.minX - VIEWBOX_PAD - (vbW - contentW) / 2;
    vbY = bounds.minY - VIEWBOX_PAD;
  } else {
    // Screen is taller — expand viewBox height, center vertically
    vbW = contentW;
    vbH = contentW / screenAspect;
    vbX = bounds.minX - VIEWBOX_PAD;
    vbY = bounds.minY - VIEWBOX_PAD - (vbH - contentH) / 2;
  }

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
              {/* Debug: blue=inverted, red=direct mapping */}
              {debugTaps.map((tap, i) => (
                <React.Fragment key={`debug-${i}`}>
                  <SvgCircle cx={tap.svgInverted.x} cy={tap.svgInverted.y} r={8} fill="blue" opacity={0.8} />
                  <SvgCircle cx={tap.svgDirect.x} cy={tap.svgDirect.y} r={6} fill="red" opacity={0.8} />
                </React.Fragment>
              ))}
            </Svg>
          </Animated.View>
          {/* Debug overlay: shows raw + computed coords */}
          <View style={styles.debugOverlay} pointerEvents="none">
            <ThemedText style={styles.debugText}>
              screenW={Math.round(screenW)} viewH={Math.round(viewH)} halfW={Math.round(halfW)} halfH={Math.round(halfH)}
            </ThemedText>
            {debugTaps.slice(-3).map((tap, i) => (
              <ThemedText key={`debug-${i}`} style={styles.debugText}>
                e.xy=({Math.round(tap.ex)},{Math.round(tap.ey)}) abs=({Math.round(tap.absX)},{Math.round(tap.absY)})
                {'\n'}blue=({Math.round(tap.svgInverted.x)},{Math.round(tap.svgInverted.y)}) red=({Math.round(tap.svgDirect.x)},{Math.round(tap.svgDirect.y)})
                {'\n'}t=({Math.round(tap.tx)},{Math.round(tap.ty)}) s={tap.s.toFixed(2)}
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
