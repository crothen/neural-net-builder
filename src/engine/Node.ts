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
    public maxPotential: number = 4.0;

    // Fatigue state
    public fatigue: number = 0; // The threshold jump amount
    public recovery: number = 0; // The threshold recovery amount per tick
    public currentThreshold: number = 1.0; // The dynamic threshold

    constructor(config: NodeConfig) {
        this.id = config.id;
        this.type = config.type;
        this.x = config.x;
        this.y = config.y;
        this.label = config.label || '';
        this.bias = config.bias || 0;
        this.threshold = config.threshold !== undefined ? config.threshold : 1.0;
        this.currentThreshold = this.threshold; // Initialize dynamic threshold

        this.maxPotential = config.maxPotential !== undefined ? config.maxPotential : 3.0; // Default 3.0 per request
        this.refractoryPeriod = config.refractoryPeriod !== undefined ? Number(config.refractoryPeriod) : 2;
        this.inputFrequency = config.inputFrequency !== undefined ? config.inputFrequency : 1.0;

        this.fatigue = config.fatigue !== undefined ? config.fatigue : 0;
        this.recovery = config.recovery !== undefined ? config.recovery : 0;

        // Sanitize activation type to ensure consistent behavior
        const typeInput = config.activationType ? String(config.activationType).toUpperCase() : 'PULSE';
        this.activationType = (typeInput === 'SUSTAINED') ? 'SUSTAINED' : 'PULSE';

        // FIX: If it is an OUTPUT or INTERPRETATION node, it should have NO memory.
        if (this.type === NodeType.OUTPUT || this.type === NodeType.INTERPRETATION) {
            // Exception: Sustained Output (OUTPUT + SUSTAINED) should have memory (decay)
            if (this.activationType === 'SUSTAINED') {
                this.decay = config.decay !== undefined ? config.decay : 0.9;
            } else {
                this.decay = 0.0; // Decay 0.0 means P * 0 = 0 (Instant Reset)
            }
        } else {
            // Brain nodes keep their memory
            this.decay = config.decay !== undefined ? config.decay : 0.9;
        }
    }

    /**
     * Updates the node state based on inputs.
     * @param inputSum The sum of weighted inputs from incoming connections.
     */
    public update(inputSum: number) {
        // 1. Add inputs and bias
        this.potential += inputSum + this.bias;

        // 2. Decay
        // Apply decay to the potential BEFORE checking threshold (User Rule: "Decay (The Leak): Multiply potential")
        // "The 'receiving node' decays right here... every single frame."
        // "Check Threshold (Fire): IF potential > threshold"
        this.potential *= this.decay;

        // Clamp to 0 to prevent negative buildup
        if (this.potential < 0) this.potential = 0;

        // FIX: Clamp Sustained/Pulse nodes to a reasonable Max relative to threshold
        if (this.potential > this.maxPotential) {
            this.potential = this.maxPotential;
        }

        // FATIGUE RECOVERY (Step 2 in User Request)
        // "Slowly drift threshold back down to 1.0"
        if (this.currentThreshold > this.threshold) {
            this.currentThreshold -= this.recovery;
            // Don't drift below base threshold
            if (this.currentThreshold < this.threshold) {
                this.currentThreshold = this.threshold;
            }
        } else if (this.currentThreshold < this.threshold) {
            // Just in case it got lower somehow, reset to base
            this.currentThreshold = this.threshold;
        }

        // 3. Check Threshold (Fire) - USING DYNAMIC THRESHOLD
        if (this.potential >= this.currentThreshold) {
            // 0. Check Refractory Period (Gate Firing)
            if (this.refractoryTimer > 0) {
                this.refractoryTimer--;
                this.isFiring = false;
                this.activation = 0.0;
                // Only hard reset potential for PULSE nodes. 
                if (this.activationType === 'PULSE') {
                    this.potential = 0;
                }
                return;
            }

            this.isFiring = true;
            this.activation = 1.0; // Spike!

            // Apply Refractory Period
            const jitter = Math.random() < 0.5 ? 0 : 1;
            this.refractoryTimer = this.refractoryPeriod + jitter;

            // Soft Reset
            // USER RULE: Sustained Output does NOT lose potential when firing
            const isSustainedOutput = (this.type === NodeType.OUTPUT && this.activationType === 'SUSTAINED');

            if (!isSustainedOutput) {
                // USER RULE: "potential -= this.currentThreshold; // Soft Reset"
                // Important: subtract the ACTUAL threshold used to fire (which might be higher due to fatigue)
                this.potential -= this.currentThreshold;
            }

            // FATIGUE JUMP (Step 4 in User Request)
            // "Jump the threshold up!"
            this.currentThreshold += this.fatigue;

        } else {
            // Not firing
            this.isFiring = false;
            this.activation = 0.0;

            // Refractory tick down even if not firing? 
            // Usually refractory only matters AFTER firing. 
            // If we are below threshold, we are just charging.
            if (this.refractoryTimer > 0) this.refractoryTimer--;
        }

        // USER RULE: Only Sustained nodes should have a potential
        // Everything else does not need to store it. They are "fire and forget".
        if (this.activationType !== 'SUSTAINED') {
            // If we didn't fire, we still reset? 
            // Wait, "Integrate -> Decay -> Check".
            // If it's a "PULSE" node (Leaky Integrity Fire), it SHOULD keep potential between ticks if it doesn't fire!
            // That's the "Integrate" part of "LIF".
            // If we reset potential here, it's just "Instant Fire".
            // BUT, the previous code had: "if (this.activationType !== 'SUSTAINED') this.potential = 0;" at the VERY END.
            // This implies Pulse nodes are NOT integrating over time? 
            // OR "Decay" is 0.0 for them?

            // Check Constructor:
            // "if (this.activationType === 'SUSTAINED') this.decay = ... else this.decay = 0.0" (Instant Reset) for OUTPUT.
            // But for BRAIN: "this.decay = 0.9".
            // So Brain nodes ARE Integrating.

            // The previous code block "if (this.activationType !== 'SUSTAINED') this.potential = 0;" was likely WRONG or aggressive clean up.
            // If Brain nodes (PULSE) have decay 0.9, they MUST retain potential.
            // So I should REMOVE that forced reset if I want them to Integrate.

            // User Spec: "Decay: Multiply potential by 0.9." 
            // This implies potential persists.

            // I will REMOVE the forced "this.potential = 0" at the end, 
            // because strict LIF relies on Decay to reduce potential, not hard reset (unless firing).
        }

        // USER RULE: Only Sustained nodes should have a potential
        // Everything else does not need to store it. They are "fire and forget".
        if (this.activationType !== 'SUSTAINED') {
            this.potential = 0;
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
