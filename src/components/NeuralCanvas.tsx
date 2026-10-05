import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { NeuralNet } from '../engine/NeuralNet';
import { Renderer } from '../visualizer/Renderer';
import type { RenderView } from '../visualizer/Renderer';
import { NodeType } from '../engine/types';
import type { ModuleConfig, ConnectionSide, ModuleConnectionConfig } from '../engine/types';
import { BaseNode as NeuralNode } from '../engine/nodes/BaseNode';

interface NeuralCanvasProps {
    speed: number;
    paused: boolean;
    showHidden: boolean;
    onModuleSelect?: (moduleId: string | null) => void;
    onNodeContextMenu?: (nodeId: string) => void;
}

export interface NeuralCanvasHandle {
    save: () => any;
    load: (data: any) => void;
    loadData: (data: any) => void;
    addModule: (config: ModuleConfig) => void;
    connectModules: (srcId: string, tgtId: string, srcSide?: ConnectionSide, tgtSide?: ConnectionSide, coverage?: number, localizer?: number) => void;
    disconnectModules: (id1: string, id2: string) => void;
    getModuleConnectivity: (id: string) => { id: string, count: number, direction: 'in' | 'out' | 'self' }[];
    setGlobalDecay: (decay: number) => void;
    moveModule: (id: string, x: number, y: number) => void;
    updateModule: (id: string, config: Partial<ModuleConfig>) => void;
    renameModule: (id: string, name: string) => void;
    updateNode: (nodeId: string, config: { label?: string }) => void;
    getModules: () => ModuleConfig[];
    getModuleNodes: (moduleId: string) => NeuralNode[];
    getNodeConnections: (nodeId: string) => { incoming: any[], outgoing: any[] };
    clear: () => void;
    removeModule: (id: string) => void;
    getModuleConnectionConfig: (idA: string, idB: string) => ModuleConnectionConfig | undefined;
    step: (count: number) => void;
    getTickCount: () => number;
    resetState: () => void;
    populateLearnedOutput?: (targetId: string, sourceId: string) => void;
    triggerInputNode: (index: number) => void;
    getNet: () => NeuralNet;
    setView: (view: RenderView | undefined) => void;
    fitToView: (insets?: { top?: number, bottom?: number }) => void;
}

