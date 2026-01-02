import { BaseNode } from './BaseNode';
import { type NodeConfig } from '../types';

export class InputNode extends BaseNode {
    // Timer for internal generation state
    private timer: number = 0;

    constructor(config: NodeConfig) {
        super(config);
        this.inputType = config.inputType || 'PULSE';
        this.inputFrequency = config.inputFrequency !== undefined ? config.inputFrequency : 1.0;

        // Inputs have no decay/threshold logic in the traditional sense
        this.decay = 0;
        this.threshold = 0;
    }

    public update(_inputSum: number): void {
        // Usage of inputSum: Input nodes technically don't receive inputs from other nodes usually,
        // but if they did, we could add it. For now, they generate their own signal.
        // We override this.potential directly via setInput or internal generation.

        // This update loop is for self-generated activity if any.
        // "Pulse (Manual)" usually relies on setInput().

        // Generators:
        if (this.inputType === 'SIN') {
            this.timer += 0.1; // Tick increment
            // sin(t * freq)
            const val = Math.sin(this.timer * this.inputFrequency);
            this.activation = (val + 1) / 2; // Normalize -1..1 to 0..1
            this.potential = this.activation;
            this.isFiring = this.activation > 0.5; // Visual threshold
        } else if (this.inputType === 'NOISE') {
            // Frequency as density/probability?
            // "inputFrequency" 1.0 = heavy noise?
            if (Math.random() < (this.inputFrequency * 0.1)) {
                this.activation = Math.random();
                this.potential = this.activation;
                this.isFiring = true;
            } else {
                this.activation = 0;
                this.potential = 0;
                this.isFiring = false;
            }
        }
        // PULSE is manual, usually set via setInput
        // We reset it here to ensure it only fires for one tick (One-Shot)
        if (this.inputType === 'PULSE') {
            this.potential = 0;
            this.activation = 0;
            this.isFiring = false;
        }
    }

    public override setInput(val: number) {
        this.potential = val;
        this.activation = val;
        this.isFiring = val >= 0.8; // Visual threshold
    }
}
