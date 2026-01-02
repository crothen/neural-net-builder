import { BaseNode } from './nodes/BaseNode';
import { NodeFactory } from './NodeFactory';
import { Connection } from './Connection';
import type { NodeConfig, ConnectionConfig, ModuleConfig, ConnectionSide, ModuleConnectionConfig } from './types';
import { NodeType } from './types';

export class NeuralNet {
    public nodes: Map<string, BaseNode> = new Map();
    public connections: Connection[] = [];
    public modules: Map<string, ModuleConfig> = new Map();

    // Config Storage for Links between Modules
    public moduleConnections: Map<string, ModuleConnectionConfig> = new Map();

    // Cache for quick lookup of incoming connections per node
    public incoming: Map<string, Connection[]> = new Map();
    // Cache for Node ID -> Module ID lookup
    public nodeModuleMap: Map<string, string> = new Map();

    constructor() { }

    public addNode(config: NodeConfig) {
        const node = NodeFactory.create(config);
        this.nodes.set(node.id, node);
        this.incoming.set(node.id, []);
    }

    private rebuildIncomingMap() {
        this.incoming.clear();
        this.nodes.forEach(n => this.incoming.set(n.id, []));
        this.connections.forEach(conn => {
            const list = this.incoming.get(conn.targetId);
            if (list) list.push(conn);
            else this.incoming.set(conn.targetId, [conn]);
        });
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

        // USER RULE: If target is Sustained Output, normalize weights immediately
        this.normalizeSustainedWeights(conn.targetId);
    }

    /**
     * Checks if the node belongs to a SUSTAINED_OUTPUT module.
     * If so, sets all incoming weights to (MaxPotential / ConnectionCount).
     */
    public normalizeSustainedWeights(nodeId: string) {
        const moduleId = this.nodeModuleMap.get(nodeId);
        if (!moduleId) return;

        const module = this.modules.get(moduleId);
        if (!module || module.type !== 'SUSTAINED_OUTPUT') return;

        const node = this.nodes.get(nodeId);
        if (!node) return;

        const incoming = this.incoming.get(nodeId) || [];
        if (incoming.length === 0) return;

        const gain = module.gain !== undefined ? module.gain : 3.0; // Default gain 3.0
        const newWeight = gain / incoming.length;

        // Update all incoming weights
        incoming.forEach(conn => {
            conn.weight = newWeight;
        });
    }

    public addModule(config: ModuleConfig) {
        if (config.type === 'BRAIN' && config.hebbianLearning === undefined) {
            config.hebbianLearning = true;
            config.learningRate = 0.01;
        }
        this.modules.set(config.id, config);

        // Inherit defaults if missing
        if (config.type === 'BRAIN') {
            if (config.isLocalized === undefined) config.isLocalized = false;
            if (config.localizationLeak === undefined) config.localizationLeak = 0;
        }

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
                // Dale's Principle: 80% Excitatory, 20% Inhibitory (Initialize)
                const isInhibitory = Math.random() < 0.2; // 20% chance
                const nType = isInhibitory ? 'INHIBITORY' : 'EXCITATORY';

                this.addNode({
                    id: nodeId,
                    type: NodeType.HIDDEN,
                    neuronType: nType,
                    x: centerX + r * Math.cos(theta),
                    y: centerY + r * Math.sin(theta),
                    label: '',
                    activationType: config.activationType || 'PULSE',
                    decay: config.decay,
                    // Pass missing parameters to Node
                    refractoryPeriod: config.refractoryPeriod,
                    threshold: config.threshold,
                    bias: config.bias,
                    maxPotential: config.maxPotential
                });
                this.nodeModuleMap.set(nodeId, config.id);
            }

