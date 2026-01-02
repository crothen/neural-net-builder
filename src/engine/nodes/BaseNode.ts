import { type NodeConfig, NodeType, type ActivationType, type InputType, type SustainabilityConfig } from '../types';

/**
 * Abstract Base Class for all Neural Network Nodes.
 * Provides shared state and the contract for update().
 */
export abstract class BaseNode {
    public id: string;
    public type: NodeType;
    public x: number;
    public y: number;
    public label: string;

    // Shared Physics State
    public potential: number = 0;
    public activation: number = 0;
    public isFiring: boolean = false;

    // Common Configuration
    public bias: number = 0;

    // Some shared properties that might vary by implementation, 
    // but useful to keep common for UI/Inspector access without casting.
    public threshold: number = 1.0;
    public decay: number = 0.0;
    public maxPotential: number = 3.0;

    // Activation/Input Configuration (Optional, usually specific types)
    public activationType: ActivationType = 'PULSE';
    public inputType: InputType = 'PULSE';
    public inputFrequency: number = 1.0;

    // Fatigue properties (Shared signature, used primarily by BrainNode)
    public fatigue: number = 0;
    public recovery: number = 0;
    public currentThreshold: number = 1.0;

    // Refractory (Shared signature)
    public refractoryPeriod: number = 0;
    public refractoryTimer: number = 0;

    // Sustainability Config
    public sustainability?: SustainabilityConfig;

    constructor(config: NodeConfig) {
        this.id = config.id;
        this.type = config.type;
        this.x = config.x;
        this.y = config.y;
        this.label = config.label || '';
        this.bias = config.bias || 0;

        // Common defaults
        this.threshold = config.threshold ?? 1.0;
        this.maxPotential = config.maxPotential ?? 3.0;

        // Fatigue defaults
        this.fatigue = config.fatigue ?? 0;
        this.recovery = config.recovery ?? 0;
        this.currentThreshold = this.threshold;

        this.sustainability = config.sustainability;
    }

    /**
     * Core update logic for the node. 
     * @param inputSum The logical input sum for this tick.
     */
    public abstract update(inputSum: number): void;

    /**
     * Resets the node state (e.g. for hard restart).
     */
    public reset(): void {
        this.potential = 0;
        this.activation = 0;
        this.isFiring = false;
        this.refractoryTimer = 0;
        this.currentThreshold = this.threshold;
    }

    /**
     * Setter for inputs (Manual override)
     */
    public setInput(val: number): void {
        // Default implementation does nothing or sets potential.
        // InputNode will override.
        this.potential = val;
    }
}
