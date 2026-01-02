import { BaseNode } from './BaseNode';
import { type NodeConfig } from '../types';

/**
 * Standard Output Node (Pulse).
 * Resets potential to 0 immediately after update/firing (Fire and Forget).
 */
export class OutputNode extends BaseNode {
    constructor(config: NodeConfig) {
        super(config);
        // Standard Outputs are instant.
        this.decay = 1.0; // P * 1.0 (Wait, previously decay=1.0 meant Instant Reset in setGlobalDecay logic?)
        // Let's check Logic: "potential *= decay". 
        // If we want instant reset, decay should be 0.0.
        // In Node.ts logic: "if (OUTPUT) this.decay = 0.0".
        this.decay = 0.0;
    }

    public update(inputSum: number): void {
        this.potential += inputSum + this.bias;

        // Instant Decay / Reset Logic
        // For Pulse Output, we simply reset at the end of the update (Fire and Forget).
        // The decay property is effectively ignored or treated as 0.

        if (this.potential > this.maxPotential) this.potential = this.maxPotential;

        if (this.potential >= this.threshold) {
            this.isFiring = true;
            this.activation = 1.0;
            this.potential = 0; // Hard Reset
        } else {
            this.isFiring = false;
            this.activation = 0.0;
            this.potential = 0; // Hard Reset (No memory)
        }
    }
}

/**
 * Sustained Output Node.
 * Accumulates potential and respects Decay.
 * Does NOT reset upon firing.
 */
export class SustainedOutputNode extends BaseNode {
    constructor(config: NodeConfig) {
        super(config);
        this.activationType = 'SUSTAINED';
        // Inherits config.decay (e.g. 0.9)
        this.decay = config.decay ?? 0.9;
    }

    public update(inputSum: number): void {
        // 1. Integrate
        this.potential += inputSum + this.bias;

        // 2. Decay
        this.potential *= this.decay;
        if (this.potential < 0) this.potential = 0;

        // 3. Clamp
        if (this.potential > this.maxPotential) this.potential = this.maxPotential;

        // 4. Fire Check
        // No Refractory for Sustained (usually)
        if (this.potential >= this.threshold) {
            this.isFiring = true;
            this.activation = 1.0;
            // NO RESET. Potential stays high.
        } else {
            this.isFiring = false;
            this.activation = 0.0;
        }
    }
}
