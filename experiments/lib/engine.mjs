// src/engine/nodes/BaseNode.ts
var BaseNode = class {
  id;
  type;
  x;
  y;
  label;
  // Shared Physics State
  potential = 0;
  activation = 0;
  isFiring = false;
  // Dale's Principle
  neuronType = "EXCITATORY";
  averageFiringRate = 0;
  // EMA of firing rate
  lastFiredTick = -Infinity;
  // NeuralNet.tickCount at the most recent spike
  // Common Configuration
  bias = 0;
  // Some shared properties that might vary by implementation, 
  // but useful to keep common for UI/Inspector access without casting.
  threshold = 1;
  decay = 0;
  maxPotential = 3;
  // Activation/Input Configuration (Optional, usually specific types)
  activationType = "PULSE";
  inputType = "PULSE";
  inputFrequency = 1;
  // Fatigue properties (Shared signature, used primarily by BrainNode)
  fatigue = 0;
  recovery = 0;
  currentThreshold = 1;
  // Refractory (Shared signature)
  refractoryPeriod = 0;
  refractoryTimer = 0;
  // Sustainability Config
  sustainability;
  constructor(config) {
    this.id = config.id;
    this.type = config.type;
    this.x = config.x;
    this.y = config.y;
    this.label = config.label || "";
    this.bias = config.bias || 0;
    this.neuronType = config.neuronType || "EXCITATORY";
    this.threshold = config.threshold ?? 1;
    this.maxPotential = config.maxPotential ?? 3;
    this.fatigue = config.fatigue ?? 0;
    this.recovery = config.recovery ?? 0;
    this.currentThreshold = this.threshold;
    this.sustainability = config.sustainability;
  }
  /**
   * Resets the node state (e.g. for hard restart).
   */
  reset() {
    this.potential = 0;
    this.activation = 0;
    this.isFiring = false;
    this.refractoryTimer = 0;
    this.currentThreshold = this.threshold;
    this.lastFiredTick = -Infinity;
  }
  /**
   * Setter for inputs (Manual override)
   */
  setInput(val) {
    this.potential = val;
  }
};

// src/engine/nodes/BrainNode.ts
var BrainNode = class extends BaseNode {
  constructor(config) {
    super(config);
    this.decay = config.decay ?? 0.9;
    this.refractoryPeriod = Number(config.refractoryPeriod ?? 2);
  }
  update(inputSum) {
    if (this.refractoryTimer > 0) {
      this.refractoryTimer--;
      this.isFiring = false;
      this.activation = 0;
      return;
    }
    this.potential += inputSum + this.bias;
    this.potential *= this.decay;
    if (this.potential < 0) this.potential = 0;
    if (this.potential > this.maxPotential) {
      this.potential = this.maxPotential;
    }
    if (this.currentThreshold > this.threshold) {
      this.currentThreshold -= this.recovery;
      if (this.currentThreshold < this.threshold) {
        this.currentThreshold = this.threshold;
      }
    }
    if (this.potential >= this.currentThreshold) {
      this.fire();
      if (this.sustainability && this.sustainability.adaptiveThreshold) {
        this.threshold += this.sustainability.adaptationSpeed;
      }
    } else {
      this.isFiring = false;
      this.activation = 0;
      if (this.sustainability && this.sustainability.adaptiveThreshold) {
        const { adaptationSpeed, targetRate } = this.sustainability;
        this.threshold -= adaptationSpeed * targetRate;
        this.threshold = Math.max(this.threshold, 0.1);
      }
    }
  }
  fire() {
    this.isFiring = true;
    this.activation = 1;
    this.potential -= this.currentThreshold;
    this.currentThreshold += this.fatigue;
    const jitter = Math.random() < 0.5 ? 0 : 1;
    this.refractoryTimer = this.refractoryPeriod + jitter;
  }
};

// src/engine/nodes/InputNode.ts
var InputNode = class extends BaseNode {
  // Timer for internal generation state
  timer = 0;
  manualPulseTimer = 0;
  constructor(config) {
    super(config);
    this.inputType = config.inputType || "PULSE";
    this.inputFrequency = config.inputFrequency !== void 0 ? config.inputFrequency : 1;
    this.decay = 0;
    this.threshold = 0;
  }
  /**
   * Triggers a manual pulse for a specified duration (in ticks).
   */
  trigger(duration = 5) {
    this.manualPulseTimer = duration;
  }
  update(_inputSum) {
    if (this.inputType === "SIN") {
      this.timer += 0.1;
      const val = Math.sin(this.timer * this.inputFrequency);
      this.activation = (val + 1) / 2;
      this.potential = this.activation;
      this.isFiring = this.activation > 0.5;
    } else if (this.inputType === "NOISE") {
      if (Math.random() < this.inputFrequency * 0.1) {
        this.activation = Math.random();
        this.potential = this.activation;
        this.isFiring = true;
      } else {
        this.activation = 0;
        this.potential = 0;
        this.isFiring = false;
      }
    }
    if (this.inputType === "PULSE") {
      if (this.manualPulseTimer > 0) {
        this.potential = 1;
        this.activation = 1;
        this.isFiring = true;
        this.manualPulseTimer--;
      } else {
        this.potential = 0;
        this.activation = 0;
        this.isFiring = false;
      }
    }
  }
  setInput(val) {
    this.potential = val;
    this.activation = val;
    this.isFiring = val >= 0.8;
  }
};

// src/engine/nodes/OutputNode.ts
var OutputNode = class extends BaseNode {
  constructor(config) {
    super(config);
    this.decay = 1;
    this.decay = 0;
  }
  update(inputSum) {
    this.potential += inputSum + this.bias;
    if (this.potential > this.maxPotential) this.potential = this.maxPotential;
    if (this.potential >= this.threshold) {
      this.isFiring = true;
      this.activation = 1;
      this.potential = 0;
    } else {
      this.isFiring = false;
      this.activation = 0;
      this.potential = 0;
    }
  }
};
var SustainedOutputNode = class extends BaseNode {
  constructor(config) {
    super(config);
    this.activationType = "SUSTAINED";
    this.decay = config.decay ?? 0.9;
  }
  update(inputSum) {
    this.potential += inputSum + this.bias;
    this.potential *= this.decay;
    if (this.potential < 0) this.potential = 0;
    if (this.potential > this.maxPotential) this.potential = this.maxPotential;
    if (this.potential >= this.threshold) {
      this.isFiring = true;
      this.activation = 1;
    } else {
      this.isFiring = false;
      this.activation = 0;
    }
  }
};

// src/engine/types.ts
var NodeType = {
  INPUT: "INPUT",
  HIDDEN: "HIDDEN",
  INTERPRETATION: "INTERPRETATION",
  OUTPUT: "OUTPUT",
  CONCEPT: "CONCEPT",
  LEARNED: "LEARNED"
};

// src/engine/NodeFactory.ts
var NodeFactory = class {
  static create(config) {
    const { type, activationType } = config;
    if (type === NodeType.INPUT) {
      return new InputNode(config);
    }
    if (type === NodeType.OUTPUT || type === NodeType.INTERPRETATION || type === NodeType.LEARNED) {
      if (activationType === "SUSTAINED") {
        return new SustainedOutputNode(config);
      }
      return new OutputNode(config);
    }
    if (type === NodeType.HIDDEN || type === NodeType.CONCEPT) {
      return new BrainNode(config);
    }
    return new BrainNode(config);
  }
};

// src/engine/Connection.ts
var Connection = class {
  id;
  sourceId;
  targetId;
  weight;
  // For visualization: last transmitted signal strength
  signalStrength = 0;
  constructor(config) {
    this.id = config.id;
    this.sourceId = config.sourceId;
    this.targetId = config.targetId;
    this.weight = config.weight;
  }
};

