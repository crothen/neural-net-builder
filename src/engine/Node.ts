import type { NodeConfig } from './types.ts';
import { NodeType } from './types.ts';

export class Node {
    public id: string;
    public type: NodeType;
    public x: number;
    public y: number;
    public label: string;

    // LIF state
    public potential: number = 0; // Membrane potential (v)
    public activation: number = 0; // Output signal
    public isFiring: boolean = false;

    // Parameters
    private bias: number;
    public decay: number = 0.1; // How much potential decays per tick (0-1)
    public threshold: number = 1.0;
    public refractoryPeriod: number = 2; // Cycles to wait
    private refractoryTimer: number = 0;
    public activationType: 'SUSTAINED' | 'PULSE' = 'PULSE';

    constructor(config: NodeConfig) {
        this.id = config.id;
        this.type = config.type;
        this.x = config.x;
        this.y = config.y;
        this.label = config.label || '';
        this.bias = config.bias || 0;
        this.threshold = config.threshold !== undefined ? config.threshold : 1.0;
        this.refractoryPeriod = config.refractoryPeriod !== undefined ? config.refractoryPeriod : 2;
        this.activationType = config.activationType || 'PULSE';

        // Default Brain nodes to SUSTAINED if not specified? 
        // Better to be explicit in config, usually.
        // But for backward compatibility logic inside the class:
        this.activationType = config.activationType || 'PULSE';

        // FIX: If it is an OUTPUT or INTERPRETATION node, it should have NO memory.
        if (this.type === NodeType.OUTPUT || this.type === NodeType.INTERPRETATION) {
            this.decay = 1.0; // Decay 100% every tick (Instant Reset)
        } else {
            // Brain nodes keep their memory
            this.decay = config.decay || 0.1;
        }
    }

    /**
     * Updates the node state based on inputs.
     * @param inputSum The sum of weighted inputs from incoming connections.
     */
    public update(inputSum: number) {
        // 0. Check Refractory Period
        if (this.refractoryTimer > 0) {
            this.refractoryTimer--;
            this.isFiring = false;
            this.activation = 0.0;
            this.potential = 0; // Hard reset during absolute refractory
            return;
        }

        // 1. Add inputs and bias
        this.potential += inputSum + this.bias;

        if (this.potential >= this.threshold) {
            this.isFiring = true;
            this.activation = 1.0; // Spike!

            // FIX: Only apply Refractory Period to PULSE nodes
            if (this.activationType === 'PULSE') {
                this.refractoryTimer = this.refractoryPeriod;
                this.potential -= this.threshold; // Soft Reset
            } else {
                // SUSTAINED MODE:
                // Do NOT set the timer.
                // Do NOT subtract threshold.
                // Just let the high potential sit there.
                // It will naturally decay in Step 4.
            }

        } else {
            this.isFiring = false;
            this.activation = 0.0;
        }

        // 4. Decay
        // Apply decay to the remaining potential
        this.potential *= (1 - this.decay);

        // Clamp to 0 to prevent negative buildup
        if (this.potential < 0) this.potential = 0;

        // FIX: Clamp Sustained nodes to a reasonable Max (e.g. 4.0) 
        // instead of the threshold (1.0). This allows "strong" memory 
        // that takes time to decay, without going to infinity.
        if (this.activationType === 'SUSTAINED' && this.potential > 4.0) {
            this.potential = 4.0;
        }
    }

    /**
     * For INPUT nodes, we might want to manually set the potential/activation.
     */
    public setInput(val: number) {
        this.potential = val;
        // direct feed-through for inputs? Or do they pulse?
        // User said "click on input nodes... how it reacts".
        // Let's assume input nodes fire if value > threshold, or we just map value to activation directly.
        this.activation = val;
        this.isFiring = val >= 0.8; // arbitrary visual threshold
    }

    public reset() {
        this.potential = 0;
        this.activation = 0;
        this.isFiring = false;
        this.refractoryTimer = 0;
    }
}
