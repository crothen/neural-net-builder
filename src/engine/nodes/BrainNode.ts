import { BaseNode } from './BaseNode';
import { type NodeConfig } from '../types';

export class BrainNode extends BaseNode {
    constructor(config: NodeConfig) {
        super(config);
        this.decay = config.decay ?? 0.9;
        this.refractoryPeriod = Number(config.refractoryPeriod ?? 2);
    }

    public update(inputSum: number): void {
        // 1. Check Refractory Period (Gate Execution)
        if (this.refractoryTimer > 0) {
            this.refractoryTimer--;
            this.isFiring = false;
            this.activation = 0.0;
            // Brain Nodes (Hidden/LIF) do NOT hard reset potential to 0 here.
            // They just can't fire.
            return;
        }

        // 2. Integration
        this.potential += inputSum + this.bias;

        // 3. Decay (Pre-Threshold)
        this.potential *= this.decay;
        if (this.potential < 0) this.potential = 0;

        // 4. Max Potential Clamp
        if (this.potential > this.maxPotential) {
            this.potential = this.maxPotential;
        }

        // 5. Fatigue Recovery
        // Drift currentThreshold back to base threshold
        if (this.currentThreshold > this.threshold) {
            this.currentThreshold -= this.recovery;
            if (this.currentThreshold < this.threshold) {
                this.currentThreshold = this.threshold;
            }
        }

        // 6. Threshold Check
        if (this.potential >= this.currentThreshold) {
            this.fire();

            // Adaptive Threshold: Raise Shield (Too Loud)
            if (this.sustainability && this.sustainability.adaptiveThreshold) {
                this.threshold += this.sustainability.adaptationSpeed;
            }
        } else {
            this.isFiring = false;
            this.activation = 0.0;

            // Adaptive Threshold: Lower Shield (Bored)
            if (this.sustainability && this.sustainability.adaptiveThreshold) {
                const { adaptationSpeed, targetRate } = this.sustainability;
                this.threshold -= (adaptationSpeed * targetRate);
                // Safety Clamp (Plan said 0.1)
                this.threshold = Math.max(this.threshold, 0.1);
            }
        }
    }

    private fire() {
        this.isFiring = true;
        this.activation = 1.0;

        // Soft Reset: Subtract the threshold (User Rule)
        this.potential -= this.currentThreshold;

        // Fatigue Jump
        this.currentThreshold += this.fatigue;

        // Visual Jitter for refractory
        const jitter = Math.random() < 0.5 ? 0 : 1;
        this.refractoryTimer = this.refractoryPeriod + jitter;
    }
}