            // Recurrent Internal Connections
            this.rewireInternalConnections(config.id);
        } else if (config.type === 'CONCEPT') {
            // CONCEPT: Nodes defined by ID/Label list
            const concepts = config.concepts || [];
            // Default layout: Vertical column
            // Default layout: Vertical column
            const height = config.height || (concepts.length * 40); // Increased spacing for readability
            const startY = config.y - (height / 2);
            // Smaller minimum step
            const stepY = concepts.length > 0 ? height / concepts.length : 40;

            concepts.forEach((concept, i) => {
                const nodeId = `${config.id}-${concept.id}`; // Use concept ID if unique, or index? 
                // Concept IDs from CSV might be integers "1", "2". 
                // Let's ensure uniqueness by prepending module ID.
                this.addNode({
                    id: nodeId,
                    type: NodeType.CONCEPT,
                    x: config.x,
                    y: startY + (stepY * i) + (stepY / 2),
                    label: concept.label,
                    activationType: 'PULSE', // Input Concept is usually binary State
                    decay: config.decay || 0.1,
                    refractoryPeriod: config.refractoryPeriod,
                    threshold: config.threshold,
                    bias: config.bias,
                    maxPotential: config.maxPotential
                });
                this.nodeModuleMap.set(nodeId, config.id);
            });
        } else if (config.type === 'LEARNED_OUTPUT') {
            // LEARNED_OUTPUT: Starts empty. Nodes added dynamically during training.
            // No nodes generated here.
        } else {
            // LAYER / INPUT / OUTPUT: Vertical Columns
            const height = config.height || 600;
            const startY = config.y - (height / 2);
            const stepY = height / (config.nodeCount + 1);

            const depth = config.depth || 1;
            const widthSpacing = config.width || 100;

            const startX = config.x - ((depth - 1) * widthSpacing) / 2;

            let nodeType: NodeType = NodeType.HIDDEN;
            let activationType = config.activationType || 'PULSE';

            if (config.type === 'INPUT') nodeType = NodeType.INPUT;
            if (config.type === 'OUTPUT') nodeType = NodeType.OUTPUT;
            if (config.type === 'SUSTAINED_OUTPUT') {
                nodeType = NodeType.OUTPUT;
                activationType = 'SUSTAINED'; // Enforce sustained
            }
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
                        activationType: activationType,
                        decay: config.decay,
                        // Pass missing parameters to Node
                        refractoryPeriod: config.refractoryPeriod,
                        threshold: config.threshold,
                        bias: config.bias,
                        inputFrequency: config.inputFrequency,
                        maxPotential: config.maxPotential
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
                                weight: (Math.random() * 2 - 1) * 0.5
                            });
                        }
                    }
                }
            }
        }
    }



    public populateLearnedOutput(targetId: string, sourceConceptId: string) {
        const target = this.modules.get(targetId);
        const source = this.modules.get(sourceConceptId);

        if (!target || target.type !== 'LEARNED_OUTPUT') return;
        if (!source || source.type !== 'CONCEPT' || !source.concepts) return;

        // Clear existing nodes if any
        // We need to filter 'this.nodes' Map? No, it's a Map<string, Node>.
        // Also need to update nodeModuleMap

        // Naive clearing: Iterate all nodes, remove those belonging to this module
        // Better: this.removeModule(targetId) then re-add? No, that removes connections.
        // But Learned Output starts empty, so maybe just check if empty?

        // Actually, if we re-train, we probably want to wipe and re-create.
        // For now let's assume valid "Training" clears previous state of that module.

        // Remove existing nodes for this module
        const nodeIdsToRemove: string[] = [];
        this.nodes.forEach(n => {
            if (this.nodeModuleMap.get(n.id) === targetId) nodeIdsToRemove.push(n.id);
        });
        nodeIdsToRemove.forEach(nid => {
            this.nodes.delete(nid);
            this.nodeModuleMap.delete(nid);
        });

        // Create nodes for each concept
        const concepts = source.concepts;
        const spacing = (target.height || 600) / (concepts.length + 1);
        const startY = target.y - ((target.height || 600) / 2) + spacing;

        concepts.forEach((concept, i) => {
            const nodeId = `${target.id}-node-${concept.id}`;
            this.addNode({
                id: nodeId,
                x: target.x,
                y: startY + (i * spacing),
                // initialPotential: 0, // Removed: Not in NodeConfig
                threshold: target.threshold || 0.5,
                decay: 0.1,
                activationType: 'SUSTAINED',
                refractoryPeriod: 2,
                label: concept.label,
                type: 'LEARNED' as any
            });
            this.nodeModuleMap.set(nodeId, target.id);
        });

        // Update target node count
        target.nodeCount = concepts.length;
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
        // Check if we need to regenerate structure
        const topologyKeys: (keyof ModuleConfig)[] = ['type', 'nodeCount', 'depth'];
        const geometryKeys: (keyof ModuleConfig)[] = ['radius', 'height', 'width'];

        const needsTopologyRegen = topologyKeys.some(key => newConfig[key] !== undefined && newConfig[key] !== module[key]);
        const needsGeometryUpdate = geometryKeys.some(key => newConfig[key] !== undefined && newConfig[key] !== module[key]);
        const needsRewiring = newConfig.isLocalized !== undefined
            || newConfig.localizationLeak !== undefined
            || newConfig.synapsesPerNode !== undefined
            || newConfig.initialWeightModifier !== undefined;

        if (needsGeometryUpdate && !needsTopologyRegen) {
            // Non-destructive update of node positions (Scaling)
            Object.assign(module, newConfig);

            if (module.type === 'BRAIN') {
                const centerX = module.x;
                const centerY = module.y;
                const radius = module.radius || 200;
                const goldenAngle = Math.PI * (3 - Math.sqrt(5));

                // Re-calculate positions for existing nodes based on index
                const nodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(id + '-'))
                    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

                nodes.forEach((node, i) => {
                    const theta = i * goldenAngle;
                    const r = radius * Math.sqrt((i + 1) / nodes.length); // Use current length as count
                    node.x = centerX + r * Math.cos(theta);
                    node.y = centerY + r * Math.sin(theta);
                });
            } else {
                // LAYER / INPUT / OUTPUT
                const nodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(id + '-'));
                const height = module.height || 600;
                const startY = module.y - (height / 2);
                const stepY = height / (module.nodeCount + 1);

                const depth = module.depth || 1;
                const widthSpacing = module.width || 100;
                const startX = module.x - ((depth - 1) * widthSpacing) / 2;

                nodes.forEach(node => {
                    // Extract Indices from ID: "modId-depth-index"
                    // Brain nodes might have "modId-index", but we check type above.
                    // Layer nodes: "modId-col-row"
                    const parts = node.id.split('-');
                    // parts[0] = modId. 
                    // if parts.length == 3: modId, col, row.
                    // if parts.length == 2: modId, row (Input/Output usually depth=1 but might be stored as simple index if I look at addModule logic?)
                    // Let's re-verify addModule.
                    // Input/output logic: "nodeId = `${config.id}-${d}-${i}`" (lines 97-101 in previous view)
                    // So they are 0-indexed column.

                    if (parts.length >= 3) {
                        const col = parseInt(parts[parts.length - 2]);
                        const row = parseInt(parts[parts.length - 1]);

                        const colX = startX + (col * widthSpacing);
                        node.x = colX;
                        node.y = startY + stepY * (row + 1);
                    }
                });
            }
            // Should we rewire internal if geometry changes? 
            // If localized, YES, because distances changed.
            if (module.isLocalized) {
                this.rewireInternalConnections(id);
            }
            return;
        }

        const needsRegeneration = needsTopologyRegen;

        // Always update the config object
        Object.assign(module, newConfig);

        // If only metadata changed (name, color, label, threshold), update nodes and exit
        if (!needsRegeneration) {
            // Update node labels if name changed
            if (newConfig.name) {
                this.renameModule(id, newConfig.name);
            }

            // Update params efficiently without regeneration
            const relevantNodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(id + '-'));
            relevantNodes.forEach(node => {
                if (newConfig.threshold !== undefined) node.threshold = newConfig.threshold;
                if (newConfig.decay !== undefined) node.decay = newConfig.decay;
                if (newConfig.refractoryPeriod !== undefined) node.refractoryPeriod = Number(newConfig.refractoryPeriod);
                if (newConfig.fatigue !== undefined) node.fatigue = newConfig.fatigue;
                if (newConfig.recovery !== undefined) node.recovery = newConfig.recovery;
                if (newConfig.initialWeightModifier !== undefined) {
                    // Update internal initial weight modifier on module config
                    // Wait, this is stored on modules map, not nodes. 
                    // Passed config `newConfig` is merged later in `Object.assign(module, newConfig)` 
                    // but we do that AFTER this block if `!needsRegeneration`.
                    // We need to ensure module config is updated if we are skipping regen.
                    // But wait, line 361 `Object.assign` is AFTER this block?
                    // NO, line 361 is inside the `else` block or after?
                    // Let's check view_file.
                    // Ah, `Object.assign(module, newConfig)` is at line 361, which is OUTSIDE the `if (!needsRegeneration)` block?
                    // No, line 282: updateModule starts.
                    // Line 361 `Object.assign` is executed regardless?
                    // Wait, lines 297-356 handle geometry update and RETURN.
                    // Then line 361 executes.
                    // Then line 364: `if (!needsRegeneration)`.
                    // So `module` IS ALREADY updated with `newConfig` by line 364.
                    // So if `needsRewiring` is true, we just call `rewireInternalConnections(id)`.
                    // We don't need to do anything special here for `initialWeightModifier`.
                    // It will be picked up by `rewireInternalConnections` from `this.modules.get(moduleId)`.
                }
                if (newConfig.activationType !== undefined) {
                    const typeInput = String(newConfig.activationType).toUpperCase();
                    node.activationType = (typeInput === 'SUSTAINED') ? 'SUSTAINED' : 'PULSE';
                }
            });

            if (newConfig.activationType !== undefined) {
                // Optimization: Remove activationType from structuralKeys if we handle it here?
                // No, line 153 already has it. I should remove it from structuralKeys in the next step
                // OR jus let it regen if I don't handle it here. 
            }

            if (needsRewiring) {
                this.rewireInternalConnections(id);
            }

            // USER RULE: Update weights if Max Potential OR Gain changes for SUSTAINED_OUTPUT
            if ((newConfig.maxPotential !== undefined || newConfig.gain !== undefined) && module.type === 'SUSTAINED_OUTPUT') {
                const relevantNodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(id + '-'));
                relevantNodes.forEach(node => this.normalizeSustainedWeights(node.id));
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

            // FIND SAVED CONFIG
            const forwardKey = `${srcModId}-${tgtModId}`;
            const reverseKey = `${tgtModId}-${srcModId}`;
            const config = this.moduleConnections.get(forwardKey) || this.moduleConnections.get(reverseKey);

            // Default params if no config found (Legacy behavior: 100%)
            const coverage = config ? config.coverage : 100;
            const localizer = config ? config.localizer : 0;

            // Pre-calculate positions for localization if needed
            // (Assuming verifyLocalization Logic logic is roughly: sort by distance)

            srcNodes.forEach(src => {
                // If Localized, we might sort targets by distance? 
                // Or simply apply probability based on distance?
                // The connectModules implementation does detailed localization.
                // Replicating FULL localizer logic here is complex inside this loop.
                // Simplified "Selection" Logic:

                let potentialTargets = [...tgtNodes];

                // 1. Sort by distance if localized
                if (localizer > 0) {
                    potentialTargets.sort((a, b) => {
                        const distA = (a.x - src.x) ** 2 + (a.y - src.y) ** 2;
                        const distB = (b.x - src.x) ** 2 + (b.y - src.y) ** 2;
                        return distA - distB;
                    });
                } else {
                    // Random shuffle for standard coverage
                    potentialTargets.sort(() => Math.random() - 0.5);
                }

                // 2. Determine how many to connect
                // Coverage % of ALL targets? 
                // For "ALL" -> "ALL": count = targets.length * (coverage/100)
                // We assume strict ALL-ALL topology for now as we don't parse "Sides" deeply here
                const countToConnect = Math.max(1, Math.floor(potentialTargets.length * (coverage / 100)));

                // 3. Connect to top N (closest or random)
                for (let i = 0; i < countToConnect; i++) {
                    const tgt = potentialTargets[i];
                    const connId = `c-${src.id}-${tgt.id}`;

                    if (!existing.has(connId)) {
                        // Apply randomness if leak?
                        // If Localizer > 0, we already sorted. 
                        // Leak logic in connectModules is complex (probabilistic swap).
                        // For REPAIR, exact adherence to original shape is hard without storing seed.
                        // We do our best to respect the *Intent* (Coverage/Sort).

                        this.addConnection({
                            id: connId,
                            sourceId: src.id,
                            targetId: tgt.id,
                            weight: (Math.random()) * (srcMod.type === 'BRAIN' ? 1 : 1) // Positive for now in repair? Or check Brain?
                            // Creating Input->Brain should be positive. Brain->Brain?
                            // Let's stick to positive random unless requested otherwise.
                            // User asked for negative weights "when creating new connections in a brain".
                            // This function connects ANY modules. 
                            // If Source is BRAIN -> Target BRAIN, maybe allow negative?
                            // Let's keep it positive 0..1 to be safe for general wiring, 
                            // unless it's strictly internal rewiring which uses the other function.
                        });
                    }
                }
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

    public updateNode(nodeId: string, config: { label?: string, inputType?: 'PULSE' | 'SIN' | 'NOISE', inputFrequency?: number }) {
        const node = this.nodes.get(nodeId);
        if (node) {
            if (config.label !== undefined) node.label = config.label;
            if (config.inputFrequency !== undefined) node.inputFrequency = config.inputFrequency;
            if (config.inputType !== undefined) {
                node.inputType = config.inputType;
                // If switching to manual Pulse, user controls it. 
                // If switching to generators, they will take over in step().
            }
        }
    }

    private getBrainNodeAngle(node: BaseNode, mod: ModuleConfig): number {
        return Math.atan2(node.y - mod.y, node.x - mod.x);
    }

    private getAngleDist(a1: number, a2: number) {
        let diff = Math.abs(a1 - a2);
        if (diff > Math.PI) diff = (2 * Math.PI) - diff;
        return diff;
    }

    /**
     * Generic Location (0.0 - 1.0)
     * Brain: Normalized Angle (-PI..PI -> 0..1)
     * Linear: Normalized Index (0..N -> 0..1)
     */
    private getRelativeLocation(node: BaseNode, mod: ModuleConfig, index: number, total: number): number {
        if (mod.type === 'BRAIN') {
            const angle = this.getBrainNodeAngle(node, mod);
            // Map -PI..PI to 0..1
            return (angle + Math.PI) / (2 * Math.PI);
        }
        // Linear
        if (total <= 1) return 0.5;
        return index / (total - 1);
    }

    private getRelativeDist(a: number, b: number, bothCircular: boolean): number {
        let diff = Math.abs(a - b);
        if (bothCircular) {
            if (diff > 0.5) diff = 1.0 - diff;
        }
        return diff;
    }

    private normalizeWeights(node: BaseNode, targetSum: number) {
        const incoming = this.incoming.get(node.id);
        if (!incoming || incoming.length === 0) return;

        let currentSum = 0;
        incoming.forEach(c => currentSum += Math.abs(c.weight));

        if (currentSum > targetSum) {
            const factor = targetSum / currentSum;
            incoming.forEach(c => {
                // Protected Decay: Only decay "established" connections (> 0.1).
                // Leave weak "baby" weights alone to give them a chance to grow.
                if (Math.abs(c.weight) > 0.1) {
                    c.weight *= factor;
                }
            });
        }
    }

    public rewireInternalConnections(moduleId: string) {
        const module = this.modules.get(moduleId);
        if (!module) return;

        // 1. Remove existing internal connections
        this.connections = this.connections.filter(c => {
            const srcMod = this.nodeModuleMap.get(c.sourceId);
            const tgtMod = this.nodeModuleMap.get(c.targetId);
            return !(srcMod === moduleId && tgtMod === moduleId);
        });
        this.rebuildIncomingMap(); // Quickest way to clean up maps

        // 2. Create new connections
        const nodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(moduleId + '-'));
        const connectionsPerNode = module.synapsesPerNode || 2; // Fixed sparse connectivity

        const isLocalized = module.isLocalized || false;
        const leak = module.localizationLeak || 0;
        const targetPercentage = module.initialWeightModifier ?? 0.2; // Default 20% consensus

        nodes.forEach(source => {
            // 1. Prepare Candidates
            let candidates = nodes.filter(n => n.id !== source.id);

            // 2. Sort by Euclidean Distance if Localized
            if (isLocalized && module.type === 'BRAIN') {
                candidates.sort((a, b) => {
                    const dA = (a.x - source.x) ** 2 + (a.y - source.y) ** 2;
                    const dB = (b.x - source.x) ** 2 + (b.y - source.y) ** 2;
                    return dA - dB;
                });
            } else {
                // Shuffle for random distribution if not localized
                candidates.sort(() => Math.random() - 0.5);
            }

            // 3. Select Targets
            const count = Math.min(connectionsPerNode, candidates.length);
            for (let k = 0; k < count; k++) {
                let target: BaseNode;

                if (isLocalized && module.type === 'BRAIN') {
                    // Localization with Leak Logic
                    const roll = Math.random() * 100;
                    if (roll >= leak) {
                        // Pick CLOSEST
                        target = candidates.splice(0, 1)[0];
                    } else {
                        // Pick RANDOM
                        const idx = Math.floor(Math.random() * candidates.length);
                        target = candidates.splice(idx, 1)[0];
                    }
                } else {
                    // Random
                    target = candidates.splice(0, 1)[0];
                }

                if (target) {
                    // Calculate Weight based on User Formula
                    // We need to know 'target's total incoming connections' to set the weight ON THE CONNECTION TO TARGET?
                    // Wait. The formula `getInitialWeight(totalIncoming)` is for the *Target Node*.
                    // "We want the node to fire if ~20% of inputs are active." -> The Target Node.
                    // So we must check how many connections `target` WILL have.
                    // IMPORTANT: We are iterating `nodes` as SOURCES.
                    // But the weight logic depends on the TARGET's situation.

                    // Current Incoming (External)
                    const currentIncoming = this.incoming.get(target.id)?.length || 0;

                    // Future Incoming (Internal)
                    // We assume every node gets exactly `connectionsPerNode` internal connections?
                    // In a directed graph, "synapsesPerNode" on the MODULE usually means "Outgoing per node" or "Incoming per node"?
                    // Read line 650: `connectionsPerNode = module.synapsesPerNode || 2`.
                    // And the loop iterates `nodes.forEach(source ...)`. 
                    // Then creates `count` connections FROM source TO targets.
                    // So `synapsesPerNode` is OUTGOING connections per node.

                    // IF connections are random/localized, the INCOMING count varies!
                    // We cannot know the exact final incoming count for `target` easily inside this loop (it's probabilistic).
                    // However, if the graph is uniform-ish, Avg Incoming ~= Avg Outgoing = `synapsesPerNode`.
                    // Let's use `connectionsPerNode` as the estimate for internal incoming.

                    const estimatedTotalInputs = currentIncoming + connectionsPerNode;

                    // Precision Note: This is an estimate. 
                    // If we wanted exactness, we'd need two passes: 1. Decide connections, 2. assign weights.
                    // But for "Initial Weights", an estimate is standard.

                    let idealWeight = 1.0 / (Math.max(1, estimatedTotalInputs) * targetPercentage);
                    idealWeight = Math.min(idealWeight, 0.5); // Clamp max



                    // Dale's Principle Wiring Rule:
                    // If Source is Excitatory -> Positive Weight (Small)
                    // If Source is Inhibitory -> Negative Weight (Large, ~3x stronger)
                    const isExcitatory = source.neuronType === 'EXCITATORY';

                    let finalWeight = 0;
                    if (isExcitatory) {
                        // Excitatory: Random Positive [0.5*ideal, 1.5*ideal]
                        finalWeight = idealWeight * (0.5 + Math.random());
                    } else {
                        // Inhibitory: Stronger Negative (x3)
                        finalWeight = -idealWeight * 3.0 * (0.5 + Math.random());
                    }

                    this.addConnection({
                        id: `c-${source.id}-${target.id}-${k}`,
                        sourceId: source.id,
                        targetId: target.id,
                        weight: finalWeight
                    });
                }
            }
        });
    }
    public removeModule(moduleId: string) {
        if (!this.modules.has(moduleId)) return;

        // 1. Remove Nodes
        const nodesToRemove: string[] = [];
        this.nodes.forEach(n => {
            if (n.id.startsWith(moduleId + '-')) nodesToRemove.push(n.id);
        });

        nodesToRemove.forEach(id => {
            this.nodes.delete(id);
            this.incoming.delete(id);
            this.nodeModuleMap.delete(id);
        });

        // 2. Remove Connections
        this.connections = this.connections.filter(c => {
            const srcExists = this.nodes.has(c.sourceId);
            const tgtExists = this.nodes.has(c.targetId);
            return srcExists && tgtExists;
        });

        this.rebuildIncomingMap();

        // 3. Remove Module Config
        this.modules.delete(moduleId);

        // 4. Remove Related Module Connection Configs
        for (const key of this.moduleConnections.keys()) {
            // key is "sourceId-targetId"
            // We need to check if moduleId is either source or target
            // But formatting is hyphenated, and IDs can contain hyphens.
            // Wait, standard mod IDs are usually "brain-1", "layer-2".
            // Safest check: parse the stored values?
            const config = this.moduleConnections.get(key);
            if (config && (config.sourceId === moduleId || config.targetId === moduleId)) {
                this.moduleConnections.delete(key);
            }
        }
    }

    public getModuleNodes(moduleId: string): BaseNode[] {
        // Filter nodes that belong to this module (prefix check)
        // Optimization: Could store this in module config, but filter is fine for UI
        return Array.from(this.nodes.values())
            .filter(n => n.id.startsWith(moduleId + '-'))
            .sort((a, b) => {
                // Sort by ID (usually index)
                return a.id.localeCompare(b.id, undefined, { numeric: true });
            });
    }

    public tickCount: number = 0;

    public resetState() {
        this.nodes.forEach(n => {
            n.potential = 0;
            n.activation = 0;
            n.refractoryTimer = 0;
        });
        this.tickCount = 0;
    }

    public connectModules(
        sourceId: string,
        targetId: string,
        srcSide: ConnectionSide = 'ALL',
        tgtSide: ConnectionSide = 'ALL',
        coverage: number = 100,
        localizer: number = 0
    ) {
        // Enforce replacement policy: Clear existing connections between these modules first
        this.disconnectModules(sourceId, targetId);

        const getNodesForSide = (modId: string, side: ConnectionSide): BaseNode[] => {
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
        const targetMod = this.modules.get(targetId);

        if (sourceNodes.length === 0 || targetNodes.length === 0 || !targetMod) return;

        // Validation for Coverage
        const finalCoverage = Math.max(1, Math.min(100, coverage));
        // Calculate attempts per source node
        const connectionsPerSource = Math.max(1, Math.floor(targetNodes.length * (finalCoverage / 100)));

        // Store Configuration for Future Inspection
        const linkId = `${sourceId}-${targetId}`;
        this.moduleConnections.set(linkId, {
            sourceId,
            targetId,
            coverage: finalCoverage,
            localizer: localizer,
            sides: { src: srcSide, tgt: tgtSide }
        });

        // If using Localizer, enforce IS LOCALIZED on target brain (if brain)
        // Localizer is now treated as "Leak" (0 = Strict, 100 = Random)
        if (targetMod.type === 'BRAIN' && localizer < 100) {
            if (!targetMod.isLocalized) {
                targetMod.isLocalized = true;
                this.rewireInternalConnections(targetMod.id);
            }
        }

        // Check Source Type for Weight Initialization
        const sourceMod = this.modules.get(sourceId);
        const isSourceSustainedOutput = sourceMod && sourceMod.type === 'SUSTAINED_OUTPUT';
        const initialWeight = isSourceSustainedOutput ? 1.0 : undefined; // Undefined = Random logic later

        sourceNodes.forEach((src, srcIndex) => {
            // Determine Candidate Pool for this Source Node
            let candidates: BaseNode[] = [...targetNodes];

            // LOCALIZATION LOGIC (Generic for ALL types now)
            // If localizer < 100, we prefer spatially aligned nodes
            const useLocalization = localizer < 100;
            let preferredCandidates: BaseNode[] = [];

            if (useLocalization) {
                // 1. Get Source Location (0..1)
                // Note: If sourceMod is missing, we can't do much.
                // We need 'sourceMod' to know if it is Brain or not.
                // We retrieved sourceMod above.
                if (sourceMod) {
                    const srcLoc = this.getRelativeLocation(src, sourceMod, srcIndex, sourceNodes.length);

                    // 2. Filter Targets based on Distance threshold
                    // Threshold derived from Coverage?
                    // E.g. Coverage 10% -> Window of 0.1? or 0.05 on each side?
                    // Let's ensure at least some window.
                    // Using SectorSize logic from before:
                    // If we want "Coverage%" of the target, we should pick candidates within that range.
                    // Window Size = (Coverage / 100). E.g. 20% -> 0.2.
                    // Distance Threshold = Window / 2 = 0.1.
                    // Clamp min threshold to avoid empty sets (e.g. 5% coverage on 10 nodes = 0.5 nodes -> 0)
                    const safeCoverage = Math.max(finalCoverage, 5); // Minimum 5% spatial window
                    const threshold = (safeCoverage / 100) / 2;

                    const bothCircular = sourceMod.type === 'BRAIN' && targetMod.type === 'BRAIN';

                    preferredCandidates = targetNodes.filter((tgt, tgtIndex) => {
                        const tgtLoc = this.getRelativeLocation(tgt, targetMod, tgtIndex, targetNodes.length);
                        return this.getRelativeDist(srcLoc, tgtLoc, bothCircular) <= threshold;
                    });

                    // Fallback if empty (e.g. extremely strict threshold or low node count)
                    if (preferredCandidates.length === 0) preferredCandidates = [...targetNodes];
                } else {
                    preferredCandidates = [...targetNodes];
                }
            }

            // Generate connections
            const connectedTargets = new Set<string>();
            let attempts = 0;
            const maxAttempts = connectionsPerSource * 2; // Safety break

            while (connectedTargets.size < connectionsPerSource && attempts < maxAttempts) {
                attempts++;

                let targetPool = candidates;

                // Apply Localization Roll (Treat localizer as LEAK)
                // If localizer is 10, there is a 10% chance to LEAK (use global), 90% chance to be LOCAL (use preferred).
                if (useLocalization) {
                    const roll = Math.random() * 100;
                    if (roll > localizer) {
                        // Logic: Roll (0-100) > Leak (10) -> Success (use Local)
                        targetPool = preferredCandidates;
                    }
                }

                if (targetPool.length === 0) continue;


                // Pick random target
                const tgt = targetPool[Math.floor(Math.random() * targetPool.length)];

                if (connectedTargets.has(tgt.id)) continue; // Already connected
                if (tgt.id === src.id) continue; // No self loops here

                // Add Connection
                // Dale's Principle (External Wiring)
                // Check Source Type
                const isExcitatory = src.neuronType === 'EXCITATORY';
                let w = initialWeight !== undefined ? initialWeight : 0.2; // Default base

                if (initialWeight === undefined) {
                    // If purely random, use Sign Logic
                    if (isExcitatory) {
                        w = Math.random() * 0.5; // 0 to 0.5
                    } else {
                        w = -Math.random() * 1.5; // 0 to -1.5 (Stronger)
                    }
                } else {
                    // If initialWeight provided (e.g. 1.0 for Sustained), respect it but Flip Sign if Inhibitory
                    if (!isExcitatory) w = -w;
                }

                this.addConnection({
                    id: `c-${src.id}-${tgt.id}`,
                    sourceId: src.id,
                    targetId: tgt.id,
                    weight: w
                });
                connectedTargets.add(tgt.id);
            }
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
                neuronType: n.neuronType, // Persist Dale's Principle type
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
            })),
            moduleConnections: Array.from(this.moduleConnections.entries())
        };
    }

    public fromJSON(data: { modules?: ModuleConfig[], nodes: NodeConfig[], connections: ConnectionConfig[], moduleConnections?: [string, ModuleConnectionConfig][] }) {
        this.nodes.clear();
        this.connections = [];
        this.incoming.clear();
        this.modules.clear();
        this.moduleConnections.clear();

        if (data.moduleConnections) {
            data.moduleConnections.forEach(([key, val]) => this.moduleConnections.set(key, val));
        }

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

    public triggerInput(index: number) {
        // 1. Get all Input Nodes
        const inputNodes = Array.from(this.nodes.values())
            .filter(n => n.type === NodeType.INPUT)
            .sort((a, b) => a.id.localeCompare(b.id)); // Stable sort

        // 2. Select by Index
        if (index >= 0 && index < inputNodes.length) {
            const node = inputNodes[index];

            // 3. Trigger only if PULSE
            if (node.activationType === 'PULSE') {
                // Ensure it is an InputNode instance (it should be due to filter above)
                if ('trigger' in node && typeof (node as any).trigger === 'function') {
                    (node as any).trigger(1); // Fire for 1 tick as requested
                } else {
                    // Fallback
                    node.potential = 1.0;
                    node.isFiring = true;
                }
            } else {
                console.log(`Node ${node.id} is not PULSE type.`);
            }
        }
    }

    public step() {
        this.tickCount++;
        const inputSums = new Map<string, number>();

        // 1. Process INPUT Nodes based on InputType
        this.nodes.forEach(node => {
            if (node.type === NodeType.INPUT) {
                switch (node.inputType) {
                    case 'SIN':
                        // Sin Wave: Base 0.1 factor * frequency
                        // Base period approx 60 ticks. Freq 1 = 0.1 rad/tick.
                        const sinFreq = (node.inputFrequency || 1.0) * 0.1;
                        node.activation = (Math.sin(this.tickCount * sinFreq) + 1) / 2;
                        node.potential = node.activation;
                        break;
                    case 'NOISE':
                        // Random noise with Frequency (Sample and Hold)
                        const freq = node.inputFrequency || 1.0;
                        if (freq >= 1) {
                            // Update every tick (or multiple times, but discrete is max 1)
                            node.activation = Math.random();
                        } else {
                            // Sample and Hold
                            const period = Math.round(1 / freq);
                            if (this.tickCount % period === 0) {
                                node.activation = Math.random();
                            }
                            // Else keep previous activation
                        }
                        node.potential = node.activation;
                        break;
                    case 'PULSE':
                    default:
                        // Keep manual value, but maybe decay if needed (or not, if manual)
                        // For now, do nothing, assume user sets it or it stays.
                        break;
                }
                node.isFiring = node.activation > 0.5;
            }
        });

        this.nodes.forEach(node => {
            if (node.type === NodeType.INPUT) return;

            let sum = 0;
            const incomingConns = this.incoming.get(node.id) || [];

            // Normalization Logic: Group connections by source Brain module
            const brainInputs = new Map<string, { conns: { conn: Connection, rawSignal: number }[] }>();

            incomingConns.forEach(conn => {
                const sourceNode = this.nodes.get(conn.sourceId);
                const sourceModId = this.nodeModuleMap.get(conn.sourceId);

                if (sourceNode) {
                    let sourceIsSustained = sourceNode.activationType === 'SUSTAINED'; // Check flag, assuming BRAIN/SUSTAINED_OUTPUT have this

                    let rawSignal = 0;

                    // SPECIAL LOGIC: Sustained Source
                    if (sourceIsSustained && sourceModId) {
                        const sourceMod = this.modules.get(sourceModId);

                        // Check if it is strictly a SUSTAINED_OUTPUT module (or Brain?)
                        // "Importantantly, this is only the case if the connection is to another Sustained node" implies:
                        // If Source is Sustained_Output -> Target Sustained_Output: Add Signal
                        // If Source is Sustained_Output -> Target Pulse: Gate Signal

                        const isSourceSustainedOutput = sourceMod && sourceMod.type === 'SUSTAINED_OUTPUT';
                        const isTargetSustainedOutput = node.activationType === 'SUSTAINED'; // "another Sustained node"

                        if (isSourceSustainedOutput) {
                            if (isTargetSustainedOutput) {
                                // Logic 1: Sustained -> Sustained
                                // "calculate the increase in potential. So if a brain node fires, it fires 1, it is then multiplied by the weight of the connection."
                                // Note: Sustained Nodes always 'fire' if they have potential? Or only if firing?
                                // "if a brain node fires, it fires 1"

                                if (sourceNode.isFiring) {
                                    rawSignal = 1.0 * conn.weight;
                                }
                            } else {
                                // Logic 2: Sustained -> Pulse ("normal")
                                // "it only fires if the weight is less than its current potential" (Gate condition)
                                if (sourceNode.potential > conn.weight) {
                                    if (sourceNode.isFiring) {
                                        rawSignal = 1.0 * conn.weight;
                                    }
                                } else {
                                    rawSignal = 0; // Gated
                                }
                            }
                        } else {
                            // Standard Brain/Other Sustained
                            rawSignal = sourceNode.activation * conn.weight;
                        }

                    } else {
                        // Standard Pulse Source
                        rawSignal = sourceNode.activation * conn.weight;
                    }

                    const targetModId = this.nodeModuleMap.get(node.id);

                    let isExternalBrain = false;
                    if (sourceModId && sourceModId !== targetModId) {
                        const sourceMod = this.modules.get(sourceModId);
                        // Apply normalization ONLY if NOT Sustained Output source
                        // "please remove the calculation at runtime for the sustained nodes" check
                        // EDIT: Also check TARGET. If target is SUSTAINED_OUTPUT, we SKIP external brain normalization
                        // because we pre-calculated the weights to be 'Gain / Count'.
                        const targetMod = this.modules.get(targetModId || '');
                        const isTargetSustainedOutput = targetMod && targetMod.type === 'SUSTAINED_OUTPUT';

                        if (sourceMod && sourceMod.type === 'BRAIN' && !isTargetSustainedOutput) {
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

            // Dale's Principle: Track EMA Firing Rate
            // Alpha = 0.01 (Slow moving average, ~100 steps)
            const alpha = 0.01;
            const fired = node.isFiring ? 1.0 : 0.0;
            node.averageFiringRate = (alpha * fired) + ((1 - alpha) * node.averageFiringRate);
        });

        // Synaptic Scaling (Homeostasis)
        // Check per module config, default to 100 if undefined
        this.modules.forEach(module => {
            if (module.type === 'BRAIN' && module.sustainability && module.sustainability.synapticScaling) {
                const period = module.sustainability.scalingPeriod || 100;
                if (this.tickCount % period === 0) {
                    // Apply to all nodes in this module
                    const moduleNodes = Array.from(this.nodes.values()).filter(n => n.id.startsWith(module.id));
                    moduleNodes.forEach(node => {
                        this.normalizeWeights(node, module.sustainability!.targetSum);
                    });
                }
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

                const pruningThreshold = module.pruningThreshold !== undefined ? module.pruningThreshold : 0.05;
                const connsToRemove: Set<string> = new Set();

                internalConns.forEach(conn => {
                    const src = this.nodes.get(conn.sourceId);
                    const tgt = this.nodes.get(conn.targetId);

                    if (src && tgt) {
                        // Hebbian Update: W_new = W_old + rate * (Activation_src * Activation_tgt)
                        // Standard Hebbian: "Cells that fire together, wire together"
                        // Only increase if both are active?
                        // Or standard delta rule?
                        // Simple Hebbian: product of activations.
                        // Subtractive Normalization
                        // "Grow based on correlation, but shrink everyone to pay for it."
                        // This maintains a fixed "weight budget" per node (Conservation of Synaptic weight).

                        // 1. Calculate Boost
                        const boost = rate * src.activation * tgt.activation;

                        // Dale's Principle: Plasticity Rules
                        if (src.neuronType === 'EXCITATORY') {
                            // Standard Hebbian for Excitatory
                            // "Cells that fire together, wire together"
                            // Limit max weight to avoid runways? Normalization handles that.
                            conn.weight += boost;
                        } else {
                            // Homeostatic Plasticity for Inhibitory
                            // Goal: Maintain Target Firing Rate at Set Point (e.g. 10%)
                            const targetRate = 0.1;

                            // If Target is too active -> Inhibition should INCREASE (become more negative)
                            // "Police, there's too much noise here!"
                            if (tgt.averageFiringRate > targetRate) {
                                // Strengthen Inhibition (Subtract positive value)
                                conn.weight -= 0.001;
                            } else {
                                // Relax Inhibition (Add positive value to negative weight -> closer to 0)
                                conn.weight += 0.001;
                            }
                        }

                        // 2. Check Target Sum (Capacity)
                        const targetSum = module.sustainability?.targetSum || 3.0; // Default to 3
                        const incomingToTgt = this.incoming.get(tgt.id) || [];

                        // RESTRICTION: Only consider INTERNAL connections for the budget
                        const internalIncoming = incomingToTgt.filter(c => c.sourceId.startsWith(moduleId));

                        let currentTotal = 0;
                        internalIncoming.forEach(c => currentTotal += Math.abs(c.weight));

                        // 3. Conditional Tax: Only tax if we are exceeding the budget
                        if (currentTotal > targetSum) {
                            // "Rich get richer, but everyone pays the tax to stay under the ceiling."
                            // We distribute the 'boost' cost (or the excess) across everyone.
                            // To stabilize AT targetSum, strictly speaking we should remove 'excess'.
                            // But simply removing 'boost' (the recent addition) is the "Subtractive Normalization" philosophy
                            // which stabilizes the sum at the point where it becomes active (approx targetSum).

                            if (internalIncoming.length > 0) {
                                const tax = boost / internalIncoming.length;

                                internalIncoming.forEach(c => {
                                    c.weight -= tax;
                                    // Allow negative (Inhibitory) weights - No Clamp

                                    // CHECK PRUNING
                                    if (Math.abs(c.weight) < pruningThreshold) {
                                        connsToRemove.add(c.id);
                                    }
                                });
                            }
                        }

                        // PRUNING
                        if (Math.abs(conn.weight) < pruningThreshold) {
                            connsToRemove.add(conn.id);
                        }
                    }
                });

                // Apply Pruning
                if (connsToRemove.size > 0) {
                    this.connections = this.connections.filter(c => !connsToRemove.has(c.id));
                    // Full Rebuild of incoming map is safest/easiest given current architecture
                    this.rebuildIncomingMap();
                }

                // REGROWTH
                const regrowthRate = module.regrowthRate || 0; // Connections per tick
                if (regrowthRate > 0) {
                    const count = Math.floor(regrowthRate);
                    const chance = regrowthRate - count;
                    let toAdd = count;
                    if (Math.random() < chance) toAdd++;

                    const moduleNodes = this.getModuleNodes(moduleId);
                    if (moduleNodes.length > 1) {
                        for (let i = 0; i < toAdd; i++) {
                            const src = moduleNodes[Math.floor(Math.random() * moduleNodes.length)];
                            let tgt = moduleNodes[Math.floor(Math.random() * moduleNodes.length)];
                            while (tgt.id === src.id) {
                                tgt = moduleNodes[Math.floor(Math.random() * moduleNodes.length)];
                            }

                            this.addConnection({
                                id: `c-${src.id}-${tgt.id}-${Date.now()}-${Math.random()}`,
                                sourceId: src.id,
                                targetId: tgt.id,
                                weight: (Math.random() - 0.5) * 0.4 // Range [-0.2, 0.2]
                            });
                        }
                    }
                }
            }
        });
    }



    /**
     * Removes all connections between two modules.
     */
    public disconnectModules(modId1: string, modId2: string) {
        // Find Connections between these two modules
        this.connections = this.connections.filter(c => {
            const srcMod = this.nodeModuleMap.get(c.sourceId);
            const tgtMod = this.nodeModuleMap.get(c.targetId);

            // Check if connection is FROM 1 TO 2 or FROM 2 TO 1
            const isMatch = (srcMod === modId1 && tgtMod === modId2) || (srcMod === modId2 && tgtMod === modId1);

            // Keep if NOT a match (filter removes matches)
            return !isMatch;
        });

        // Rebuild incoming map
        this.rebuildIncomingMap();

        // Also remove Module Connection Config
        this.moduleConnections.delete(`${modId1}-${modId2}`);
        this.moduleConnections.delete(`${modId2}-${modId1}`);
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
        const stats = new Map<string, { id: string, count: number, totalWeight: number, direction: 'in' | 'out' | 'self' }>();

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
                    stats.set(key, { id: tgtModId, count: 0, totalWeight: 0, direction: dir });
                }
                const entry = stats.get(key)!;
                entry.count++;
                entry.totalWeight += Math.abs(c.weight); // Use absolute weight for magnitude? Or raw? User asked for "values". Usually weight.
            }

            // CASE 2: Incoming to selected module (from OTHERS)
            // We generally separate "Internal" (Self) from "In".
            // If srcMod == tgtMod == moduleId, we already caught it above as 'self'.
            // So here we only care if tgtMod == moduleId && srcMod != moduleId.
            if (tgtModId === moduleId && srcModId !== moduleId) {
                const key = `in-${srcModId}`;
                if (!stats.has(key)) {
                    stats.set(key, { id: srcModId, count: 0, totalWeight: 0, direction: 'in' });
                }
                const entry = stats.get(key)!;
                entry.count++;
                entry.totalWeight += Math.abs(c.weight);
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
                // FORCE Pulse Outputs/Layers to stay at 1.0 (Instant) - handled by update() anyway
                // Logic: Sustained Output should NOT obey global decay slider. They have their own setting.
                if (n.activationType === 'SUSTAINED') {
                    // Do nothing. Preserve n.decay.
                } else {
                    n.decay = 1.0;
                }
            } else if (n.type !== NodeType.INPUT) {
                // Only Brain nodes get the slider value
                n.decay = decay;
            }
        });
    }
}
