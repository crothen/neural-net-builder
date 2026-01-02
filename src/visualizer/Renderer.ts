import { NeuralNet } from '../engine/NeuralNet';
import { NodeType } from '../engine/types';

export class Renderer {
    private ctx: CanvasRenderingContext2D;
    private width: number;
    private height: number;

    constructor(ctx: CanvasRenderingContext2D, width: number, height: number) {
        this.ctx = ctx;
        this.width = width;
        this.height = height;
    }

    public resize(width: number, height: number) {
        this.width = width;
        this.height = height;
        // Canvas size should be set by the element, but we track it here for clearing
    }

    public draw(
        net: NeuralNet,
        transform: { x: number, y: number, k: number },
        hoveredNodeId?: string,
        inspection?: { sourceId: string | null, targetId: string | null },
        showHidden: boolean = true,
        highlightedNodeId?: string | null
    ) {
        const { x: tx, y: ty, k: zoom } = transform;

        // 1. Clear background
        this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform for clear
        this.ctx.fillStyle = '#0f0f13'; // Dark background
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Apply Zoom/Pan Transform
        this.ctx.setTransform(zoom, 0, 0, zoom, tx, ty);

        // 2. Draw Connections
        net.connections.forEach(conn => {
            const source = net.nodes.get(conn.sourceId);
            const target = net.nodes.get(conn.targetId);
            if (!source || !target) return;

            // Visibility Check
            if (!showHidden) {
                // Hide if either end is HIDDEN or INTERPRETATION
                if (source.type === NodeType.HIDDEN || source.type === NodeType.INTERPRETATION ||
                    target.type === NodeType.HIDDEN || target.type === NodeType.INTERPRETATION) {
                    return;
                }
            }

            // Check Inspector highlight
            let isInspected = false;
            // Check direction: Source -> Target
            if (inspection && inspection.sourceId === conn.sourceId && inspection.targetId === conn.targetId) {
                isInspected = true;
            }

            // Calculate intensity based on signal strength
            const intensity = Math.min(conn.signalStrength, 1.0);

            // Hebbian Visualization:
            // Width and Opacity based on Weight Magnitude
            const weight = conn.weight;
            const weightAbs = Math.abs(weight);
            const isExcitatory = weight >= 0;

            this.ctx.beginPath();
            this.ctx.moveTo(source.x, source.y);
            this.ctx.lineTo(target.x, target.y);

            if (isInspected) {
                this.ctx.strokeStyle = '#ffff00'; // Yellow highlight
                this.ctx.lineWidth = 4;
                this.ctx.shadowBlur = 15;
                this.ctx.shadowColor = 'yellow';
            } else if (highlightedNodeId && (conn.sourceId === highlightedNodeId || conn.targetId === highlightedNodeId)) {
                // Persistent Highlight (Middle Click) - Light Green
                this.ctx.strokeStyle = '#00ff88';
                this.ctx.lineWidth = 2.5;
                this.ctx.globalAlpha = 0.8;
                this.ctx.shadowBlur = 8;
                this.ctx.shadowColor = '#00ff88';

                // Draw Direction Arrow
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;
                const dx = target.x - source.x;
                const dy = target.y - source.y;
                const angle = Math.atan2(dy, dx);
                const arrowSize = 8;

                this.ctx.stroke(); // Draw line first

                this.ctx.save();
                this.ctx.translate(midX, midY);
                this.ctx.rotate(angle);
                this.ctx.beginPath();
                this.ctx.moveTo(0, 0);
                this.ctx.lineTo(-arrowSize, -arrowSize / 2);
                this.ctx.lineTo(-arrowSize, arrowSize / 2);
                this.ctx.closePath();
                this.ctx.fillStyle = '#00ff88';
                this.ctx.fill();
                this.ctx.restore();

                // Restart path for consistency (though we just stroked)
                this.ctx.beginPath();
            } else {
                // Dynamic styling based on Weight & Activity
                let baseWidth = 0.5 + (weightAbs * 1.5); // Thicker connections = stronger weights
                let baseAlpha = 0.02 + (weightAbs * 0.1); // Extremely transparent resting state

                if (intensity > 0.01) {
                    // Active Firing
                    this.ctx.lineWidth = baseWidth * 2.0; // Pulse expansion
                    const glowAlpha = Math.min(1.0, baseAlpha + 0.5);
                    const color = isExcitatory ? `0, 255, 255` : `255, 50, 50`;
                    this.ctx.strokeStyle = `rgba(${color}, ${glowAlpha})`;

                    this.ctx.shadowBlur = 10 * intensity;
                    this.ctx.shadowColor = isExcitatory ? 'cyan' : 'red';
                } else {
                    // Resting State
                    this.ctx.lineWidth = baseWidth;
                    const color = isExcitatory ? `0, 200, 255` : `200, 0, 0`;
                    this.ctx.strokeStyle = `rgba(${color}, ${baseAlpha})`;
                    this.ctx.shadowBlur = 0;
                }
            }

            this.ctx.stroke();
            this.ctx.globalAlpha = 1.0; // Reset alpha for text if needed (though stroke() used line alpha)
            this.ctx.shadowBlur = 0; // Reset

            // Draw Weight Text if inspected OR Highlighted
            if (isInspected || (highlightedNodeId && (conn.sourceId === highlightedNodeId || conn.targetId === highlightedNodeId))) {
                const midX = (source.x + target.x) / 2;
                const midY = (source.y + target.y) / 2;

                this.ctx.fillStyle = '#ffff00';
                this.ctx.font = 'bold 16px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';

                // Draw background for text
                const text = `W: ${conn.weight.toFixed(3)}`;
                const textMetrics = this.ctx.measureText(text);
                const padding = 4;

                this.ctx.save();
                this.ctx.fillStyle = 'rgba(0,0,0,0.8)';
                this.ctx.fillRect(
                    midX - textMetrics.width / 2 - padding,
                    midY - 10 - padding,
                    textMetrics.width + padding * 2,
                    20 + padding * 2
                );
                this.ctx.restore();

                this.ctx.fillStyle = '#ffff00';
                this.ctx.fillText(text, midX, midY);
            }
        });

        // 3. Draw Nodes & Module Labels
        // Iterate by MODULE to access module-level properties (Color, Name)
        net.modules.forEach(module => {
            // Visualize Localization Sectors (Brain Only)
            if (module.type === 'BRAIN' && module.isLocalized) {
                const radius = module.radius || 200;
                const sectors = 8;

                this.ctx.beginPath();
                for (let i = 0; i < sectors; i++) {
                    const angle = (i / sectors) * 2 * Math.PI;
                    const x = module.x + Math.cos(angle) * (radius * 0.2); // Start slightly offset
                    const y = module.y + Math.sin(angle) * (radius * 0.2);
                    const endX = module.x + Math.cos(angle) * radius;
                    const endY = module.y + Math.sin(angle) * radius;

                    this.ctx.moveTo(x, y);
                    this.ctx.lineTo(endX, endY);
                }
                this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; // Very subtle
                this.ctx.lineWidth = 1;
                this.ctx.setLineDash([5, 5]); // Dashed
                this.ctx.stroke();
                this.ctx.setLineDash([]); // Reset
            }

            // --- CUSTOM VISUALIZATION FOR TRAINING DATA (HEXAGON) ---
            if (module.type === 'TRAINING_DATA') {
                // Draw Hexagon
                const r = 40; // Size
                this.ctx.beginPath();
                for (let i = 0; i < 6; i++) {
                    const angle = Math.PI / 3 * i;
                    const hx = module.x + r * Math.cos(angle);
                    const hy = module.y + r * Math.sin(angle);
                    if (i === 0) this.ctx.moveTo(hx, hy);
                    else this.ctx.lineTo(hx, hy);
                }
                this.ctx.closePath();

                this.ctx.fillStyle = '#222';
                this.ctx.fill();
                this.ctx.lineWidth = 2;
                this.ctx.strokeStyle = '#44cb82'; // Greenish
                this.ctx.stroke();

                // Label
                this.ctx.fillStyle = '#fff';
                this.ctx.font = '14px "Inter", sans-serif';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(module.name || 'DATA', module.x, module.y);
            }

            // --- CUSTOM VISUALIZATION FOR COLLAPSED CONCEPT (TRIANGLE) ---
            if (module.type === 'CONCEPT' && module.collapsed) {
                const r = 15; // Smaller
                this.ctx.beginPath();
                this.ctx.moveTo(module.x, module.y - r); // Top
                this.ctx.lineTo(module.x - r, module.y + r * 0.8); // Bot Left
                this.ctx.lineTo(module.x + r, module.y + r * 0.8); // Bot Right
                this.ctx.closePath();

                this.ctx.fillStyle = '#444';
                this.ctx.fill();
                this.ctx.lineWidth = 2;
                this.ctx.strokeStyle = '#aaa';
                this.ctx.stroke();

                // No text inside triangle as requested
            }

            // Draw Module Label (Prominent)
            // Visibility Check: If hiding details, only show labels for INPUT/OUTPUT
            if (module.type === 'TRAINING_DATA' || (!showHidden && module.type !== 'INPUT' && module.type !== 'OUTPUT')) {
                // Skip drawing label
            } else {
                // Use custom color if present, else faint Cyan
                this.ctx.fillStyle = module.color || 'rgba(0, 212, 255, 0.5)';
                this.ctx.font = 'bold 24px "Inter", sans-serif';
                // Increase font size slightly

                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'bottom';

                // Position above the module
                // For Brain, radius. For Layers, height/2.
                const labelY = module.type === 'BRAIN'
                    ? module.y - (module.radius || 200) - 15
                    : module.type === 'CONCEPT' && module.collapsed
                        ? module.y - 25 // Just above the triangle (r=15)
                        : module.y - (module.height || 600) / 2 - 15;

                // Use name if available, else label
                this.ctx.fillText(module.name || module.label!, module.x, labelY);
            }

            // Get nodes for this module
            const nodes = net.getModuleNodes(module.id);

            // Special Case: Empty Learned Output
            if (module.type === 'LEARNED_OUTPUT' && nodes.length === 0) {
                const w = module.width || 200;
                const h = module.height || 200;
                const x = module.x - w / 2;
                const y = module.y - h / 2;

                this.ctx.save();
                this.ctx.strokeStyle = '#444';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([10, 5]);
                this.ctx.strokeRect(x, y, w, h);

                this.ctx.fillStyle = '#666';
                this.ctx.font = 'italic 16px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText('(Empty Output)', module.x, module.y);
                this.ctx.restore();
            }

            nodes.forEach(node => {
                // Skip if collapsed concept (drawn as triangle)
                if (module.type === 'CONCEPT' && module.collapsed) return;

                // Visibility Check
                if (!showHidden) {
                    if (node.type === NodeType.HIDDEN || node.type === NodeType.INTERPRETATION) {
                        return;
                    }
                }

                this.ctx.beginPath();
                // Smaller hidden nodes, Input/Output slightly larger
                let radius = node.type === NodeType.HIDDEN ? 6 : 12;

                // --- CONCEPT NODE OVERRIDE ---
                if (node.type === NodeType.CONCEPT) {
                    // Small dot
                    radius = 3;
                    this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
                    this.ctx.fillStyle = '#fff';
                    this.ctx.fill();

                    // Label (Left)
                    this.ctx.fillStyle = '#ccc';
                    this.ctx.font = '12px "Inter", sans-serif';
                    this.ctx.textAlign = 'right';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.fillText(node.label || node.id, node.x - 8, node.y);

                    // Skip the rest of standard drawing (potential heatmaps, rings etc don't apply)
                    return;
                }

                this.ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);

                // --- Color Logic (FILL) ---
                // "Inside of the circle": logic as before (Potential Heatmap)

                const metric = Math.min(Math.max(node.potential, 0), 1.0);
                let fillStyle;

                if (node.isFiring) {
                    fillStyle = '#87CEEB'; // Sky Blue (Firing)
                } else {
                    // Gradient: Black (0) -> Sky Blue (1)
                    // Sky Blue is rgb(135, 206, 235)
                    const r = Math.floor(135 * metric);
                    const g = Math.floor(206 * metric);
                    const b = Math.floor(235 * metric);
                    fillStyle = `rgb(${r}, ${g}, ${b})`;
                }

                this.ctx.fillStyle = fillStyle;
                this.ctx.fill();

                // --- Dale's Principle Indicators (+/-) ---
                if (node.type === NodeType.HIDDEN && !module.collapsed) {
                    this.ctx.save();
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    // Font size relative to radius (radius is 6 for hidden)
                    this.ctx.font = 'bold 10px monospace';

                    if (node.neuronType === 'INHIBITORY') {
                        this.ctx.fillStyle = '#ff4444'; // Red for Inhibitory
                        this.ctx.fillText('-', node.x, node.y);
                    } else {
                        // Default to Excitatory (Green +)
                        this.ctx.fillStyle = '#44ff44'; // Green for Excitatory
                        this.ctx.fillText('+', node.x, node.y + 1); // +1 offset for visual centering
                    }
                    this.ctx.restore();
                }

                // --- Stroke / Ring Logic (OUTER CIRCLE) ---
                this.ctx.lineWidth = 2;
                let strokeColor = '#333';
                let strokeGlow = 0;

                const isInspectedSource = inspection?.sourceId === node.id;
                const isInspectedTarget = inspection?.targetId === node.id;

                if (node.isFiring) {
                    strokeColor = '#ffffff'; // White Ring (Restored)
                    this.ctx.lineWidth = 4;
                    strokeGlow = 20;
                } else if (isInspectedSource) {
                    strokeColor = '#ffff00'; // Yellow for Source
                    this.ctx.lineWidth = 3;
                    strokeGlow = 15;
                } else if (isInspectedTarget) {
                    strokeColor = '#ff8800'; // Orange for Target
                    this.ctx.lineWidth = 3;
                    strokeGlow = 15;
                } else {
                    // --- CUSTOM MODULE COLOR APPLIES HERE ---
                    if (module.color) {
                        strokeColor = module.color;
                        this.ctx.lineWidth = 3; // Make it slightly thicker to be visible
                    } else {
                        // Default Type-based colors
                        if (node.type === NodeType.INPUT) strokeColor = '#ff00ff';
                        else if (node.type === NodeType.OUTPUT) strokeColor = '#ffff00';
                        else if (node.type === NodeType.INTERPRETATION) strokeColor = '#ffaa00';
                        else strokeColor = '#00ffff';
                    }
                }

                this.ctx.strokeStyle = strokeColor;
                if (strokeGlow > 0) {
                    this.ctx.shadowBlur = strokeGlow;
                    this.ctx.shadowColor = strokeColor;
                }
                this.ctx.stroke();
                this.ctx.shadowBlur = 0; // Reset

                // Label: Only show if custom (label != id)
                const isDefault = node.label === node.id || node.label === `${node.id}`;

                if (!isDefault && node.label && node.type !== NodeType.HIDDEN && node.type !== NodeType.INTERPRETATION) {
                    this.ctx.fillStyle = '#fff';
                    this.ctx.font = '12px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.fillText(node.label, node.x, node.y - (radius + 5));
                }
            });
        });

