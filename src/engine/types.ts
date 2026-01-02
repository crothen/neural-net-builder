export const NodeType = {
    INPUT: 'INPUT',
    HIDDEN: 'HIDDEN',
    INTERPRETATION: 'INTERPRETATION',
    OUTPUT: 'OUTPUT',
    CONCEPT: 'CONCEPT',
    LEARNED: 'LEARNED'
} as const;

export type NodeType = typeof NodeType[keyof typeof NodeType];

export type ActivationType = 'SUSTAINED' | 'PULSE'; // New firing modes
export type InputType = 'PULSE' | 'SIN' | 'NOISE'; // New input generator modes

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
    inputFrequency?: number; // Frequency/Density for INPUT nodes
    maxPotential?: number;
    inputType?: InputType;
    fatigue?: number; // Threshold jump after firing
    recovery?: number; // Threshold recovery per tick
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

export type ModuleType = 'BRAIN' | 'LAYER' | 'INPUT' | 'OUTPUT' | 'SUSTAINED_OUTPUT' | 'CONCEPT' | 'LEARNED_OUTPUT' | 'TRAINING_DATA';

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
    pruningThreshold?: number; // Remove weak connections below this
    regrowthRate?: number; // New connections per tick
    leak?: number; // For Brain modules (general signal leak/decay modifier)

    radius?: number; // for Brain
    width?: number; // for Layer width (visual spacing between columns)
    height?: number; // for Layer height

    // Node params
    activationType?: ActivationType;
    threshold?: number;
    decay?: number;
    refractoryPeriod?: number;
    bias?: number;
    inputFrequency?: number;
    maxPotential?: number; // Configurable max potential cap
    gain?: number; // Weight multiplier for Sustained Output
    fatigue?: number; // Threshold jump
    recovery?: number; // Threshold recovery


    // Localization
    isLocalized?: boolean;
    localizationLeak?: number; // 0-100 (Replaces 'localizer' for internal use basically)
    synapsesPerNode?: number; // Internal connections per node (default 2)

    // Concept Data
    concepts?: { id: string; label: string }[];
    conceptColumn?: string;
    collapsed?: boolean; // If true, rendering is simplified (e.g. triangle)

    // Training Data
    trainingData?: any[]; // The raw CSV rows
    trainingConfig?: {
        targetBrainId?: string; // Linked Brain
        targetOutputId?: string; // Linked Learned Output
        trainingIterations?: number; // Steps per concept
        idColumn: string;
        wordColumn: string;
        // Map ModuleID -> CSV Column Name
        conceptMappings: Record<string, { column: string, delimiter: string }>;
    };
}

export type ConnectionSide = 'ALL' | 'LEFT' | 'RIGHT';

export interface ModuleConnectionConfig {
    sourceId: string;
    targetId: string;
    coverage: number;
    localizer: number;
    sides: {
        src: ConnectionSide;
        tgt: ConnectionSide;
    };
}