export const NeuralCanvas = forwardRef<NeuralCanvasHandle, NeuralCanvasProps>((
    { speed, paused, showHidden, onModuleSelect, onNodeContextMenu },
    ref
) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const netRef = useRef<NeuralNet>(new NeuralNet());
    const rendererRef = useRef<Renderer | null>(null);
    const requestRef = useRef<number | null>(null);

    // Interaction State
    const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ x: number, y: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | undefined>(undefined);

    // Module Move State
    const [draggingModuleId, setDraggingModuleId] = useState<string | null>(null);

    // Connection Inspector State
    const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);
    const highlightedNodeIdRef = useRef<string | null>(null);
    highlightedNodeIdRef.current = highlightedNodeId;



    // Touch State (active pointers + pinch gesture)
    const pointersRef = useRef<Map<number, { x: number, y: number }>>(new Map());
    const pinchRef = useRef<{ dist: number, mid: { x: number, y: number }, transform: { x: number, y: number, k: number } } | null>(null);
    const tapRef = useRef<{ x: number, y: number, nodeId?: string } | null>(null);

    // Demo overrides for the renderer (node rings, which connections to draw)
    const viewRef = useRef<RenderView | undefined>(undefined);

    // On narrow (mobile) canvases the default 1:1 view shows only a corner of the net, so zoom out to fit it.
    const fitToViewIfNarrow = () => fitToView(true);

    const fitToView = (onlyIfNarrow: boolean = false, insets: { top?: number, bottom?: number } = {}) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || (onlyIfNarrow && rect.width >= 900)) return;

        const nodes = Array.from(netRef.current.nodes.values());
        if (nodes.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(n => {
            minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
        });

        const pad = 40;
        const top = insets.top ?? 0;
        const height = Math.max(100, rect.height - top - (insets.bottom ?? 0));
        const k = Math.min(1, rect.width / (maxX - minX + pad * 2), height / (maxY - minY + pad * 2));
        setTransform({
            x: rect.width / 2 - ((minX + maxX) / 2) * k,
            y: top + height / 2 - ((minY + maxY) / 2) * k,
            k
        });
    };

    // Expose Save/Load
    const justLoadedRef = useRef(false);

    useImperativeHandle(ref, () => ({
        save: () => {
            return netRef.current.toJSON();
        },
        load: (data: any) => {
            netRef.current.fromJSON(data);
            fitToViewIfNarrow();
            justLoadedRef.current = true;
        },
        loadData: (data: any) => {
            netRef.current.fromJSON(data);
            fitToViewIfNarrow();
            // We don't necessarily set justLoadedRef here if we want simulation to start immediately or behave differently
            // But for initial load, it's fine.
            justLoadedRef.current = true;
        },
        addModule: (config: ModuleConfig) => {
            netRef.current.addModule(config);
        },

        disconnectModules: (id1, id2) => netRef.current.disconnectModules(id1, id2),
        getModuleConnectivity: (id) => netRef.current.getModuleConnectivity(id),
        setGlobalDecay: (decay: number) => netRef.current.setGlobalDecay(decay),
        moveModule: (id: string, x: number, y: number) => {
            netRef.current.moveModule(id, x, y);
        },
        updateModule: (id: string, config: Partial<ModuleConfig>) => {
            netRef.current.updateModule(id, config);
        },
        renameModule: (id: string, name: string) => {
            netRef.current.renameModule(id, name);
        },
        updateNode: (nodeId: string, config: { label?: string }) => {
            netRef.current.updateNode(nodeId, config);
        },
        getModules: () => {
            return Array.from(netRef.current.modules.values());
        },
        getModuleNodes: (moduleId: string) => {
            return netRef.current.getModuleNodes(moduleId);
        },
        getNodeConnections: (nodeId: string) => {
            return netRef.current.getNodeConnections(nodeId);
        },
        clear: () => {
            netRef.current.clear();
            viewRef.current = undefined;
        },
        removeModule: (id: string) => {
            netRef.current.removeModule(id);
        },
        connectModules: (srcId, tgtId, srcSide, tgtSide, coverage, localizer) => {
            netRef.current.connectModules(srcId, tgtId, srcSide, tgtSide, coverage, localizer);
        },
        getModuleConnectionConfig: (idA: string, idB: string) => {
            let config = netRef.current.moduleConnections.get(`${idA}-${idB}`);
            if (!config) config = netRef.current.moduleConnections.get(`${idB}-${idA}`);
            return config;
        },
        populateLearnedOutput: (targetId: string, sourceId: string) => {
            netRef.current.populateLearnedOutput(targetId, sourceId);
        },
        step: (count: number) => {
            for (let i = 0; i < count; i++) {
                netRef.current.step();
            }
        },
        getTickCount: () => {
            return netRef.current.tickCount;
        },
        resetState: () => {
            netRef.current.resetState();
        },
        triggerInputNode: (index: number) => {
            netRef.current.triggerInput(index);
        },
        getNet: () => netRef.current,
        setView: (view) => { viewRef.current = view; },
        fitToView: (insets) => fitToView(false, insets)
    }));

    // Initialize Network (Generation Logic Removed)
    useEffect(() => { }, []);

    // Animation & Rendering Loop
    const hoveredNodeIdRef = useRef<string | undefined>(undefined);
    hoveredNodeIdRef.current = hoveredNodeId;

    const transformRef = useRef(transform);
    transformRef.current = transform;

    const showHiddenRef = useRef(showHidden);
    showHiddenRef.current = showHidden;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleResize = () => {
            if (!canvas.parentElement) return;
            const rect = canvas.parentElement.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;

            // Adjust renderer size
            if (rendererRef.current) {
                rendererRef.current.resize(rect.width, rect.height);
            }

            // Reset context scale
            const ctx = canvas.getContext('2d');
            if (ctx) ctx.scale(dpr, dpr);
        };

        const resizeObserver = new ResizeObserver(() => handleResize());
        if (canvas.parentElement) {
            resizeObserver.observe(canvas.parentElement);
        }

        // Initial setup
        handleResize();

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        rendererRef.current = new Renderer(ctx, canvas.width, canvas.height); // Size updated in resize

        let lastTime = 0;
        const animate = (time: number) => {
            const dt = time - lastTime;

            if (!paused && dt > speed) {
                netRef.current.step();
                lastTime = time;
            }

            rendererRef.current?.draw(
                netRef.current,
                transformRef.current,
                hoveredNodeIdRef.current,
                undefined, // inspection
                showHiddenRef.current,
                highlightedNodeIdRef.current,
                viewRef.current
            );
            requestRef.current = requestAnimationFrame(animate);
        };

        requestRef.current = requestAnimationFrame(animate);

        return () => {
            if (requestRef.current !== null) cancelAnimationFrame(requestRef.current);
            resizeObserver.disconnect();
        };
    }, [speed, paused]);

    // --- Interaction Handlers ---

    const getPointerPos = (e: React.MouseEvent) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    };

    const findNodeAt = (pos: { x: number, y: number }): string | undefined => {
        const lx = (pos.x - transform.x) / transform.k;
        const ly = (pos.y - transform.y) / transform.k;
        for (const node of netRef.current.nodes.values()) {
            const dx = lx - node.x;
            const dy = ly - node.y;
            if (dx * dx + dy * dy < 400) return node.id;
        }
        return undefined;
    };

    const findModuleIdForNode = (nodeId: string): string | null => {
        for (const mod of netRef.current.modules.values()) {
            if (nodeId.startsWith(mod.id + '-')) return mod.id;
        }
        return null;
    };

    const startPinch = () => {
        const [a, b] = Array.from(pointersRef.current.values());
        pinchRef.current = {
            dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
            transform
        };
        setIsDragging(false);
        setDraggingModuleId(null);
        dragStartRef.current = null;
        tapRef.current = null;
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const rect = canvasRef.current!.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const scaleFactor = 1.1;
        const zoomIn = e.deltaY < 0;
        const factor = zoomIn ? scaleFactor : 1 / scaleFactor;

        // Current world position under mouse
        const wx = (mx - transform.x) / transform.k;
        const wy = (my - transform.y) / transform.k;

        // New scale
        const newK = transform.k * factor;

        // New translation to keep world point wx,wy at mouse position mx,my
        // mx = newX + wx * newK  =>  newX = mx - wx * newK
        setTransform({
            x: mx - wx * newK,
            y: my - wy * newK,
            k: newK
        });
    };

    const handleMouseDown = (e: React.PointerEvent) => {
        const pos = getPointerPos(e);

        // Touch has no hover phase, so hit-test at the press position instead of relying on the last mouse move.
        const hoveredNodeId = findNodeAt(pos);
        setHoveredNodeId(hoveredNodeId);

        if (e.pointerType === 'touch') {
            canvasRef.current?.setPointerCapture(e.pointerId);
            pointersRef.current.set(e.pointerId, pos);
            if (pointersRef.current.size === 2) {
                startPinch();
                return;
            }
            if (pointersRef.current.size > 2) return;
            tapRef.current = { x: pos.x, y: pos.y, nodeId: hoveredNodeId };
        }

        // Middle Click Handling (Button 1)
        if (e.button === 1) {
            e.preventDefault();
            if (hoveredNodeId) {
                // New logic: Highlight all connections for this node
                // We reuse 'inspection' state for this, but maybe we need a new state?
                // The prompt says "highlight them in light green".
                // And "hover over a connection => see value".
                // I'll repurpose 'inspection' to be more flexible or add a 'highlightedNodeId' state.
                // Actually, Renderer.draw accepts 'inspection'. I will add 'highlightedNodeId' to Renderer.draw.
                // Let's create a state for it.
                setHighlightedNodeId(prev => (prev === hoveredNodeId ? null : hoveredNodeId));
            } else {
                setHighlightedNodeId(null);
            }
            return;
        }

        // Left Click -> Check for Module Drag
        if (hoveredNodeId) {
            const foundModId = findModuleIdForNode(hoveredNodeId);

            if (foundModId) {
                const mod = netRef.current.modules.get(foundModId);
                if (mod) {
                    setDraggingModuleId(foundModId);
                    // Store offset from module center
                    const wx = (pos.x - transform.x) / transform.k;
                    const wy = (pos.y - transform.y) / transform.k;

                    dragStartRef.current = { x: wx - mod.x, y: wy - mod.y };

                    // SELECTION REMOVED FROM SINGLE CLICK (Drag only)
                    return;
                }
            }
        } else {
            // Check for Empty/Learned Output Module Hit (Body Drag)
            const wx = (pos.x - transform.x) / transform.k;
            const wy = (pos.y - transform.y) / transform.k;

            for (const mod of netRef.current.modules.values()) {
                if (mod.type === 'LEARNED_OUTPUT' || mod.type === 'TRAINING_DATA' || mod.type === 'CONCEPT') {
                    // Check collapsed Concept specifically
                    if (mod.type === 'CONCEPT' && mod.collapsed) {
                        // Small hitbox for triangle (r=15) + label
                        const r = 30; // generous hit radius
                        const dist = Math.sqrt(Math.pow(wx - mod.x, 2) + Math.pow(wy - (mod.y - 10), 2));
                        if (dist < r) {
                            setDraggingModuleId(mod.id);
                            dragStartRef.current = { x: wx - mod.x, y: wy - mod.y };
                            if (onModuleSelect) onModuleSelect(mod.id);
                            return;
                        }
                        continue;
                    }

                    // For others (or non-collapsed concept with 0 nodes?)
                    if (mod.type === 'CONCEPT' && mod.nodeCount > 0 && !mod.collapsed) continue;

                    // Standard Box Hitbox (Learned Output / Training Data / Empty Concept)
                    const w = mod.width || 100;
                    const h = mod.height || 600;
                    if (wx >= mod.x - w / 2 && wx <= mod.x + w / 2 &&
                        wy >= mod.y - h / 2 && wy <= mod.y + h / 2) {

                        setDraggingModuleId(mod.id);
                        dragStartRef.current = { x: wx - mod.x, y: wy - mod.y };

                        // Select on click for these since they have no nodes to click
                        if (onModuleSelect) onModuleSelect(mod.id);
                        return;
                    }
                }
            }
        }

        // Background Drag
        setIsDragging(true);
        dragStartRef.current = { x: pos.x - transform.x, y: pos.y - transform.y };

        // Background Click -> Deselect REMOVED by user request
        // if (!hoveredNodeId && onModuleSelect) onModuleSelect(null);
    };

    const handleDoubleClick = () => {
        // Check selection on double click
        if (hoveredNodeId) {
            const foundModId = findModuleIdForNode(hoveredNodeId);
            if (foundModId && onModuleSelect) {
                onModuleSelect(foundModId);
            }
        }
    };

    const handleMouseMove = (e: React.PointerEvent) => {
        const pos = getPointerPos(e);

        if (e.pointerType === 'touch') {
            if (!pointersRef.current.has(e.pointerId)) return;
            pointersRef.current.set(e.pointerId, pos);

            // Two fingers: pinch-zoom + pan around the gesture midpoint
            const pinch = pinchRef.current;
            if (pinch && pointersRef.current.size >= 2) {
                const [a, b] = Array.from(pointersRef.current.values());
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const k = pinch.transform.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist);
                const wx = (pinch.mid.x - pinch.transform.x) / pinch.transform.k;
                const wy = (pinch.mid.y - pinch.transform.y) / pinch.transform.k;
                setTransform({ x: mid.x - wx * k, y: mid.y - wy * k, k });
                return;
            }

            // Moving past a small threshold turns a tap into a drag
            if (tapRef.current && Math.hypot(pos.x - tapRef.current.x, pos.y - tapRef.current.y) > 8) {
                tapRef.current = null;
            }
        }

        if (draggingModuleId && dragStartRef.current) {
            const wx = (pos.x - transform.x) / transform.k;
            const wy = (pos.y - transform.y) / transform.k;

            const newX = wx - dragStartRef.current.x;
            const newY = wy - dragStartRef.current.y;

            netRef.current.moveModule(draggingModuleId, newX, newY);
            return;
        }

        if (isDragging && dragStartRef.current) {
            setTransform({
                ...transform,
                x: pos.x - dragStartRef.current.x,
                y: pos.y - dragStartRef.current.y
            });
        }

        // Hover
        setHoveredNodeId(findNodeAt(pos));
    };

    const handleMouseUp = (e: React.PointerEvent) => {
        if (e.pointerType === 'touch') {
            pointersRef.current.delete(e.pointerId);
            if (pointersRef.current.size < 2) pinchRef.current = null;

            // Single tap on a node selects its module (touch has no practical double-click)
            const tap = tapRef.current;
            tapRef.current = null;
            if (tap?.nodeId && e.type === 'pointerup' && onModuleSelect) {
                const modId = findModuleIdForNode(tap.nodeId);
                if (modId) onModuleSelect(modId);
            }
        }

        setIsDragging(false);
        setDraggingModuleId(null);
        dragStartRef.current = null;
    };

    const handleClick = () => {
        if (hoveredNodeId && !draggingModuleId) {
            const node = netRef.current.nodes.get(hoveredNodeId);
            if (node && node.type === NodeType.INPUT) {
                node.setInput(1.0);
            }
        }
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        if (hoveredNodeId && onNodeContextMenu) {
            e.preventDefault();
            onNodeContextMenu(hoveredNodeId);
        }
    };

    return (
        <div style={{ width: '100%', height: '100%', background: '#000', overflow: 'hidden' }}>
            <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%', touchAction: 'none' }}
                onWheel={handleWheel}
                onPointerDown={handleMouseDown}
                onPointerMove={handleMouseMove}
                onPointerUp={handleMouseUp}
                onPointerCancel={handleMouseUp}
                onPointerLeave={handleMouseUp}
                onClick={handleClick}
                onDoubleClick={handleDoubleClick}
                onContextMenu={handleContextMenu}
            />
        </div>
    );
});