        // 4. Hover Tooltip
        if (hoveredNodeId) {
            const node = net.nodes.get(hoveredNodeId);
            // Check visibility for tooltip
            if (node && !showHidden && (node.type === NodeType.HIDDEN || node.type === NodeType.INTERPRETATION)) {
                // Should not show!
            } else if (node) {
                // Draw tooltip near node
                const labelText = node.label || node.id;

                let status = '';
                if (node.isFiring) status = ' (FIRED!)';
                const statsText = `Potential: ${node.potential.toFixed(3)}${status}`;

                this.ctx.font = '12px Courier New';
                const labelMetrics = this.ctx.measureText(labelText);
                const statsMetrics = this.ctx.measureText(statsText);

                const padding = 8;
                const lineHeight = 16;
                const width = Math.max(labelMetrics.width, statsMetrics.width) + (padding * 2);
                const height = (lineHeight * 2) + (padding * 2);

                const tx = node.x + 15;
                const ty = node.y - height;

                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
                this.ctx.fillRect(tx, ty, width, height);
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 1;
                this.ctx.strokeRect(tx, ty, width, height);

                this.ctx.fillStyle = '#fff';
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'top';

                // Draw Label Title (Bold-ish color or just white)
                this.ctx.fillStyle = '#44cb82'; // Greenish title
                this.ctx.fillText(labelText, tx + padding, ty + padding);

                // Draw Stats
                this.ctx.fillStyle = '#fff';
                this.ctx.fillText(statsText, tx + padding, ty + padding + lineHeight);
            }
        }
    }
}
