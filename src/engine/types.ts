export const NodeType = {
    INPUT: 'INPUT',
    HIDDEN: 'HIDDEN',
    INTERPRETATION: 'INTERPRETATION',
    OUTPUT: 'OUTPUT'
} as const;

export type NodeType = typeof NodeType[keyof typeof NodeType];

export type ActivationType = 'SUSTAINED' | 'PULSE'; // New firing modes

export interface NodeConfig {
    id: string;
    type: NodeType;
    x: number;
    y: number;
    label?: string;
    bias?: number;
    threshold?: number; // Configurable firing threshold
    refractoryPeriod?: number; // Cycles to wait after firing
    activationType?: ActivationType; // Configurable firing logic
    decay?: number;
}

export interface ConnectionConfig {
    id: string;
    sourceId: string;
    targetId: string;
    weight: number;
}

/**
 * Represents the state of a node for visualization.
 */
export interface NodeState {
    id: string;
    activation: number; // 0 to 1 (or higher if using raw value)
    potential: number; // For LIF visualization
    isFiring: boolean;
    inRefractory: boolean; // Visual feedback?
}

export type ModuleType = 'BRAIN' | 'LAYER' | 'INPUT' | 'OUTPUT';

export interface ModuleConfig {
    id: string;
    type: ModuleType;
    x: number; // Center X
    y: number; // Center Y
    label?: string; // Auto-generated ID label
    name?: string; // User-defined name
    color?: string; // Neutral color for nodes

    // Config params
    nodeCount: number; // Height (nodes per column)
    depth?: number; // Number of columns (for LAYERS)

    // Hebbian Learning
    hebbianLearning?: boolean;
    learningRate?: number;

    radius?: number; // for Brain
    width?: number; // for Layer width (visual spacing between columns)
    height?: number; // for Layer height

    // Node params
    activationType?: ActivationType;
    threshold?: number;
    decay?: number;
    refractoryPeriod?: number;
}

export type ConnectionSide = 'ALL' | 'LEFT' | 'RIGHT';

