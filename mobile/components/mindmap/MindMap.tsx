import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useSharedValue } from 'react-native-reanimated';
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

  // Shared values for UI-thread gesture computation
  const camVbX = useSharedValue(0);
  const camVbY = useSharedValue(0);
  const camVbW = useSharedValue(MIN_VB_W);
  const camVbH = useSharedValue(MIN_VB_H);
  const naturalVbWShared = useSharedValue(MIN_VB_W);
  const screenWS = useSharedValue(screenW);
  const viewHS = useSharedValue(viewH);

  // Gesture state (all on UI thread)
  const gestureCount = useSharedValue(0);
  const savedVbX = useSharedValue(0);
  const savedVbY = useSharedValue(0);
  const savedVbW = useSharedValue(MIN_VB_W);
  const savedVbH = useSharedValue(MIN_VB_H);
  const gesturePanX = useSharedValue(0);
  const gesturePanY = useSharedValue(0);
  const gestureScaleVal = useSharedValue(1);
  const focalFracX = useSharedValue(0.5);
  const focalFracY = useSharedValue(0.5);
  const focalCaptured = useSharedValue(false);

  const prevLayoutRef = useRef<PrevLayout | null>(null);
  const animFrameRef = useRef<number>(0);
  const animTargetLayoutRef = useRef<LayoutResult | null>(null);

  useEffect(() => { screenWS.value = screenW; }, [screenW]);
  useEffect(() => { viewHS.value = viewH; }, [viewH]);

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

  // Natural viewBox from display bounds
  const naturalVb = useMemo(() => {
    if (!display) return null;
    return computeViewBox(display.bounds, screenW, viewH);
  }, [display, screenW, viewH]);

  // Sync natural viewBox to shared values (for gesture computation on UI thread)
  useEffect(() => {
    if (!naturalVb) return;
    const vb = cameraVb ?? naturalVb;
    camVbX.value = vb.vbX;
    camVbY.value = vb.vbY;
    camVbW.value = vb.vbW;
    camVbH.value = vb.vbH;
    naturalVbWShared.value = naturalVb.vbW;
  }, [naturalVb, cameraVb]);

  const layoutRef = useRef<LayoutResult | null>(null);
  layoutRef.current = layout;

  // --- Gesture handling ---

  // Called from UI thread via runOnJS to update React state
  const updateCameraVb = useCallback((vbX: number, vbY: number, vbW: number, vbH: number) => {
    setCameraVb({ vbX, vbY, vbW, vbH });
  }, []);

  const recomputeVb = () => {
    'worklet';
    let s = gestureScaleVal.value;
    const maxS = MAX_ZOOM * savedVbW.value / naturalVbWShared.value;
    const minS = MIN_ZOOM * savedVbW.value / naturalVbWShared.value;
    s = Math.min(maxS, Math.max(minS, s));

    const newW = savedVbW.value / s;
    const newH = savedVbH.value / s;

    const fSvgX = savedVbX.value + focalFracX.value * savedVbW.value;
    const fSvgY = savedVbY.value + focalFracY.value * savedVbH.value;
    const zoomedVbX = fSvgX - focalFracX.value * newW;
    const zoomedVbY = fSvgY - focalFracY.value * newH;

    const panSvgX = gesturePanX.value * (newW / screenWS.value);
    const panSvgY = gesturePanY.value * (newH / viewHS.value);

    const finalX = zoomedVbX - panSvgX;
    const finalY = zoomedVbY - panSvgY;

    camVbX.value = finalX;
    camVbY.value = finalY;
    camVbW.value = newW;
    camVbH.value = newH;

    runOnJS(updateCameraVb)(finalX, finalY, newW, newH);
  };

  const saveGestureState = () => {
    'worklet';
    savedVbX.value = camVbX.value;
    savedVbY.value = camVbY.value;
    savedVbW.value = camVbW.value;
    savedVbH.value = camVbH.value;
  };

  const resetGestureDeltas = () => {
    'worklet';
    gesturePanX.value = 0;
    gesturePanY.value = 0;
    gestureScaleVal.value = 1;
    focalCaptured.value = false;
  };

  // Hit-test: screen coords → SVG coords via camera viewBox
  const handleTap = useCallback((svgX: number, svgY: number) => {
    const l = layoutRef.current;
    if (!l) return;
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
  }, [handleNodePress]);

  const tapGesture = Gesture.Tap()
    .onEnd((e) => {
      const svgX = camVbX.value + (e.x / screenWS.value) * camVbW.value;
      const svgY = camVbY.value + (e.y / viewHS.value) * camVbH.value;
      runOnJS(handleTap)(svgX, svgY);
    });

  const panGesture = Gesture.Pan()
    .minDistance(10)
    .onStart(() => {
      if (gestureCount.value === 0) {
        saveGestureState();
        resetGestureDeltas();
      }
      gestureCount.value++;
    })
    .onUpdate((e) => {
      gesturePanX.value = e.translationX;
      gesturePanY.value = e.translationY;
      recomputeVb();
    })
    .onEnd(() => {
      gestureCount.value--;
      if (gestureCount.value === 0) {
        resetGestureDeltas();
      }
    });

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      if (gestureCount.value === 0) {
        saveGestureState();
        resetGestureDeltas();
      }
      gestureCount.value++;
    })
    .onUpdate((e) => {
      if (!focalCaptured.value) {
        focalFracX.value = e.focalX / screenWS.value;
        focalFracY.value = e.focalY / viewHS.value;
        focalCaptured.value = true;
      }
      gestureScaleVal.value = e.scale;
      recomputeVb();
    })
    .onEnd(() => {
      gestureCount.value--;
      if (gestureCount.value === 0) {
        resetGestureDeltas();
      }
    });

  const composed = Gesture.Race(
    tapGesture,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

  if (error) {
    return (
      <View style={styles.center}>
        <ThemedText>Error: {error}</ThemedText>
      </View>
    );
  }

  if (!tree || !layout || !display) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <ThemedText style={{ marginTop: 12 }}>Loading mind map...</ThemedText>
      </View>
    );
  }

  const activeVb = cameraVb ?? naturalVb!;

  return (
    <GestureHandlerRootView style={styles.fill}>
      <GestureDetector gesture={composed}>
        <Animated.View
          style={[styles.fill, { backgroundColor: '#121212' }]}
          onLayout={(e) => setViewH(e.nativeEvent.layout.height)}
        >
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
