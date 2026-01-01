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
    public refractoryTimer: number = 0;
    public activationTimer: number = 0;
    public activationType: 'SUSTAINED' | 'PULSE' = 'PULSE';
    public inputType: 'PULSE' | 'SIN' | 'NOISE' = 'PULSE';
    public inputFrequency: number = 1.0;

    constructor(config: NodeConfig) {
        this.id = config.id;
        this.type = config.type;
        this.x = config.x;
        this.y = config.y;
        this.label = config.label || '';
        this.bias = config.bias || 0;
        this.threshold = config.threshold !== undefined ? config.threshold : 1.0;
        this.refractoryPeriod = config.refractoryPeriod !== undefined ? Number(config.refractoryPeriod) : 2;
        this.inputFrequency = config.inputFrequency !== undefined ? config.inputFrequency : 1.0;

        // Sanitize activation type to ensure consistent behavior
        const typeInput = config.activationType ? String(config.activationType).toUpperCase() : 'PULSE';
        this.activationType = (typeInput === 'SUSTAINED') ? 'SUSTAINED' : 'PULSE';

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
            // Only hard reset potential for PULSE nodes. 
            // SUSTAINED nodes keep their charge but are legally prevented from firing.
            if (this.activationType === 'PULSE') {
                this.potential = 0;
            }
            return;
        }

        // 1. Add inputs and bias
        this.potential += inputSum + this.bias;

        if (this.potential >= this.threshold) {
            this.isFiring = true;
            this.activation = 1.0; // Spike!

            // Apply Refractory Period to BOTH types to allow rate-limiting
            const jitter = Math.random() < 0.5 ? 0 : 1;
            this.refractoryTimer = this.refractoryPeriod + jitter;

            if (this.activationType === 'PULSE') {
                this.potential -= this.threshold; // Soft Reset
            }
            // SUSTAINED: Potential is maintained, but output is silenced for (refractory) ticks.

        } else {
            this.isFiring = false;
            this.activation = 0.0;
        }

        // 4. Decay
        // Apply decay to the remaining potential
        this.potential *= (1 - this.decay);

        // Clamp to 0 to prevent negative buildup
        if (this.potential < 0) this.potential = 0;

        // FIX: Clamp Sustained/Pulse nodes to a reasonable Max relative to threshold
        // This prevents infinite buildup but allows some "overcharge"
        const maxPotential = this.threshold * 4.0;
        if (this.potential > maxPotential) {
            this.potential = maxPotential;
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
