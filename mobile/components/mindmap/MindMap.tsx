import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';

import { API_BASE_URL } from '@/constants/api';
import { ThemedText } from '@/components/ThemedText';
import { TreeNode, PositionedNode, Edge } from '@/types/tree';
import { layoutTree, LayoutResult } from './layout';
import MindMapEdge from './MindMapEdge';
import MindMapNode from './MindMapNode';

const VIEWBOX_PAD = 40;
const MIN_VB_W = 600;
const MIN_VB_H = 400;
const ANIM_DURATION = 300;
const MAX_ZOOM = 10;
const MIN_ZOOM = 0.3;

interface VB { vbX: number; vbY: number; vbW: number; vbH: number }

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

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function computeViewBox(bounds: LayoutResult['bounds'], screenW: number, viewH: number): VB {
  let contentW = bounds.maxX - bounds.minX + VIEWBOX_PAD * 2;
  let contentH = bounds.maxY - bounds.minY + VIEWBOX_PAD * 2;
  contentW = Math.max(contentW, MIN_VB_W);
  contentH = Math.max(contentH, MIN_VB_H);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const screenAspect = screenW / viewH;
  const contentAspect = contentW / contentH;
  let vbW: number, vbH: number;
  if (screenAspect > contentAspect) {
    vbH = contentH;
    vbW = contentH * screenAspect;
  } else {
    vbW = contentW;
    vbH = contentW / screenAspect;
  }
  return { vbX: centerX - vbW / 2, vbY: centerY - vbH / 2, vbW, vbH };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Compute the effective viewBox after applying a gesture transform */
function applyTransformToVb(
  vb: VB, tx: number, ty: number, s: number,
  screenW: number, viewH: number,
): VB {
  const halfW = screenW / 2;
  const halfH = viewH / 2;
  // Screen center maps to SVG point:
  const localCX = (halfW - halfW - tx) / s + halfW; // = -tx/s + halfW
  const localCY = (halfH - halfH - ty) / s + halfH; // = -ty/s + halfH
  const svgCX = vb.vbX + (localCX / screenW) * vb.vbW;
  const svgCY = vb.vbY + (localCY / viewH) * vb.vbH;
  const newVbW = vb.vbW / s;
  const newVbH = vb.vbH / s;
  return {
    vbX: svgCX - newVbW / 2,
    vbY: svgCY - newVbH / 2,
    vbW: newVbW,
    vbH: newVbH,
  };
}

interface PrevLayout {
  positions: Map<string, { x: number; y: number }>;
  bounds: LayoutResult['bounds'];
}

export default function MindMap() {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [viewH, setViewH] = useState(screenH);
  const [animProgress, setAnimProgress] = useState(1);
  const [cameraVb, setCameraVb] = useState<VB | null>(null);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);

  // Track active gesture count to know when all gestures are done
  const gestureCount = useSharedValue(0);
  // Committed zoom ratio (shared value for UI thread access in pinch limiter)
  const committedZoom = useSharedValue(1);

  const prevLayoutRef = useRef<PrevLayout | null>(null);
  const animFrameRef = useRef<number>(0);
  const animTargetLayoutRef = useRef<LayoutResult | null>(null);
  const naturalVbRef = useRef<VB>({ vbX: 0, vbY: 0, vbW: 1, vbH: 1 });
  const cameraVbRef = useRef<VB | null>(null);
  cameraVbRef.current = cameraVb;

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

  // Reset camera when layout changes (expand/collapse)
  useEffect(() => {
    if (layout) {
      setCameraVb(null);
      committedZoom.value = 1;
      translateX.value = 0;
      translateY.value = 0;
      scale.value = 1;
    }
  }, [layout]);

  // Start animation when layout changes
  useEffect(() => {
    if (!layout) return;

    if (prevLayoutRef.current) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      animTargetLayoutRef.current = layout;
      const startTime = Date.now();
      setAnimProgress(0);

      const animate = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(1, elapsed / ANIM_DURATION);
        const eased = easeInOutQuad(t);
        setAnimProgress(eased);
        if (t < 1) {
          animFrameRef.current = requestAnimationFrame(animate);
        } else {
          savePrevLayout(layout);
        }
      };
      animFrameRef.current = requestAnimationFrame(animate);
    } else {
      animTargetLayoutRef.current = layout;
      savePrevLayout(layout);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [layout]);

  function savePrevLayout(l: LayoutResult) {
    const positions = new Map<string, { x: number; y: number }>();
    for (const node of l.nodes) {
      positions.set(node.id, { x: node.x, y: node.y });
    }
    prevLayoutRef.current = { positions, bounds: l.bounds };
  }

  // Compute interpolated nodes, edges, and viewBox
  const display = useMemo(() => {
    if (!layout) return null;

    const prev = prevLayoutRef.current;
    const layoutIsNew = layout !== animTargetLayoutRef.current;
    const t = (layoutIsNew && prev) ? 0 : animProgress;
    const settled = t >= 1 || !prev;

    const displayNodes: PositionedNode[] = settled
      ? layout.nodes
      : layout.nodes.map((node) => {
          const prevPos = prev.positions.get(node.id);
          if (!prevPos) {
            return { ...node, opacity: t };
          }
          return {
            ...node,
            x: lerp(prevPos.x, node.x, t),
            y: lerp(prevPos.y, node.y, t),
          };
        });

    const posMap = new Map<string, { x: number; y: number; width: number }>();
    for (const n of displayNodes) {
      posMap.set(n.id, { x: n.x, y: n.y, width: n.width });
    }

    const displayEdges: Edge[] = layout.edges.map((edge, i) => {
      if (settled) return edge;

      const targetNode = layout.nodes[i + 1];
      if (!targetNode) return { ...edge, opacity: t };

      const targetPos = posMap.get(targetNode.id);
      if (!targetPos) return { ...edge, opacity: t };

      const parentNode = findParentForEdge(layout.nodes, edge);
      const parentPos = parentNode ? posMap.get(parentNode.id) : null;

      const startX = parentPos
        ? edge.side === 'right'
          ? parentPos.x + (parentNode!.width / 2)
          : parentPos.x - (parentNode!.width / 2)
        : edge.startX;
      const startY = parentPos ? parentPos.y : edge.startY;
      const endX = edge.side === 'right'
        ? targetPos.x - targetNode.width / 2
        : targetPos.x + targetNode.width / 2;
      const endY = targetPos.y;

      const nodeIsNew = !prev.positions.has(targetNode.id);
      return {
        ...edge,
        startX,
        startY,
        endX,
        endY,
        opacity: nodeIsNew ? t : undefined,
      };
    });

    let displayBounds = layout.bounds;
    if (!settled) {
      displayBounds = {
        minX: lerp(prev.bounds.minX, layout.bounds.minX, t),
        maxX: lerp(prev.bounds.maxX, layout.bounds.maxX, t),
        minY: lerp(prev.bounds.minY, layout.bounds.minY, t),
        maxY: lerp(prev.bounds.maxY, layout.bounds.maxY, t),
      };
    }

    return { nodes: displayNodes, edges: displayEdges, bounds: displayBounds };
  }, [layout, animProgress]);

  // Compute the natural viewBox from display bounds
  const naturalVb = useMemo(() => {
    if (!display) return null;
    return computeViewBox(display.bounds, screenW, viewH);
  }, [display, screenW, viewH]);

  if (naturalVb) naturalVbRef.current = naturalVb;

  // The viewBox used for rendering (camera override or natural)
  const activeVb = cameraVb ?? naturalVb;

  const layoutRef = useRef<LayoutResult | null>(null);
  layoutRef.current = layout;

  const halfW = screenW / 2;
  const halfH = viewH / 2;

  // Commit gesture transform into the viewBox on release
  const commitCamera = useCallback((tx: number, ty: number, s: number) => {
    if (s === 1 && tx === 0 && ty === 0) return;

    const currentVb = cameraVbRef.current ?? naturalVbRef.current;
    const newVb = applyTransformToVb(currentVb, tx, ty, s, screenW, viewH);

    // Compute total zoom relative to natural viewBox
    const totalZoom = naturalVbRef.current.vbW / newVb.vbW;

    // Reset shared values first (same JS tick, should batch with state update)
    translateX.value = 0;
    translateY.value = 0;
    scale.value = 1;
    committedZoom.value = totalZoom;

    setCameraVb(newVb);
  }, [screenW, viewH]);

  // Hit-test tap: account for camera viewBox + gesture transform
  const handleTap = useCallback((
    ex: number, ey: number, tx: number, ty: number, s: number,
    avbX: number, avbY: number, avbW: number, avbH: number,
  ) => {
    const l = layoutRef.current;
    if (!l) return;

    // Invert the gesture transform to get local screen coords
    const localX = (ex - halfW - tx) / s + halfW;
    const localY = (ey - halfH - ty) / s + halfH;

    // Map local coords to SVG coords via the active viewBox
    const svgX = avbX + (localX / screenW) * avbW;
    const svgY = avbY + (localY / viewH) * avbH;

    for (const node of l.nodes) {
      const hitPad = 6;
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
  }, [screenW, viewH, halfW, halfH, handleNodePress]);

  // We need activeVb values accessible from the UI thread for tap handling.
  // Store them in shared values updated from JS.
  const activeVbX = useSharedValue(0);
  const activeVbY = useSharedValue(0);
  const activeVbW = useSharedValue(1);
  const activeVbH = useSharedValue(1);
  if (activeVb) {
    activeVbX.value = activeVb.vbX;
    activeVbY.value = activeVb.vbY;
    activeVbW.value = activeVb.vbW;
    activeVbH.value = activeVb.vbH;
  }

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      runOnJS(handleTap)(
        e.x, e.y,
        translateX.value, translateY.value, scale.value,
        activeVbX.value, activeVbY.value, activeVbW.value, activeVbH.value,
      );
    });

  const panGesture = Gesture.Pan()
    .minDistance(10)
    .onStart(() => {
      gestureCount.value++;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      gestureCount.value--;
      if (gestureCount.value === 0) {
        runOnJS(commitCamera)(translateX.value, translateY.value, scale.value);
      }
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      gestureCount.value++;
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      const totalZoom = committedZoom.value * savedScale.value * e.scale;
      const clampedTotal = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, totalZoom));
      scale.value = clampedTotal / committedZoom.value;
    })
    .onEnd(() => {
      gestureCount.value--;
      if (gestureCount.value === 0) {
        runOnJS(commitCamera)(translateX.value, translateY.value, scale.value);
      }
    });

  const composed = Gesture.Race(
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

  if (!tree || !layout || !display || !activeVb) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <ThemedText style={{ marginTop: 12 }}>Loading mind map...</ThemedText>
      </View>
    );
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
              viewBox={`${activeVb.vbX} ${activeVb.vbY} ${activeVb.vbW} ${activeVb.vbH}`}
            >
              {display.edges.map((edge, i) => (
                <MindMapEdge key={`e-${i}`} edge={edge} />
              ))}
              {display.nodes.map((node) => (
                <MindMapNode key={node.id} node={node} />
              ))}
            </Svg>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

/** Find the parent node for an edge by matching the edge's startX/startY to a node's edge position */
function findParentForEdge(nodes: PositionedNode[], edge: Edge): PositionedNode | undefined {
  for (const n of nodes) {
    const edgeX = edge.side === 'right' ? n.x + n.width / 2 : n.x - n.width / 2;
    if (Math.abs(edgeX - edge.startX) < 1 && Math.abs(n.y - edge.startY) < 1) {
      return n;
    }
  }
  return undefined;
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
