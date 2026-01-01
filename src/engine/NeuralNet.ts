import { Node } from './Node';
import { Connection } from './Connection';
import type { NodeConfig, ConnectionConfig, ModuleConfig, ConnectionSide } from './types';
import { NodeType } from './types';

export class NeuralNet {
    public nodes: Map<string, Node> = new Map();
    public connections: Connection[] = [];
    public modules: Map<string, ModuleConfig> = new Map();

    // Cache for quick lookup of incoming connections per node
    public incoming: Map<string, Connection[]> = new Map();
    // Cache for Node ID -> Module ID lookup
    public nodeModuleMap: Map<string, string> = new Map();

    constructor() { }

    public addNode(config: NodeConfig) {
        const node = new Node(config);
        this.nodes.set(node.id, node);
        this.incoming.set(node.id, []);
    }

    public addConnection(config: ConnectionConfig) {
        const conn = new Connection(config);
        this.connections.push(conn);

        // Register in lookup
        const list = this.incoming.get(conn.targetId);
        if (list) {
            list.push(conn);
        } else {
            this.incoming.set(conn.targetId, [conn]);
        }
    }

    public addModule(config: ModuleConfig) {
        if (config.type === 'BRAIN' && config.hebbianLearning === undefined) {
            config.hebbianLearning = true;
            config.learningRate = 0.01;
        }
        this.modules.set(config.id, config);

        // Generate Nodes based on Type
        if (config.type === 'BRAIN') {
            // BRAIN: Golden Spiral Distribution
            const centerX = config.x;
            const centerY = config.y;
            const radius = config.radius || 200;
            const goldenAngle = Math.PI * (3 - Math.sqrt(5));

            for (let i = 0; i < config.nodeCount; i++) {
                const theta = i * goldenAngle;
                const r = radius * Math.sqrt((i + 1) / config.nodeCount);

                const nodeId = `${config.id}-${i}`;
                this.addNode({
                    id: nodeId,
                    type: NodeType.HIDDEN,
                    x: centerX + r * Math.cos(theta),
                    y: centerY + r * Math.sin(theta),
                    label: '',
                    activationType: config.activationType || 'SUSTAINED',
                    decay: config.decay
                });
                this.nodeModuleMap.set(nodeId, config.id);
            }

            // Recurrent Internal Connections (Bidirectional)
            const nodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(config.id));
            nodes.forEach(source => {
                // Connect to random peers (One-Way)
                for (let k = 0; k < 1; k++) {
                    let target = nodes[Math.floor(Math.random() * nodes.length)];
                    // Prevent Self-Connections to avoid infinite feedback loops
                    while (target.id === source.id && nodes.length > 1) {
                        target = nodes[Math.floor(Math.random() * nodes.length)];
                    }

                    // Forward
                    // Forward only (One-way)
                    this.addConnection({
                        id: `c-${source.id}-${target.id}-${k}`,
                        sourceId: source.id,
                        targetId: target.id,
                        weight: Math.random() // Positive only (0 to 1) for teal visuals
                    });

                    // REMOVED: Twoway/Reverse connection logic
                }
            });

        } else {
            // LAYER / INPUT / OUTPUT: Vertical Columns
            const height = config.height || 600;
            const startY = config.y - (height / 2);
            const stepY = height / (config.nodeCount + 1);

            const depth = config.depth || 1;
            const widthSpacing = config.width || 100;

            const startX = config.x - ((depth - 1) * widthSpacing) / 2;

            let nodeType: NodeType = NodeType.HIDDEN;
            if (config.type === 'INPUT') nodeType = NodeType.INPUT;
            if (config.type === 'OUTPUT') nodeType = NodeType.OUTPUT;
            if (config.type === 'LAYER') nodeType = NodeType.INTERPRETATION;

            for (let d = 0; d < depth; d++) {
                const colX = startX + (d * widthSpacing);

                for (let i = 0; i < config.nodeCount; i++) {
                    const nodeId = `${config.id}-${d}-${i}`;
                    this.addNode({
                        id: nodeId,
                        type: nodeType,
                        x: colX,
                        y: startY + stepY * (i + 1),
                        label: '',
                        activationType: config.activationType || 'PULSE',
                        decay: config.decay
                    });
                    this.nodeModuleMap.set(nodeId, config.id);
                }

                if (d > 0) {
                    const prevColIdx = d - 1;
                    for (let currI = 0; currI < config.nodeCount; currI++) {
                        for (let prevI = 0; prevI < config.nodeCount; prevI++) {
                            const srcId = `${config.id}-${prevColIdx}-${prevI}`;
                            const tgtId = `${config.id}-${d}-${currI}`;
                            this.addConnection({
                                id: `c-${srcId}-${tgtId}`,
                                sourceId: srcId,
                                targetId: tgtId,
                                weight: Math.random() // Positive only
                            });
                        }
                    }
                }
            }
        }
    }

    /**
     * Updates an existing module and regenerates its nodes.
     * Preserves ID, Name, Position. Re-creates nodes based on new count/depth.
     * Prunes invalid connections.
     */
    public updateModule(id: string, newConfig: Partial<ModuleConfig>) {
        const module = this.modules.get(id);
        if (!module) return;

        // Check if we need to regenerate structure
        const structuralKeys: (keyof ModuleConfig)[] = ['type', 'nodeCount', 'depth', 'radius', 'height', 'width', 'activationType'];
        const needsRegeneration = structuralKeys.some(key => newConfig[key] !== undefined && newConfig[key] !== module[key]);

        // Always update the config object
        Object.assign(module, newConfig);

        // If only metadata changed (name, color, label, threshold), update nodes and exit
        if (!needsRegeneration) {
            // Update node labels if name changed
            if (newConfig.name) {
                this.renameModule(id, newConfig.name);
            }

            // Update threshold efficiently without regeneration
            if (newConfig.threshold !== undefined) {
                for (const node of this.nodes.values()) {
                    if (node.id.startsWith(id + '-')) {
                        node.threshold = newConfig.threshold;
                    }
                }
            }
            return;
        }

        const mergedConfig = { ...module, ...newConfig };

        // 1. Remove old nodes for this module
        // We filter out nodes that start with `id-`
        // Note: This is destructive to node state (activation/potential).
        const idsToRemove = new Set<string>();
        for (const node of this.nodes.values()) {
            if (node.id.startsWith(id + '-')) {
                idsToRemove.add(node.id);
            }
        }

        idsToRemove.forEach(nodeId => {
            this.nodes.delete(nodeId);
            this.incoming.delete(nodeId);
            this.nodeModuleMap.delete(nodeId);
        });

        // 2. Re-run addModule logic (generation)
        // addModule sets the module config again and generates nodes
        this.addModule(mergedConfig);

        // 3. Prune invalid connections
        // Connections might refer to node IDs that no longer exist (if count decreased)
        // or loopback connections that were internal.
        // We filter the connections list.
        this.connections = this.connections.filter(c => {
            const srcExists = this.nodes.has(c.sourceId);
            const tgtExists = this.nodes.has(c.targetId);
            return srcExists && tgtExists;
        });

        // Re-build incoming map for safety (addConnection updates it, but removing didn't fully clean up lists inside Map values)
        // Actually, step 1 deleted entries for removed nodes.
        // But existing nodes (other modules) might have connections FROM removed nodes.
        // We need to clean those lists.
        // Re-build incoming map
        this.incoming.clear();
        this.connections.forEach(c => {
            const list = this.incoming.get(c.targetId);
            if (list) list.push(c);
            else this.incoming.set(c.targetId, [c]);
        });

        // 4. Repair External Connectivity
        // New nodes (if count increased) are currently orphaned.
        // We need to ensure that if this module was connected to X, the NEW nodes also connect to X.

        // Helper to check and add missing connections
        const ensureConnection = (srcModId: string, tgtModId: string) => {
            const srcMod = this.modules.get(srcModId);
            const tgtMod = this.modules.get(tgtModId);
            if (!srcMod || !tgtMod) return;

            const srcNodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(srcModId + '-'));
            const tgtNodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(tgtModId + '-'));

            if (srcNodes.length === 0 || tgtNodes.length === 0) return;

            // Build set of existing connections for O(1) lookup
            const existing = new Set<string>();
            this.connections.forEach(c => existing.add(c.id));

            // Sparse Logic (match connectModules)
            // Removed Sparse Logic to ensure "all nodes" are included as requested
            // const potential = srcNodes.length * tgtNodes.length;
            // const isSparse = potential > 2500;

            srcNodes.forEach(src => {
                tgtNodes.forEach(tgt => {
                    const connId = `c-${src.id}-${tgt.id}`;
                    if (!existing.has(connId)) {
                        this.addConnection({
                            id: connId,
                            sourceId: src.id,
                            targetId: tgt.id,
                            weight: Math.random() // Positive
                        });
                    }
                });
            });
        };

        // Re-connect to previously identified neighbors
        // optimization: we can assume neighbors based on surviving connections
        // If we scaled DOWN, some neighbors might have lost ALL connections.
        // So we really should have captured neighbors BEFORE the wipe.
        // BUT, since we filtered connections in Step 3 based on 'srcExists && tgtExists',
        // and 'addModule' re-uses IDs (0..N), the connections for 0..N are preserved.
        // So we can still find the neighbors by looking at valid connections!

        const neighborsOut = new Set<string>();
        const neighborsIn = new Set<string>();

        this.connections.forEach(c => {
            // We need to resolve Module IDs from Node IDs
            // Since we just rebuilt nodes, we can use the prefix check or look it up
            // Simple prefix check is fast enough here or we trust the surviving connections
            const srcNode = this.nodes.get(c.sourceId);
            const tgtNode = this.nodes.get(c.targetId);
            if (!srcNode || !tgtNode) return;

            // Extract Module ID (everything before last hyphen is risky if we have dashes in name, 
            // but here IDs are robust: "modID-index" or "modID-depth-index")
            // actually our node IDs are "modID-..." 
            // Let's rely on the module list to find owner.
            // Optimize: Check if starts with THIS module ID

            if (c.sourceId.startsWith(id + '-')) {
                // Outgoing from THIS
                // Find target module
                // We can find target module by iterating modules (slow) or assumption.
                // Better: iterate all modules for exact matches.
                // For now, let's use the robust `getModuleConnectivity` logic's reverse:
                // We can iterate ALL modules to find owners.
                // Or simple heuristic:
                // We just need to know which OTHER modules are touched.
                // Let's look at the implementation of getModuleConnectivity again?
                // No, let's just iterate all modules once to map Node->Module for the *relevant* connections.
            }
        });

        // Actually, simpler approach:
        // 1. Get all connections involving this module (preserved ones).
        // 2. Identify the "Other" module ID.
        // 3. Add to set.
        // 4. Run ensureConnection.

        this.connections.forEach(c => {
            const isSource = c.sourceId.startsWith(id + '-');
            const isTarget = c.targetId.startsWith(id + '-');

            if (isSource && !isTarget) {
                // Outgoing to someone. Who? 
                // We don't know the module ID of target easily without lookup.
                // let's try to extract it. 
                // Heuristic: Module IDs are typically UUIDs or simple strings.
                // Node ID: "MODULE_ID-..."
                // We can check against key in this.modules
                for (const [modId] of this.modules) {
                    if (modId !== id && c.targetId.startsWith(modId + '-')) {
                        neighborsOut.add(modId);
                        break;
                    }
                }
            } else if (isTarget && !isSource) {
                // Incoming from someone
                for (const [modId] of this.modules) {
                    if (modId !== id && c.sourceId.startsWith(modId + '-')) {
                        neighborsIn.add(modId);
                        break;
                    }
                }
            }
        });

        neighborsOut.forEach(tgt => ensureConnection(id, tgt));
        neighborsIn.forEach(src => ensureConnection(src, id));
    }

    public moveModule(id: string, newX: number, newY: number) {
        const module = this.modules.get(id);
        if (!module) return;

        const dx = newX - module.x;
        const dy = newY - module.y;

        module.x = newX;
        module.y = newY;

        // Move all nodes
        for (const node of this.nodes.values()) {
            if (node.id.startsWith(id + '-')) {
                node.x += dx;
                node.y += dy;
            }
        }
    }

    public renameModule(id: string, newName: string) {
        const module = this.modules.get(id);
        if (!module) return;
        module.name = newName;

        // Update labels?
        // Node labels are "label-index". 
        // We can update them but it's expensive loop. 
        // Visualizer usage of label: draws text.
        // Let's update them.
        for (const node of this.nodes.values()) {
            if (node.id.startsWith(id + '-')) {
                const suffix = node.id.substring(id.length); // "-0" or "-0-1"
                node.label = `${newName}${suffix}`;
            }
        }
    }

    public updateNode(nodeId: string, config: { label?: string }) {
        const node = this.nodes.get(nodeId);
        if (node) {
            if (config.label !== undefined) node.label = config.label;
        }
    }

    public getModuleNodes(moduleId: string): Node[] {
        // Filter nodes that belong to this module (prefix check)
        // Optimization: Could store this in module config, but filter is fine for UI
        return Array.from(this.nodes.values())
            .filter(n => n.id.startsWith(moduleId + '-'))
            .sort((a, b) => {
                // Sort by ID (usually index)
                return a.id.localeCompare(b.id, undefined, { numeric: true });
            });
    }

    public connectModules(sourceId: string, targetId: string, srcSide: ConnectionSide = 'ALL', tgtSide: ConnectionSide = 'ALL') {
        const getNodesForSide = (modId: string, side: ConnectionSide): Node[] => {
            const mod = this.modules.get(modId);
            if (!mod) return [];

            const allNodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(modId + '-'));

            if (mod.type === 'BRAIN') return allNodes;

            if (side === 'ALL') return allNodes;

            const depth = mod.depth || 1;
            // Left = index 0. Right = index depth-1.
            const targetCol = side === 'LEFT' ? 0 : (depth - 1);

            return allNodes.filter(n => {
                // ID format: "modId-depth-index"
                const suffix = n.id.substring(modId.length + 1);
                const [dStr] = suffix.split('-');
                const d = parseInt(dStr);
                return d === targetCol;
            });
        };

        const sourceNodes = getNodesForSide(sourceId, srcSide);
        const targetNodes = getNodesForSide(targetId, tgtSide);

        if (sourceNodes.length === 0 || targetNodes.length === 0) return;

        // const potential = sourceNodes.length * targetNodes.length;
        // const isSparse = potential > 2500;

        sourceNodes.forEach(src => {
            targetNodes.forEach((tgt) => {
                this.addConnection({
                    id: `c-${src.id}-${tgt.id}`,
                    sourceId: src.id,
                    targetId: tgt.id,
                    weight: Math.random() // Positive only
                });
            });
        });
    }

    public reset() {
        this.nodes.forEach(n => n.reset());
    }

    public getNodes() {
        return Array.from(this.nodes.values());
    }

    public toJSON() {
        return {
            modules: Array.from(this.modules.values()),
            nodes: Array.from(this.nodes.values()).map(n => ({
                id: n.id,
                type: n.type,
                x: n.x,
                y: n.y,
                label: n.label,
                activationType: n.activationType,
                // Save state too? Maybe potential
                potential: n.potential
            })),
            connections: this.connections.map(c => ({
                id: c.id,
                sourceId: c.sourceId,
                targetId: c.targetId,
                weight: c.weight
            }))
        };
    }

    public fromJSON(data: { modules?: ModuleConfig[], nodes: NodeConfig[], connections: ConnectionConfig[] }) {
        this.nodes.clear();
        this.connections = [];
        this.incoming.clear();
        this.modules.clear();

        if (data.modules) {
            data.modules.forEach(m => this.modules.set(m.id, m));
        }

        data.nodes.forEach(n => this.addNode({
            ...n,
            label: n.label // Ensure label is passed if not in spread
        }));

        // Rebuild Node->Module Map
        this.nodeModuleMap.clear();
        this.modules.forEach(mod => {
            // Re-identify nodes for this module
            // This relies on ID prefixes matching
            const nodes = this.getModuleNodes(mod.id);
            nodes.forEach(n => this.nodeModuleMap.set(n.id, mod.id));
        });

        data.connections.forEach(c => this.addConnection(c));
    }

    public step() {
        const inputSums = new Map<string, number>();

        this.nodes.forEach(node => {
            if (node.type === NodeType.INPUT) return;

            let sum = 0;
            const incomingConns = this.incoming.get(node.id) || [];

            // Normalization Logic: Group connections by source Brain module
            const brainInputs = new Map<string, { conns: { conn: Connection, rawSignal: number }[] }>();

            incomingConns.forEach(conn => {
                const sourceNode = this.nodes.get(conn.sourceId);
                if (sourceNode) {
                    const rawSignal = sourceNode.activation * conn.weight;

                    const sourceModId = this.nodeModuleMap.get(sourceNode.id);
                    const targetModId = this.nodeModuleMap.get(node.id);

                    let isExternalBrain = false;
                    if (sourceModId && sourceModId !== targetModId) {
                        const sourceMod = this.modules.get(sourceModId);
                        if (sourceMod && sourceMod.type === 'BRAIN') {
                            isExternalBrain = true;
                        }
                    }

                    if (isExternalBrain && sourceModId) {
                        let entry = brainInputs.get(sourceModId);
                        if (!entry) {
                            entry = { conns: [] };
                            brainInputs.set(sourceModId, entry);
                        }
                        entry.conns.push({ conn, rawSignal });
                    } else {
                        // Standard processing
                        sum += rawSignal;
                        conn.signalStrength = Math.abs(rawSignal);
                    }
                }
            });

            // Process Normalized Inputs
            brainInputs.forEach((entry) => {
                const count = entry.conns.length;
                if (count > 0) {
                    // Normalization Factor: 1.0 / Total Connections from this brain
                    // This ensures the total possible input from the brain is effectively "averaged"
                    // preventing saturation from 100+ connections.
                    const normFactor = 1.0 / count;

                    entry.conns.forEach(item => {
                        const normalizedSignal = item.rawSignal * normFactor;
                        sum += normalizedSignal;
                        // Visualizer: Use raw signal so activity is visible, 
                        // even though physics uses normalized input.
                        item.conn.signalStrength = Math.abs(item.rawSignal);
                    });
                }
            });

            inputSums.set(node.id, sum);
        });

        this.nodes.forEach(node => {
            if (node.type === NodeType.INPUT) {
                node.update(0);
            } else {
                const inputSum = inputSums.get(node.id) || 0;
                node.update(inputSum);
            }
        });

        // 3. Hebbian Learning (Phase 12)
        this.modules.forEach(module => {
            if (module.type === 'BRAIN' && module.hebbianLearning) {
                const rate = module.learningRate || 0.01;
                const moduleId = module.id;

                // Optimization: Filter global connections for internal ones
                // Note: In a high-performance scenario, we would cache this list.
                const internalConns = this.connections.filter(c =>
                    c.sourceId.startsWith(moduleId) && c.targetId.startsWith(moduleId)
                );

                internalConns.forEach(conn => {
                    const src = this.nodes.get(conn.sourceId);
                    const tgt = this.nodes.get(conn.targetId);

                    if (src && tgt && src.isFiring) {
                        // Hebbian Rule: "Cells that fire together, wire together"
                        if (tgt.isFiring) {
                            conn.weight += rate; // Strengthen
                        } else {
                            // Anti-Hebbian / LTD (Long Term Depression)
                            // If source fires but target doesn't, the connection weakens
                            conn.weight -= rate;
                        }

                        // Clamp Weights to [-1, 1]
                        if (conn.weight > 1) conn.weight = 1;
                        if (conn.weight < -1) conn.weight = -1;
                    }
                });
            }
        });
    }

    /**
     * Removes all connections between two modules.
     */
    public disconnectModules(modId1: string, modId2: string) {
        this.connections = this.connections.filter(c => {
            const isSrc1 = this.nodes.get(c.sourceId)?.id.startsWith(modId1 + '-');
            const isTgt2 = this.nodes.get(c.targetId)?.id.startsWith(modId2 + '-');

            const isSrc2 = this.nodes.get(c.sourceId)?.id.startsWith(modId2 + '-');
            const isTgt1 = this.nodes.get(c.targetId)?.id.startsWith(modId1 + '-');

            // Remove if 1->2 OR 2->1 (Total disconnect? Or just directed?)
            // User likely wants granular control. Let's strictly support directional or both.
            // For now, let's just remove ALL links between them to be safe/simple "Delete Link" action.
            return !((isSrc1 && isTgt2) || (isSrc2 && isTgt1));
        });

        // Rebuild lookup
        this.incoming.clear();
        this.connections.forEach(c => {
            const list = this.incoming.get(c.targetId);
            if (list) list.push(c);
            else this.incoming.set(c.targetId, [c]);
        });
    }

    public getNodeConnections(nodeId: string) {
        // Retrieve all connections where this node is source or target
        const incoming = this.incoming.get(nodeId) || [];
        const outgoing = this.connections.filter(c => c.sourceId === nodeId);

        return {
            incoming,
            outgoing
        };
    }

    /**
     * Returns a summary of connections for a specific module.
     * Used for the Inspector UI.
     */
    public getModuleConnectivity(moduleId: string) {
        const stats = new Map<string, { id: string, count: number, direction: 'in' | 'out' | 'self' }>();

        // Create a lookup for module ID by node ID
        const nodeToModuleId = new Map<string, string>();

        this.modules.forEach(mod => {
            const nodes = this.getModuleNodes(mod.id);
            nodes.forEach(n => nodeToModuleId.set(n.id, mod.id));
        });

        this.connections.forEach(c => {
            const srcModId = nodeToModuleId.get(c.sourceId);
            const tgtModId = nodeToModuleId.get(c.targetId);

            if (!srcModId || !tgtModId) return;

            // CASE 1: Outgoing from selected module
            if (srcModId === moduleId) {
                const key = `out-${tgtModId}`;
                // If source==target, it's internal/self.
                const dir = srcModId === tgtModId ? 'self' : 'out';

                if (!stats.has(key)) {
                    stats.set(key, { id: tgtModId, count: 0, direction: dir });
                }
                stats.get(key)!.count++;
            }

            // CASE 2: Incoming to selected module (from OTHERS)
            // We generally separate "Internal" (Self) from "In".
            // If srcMod == tgtMod == moduleId, we already caught it above as 'self'.
            // So here we only care if tgtMod == moduleId && srcMod != moduleId.
            if (tgtModId === moduleId && srcModId !== moduleId) {
                const key = `in-${srcModId}`;
                if (!stats.has(key)) {
                    stats.set(key, { id: srcModId, count: 0, direction: 'in' });
                }
                stats.get(key)!.count++;
            }
        });

        return Array.from(stats.values());
    }

    public setGlobalDecay(decay: number) {
        this.nodes.forEach(n => {
            // Apply global decay setting ONLY to Brain/Hidden nodes.
            // Inputs are manual. 
            // Outputs/Layers must remain at 1.0 (Instant) to avoid lag.

            // Better check based on our Logic:
            if (n.type === NodeType.OUTPUT || n.type === NodeType.INTERPRETATION) {
                // FORCE these to stay at 1.0
                n.decay = 1.0;
            } else if (n.type !== NodeType.INPUT) {
                // Only Brain nodes get the slider value
                n.decay = decay;
            }
        });
    }
}