// src/engine/NeuralNet.ts
var bySummationOrder = (a, b) => a.order - b.order;
var NeuralNet = class {
  nodes = /* @__PURE__ */ new Map();
  connections = [];
  modules = /* @__PURE__ */ new Map();
  // Config Storage for Links between Modules
  moduleConnections = /* @__PURE__ */ new Map();
  // Cache for quick lookup of incoming connections per node
  incoming = /* @__PURE__ */ new Map();
  // Cache for Node ID -> Module ID lookup
  nodeModuleMap = /* @__PURE__ */ new Map();
  constructor() {
  }
  addNode(config) {
    const node = NodeFactory.create(config);
    this.nodeVersion++;
    this.nodes.set(node.id, node);
    this.incoming.set(node.id, []);
  }
  rebuildIncomingMap() {
    this.incoming.clear();
    this.nodes.forEach((n) => this.incoming.set(n.id, []));
    this.connections.forEach((conn) => {
      const list = this.incoming.get(conn.targetId);
      if (list) list.push(conn);
      else this.incoming.set(conn.targetId, [conn]);
    });
  }
  addConnection(config) {
    const conn = new Connection(config);
    this.connections.push(conn);
    const list = this.incoming.get(conn.targetId);
    if (list) {
      list.push(conn);
    } else {
      this.incoming.set(conn.targetId, [conn]);
    }
    this.normalizeSustainedWeights(conn.targetId);
  }
  /**
   * Checks if the node belongs to a SUSTAINED_OUTPUT module.
   * If so, sets all incoming weights to (MaxPotential / ConnectionCount).
   */
  normalizeSustainedWeights(nodeId) {
    const moduleId = this.nodeModuleMap.get(nodeId);
    if (!moduleId) return;
    const module = this.modules.get(moduleId);
    if (!module || module.type !== "SUSTAINED_OUTPUT") return;
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const incoming = this.incoming.get(nodeId) || [];
    if (incoming.length === 0) return;
    const gain = module.gain !== void 0 ? module.gain : 3;
    const newWeight = gain / incoming.length;
    incoming.forEach((conn) => {
      conn.weight = newWeight;
    });
  }
  addModule(config) {
    if (config.type === "BRAIN" && config.hebbianLearning === void 0) {
      config.hebbianLearning = true;
      config.learningRate = 0.01;
    }
    this.modules.set(config.id, config);
    if (config.type === "BRAIN") {
      if (config.isLocalized === void 0) config.isLocalized = false;
      if (config.localizationLeak === void 0) config.localizationLeak = 0;
    }
    if (config.type === "BRAIN") {
      const centerX = config.x;
      const centerY = config.y;
      const radius = config.radius || 200;
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < config.nodeCount; i++) {
        const theta = i * goldenAngle;
        const r = radius * Math.sqrt((i + 1) / config.nodeCount);
        const nodeId = `${config.id}-${i}`;
        const isInhibitory = Math.random() < 0.2;
        const nType = isInhibitory ? "INHIBITORY" : "EXCITATORY";
        this.addNode({
          id: nodeId,
          type: NodeType.HIDDEN,
          neuronType: nType,
          x: centerX + r * Math.cos(theta),
          y: centerY + r * Math.sin(theta),
          label: "",
          activationType: config.activationType || "PULSE",
          decay: config.decay,
          // Pass missing parameters to Node
          refractoryPeriod: config.refractoryPeriod,
          threshold: config.threshold,
          bias: config.bias,
          maxPotential: config.maxPotential
        });
        this.nodeModuleMap.set(nodeId, config.id);
      }
      this.rewireInternalConnections(config.id);
    } else if (config.type === "CONCEPT") {
      const concepts = config.concepts || [];
      const height = config.height || concepts.length * 40;
      const startY = config.y - height / 2;
      const stepY = concepts.length > 0 ? height / concepts.length : 40;
      concepts.forEach((concept, i) => {
        const nodeId = `${config.id}-${concept.id}`;
        this.addNode({
          id: nodeId,
          type: NodeType.CONCEPT,
          x: config.x,
          y: startY + stepY * i + stepY / 2,
          label: concept.label,
          activationType: "PULSE",
          // Input Concept is usually binary State
          decay: config.decay || 0.1,
          refractoryPeriod: config.refractoryPeriod,
          threshold: config.threshold,
          bias: config.bias,
          maxPotential: config.maxPotential
        });
        this.nodeModuleMap.set(nodeId, config.id);
      });
    } else if (config.type === "LEARNED_OUTPUT") {
    } else {
      const height = config.height || 600;
      const startY = config.y - height / 2;
      const stepY = height / (config.nodeCount + 1);
      const depth = config.depth || 1;
      const widthSpacing = config.width || 100;
      const startX = config.x - (depth - 1) * widthSpacing / 2;
      let nodeType = NodeType.HIDDEN;
      let activationType = config.activationType || "PULSE";
      if (config.type === "INPUT") nodeType = NodeType.INPUT;
      if (config.type === "OUTPUT") nodeType = NodeType.OUTPUT;
      if (config.type === "SUSTAINED_OUTPUT") {
        nodeType = NodeType.OUTPUT;
        activationType = "SUSTAINED";
      }
      if (config.type === "LAYER") nodeType = NodeType.INTERPRETATION;
      for (let d = 0; d < depth; d++) {
        const colX = startX + d * widthSpacing;
        for (let i = 0; i < config.nodeCount; i++) {
          const nodeId = `${config.id}-${d}-${i}`;
          this.addNode({
            id: nodeId,
            type: nodeType,
            x: colX,
            y: startY + stepY * (i + 1),
            label: "",
            activationType,
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
  populateLearnedOutput(targetId, sourceConceptId) {
    const target = this.modules.get(targetId);
    const source = this.modules.get(sourceConceptId);
    if (!target || target.type !== "LEARNED_OUTPUT") return;
    if (!source || source.type !== "CONCEPT" || !source.concepts) return;
    const nodeIdsToRemove = [];
    this.nodes.forEach((n) => {
      if (this.nodeModuleMap.get(n.id) === targetId) nodeIdsToRemove.push(n.id);
    });
    nodeIdsToRemove.forEach((nid) => {
      this.nodes.delete(nid);
      this.nodeModuleMap.delete(nid);
    });
    const concepts = source.concepts;
    const spacing = (target.height || 600) / (concepts.length + 1);
    const startY = target.y - (target.height || 600) / 2 + spacing;
    concepts.forEach((concept, i) => {
      const nodeId = `${target.id}-node-${concept.id}`;
      this.addNode({
        id: nodeId,
        x: target.x,
        y: startY + i * spacing,
        // initialPotential: 0, // Removed: Not in NodeConfig
        threshold: target.threshold || 0.5,
        decay: 0.1,
        activationType: "SUSTAINED",
        refractoryPeriod: 2,
        label: concept.label,
        type: "LEARNED"
      });
      this.nodeModuleMap.set(nodeId, target.id);
    });
    target.nodeCount = concepts.length;
  }
  /**
   * Updates an existing module and regenerates its nodes.
   * Preserves ID, Name, Position. Re-creates nodes based on new count/depth.
   * Prunes invalid connections.
   */
  updateModule(id, newConfig) {
    const module = this.modules.get(id);
    if (!module) return;
    const topologyKeys = ["type", "nodeCount", "depth"];
    const geometryKeys = ["radius", "height", "width"];
    const needsTopologyRegen = topologyKeys.some((key) => newConfig[key] !== void 0 && newConfig[key] !== module[key]);
    const needsGeometryUpdate = geometryKeys.some((key) => newConfig[key] !== void 0 && newConfig[key] !== module[key]);
    const needsRewiring = newConfig.isLocalized !== void 0 || newConfig.localizationLeak !== void 0 || newConfig.synapsesPerNode !== void 0 || newConfig.initialWeightModifier !== void 0;
    if (needsGeometryUpdate && !needsTopologyRegen) {
      Object.assign(module, newConfig);
      if (module.type === "BRAIN") {
        const centerX = module.x;
        const centerY = module.y;
        const radius = module.radius || 200;
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const nodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(id + "-")).sort((a, b) => a.id.localeCompare(b.id, void 0, { numeric: true }));
        nodes.forEach((node, i) => {
          const theta = i * goldenAngle;
          const r = radius * Math.sqrt((i + 1) / nodes.length);
          node.x = centerX + r * Math.cos(theta);
          node.y = centerY + r * Math.sin(theta);
        });
      } else {
        const nodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(id + "-"));
        const height = module.height || 600;
        const startY = module.y - height / 2;
        const stepY = height / (module.nodeCount + 1);
        const depth = module.depth || 1;
        const widthSpacing = module.width || 100;
        const startX = module.x - (depth - 1) * widthSpacing / 2;
        nodes.forEach((node) => {
          const parts = node.id.split("-");
          if (parts.length >= 3) {
            const col = parseInt(parts[parts.length - 2]);
            const row = parseInt(parts[parts.length - 1]);
            const colX = startX + col * widthSpacing;
            node.x = colX;
            node.y = startY + stepY * (row + 1);
          }
        });
      }
      if (module.isLocalized) {
        this.rewireInternalConnections(id);
      }
      return;
    }
    const needsRegeneration = needsTopologyRegen;
    Object.assign(module, newConfig);
    if (!needsRegeneration) {
      if (newConfig.name) {
        this.renameModule(id, newConfig.name);
      }
      const relevantNodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(id + "-"));
      relevantNodes.forEach((node) => {
        if (newConfig.threshold !== void 0) node.threshold = newConfig.threshold;
        if (newConfig.decay !== void 0) node.decay = newConfig.decay;
        if (newConfig.refractoryPeriod !== void 0) node.refractoryPeriod = Number(newConfig.refractoryPeriod);
        if (newConfig.fatigue !== void 0) node.fatigue = newConfig.fatigue;
        if (newConfig.recovery !== void 0) node.recovery = newConfig.recovery;
        if (newConfig.initialWeightModifier !== void 0) {
        }
        if (newConfig.activationType !== void 0) {
          const typeInput = String(newConfig.activationType).toUpperCase();
          node.activationType = typeInput === "SUSTAINED" ? "SUSTAINED" : "PULSE";
        }
      });
      if (newConfig.activationType !== void 0) {
      }
      if (needsRewiring) {
        this.rewireInternalConnections(id);
      }
      if ((newConfig.maxPotential !== void 0 || newConfig.gain !== void 0) && module.type === "SUSTAINED_OUTPUT") {
        const relevantNodes2 = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(id + "-"));
        relevantNodes2.forEach((node) => this.normalizeSustainedWeights(node.id));
      }
      return;
    }
    const mergedConfig = { ...module, ...newConfig };
    const idsToRemove = /* @__PURE__ */ new Set();
    for (const node of this.nodes.values()) {
      if (node.id.startsWith(id + "-")) {
        idsToRemove.add(node.id);
      }
    }
    idsToRemove.forEach((nodeId) => {
      this.nodes.delete(nodeId);
      this.incoming.delete(nodeId);
      this.nodeModuleMap.delete(nodeId);
    });
    this.addModule(mergedConfig);
    this.connections = this.connections.filter((c) => {
      const srcExists = this.nodes.has(c.sourceId);
      const tgtExists = this.nodes.has(c.targetId);
      return srcExists && tgtExists;
    });
    this.incoming.clear();
    this.connections.forEach((c) => {
      const list = this.incoming.get(c.targetId);
      if (list) list.push(c);
      else this.incoming.set(c.targetId, [c]);
    });
    const ensureConnection = (srcModId, tgtModId) => {
      const srcMod = this.modules.get(srcModId);
      const tgtMod = this.modules.get(tgtModId);
      if (!srcMod || !tgtMod) return;
      const srcNodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(srcModId + "-"));
      const tgtNodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(tgtModId + "-"));
      if (srcNodes.length === 0 || tgtNodes.length === 0) return;
      const existing = /* @__PURE__ */ new Set();
      this.connections.forEach((c) => existing.add(c.id));
      const forwardKey = `${srcModId}-${tgtModId}`;
      const reverseKey = `${tgtModId}-${srcModId}`;
      const config = this.moduleConnections.get(forwardKey) || this.moduleConnections.get(reverseKey);
      const coverage = config ? config.coverage : 100;
      const localizer = config ? config.localizer : 0;
      srcNodes.forEach((src) => {
        let potentialTargets = [...tgtNodes];
        if (localizer > 0) {
          potentialTargets.sort((a, b) => {
            const distA = (a.x - src.x) ** 2 + (a.y - src.y) ** 2;
            const distB = (b.x - src.x) ** 2 + (b.y - src.y) ** 2;
            return distA - distB;
          });
        } else {
          potentialTargets.sort(() => Math.random() - 0.5);
        }
        const countToConnect = Math.max(1, Math.floor(potentialTargets.length * (coverage / 100)));
        for (let i = 0; i < countToConnect; i++) {
          const tgt = potentialTargets[i];
          const connId = `c-${src.id}-${tgt.id}`;
          if (!existing.has(connId)) {
            this.addConnection({
              id: connId,
              sourceId: src.id,
              targetId: tgt.id,
              weight: Math.random() * (srcMod.type === "BRAIN" ? 1 : 1)
              // Positive for now in repair? Or check Brain?
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
    const neighborsOut = /* @__PURE__ */ new Set();
    const neighborsIn = /* @__PURE__ */ new Set();
    this.connections.forEach((c) => {
      const srcNode = this.nodes.get(c.sourceId);
      const tgtNode = this.nodes.get(c.targetId);
      if (!srcNode || !tgtNode) return;
      if (c.sourceId.startsWith(id + "-")) {
      }
    });
    this.connections.forEach((c) => {
      const isSource = c.sourceId.startsWith(id + "-");
      const isTarget = c.targetId.startsWith(id + "-");
      if (isSource && !isTarget) {
        for (const [modId] of this.modules) {
          if (modId !== id && c.targetId.startsWith(modId + "-")) {
            neighborsOut.add(modId);
            break;
          }
        }
      } else if (isTarget && !isSource) {
        for (const [modId] of this.modules) {
          if (modId !== id && c.sourceId.startsWith(modId + "-")) {
            neighborsIn.add(modId);
            break;
          }
        }
      }
    });
    neighborsOut.forEach((tgt) => ensureConnection(id, tgt));
    neighborsIn.forEach((src) => ensureConnection(src, id));
  }
  moveModule(id, newX, newY) {
    const module = this.modules.get(id);
    if (!module) return;
    const dx = newX - module.x;
    const dy = newY - module.y;
    module.x = newX;
    module.y = newY;
    for (const node of this.nodes.values()) {
      if (node.id.startsWith(id + "-")) {
        node.x += dx;
        node.y += dy;
      }
    }
  }
  renameModule(id, newName) {
    const module = this.modules.get(id);
    if (!module) return;
    module.name = newName;
    for (const node of this.nodes.values()) {
      if (node.id.startsWith(id + "-")) {
        const suffix = node.id.substring(id.length);
        node.label = `${newName}${suffix}`;
      }
    }
  }
  updateNode(nodeId, config) {
    const node = this.nodes.get(nodeId);
    if (node) {
      if (config.label !== void 0) node.label = config.label;
      if (config.inputFrequency !== void 0) node.inputFrequency = config.inputFrequency;
      if (config.inputType !== void 0) {
        node.inputType = config.inputType;
      }
    }
  }
  getBrainNodeAngle(node, mod) {
    return Math.atan2(node.y - mod.y, node.x - mod.x);
  }
  /**
   * Generic Location (0.0 - 1.0)
   * Brain: Normalized Angle (-PI..PI -> 0..1)
   * Linear: Normalized Index (0..N -> 0..1)
   */
  getRelativeLocation(node, mod, index, total) {
    if (mod.type === "BRAIN") {
      const angle = this.getBrainNodeAngle(node, mod);
      return (angle + Math.PI) / (2 * Math.PI);
    }
    if (total <= 1) return 0.5;
    return index / (total - 1);
  }
  getRelativeDist(a, b, bothCircular) {
    let diff = Math.abs(a - b);
    if (bothCircular) {
      if (diff > 0.5) diff = 1 - diff;
    }
    return diff;
  }
  normalizeWeights(node, targetSum) {
    const incoming = this.incoming.get(node.id);
    if (!incoming || incoming.length === 0) return;
    let currentSum = 0;
    incoming.forEach((c) => currentSum += Math.abs(c.weight));
    if (currentSum > targetSum) {
      const factor = targetSum / currentSum;
      incoming.forEach((c) => {
        if (Math.abs(c.weight) > 0.1) {
          c.weight *= factor;
        }
      });
    }
  }
  rewireInternalConnections(moduleId) {
    const module = this.modules.get(moduleId);
    if (!module) return;
    this.connections = this.connections.filter((c) => {
      const srcMod = this.nodeModuleMap.get(c.sourceId);
      const tgtMod = this.nodeModuleMap.get(c.targetId);
      return !(srcMod === moduleId && tgtMod === moduleId);
    });
    this.rebuildIncomingMap();
    const nodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(moduleId + "-"));
    const connectionsPerNode = module.synapsesPerNode || 2;
    const isLocalized = module.isLocalized || false;
    const leak = module.localizationLeak || 0;
    const targetPercentage = module.initialWeightModifier ?? 0.2;
    nodes.forEach((source) => {
      let candidates = nodes.filter((n) => n.id !== source.id);
      if (isLocalized && module.type === "BRAIN") {
        candidates.sort((a, b) => {
          const dA = (a.x - source.x) ** 2 + (a.y - source.y) ** 2;
          const dB = (b.x - source.x) ** 2 + (b.y - source.y) ** 2;
          return dA - dB;
        });
      } else {
        candidates.sort(() => Math.random() - 0.5);
      }
      const count = Math.min(connectionsPerNode, candidates.length);
      for (let k = 0; k < count; k++) {
        let target;
        if (isLocalized && module.type === "BRAIN") {
          const roll = Math.random() * 100;
          if (roll >= leak) {
            target = candidates.splice(0, 1)[0];
          } else {
            const idx = Math.floor(Math.random() * candidates.length);
            target = candidates.splice(idx, 1)[0];
          }
        } else {
          target = candidates.splice(0, 1)[0];
        }
        if (target) {
          const currentIncoming = this.incoming.get(target.id)?.length || 0;
          const estimatedTotalInputs = currentIncoming + connectionsPerNode;
          let idealWeight = 1 / (Math.max(1, estimatedTotalInputs) * targetPercentage);
          idealWeight = Math.min(idealWeight, 0.5);
          const isExcitatory = source.neuronType === "EXCITATORY";
          let finalWeight = 0;
          if (isExcitatory) {
            finalWeight = idealWeight * (0.5 + Math.random());
          } else {
            finalWeight = -idealWeight * 3 * (0.5 + Math.random());
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
  removeModule(moduleId) {
    if (!this.modules.has(moduleId)) return;
    const nodesToRemove = [];
    this.nodes.forEach((n) => {
      if (n.id.startsWith(moduleId + "-")) nodesToRemove.push(n.id);
    });
    nodesToRemove.forEach((id) => {
      this.nodes.delete(id);
      this.incoming.delete(id);
      this.nodeModuleMap.delete(id);
    });
    this.connections = this.connections.filter((c) => {
      const srcExists = this.nodes.has(c.sourceId);
      const tgtExists = this.nodes.has(c.targetId);
      return srcExists && tgtExists;
    });
    this.rebuildIncomingMap();
    this.modules.delete(moduleId);
    for (const key of this.moduleConnections.keys()) {
      const config = this.moduleConnections.get(key);
      if (config && (config.sourceId === moduleId || config.targetId === moduleId)) {
        this.moduleConnections.delete(key);
      }
    }
  }
  getModuleNodes(moduleId) {
    return Array.from(this.nodes.values()).filter((n) => n.id.startsWith(moduleId + "-")).sort((a, b) => {
      return a.id.localeCompare(b.id, void 0, { numeric: true });
    });
  }
  tickCount = 0;
  resetState() {
    this.nodes.forEach((n) => {
      n.potential = 0;
      n.activation = 0;
      n.refractoryTimer = 0;
      n.lastFiredTick = -Infinity;
    });
    this.tickCount = 0;
  }
  /** Remove everything: modules, nodes and connections. */
  clear() {
    this.nodes.clear();
    this.connections = [];
    this.modules.clear();
    this.incoming.clear();
    this.moduleConnections.clear();
    this.nodeModuleMap.clear();
    this.stimuli = [];
    this.spikeCounts = null;
    this.tickCount = 0;
  }
  // ---- Direct stimulation and spike recording (used by demos and experiments)
  stimuli = [];
  nextStimulusId = 1;
  /** Called at the end of every step(), if set. */
  afterStep = null;
  spikeCounts = null;
  /**
   * Drive nodes directly: for the next `ticks` ticks, `strength` is added to their input.
   * onDone is called at the end of the tick in which the stimulation runs out. Returns an id for stopStimulus().
   */
  stimulate(nodeIds, ticks, strength = 3, onDone) {
    const nodes = nodeIds.map((id2) => this.nodes.get(id2)).filter((n) => !!n);
    const id = this.nextStimulusId++;
    if (ticks > 0) this.stimuli.push({ id, nodes, remaining: ticks, strength, onDone });
    return id;
  }
  /** Stop one stimulation early (its onDone is not called). */
  stopStimulus(id) {
    this.stimuli = this.stimuli.filter((stimulus) => stimulus.id !== id);
  }
  clearStimulation() {
    this.stimuli = [];
  }
  /** Start counting spikes per node. */
  startRecording() {
    this.spikeCounts = /* @__PURE__ */ new Map();
  }
  /** Stop counting and return the spikes per node id since startRecording(). */
  stopRecording() {
    const counts = this.spikeCounts || /* @__PURE__ */ new Map();
    this.spikeCounts = null;
    return counts;
  }
  connectModules(sourceId, targetId, srcSide = "ALL", tgtSide = "ALL", coverage = 100, localizer = 0) {
    this.disconnectModules(sourceId, targetId);
    const getNodesForSide = (modId, side) => {
      const mod = this.modules.get(modId);
      if (!mod) return [];
      const allNodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(modId + "-"));
      if (mod.type === "BRAIN") return allNodes;
      if (side === "ALL") return allNodes;
      const depth = mod.depth || 1;
      const targetCol = side === "LEFT" ? 0 : depth - 1;
      return allNodes.filter((n) => {
        const suffix = n.id.substring(modId.length + 1);
        const [dStr] = suffix.split("-");
        const d = parseInt(dStr);
        return d === targetCol;
      });
    };
    const sourceNodes = getNodesForSide(sourceId, srcSide);
    const targetNodes = getNodesForSide(targetId, tgtSide);
    const targetMod = this.modules.get(targetId);
    if (sourceNodes.length === 0 || targetNodes.length === 0 || !targetMod) return;
    const finalCoverage = Math.max(1, Math.min(100, coverage));
    const connectionsPerSource = Math.max(1, Math.floor(targetNodes.length * (finalCoverage / 100)));
    const linkId = `${sourceId}-${targetId}`;
    this.moduleConnections.set(linkId, {
      sourceId,
      targetId,
      coverage: finalCoverage,
      localizer,
      sides: { src: srcSide, tgt: tgtSide }
    });
    if (targetMod.type === "BRAIN" && localizer < 100) {
      if (!targetMod.isLocalized) {
        targetMod.isLocalized = true;
        this.rewireInternalConnections(targetMod.id);
      }
    }
    const sourceMod = this.modules.get(sourceId);
    const isSourceSustainedOutput = sourceMod && sourceMod.type === "SUSTAINED_OUTPUT";
    const initialWeight = isSourceSustainedOutput ? 1 : void 0;
    sourceNodes.forEach((src, srcIndex) => {
      let candidates = [...targetNodes];
      const useLocalization = localizer < 100;
      let preferredCandidates = [];
      if (useLocalization) {
        if (sourceMod) {
          const srcLoc = this.getRelativeLocation(src, sourceMod, srcIndex, sourceNodes.length);
          const safeCoverage = Math.max(finalCoverage, 5);
          const threshold = safeCoverage / 100 / 2;
          const bothCircular = sourceMod.type === "BRAIN" && targetMod.type === "BRAIN";
          preferredCandidates = targetNodes.filter((tgt, tgtIndex) => {
            const tgtLoc = this.getRelativeLocation(tgt, targetMod, tgtIndex, targetNodes.length);
            return this.getRelativeDist(srcLoc, tgtLoc, bothCircular) <= threshold;
          });
          if (preferredCandidates.length === 0) preferredCandidates = [...targetNodes];
        } else {
          preferredCandidates = [...targetNodes];
        }
      }
      const connectedTargets = /* @__PURE__ */ new Set();
      let attempts = 0;
      const maxAttempts = connectionsPerSource * 2;
      while (connectedTargets.size < connectionsPerSource && attempts < maxAttempts) {
        attempts++;
        let targetPool = candidates;
        if (useLocalization) {
          const roll = Math.random() * 100;
          if (roll > localizer) {
            targetPool = preferredCandidates;
          }
        }
        if (targetPool.length === 0) continue;
        const tgt = targetPool[Math.floor(Math.random() * targetPool.length)];
        if (connectedTargets.has(tgt.id)) continue;
        if (tgt.id === src.id) continue;
        const isExcitatory = src.neuronType === "EXCITATORY";
        let w = initialWeight !== void 0 ? initialWeight : 0.2;
        if (initialWeight === void 0) {
          if (isExcitatory) {
            w = Math.random() * 0.5;
          } else {
            w = -Math.random() * 1.5;
          }
        } else {
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
  reset() {
    this.nodes.forEach((n) => n.reset());
  }
  getNodes() {
    return Array.from(this.nodes.values());
  }
  toJSON() {
    return {
      modules: Array.from(this.modules.values()),
      nodes: Array.from(this.nodes.values()).map((n) => ({
        id: n.id,
        type: n.type,
        neuronType: n.neuronType,
        // Persist Dale's Principle type
        x: n.x,
        y: n.y,
        label: n.label,
        activationType: n.activationType,
        // Save state too? Maybe potential
        potential: n.potential
      })),
      connections: this.connections.map((c) => ({
        id: c.id,
        sourceId: c.sourceId,
        targetId: c.targetId,
        weight: c.weight
      })),
      moduleConnections: Array.from(this.moduleConnections.entries())
    };
  }
  fromJSON(data) {
    this.nodes.clear();
    this.connections = [];
    this.incoming.clear();
    this.modules.clear();
    this.moduleConnections.clear();
    if (data.moduleConnections) {
      data.moduleConnections.forEach(([key, val]) => this.moduleConnections.set(key, val));
    }
    if (data.modules) {
      data.modules.forEach((m) => this.modules.set(m.id, m));
    }
    data.nodes.forEach((n) => this.addNode({
      ...n,
      label: n.label
      // Ensure label is passed if not in spread
    }));
    this.nodeModuleMap.clear();
    this.modules.forEach((mod) => {
      const nodes = this.getModuleNodes(mod.id);
      nodes.forEach((n) => this.nodeModuleMap.set(n.id, mod.id));
    });
    data.connections.forEach((c) => this.addConnection(c));
  }
  triggerInput(index) {
    const inputNodes = Array.from(this.nodes.values()).filter((n) => n.type === NodeType.INPUT).sort((a, b) => a.id.localeCompare(b.id));
    if (index >= 0 && index < inputNodes.length) {
      const node = inputNodes[index];
      if (node.activationType === "PULSE") {
        if ("trigger" in node && typeof node.trigger === "function") {
          node.trigger(1);
        } else {
          node.potential = 1;
          node.isFiring = true;
        }
      } else {
        console.log(`Node ${node.id} is not PULSE type.`);
      }
    }
  }
  step() {
    this.tickCount++;
    const inputSums = /* @__PURE__ */ new Map();
    this.nodes.forEach((node) => {
      if (node.type === NodeType.INPUT) {
        switch (node.inputType) {
          case "SIN":
            const sinFreq = (node.inputFrequency || 1) * 0.1;
            node.activation = (Math.sin(this.tickCount * sinFreq) + 1) / 2;
            node.potential = node.activation;
            break;
          case "NOISE":
            const freq = node.inputFrequency || 1;
            if (freq >= 1) {
              node.activation = Math.random();
            } else {
              const period = Math.round(1 / freq);
              if (this.tickCount % period === 0) {
                node.activation = Math.random();
              }
            }
            node.potential = node.activation;
            break;
          case "PULSE":
          default:
            break;
        }
        node.isFiring = node.activation > 0.5;
      }
    });
    const cache = this.getStepCache();
    const active = [];
    this.nodes.forEach((node) => {
      if (node.activation !== 0 || node.isFiring) active.push(node);
    });
    if (cache.fresh) {
      cache.outgoing.forEach((entries) => {
        for (let i = 0; i < entries.length; i++) entries[i].conn.signalStrength = 0;
      });
      cache.fresh = false;
    } else if (this.activeSources.length > 0) {
      const stillActive = new Set(active);
      for (let a = 0; a < this.activeSources.length; a++) {
        if (stillActive.has(this.activeSources[a])) continue;
        const entries = cache.outgoing.get(this.activeSources[a]);
        if (entries) for (let i = 0; i < entries.length; i++) entries[i].conn.signalStrength = 0;
      }
    }
    this.activeSources = active;
    const receiving = [];
    for (let a = 0; a < active.length; a++) {
      const entries = cache.outgoing.get(active[a]);
      if (!entries) continue;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const rawSignal = this.rawSignal(entry, entry.plan.node);
        entry.conn.signalStrength = Math.abs(rawSignal);
        entry.raw = rawSignal;
        if (entry.plan.pending.length === 0) receiving.push(entry.plan);
        entry.plan.pending.push(entry);
      }
    }
    for (let p = 0; p < receiving.length; p++) {
      const pending = receiving[p].pending;
      if (pending.length > 1) pending.sort(bySummationOrder);
      let sum = 0;
      for (let i = 0; i < pending.length; i++) {
        const entry = pending[i];
        sum += entry.group ? entry.raw * (1 / entry.group.length) : entry.raw;
      }
      pending.length = 0;
      inputSums.set(receiving[p].node.id, sum);
    }
    const finishedStimuli = [];
    if (this.stimuli.length > 0) {
      for (const stimulus of this.stimuli) {
        for (const node of stimulus.nodes) inputSums.set(node.id, (inputSums.get(node.id) || 0) + stimulus.strength);
        stimulus.remaining--;
        if (stimulus.remaining <= 0 && stimulus.onDone) finishedStimuli.push(stimulus.onDone);
      }
      this.stimuli = this.stimuli.filter((stimulus) => stimulus.remaining > 0);
    }
    this.nodes.forEach((node) => {
      if (node.type === NodeType.INPUT) {
        node.update(0);
      } else {
        const inputSum = inputSums.get(node.id) || 0;
        node.update(inputSum);
      }
      const alpha = 0.01;
      const fired = node.isFiring ? 1 : 0;
      node.averageFiringRate = alpha * fired + (1 - alpha) * node.averageFiringRate;
      if (node.isFiring) {
        node.lastFiredTick = this.tickCount;
        if (this.spikeCounts) this.spikeCounts.set(node.id, (this.spikeCounts.get(node.id) || 0) + 1);
      }
    });
    this.modules.forEach((module) => {
      if (module.type === "BRAIN" && module.sustainability && module.sustainability.synapticScaling) {
        const period = module.sustainability.scalingPeriod || 100;
        if (this.tickCount % period === 0) {
          const moduleNodes = Array.from(this.nodes.values()).filter((n) => n.id.startsWith(module.id));
          moduleNodes.forEach((node) => {
            this.normalizeWeights(node, module.sustainability.targetSum);
          });
        }
      }
    });
    this.modules.forEach((module) => {
      if (module.type === "BRAIN" && module.hebbianLearning) {
        if (module.hebbianRule === "window") {
          this.applyWindowRule(module);
          return;
        }
        const rate = module.learningRate || 0.01;
        const moduleId = module.id;
        const internalConns = this.getHebbianEntries(moduleId);
        const pruningThreshold = module.pruningThreshold !== void 0 ? module.pruningThreshold : 0.05;
        const connsToRemove = /* @__PURE__ */ new Set();
        const targetSum = module.sustainability?.targetSum || 3;
        const stamp = ++this.hebbStamp;
        for (let k = 0; k < internalConns.length; k++) {
          const { conn, src, tgt, budget } = internalConns[k];
          const boost = rate * src.activation * tgt.activation;
          if (src.neuronType === "EXCITATORY") {
            conn.weight += boost;
            if (boost !== 0) budget.stamp = 0;
          } else {
            const targetRate = 0.1;
            if (tgt.averageFiringRate > targetRate) {
              conn.weight -= 1e-3;
            } else {
              conn.weight += 1e-3;
            }
            budget.stamp = 0;
          }
          const internalIncoming = budget.conns;
          if (budget.stamp !== stamp) {
            let currentTotal = 0;
            let prunable = false;
            for (let i = 0; i < internalIncoming.length; i++) {
              const abs = Math.abs(internalIncoming[i].weight);
              currentTotal += abs;
              if (abs < pruningThreshold) prunable = true;
            }
            budget.total = currentTotal;
            budget.prunable = prunable;
            budget.stamp = stamp;
          }
          if (budget.total > targetSum) {
            if (internalIncoming.length > 0 && (boost !== 0 || budget.prunable)) {
              const tax = boost / internalIncoming.length;
              for (let i = 0; i < internalIncoming.length; i++) {
                const c = internalIncoming[i];
                c.weight -= tax;
                if (Math.abs(c.weight) < pruningThreshold) {
                  connsToRemove.add(c.id);
                }
              }
              if (tax !== 0) budget.stamp = 0;
            }
          }
          if (Math.abs(conn.weight) < pruningThreshold) {
            connsToRemove.add(conn.id);
          }
        }
        if (connsToRemove.size > 0) {
          const removed = [];
          this.connections = this.connections.filter((c) => {
            if (!connsToRemove.has(c.id)) return true;
            removed.push(c);
            return false;
          });
          this.rebuildIncomingMap();
          this.removeFromStepCache(removed);
        }
        const regrowthRate = module.regrowthRate || 0;
        if (regrowthRate > 0) {
          const count = Math.floor(regrowthRate);
          const chance = regrowthRate - count;
          let toAdd = count;
          if (Math.random() < chance) toAdd++;
          if (toAdd > 0) {
            const moduleNodes = this.getModuleNodesCached(moduleId);
            if (moduleNodes.length > 1) {
              for (let i = 0; i < toAdd; i++) {
                const src = moduleNodes[Math.floor(Math.random() * moduleNodes.length)];
                let tgt = moduleNodes[Math.floor(Math.random() * moduleNodes.length)];
                while (tgt.id === src.id) {
                  tgt = moduleNodes[Math.floor(Math.random() * moduleNodes.length)];
                }
                const cacheWasCurrent = this.isStepCacheCurrent();
                this.addConnection({
                  id: `c-${src.id}-${tgt.id}-${Date.now()}-${Math.random()}`,
                  sourceId: src.id,
                  targetId: tgt.id,
                  weight: (Math.random() - 0.5) * 0.4
                  // Range [-0.2, 0.2]
                });
                if (cacheWasCurrent) this.appendToStepCache(this.connections[this.connections.length - 1]);
              }
            }
          }
        }
      }
    });
    for (const onDone of finishedStimuli) onDone();
    if (this.afterStep) this.afterStep();
  }
  /**
   * 'window' Hebbian rule: neurons that fire within a few ticks of each other get wired together, up to a cap.
   * Only excitatory -> excitatory synapses inside the Brain learn. A neuron that fired together with others
   * every 2-3 ticks is rarely in the SAME tick as them (refractory periods put them out of step), which is
   * why the pairing is counted over a short window instead.
   */
  applyWindowRule(module) {
    const rate = module.learningRate || 0.01;
    const cap = module.weightCap ?? 0.25;
    const window = module.hebbianWindow ?? 2;
    const sameTick = module.hebbianSameTick ?? true;
    const weakenSilent = module.hebbianWeakenSilent ?? false;
    const entries = this.getHebbianEntries(module.id);
    for (let k = 0; k < entries.length; k++) {
      const { conn, src, tgt } = entries[k];
      if (!tgt.isFiring || tgt.neuronType !== "EXCITATORY" || src.neuronType !== "EXCITATORY") continue;
      const since = this.tickCount - src.lastFiredTick;
      const pre = since <= window && (sameTick || since >= 1);
      if (pre) conn.weight += rate * (1 - conn.weight / cap);
      else if (weakenSilent) conn.weight -= rate * conn.weight / cap;
    }
  }
  // ---- Step caches -------------------------------------------------------------------------------------------
  // step() used to re-derive the wiring from the Maps (and re-filter / re-sort whole lists) on every tick.
  // These caches hold that derived structure and are rebuilt only when the topology changes.
  nodeVersion = 0;
  hebbStamp = 0;
  stepCache = null;
  activeSources = [];
  // nodes that delivered a signal on the previous tick
  moduleNodesCache = null;
  /**
   * Connections are only ever added with push() or removed by replacing the array, and nodes are only replaced
   * through addNode(), so (array identity, length, node version, node count) identifies a topology.
   */
  isStepCacheCurrent() {
    const cache = this.stepCache;
    return !!cache && cache.connections === this.connections && cache.connectionCount === this.connections.length && cache.nodeVersion === this.nodeVersion && cache.nodeCount === this.nodes.size && cache.moduleCount === this.modules.size;
  }
  getStepCache() {
    if (this.isStepCacheCurrent()) return this.stepCache;
    const plans = [];
    const planByNode = /* @__PURE__ */ new Map();
    const outgoing = /* @__PURE__ */ new Map();
    this.nodes.forEach((node) => {
      if (node.type === NodeType.INPUT) return;
      const plan = { node, standard: [], brainGroups: [], groupSources: [], skipped: 0, pending: [] };
      (this.incoming.get(node.id) || []).forEach((conn) => this.addToPlan(plan, conn, outgoing));
      this.renumberPlan(plan);
      plans.push(plan);
      planByNode.set(node.id, plan);
    });
    this.stepCache = {
      connections: this.connections,
      connectionCount: this.connections.length,
      nodeVersion: this.nodeVersion,
      nodeCount: this.nodes.size,
      moduleCount: this.modules.size,
      plans,
      planByNode,
      outgoing,
      fresh: true,
      hebbian: /* @__PURE__ */ new Map()
    };
    return this.stepCache;
  }
  /** Fix each entry's place in its target's summation order: standard inputs first, then group by group. */
  renumberPlan(plan) {
    let order = 0;
    for (const entry of plan.standard) {
      entry.group = null;
      entry.order = order++;
    }
    for (const group of plan.brainGroups) for (const entry of group) {
      entry.group = group;
      entry.order = order++;
    }
  }
  /** Classify one incoming connection of plan.node (standard vs. averaged input from another Brain). */
  addToPlan(plan, conn, outgoing) {
    const src = this.nodes.get(conn.sourceId);
    if (!src) {
      plan.skipped++;
      return;
    }
    const targetModId = this.nodeModuleMap.get(plan.node.id);
    const targetMod = this.modules.get(targetModId || "");
    const isTargetSustainedOutput = !!targetMod && targetMod.type === "SUSTAINED_OUTPUT";
    const sourceModId = this.nodeModuleMap.get(conn.sourceId);
    const sourceMod = sourceModId ? this.modules.get(sourceModId) : void 0;
    const entry = {
      conn,
      src,
      fromSustainedOutput: !!sourceMod && sourceMod.type === "SUSTAINED_OUTPUT",
      plan,
      group: null,
      order: 0,
      raw: 0
    };
    const fromSource = outgoing.get(src);
    if (fromSource) fromSource.push(entry);
    else outgoing.set(src, [entry]);
    const isExternalBrain = !!sourceModId && sourceModId !== targetModId && !!sourceMod && sourceMod.type === "BRAIN" && !isTargetSustainedOutput;
    if (isExternalBrain && sourceModId) {
      let g = plan.groupSources.indexOf(sourceModId);
      if (g < 0) {
        g = plan.groupSources.push(sourceModId) - 1;
        plan.brainGroups.push([]);
      }
      plan.brainGroups[g].push(entry);
    } else {
      plan.standard.push(entry);
    }
  }
  /**
   * Pruning happens on most ticks while a Brain settles, so instead of rebuilding the whole cache the pruned
   * connections are taken out of it. Call after this.connections / this.incoming have been updated.
   */
  removeFromStepCache(removed) {
    const cache = this.stepCache;
    if (!cache) return;
    const gone = new Set(removed);
    const keep = (e) => !gone.has(e.conn);
    const targets = new Set(removed.map((c) => c.targetId));
    targets.forEach((targetId) => {
      const plan = cache.planByNode.get(targetId);
      if (plan) {
        plan.standard = plan.standard.filter(keep);
        for (let g = plan.brainGroups.length - 1; g >= 0; g--) {
          plan.brainGroups[g] = plan.brainGroups[g].filter(keep);
          if (plan.brainGroups[g].length === 0) {
            plan.brainGroups.splice(g, 1);
            plan.groupSources.splice(g, 1);
          }
        }
        this.renumberPlan(plan);
      }
      cache.hebbian.forEach((h) => {
        const budget = h.budgets.get(targetId);
        if (budget) {
          budget.conns = budget.conns.filter((c) => !gone.has(c));
          budget.stamp = 0;
        }
      });
    });
    cache.hebbian.forEach((h) => {
      h.entries = h.entries.filter(keep);
    });
    const sources = /* @__PURE__ */ new Set();
    for (const conn of removed) {
      const src = this.nodes.get(conn.sourceId);
      if (src) sources.add(src);
    }
    sources.forEach((src) => {
      const entries = cache.outgoing.get(src);
      if (entries) cache.outgoing.set(src, entries.filter(keep));
    });
    for (const plan of cache.plans) {
      let count = plan.standard.length + plan.skipped;
      for (const group of plan.brainGroups) count += group.length;
      if (count !== (this.incoming.get(plan.node.id) || []).length) {
        this.stepCache = null;
        return;
      }
    }
    cache.connections = this.connections;
    cache.connectionCount = this.connections.length;
  }
  /** Counterpart of removeFromStepCache for a connection that was just added with addConnection(). */
  appendToStepCache(conn) {
    const cache = this.stepCache;
    if (!cache) return;
    const plan = cache.planByNode.get(conn.targetId);
    if (plan) {
      this.addToPlan(plan, conn, cache.outgoing);
      this.renumberPlan(plan);
    }
    const src = this.nodes.get(conn.sourceId);
    const tgt = this.nodes.get(conn.targetId);
    cache.hebbian.forEach((h, moduleId) => {
      if (!conn.sourceId.startsWith(moduleId)) return;
      let budget = h.budgets.get(conn.targetId);
      if (budget) {
        budget.conns.push(conn);
        budget.stamp = 0;
      }
      if (!conn.targetId.startsWith(moduleId) || !src || !tgt) return;
      if (!budget) {
        budget = this.createBudget(tgt.id, moduleId);
        h.budgets.set(tgt.id, budget);
      }
      h.entries.push({ conn, src, tgt, budget });
    });
    cache.connectionCount = this.connections.length;
  }
  createBudget(targetId, moduleId) {
    const conns = (this.incoming.get(targetId) || []).filter((c) => c.sourceId.startsWith(moduleId));
    return { conns, total: 0, prunable: false, stamp: 0 };
  }
  /** The signal one connection delivers this tick. */
  rawSignal(entry, target) {
    const { conn, src } = entry;
    if (entry.fromSustainedOutput && src.activationType === "SUSTAINED") {
      if (target.activationType === "SUSTAINED") {
        return src.isFiring ? 1 * conn.weight : 0;
      }
      return src.potential > conn.weight && src.isFiring ? 1 * conn.weight : 0;
    }
    return src.activation * conn.weight;
  }
  /** Internal connections of a Brain, each with the "weight budget" (internal incoming list) of its target. */
  getHebbianEntries(moduleId) {
    const cache = this.getStepCache();
    const cached = cache.hebbian.get(moduleId);
    if (cached) return cached.entries;
    const entries = [];
    const budgets = /* @__PURE__ */ new Map();
    for (const conn of this.connections) {
      if (!(conn.sourceId.startsWith(moduleId) && conn.targetId.startsWith(moduleId))) continue;
      const src = this.nodes.get(conn.sourceId);
      const tgt = this.nodes.get(conn.targetId);
      if (!src || !tgt) continue;
      let budget = budgets.get(tgt.id);
      if (!budget) {
        budget = this.createBudget(tgt.id, moduleId);
        budgets.set(tgt.id, budget);
      }
      entries.push({ conn, src, tgt, budget });
    }
    cache.hebbian.set(moduleId, { entries, budgets });
    return entries;
  }
  /** getModuleNodes() without the per-call filter + locale sort. Do not mutate the returned array. */
  getModuleNodesCached(moduleId) {
    let cache = this.moduleNodesCache;
    if (!cache || cache.nodeVersion !== this.nodeVersion || cache.nodeCount !== this.nodes.size) {
      cache = { nodeVersion: this.nodeVersion, nodeCount: this.nodes.size, lists: /* @__PURE__ */ new Map() };
      this.moduleNodesCache = cache;
    }
    let list = cache.lists.get(moduleId);
    if (!list) {
      list = this.getModuleNodes(moduleId);
      cache.lists.set(moduleId, list);
    }
    return list;
  }
  /**
   * Removes all connections between two modules.
   */
  disconnectModules(modId1, modId2) {
    this.connections = this.connections.filter((c) => {
      const srcMod = this.nodeModuleMap.get(c.sourceId);
      const tgtMod = this.nodeModuleMap.get(c.targetId);
      const isMatch = srcMod === modId1 && tgtMod === modId2 || srcMod === modId2 && tgtMod === modId1;
      return !isMatch;
    });
    this.rebuildIncomingMap();
    this.moduleConnections.delete(`${modId1}-${modId2}`);
    this.moduleConnections.delete(`${modId2}-${modId1}`);
  }
  getNodeConnections(nodeId) {
    const incoming = this.incoming.get(nodeId) || [];
    const outgoing = this.connections.filter((c) => c.sourceId === nodeId);
    return {
      incoming,
      outgoing
    };
  }
  /**
   * Returns a summary of connections for a specific module.
   * Used for the Inspector UI.
   */
  getModuleConnectivity(moduleId) {
    const stats = /* @__PURE__ */ new Map();
    const nodeToModuleId = /* @__PURE__ */ new Map();
    this.modules.forEach((mod) => {
      const nodes = this.getModuleNodes(mod.id);
      nodes.forEach((n) => nodeToModuleId.set(n.id, mod.id));
    });
    this.connections.forEach((c) => {
      const srcModId = nodeToModuleId.get(c.sourceId);
      const tgtModId = nodeToModuleId.get(c.targetId);
      if (!srcModId || !tgtModId) return;
      if (srcModId === moduleId) {
        const key = `out-${tgtModId}`;
        const dir = srcModId === tgtModId ? "self" : "out";
        if (!stats.has(key)) {
          stats.set(key, { id: tgtModId, count: 0, totalWeight: 0, direction: dir });
        }
        const entry = stats.get(key);
        entry.count++;
        entry.totalWeight += Math.abs(c.weight);
      }
      if (tgtModId === moduleId && srcModId !== moduleId) {
        const key = `in-${srcModId}`;
        if (!stats.has(key)) {
          stats.set(key, { id: srcModId, count: 0, totalWeight: 0, direction: "in" });
        }
        const entry = stats.get(key);
        entry.count++;
        entry.totalWeight += Math.abs(c.weight);
      }
    });
    return Array.from(stats.values());
  }
  setGlobalDecay(decay) {
    this.nodes.forEach((n) => {
      if (n.type === NodeType.OUTPUT || n.type === NodeType.INTERPRETATION) {
        if (n.activationType === "SUSTAINED") {
        } else {
          n.decay = 1;
        }
      } else if (n.type !== NodeType.INPUT) {
        n.decay = decay;
      }
    });
  }
};

// src/demos/patternMemory.ts
var PATTERN_MEMORY_DEFAULTS = {
  neurons: 100,
  // excitatory neurons that can take part in patterns
  inhibitory: 10,
  // feedback inhibition: keeps total activity to about one pattern's worth
  patternSize: 10,
  teachTicks: 20,
  // one exposure = the whole pattern stimulated for this long
  cueTicks: 20,
  stimulation: 3,
  // input added to a stimulated neuron each tick
  weightCap: 0.1011,
  // largest weight a learned synapse can reach
  learningRate: 0.0468,
  window: 3,
  // ticks back a sender still counts as "fired together"
  retention: 0.849,
  // share of its potential a neuron keeps per tick (the engine calls this "decay")
  refractory: 0,
  fatigue: 0.1762,
  // threshold jump after each spike ...
  recovery: 0.4464,
  // ... and how fast it comes back down per tick
  excToInh: 0.0821,
  // excitatory -> inhibitory weight, lowest ...
  excToInhSpread: 1,
  // ... up to this many times that (1 = all the same)
  inhToExc: 0.0962,
  // inhibitory -> excitatory weight (subtracted)
  cameOnSpikes: 2
  // a neuron "came on" during a cue if it fired at least this often
};
var COLORS = ["#ffb000", "#ff5fd2", "#7dff6b", "#5fb4ff", "#ff6b5f", "#c79bff", "#5fffe1", "#fff06b"];
var MODULE_ID = "memory";
var PatternMemory = class {
  options;
  patterns = [];
  excitatoryIds = [];
  inhibitoryIds = [];
  busy = false;
  net;
  inhibitorySet = /* @__PURE__ */ new Set();
  /** Replaces whatever is in `net` with the pattern-memory Brain. */
  constructor(net, options = {}) {
    this.net = net;
    this.options = { ...PATTERN_MEMORY_DEFAULTS, ...options };
    const o = this.options;
    const total = o.neurons + o.inhibitory;
    net.clear();
    net.addModule({
      id: MODULE_ID,
      type: "BRAIN",
      x: 600,
      y: 400,
      nodeCount: total,
      radius: 260,
      name: "Memory",
      label: "Memory",
      // Every neuron is connected to every other one; learning decides which links matter.
      synapsesPerNode: total - 1,
      isLocalized: false,
      localizationLeak: 0,
      threshold: 1,
      decay: o.retention,
      refractoryPeriod: o.refractory,
      hebbianLearning: false,
      hebbianRule: "window",
      hebbianWindow: o.window,
      weightCap: o.weightCap,
      learningRate: o.learningRate,
      regrowthRate: 0
    });
    for (let i = 0; i < total; i++) {
      const id = `${MODULE_ID}-${i}`;
      const node = net.nodes.get(id);
      if (i < o.inhibitory) {
        node.neuronType = "INHIBITORY";
        this.inhibitoryIds.push(id);
        this.inhibitorySet.add(id);
      } else {
        node.neuronType = "EXCITATORY";
        this.excitatoryIds.push(id);
      }
      node.fatigue = o.fatigue;
      node.recovery = o.recovery;
    }
    const inhibitory = new Set(this.inhibitoryIds);
    for (const conn of net.connections) {
      const fromInhibitory = inhibitory.has(conn.sourceId), toInhibitory = inhibitory.has(conn.targetId);
      if (fromInhibitory) conn.weight = toInhibitory ? 0 : -o.inhToExc;
      else if (toInhibitory) conn.weight = o.excToInh * (1 + Math.random() * (o.excToInhSpread - 1));
      else conn.weight = Math.random() * 0.02;
    }
  }
  get module() {
    return this.net.modules.get(MODULE_ID);
  }
  /** A new random pattern (not taught yet). */
  addPattern() {
    const pool = this.excitatoryIds.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const pattern = {
      label: String.fromCharCode(65 + this.patterns.length % 26),
      color: COLORS[this.patterns.length % COLORS.length],
      nodeIds: pool.slice(0, this.options.patternSize),
      exposures: 0
    };
    this.patterns.push(pattern);
    return pattern;
  }
  /** One exposure: stimulate the whole pattern with learning switched on. */
  teach(pattern, onDone) {
    if (this.busy) return;
    this.busy = true;
    this.net.resetState();
    this.net.clearStimulation();
    this.module.hebbianLearning = true;
    this.net.stimulate(pattern.nodeIds, this.options.teachTicks, this.options.stimulation, () => {
      this.module.hebbianLearning = false;
      pattern.exposures++;
      this.busy = false;
      onDone?.();
    });
  }
  /** Stimulate a random part of the pattern (learning off) and report which neurons came on. */
  recall(pattern, onDone, fraction = 0.5) {
    if (this.busy) return [];
    this.busy = true;
    const shuffled = pattern.nodeIds.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const cued = shuffled.slice(0, Math.max(1, Math.floor(pattern.nodeIds.length * fraction)));
    this.net.resetState();
    this.net.clearStimulation();
    this.module.hebbianLearning = false;
    this.net.startRecording();
    this.net.stimulate(cued, this.options.cueTicks, this.options.stimulation, () => {
      const spikes = this.net.stopRecording();
      const on = (id) => (spikes.get(id) || 0) >= this.options.cameOnSpikes;
      const members = new Set(pattern.nodeIds), cuedSet = new Set(cued);
      const missing = pattern.nodeIds.filter((id) => !cuedSet.has(id));
      const result = {
        pattern,
        cued,
        cameOn: missing.filter(on),
        stayedOff: missing.filter((id) => !on(id)),
        intruders: this.excitatoryIds.filter((id) => !members.has(id) && on(id)),
        exact: false
      };
      result.exact = result.stayedOff.length === 0 && result.intruders.length === 0;
      this.busy = false;
      onDone?.(result);
    });
    return cued;
  }
  /** How strongly the pattern's neurons are wired to each other, 0..1 of the cap. */
  strength(pattern) {
    const members = new Set(pattern.nodeIds);
    let sum = 0, count = 0;
    for (const conn of this.net.connections) {
      if (members.has(conn.sourceId) && members.has(conn.targetId)) {
        sum += conn.weight;
        count++;
      }
    }
    return count ? sum / count / this.options.weightCap : 0;
  }
  /** For the canvas: only show links that have actually been learned. */
  isLearnedLink = (conn) => conn.weight > this.options.weightCap * 0.4 && !this.inhibitorySet.has(conn.sourceId) && !this.inhibitorySet.has(conn.targetId);
};

// src/demos/simon.ts
var SIMON_DEFAULTS = {
  tiles: 9,
  tileSize: 10,
  // neurons per tile
  inhibitory: 5,
  stepSize: 5,
  // neurons per "step" signal (only with stepSignal)
  stepSignal: true,
  // tell the Brain which step it is on (makes repeated tiles distinguishable)
  repeats: true,
  // may the sequence repeat a tile?
  maxRounds: 9,
  showTicks: 11,
  // each tile is lit (stimulated) for this long while the sequence is shown
  cueTicks: 4,
  // the first tile is cued for this long before the Brain is on its own
  stimulation: 3,
  weightCap: 0.495,
  learningRate: 0.3657,
  window: 4,
  sameTick: true,
  weakenSilent: true,
  retention: 0.8958,
  refractory: 0,
  fatigue: 1.0634,
  recovery: 0.0952,
  excToInh: 0.01,
  excToInhSpread: 3.3755,
  inhToExc: 0.4125
};
var SIMON_NO_STEP_SIGNAL = {
  ...SIMON_DEFAULTS,
  stepSignal: false,
  repeats: false,
  inhibitory: 0,
  showTicks: 10,
  cueTicks: 3,
  weightCap: 0.03,
  learningRate: 0.3036,
  window: 4,
  sameTick: false,
  weakenSilent: true,
  retention: 0.4696,
  refractory: 2,
  fatigue: 0.8473,
  recovery: 0.6,
  excToInh: 0.0612,
  excToInhSpread: 1.3692,
  inhToExc: 0.0709
};
var SIMON_MODULE_ID = "simon";
var SimonGame = class {
  options;
  tiles = [];
  // neuron ids per tile
  steps = [];
  // neuron ids per step signal
  sequence = [];
  round = 0;
  // rounds passed so far
  busy = false;
  gameOver = false;
  net;
  inhibitorySet = /* @__PURE__ */ new Set();
  excitatoryIds = [];
  constructor(net, options = {}) {
    this.net = net;
    this.options = { ...options.stepSignal === false ? SIMON_NO_STEP_SIGNAL : SIMON_DEFAULTS, ...options };
    const o = this.options;
    const excitatory = o.tiles * o.tileSize + (o.stepSignal ? o.maxRounds * o.stepSize : 0);
    const total = excitatory + o.inhibitory;
    net.clear();
    net.addModule({
      id: SIMON_MODULE_ID,
      type: "BRAIN",
      x: 600,
      y: 400,
      nodeCount: total,
      radius: 260,
      name: "Simon",
      label: "Simon",
      synapsesPerNode: total - 1,
      isLocalized: false,
      localizationLeak: 0,
      threshold: 1,
      decay: o.retention,
      refractoryPeriod: o.refractory,
      hebbianLearning: false,
      hebbianRule: "window",
      hebbianWindow: o.window,
      hebbianSameTick: o.sameTick,
      hebbianWeakenSilent: o.weakenSilent,
      weightCap: o.weightCap,
      learningRate: o.learningRate,
      regrowthRate: 0
    });
    for (let i = 0; i < total; i++) {
      const id = `${SIMON_MODULE_ID}-${i}`;
      const node = net.nodes.get(id);
      node.fatigue = o.fatigue;
      node.recovery = o.recovery;
      if (i < o.inhibitory) {
        node.neuronType = "INHIBITORY";
        this.inhibitorySet.add(id);
      } else {
        node.neuronType = "EXCITATORY";
        this.excitatoryIds.push(id);
      }
    }
    for (const conn of net.connections) {
      const fromInhibitory = this.inhibitorySet.has(conn.sourceId), toInhibitory = this.inhibitorySet.has(conn.targetId);
      if (fromInhibitory) conn.weight = toInhibitory ? 0 : -o.inhToExc;
      else if (toInhibitory) conn.weight = o.excToInh * (1 + Math.random() * (o.excToInhSpread - 1));
      else conn.weight = Math.random() * 0.02;
    }
    const pool = this.excitatoryIds.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let t = 0; t < o.tiles; t++) this.tiles.push(pool.slice(t * o.tileSize, (t + 1) * o.tileSize));
    if (o.stepSignal) for (let k = 0; k < o.maxRounds; k++) this.steps.push(pool.slice(o.tiles * o.tileSize + k * o.stepSize, o.tiles * o.tileSize + (k + 1) * o.stepSize));
    this.newSequence();
  }
  get module() {
    return this.net.modules.get(SIMON_MODULE_ID);
  }
  newSequence() {
    const o = this.options;
    const order = Array.from({ length: o.tiles }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    this.sequence = Array.from({ length: o.maxRounds }, (_, k) => o.repeats ? Math.floor(Math.random() * o.tiles) : order[k % o.tiles]);
    this.round = 0;
    this.gameOver = false;
  }
  /** The Brain forgets its fatigue between show and replay, like the experiment harness. */
  reset() {
    this.net.resetState();
    this.net.clearStimulation();
    for (const id of this.excitatoryIds) {
      const n = this.net.nodes.get(id);
      n.currentThreshold = n.threshold;
    }
  }
  /**
   * Play the next round: show tiles 1..k (learning on), then let the Brain replay (learning off).
   * onShow(tile)   a tile lights up while the sequence is shown
   * onPress(tile)  the Brain pressed a tile during replay
   * onDone(result)
   */
  playRound(onShow, onPress, onDone) {
    if (this.busy || this.gameOver) return;
    this.busy = true;
    const o = this.options;
    const k = this.round + 1;
    const shown = this.sequence.slice(0, k);
    const net = this.net;
    this.reset();
    this.module.hebbianLearning = true;
    const showStep = (step) => {
      if (step >= shown.length) {
        onShow(null);
        this.replay(shown, onPress, onDone);
        return;
      }
      onShow(shown[step]);
      net.stimulate([...this.tiles[shown[step]], ...this.steps[step] || []], o.showTicks, o.stimulation, () => showStep(step + 1));
    };
    showStep(0);
  }
  replay(shown, onPress, onDone) {
    const o = this.options;
    const net = this.net;
    this.module.hebbianLearning = false;
    this.reset();
    const pressed = [];
    const wasOn = new Array(o.tiles).fill(false);
    let ticks = 0;
    const limit = o.cueTicks + (shown.length + 1) * o.showTicks * 2;
    const finish = () => {
      net.afterStep = null;
      net.clearStimulation();
      const passed = pressed.length === shown.length && pressed.every((t, i) => t === shown[i]);
      if (passed) this.round++;
      else this.gameOver = true;
      this.busy = false;
      onDone({ round: shown.length, shown, pressed, passed });
    };
    let stepShown = -1, stepStimulus = 0;
    const driveStep = () => {
      if (!o.stepSignal) return;
      const step = Math.min(pressed.length, o.maxRounds - 1);
      if (step === stepShown) return;
      stepShown = step;
      net.stopStimulus(stepStimulus);
      stepStimulus = net.stimulate(this.steps[step], limit, o.stimulation);
    };
    driveStep();
    net.stimulate(this.tiles[shown[0]], o.cueTicks, o.stimulation);
    net.afterStep = () => {
      ticks++;
      for (let t = 0; t < o.tiles; t++) {
        let on = 0;
        for (const id of this.tiles[t]) if (net.tickCount - net.nodes.get(id).lastFiredTick <= 2) on++;
        const isOn = on * 2 >= o.tileSize;
        if (isOn && !wasOn[t]) {
          pressed.push(t);
          onPress(t);
          driveStep();
        }
        wasOn[t] = isOn;
      }
      const wrong = pressed.some((t, i) => t !== shown[i]);
      if (wrong || pressed.length >= shown.length || ticks >= limit) finish();
    };
  }
  /** Only learned links between tile neurons are worth drawing. */
  isLearnedLink = (conn) => conn.weight > this.options.weightCap * 0.4 && !this.inhibitorySet.has(conn.sourceId) && !this.inhibitorySet.has(conn.targetId);
};
export {
  NeuralNet,
  NodeType,
  PATTERN_MEMORY_DEFAULTS,
  PatternMemory,
  SIMON_DEFAULTS,
  SimonGame
};
