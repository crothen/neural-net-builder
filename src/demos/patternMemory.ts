import { NeuralNet } from '../engine/NeuralNet';
import type { Connection } from '../engine/Connection';

/**
 * Pattern memory: a small Brain that stores patterns with Hebbian learning alone (no teacher, no error signal)
 * and brings a whole pattern back when part of it is stimulated.
 *
 * The numbers below were found by evolving brain settings on the pattern-completion and sequence tasks
 * (experiments/patterns/evolve.mjs; see experiments/FINDINGS.md, Findings 11 and 12). On fresh seeds this setup
 * recalls 10 stored patterns of 10 neurons exactly 96% of the time, and 20 patterns 73%.
 */
export const PATTERN_MEMORY_DEFAULTS = {
    neurons: 100,          // excitatory neurons that can take part in patterns
    inhibitory: 10,        // feedback inhibition: keeps total activity to about one pattern's worth
    patternSize: 10,
    teachTicks: 20,        // one exposure = the whole pattern stimulated for this long
    cueTicks: 20,
    stimulation: 3,        // input added to a stimulated neuron each tick
    weightCap: 0.1011,     // largest weight a learned synapse can reach
    learningRate: 0.0468,
    window: 3,             // ticks back a sender still counts as "fired together"
    retention: 0.849,      // share of its potential a neuron keeps per tick (the engine calls this "decay")
    refractory: 0,
    fatigue: 0.1762,       // threshold jump after each spike ...
    recovery: 0.4464,      // ... and how fast it comes back down per tick
    excToInh: 0.0821,      // excitatory -> inhibitory weight, lowest ...
    excToInhSpread: 1,     // ... up to this many times that (1 = all the same)
    inhToExc: 0.0962,      // inhibitory -> excitatory weight (subtracted)
    cameOnSpikes: 2,       // a neuron "came on" during a cue if it fired at least this often
};

export type PatternMemoryOptions = Partial<typeof PATTERN_MEMORY_DEFAULTS>;

export interface StoredPattern {
    label: string;
    color: string;
    nodeIds: string[];
    exposures: number;
}

export interface RecallResult {
    pattern: StoredPattern;
    cued: string[];       // neurons that were stimulated
    cameOn: string[];     // missing neurons of the pattern that came on
    stayedOff: string[];  // missing neurons that did not
    intruders: string[];  // neurons outside the pattern that came on
    exact: boolean;       // everything missing came on and nothing else did
}

const COLORS = ['#ffb000', '#ff5fd2', '#7dff6b', '#5fb4ff', '#ff6b5f', '#c79bff', '#5fffe1', '#fff06b'];
export const MODULE_ID = 'memory';

export class PatternMemory {
    public readonly options: typeof PATTERN_MEMORY_DEFAULTS;
    public readonly patterns: StoredPattern[] = [];
    public readonly excitatoryIds: string[] = [];
    public readonly inhibitoryIds: string[] = [];
    public busy: boolean = false;

    private readonly net: NeuralNet;
    private readonly inhibitorySet: Set<string> = new Set();

    /** Replaces whatever is in `net` with the pattern-memory Brain. */
    constructor(net: NeuralNet, options: PatternMemoryOptions = {}) {
        this.net = net;
        this.options = { ...PATTERN_MEMORY_DEFAULTS, ...options };
        const o = this.options;
        const total = o.neurons + o.inhibitory;

        net.clear();
        net.addModule({
            id: MODULE_ID, type: 'BRAIN', x: 600, y: 400, nodeCount: total, radius: 260, name: 'Memory', label: 'Memory',
            // Every neuron is connected to every other one; learning decides which links matter.
            synapsesPerNode: total - 1, isLocalized: false, localizationLeak: 0,
            threshold: 1, decay: o.retention, refractoryPeriod: o.refractory,
            hebbianLearning: false, hebbianRule: 'window', hebbianWindow: o.window, weightCap: o.weightCap,
            learningRate: o.learningRate, regrowthRate: 0,
        });

        // The first few neurons sit in the middle of the spiral: those become the inhibitory pool.
        for (let i = 0; i < total; i++) {
            const id = `${MODULE_ID}-${i}`;
            const node = net.nodes.get(id)!;
            if (i < o.inhibitory) { node.neuronType = 'INHIBITORY'; this.inhibitoryIds.push(id); this.inhibitorySet.add(id); }
            else { node.neuronType = 'EXCITATORY'; this.excitatoryIds.push(id); }
            node.fatigue = o.fatigue;   // addModule does not pass these two on to the neurons
            node.recovery = o.recovery;
        }
        const inhibitory = new Set(this.inhibitoryIds);
        for (const conn of net.connections) {
            const fromInhibitory = inhibitory.has(conn.sourceId), toInhibitory = inhibitory.has(conn.targetId);
            if (fromInhibitory) conn.weight = toInhibitory ? 0 : -o.inhToExc;
            else if (toInhibitory) conn.weight = o.excToInh * (1 + Math.random() * (o.excToInhSpread - 1));
            else conn.weight = Math.random() * 0.02; // learned links start close to nothing
        }
    }

    private get module() {
        return this.net.modules.get(MODULE_ID)!;
    }

    /** A new random pattern (not taught yet). */
    public addPattern(): StoredPattern {
        const pool = this.excitatoryIds.slice();
        for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const pattern: StoredPattern = {
            label: String.fromCharCode(65 + (this.patterns.length % 26)),
            color: COLORS[this.patterns.length % COLORS.length],
            nodeIds: pool.slice(0, this.options.patternSize),
            exposures: 0,
        };
        this.patterns.push(pattern);
        return pattern;
    }

    /** One exposure: stimulate the whole pattern with learning switched on. */
    public teach(pattern: StoredPattern, onDone?: () => void) {
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
    public recall(pattern: StoredPattern, onDone?: (result: RecallResult) => void, fraction: number = 0.5): string[] {
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
            const on = (id: string) => (spikes.get(id) || 0) >= this.options.cameOnSpikes;
            const members = new Set(pattern.nodeIds), cuedSet = new Set(cued);
            const missing = pattern.nodeIds.filter(id => !cuedSet.has(id));
            const result: RecallResult = {
                pattern,
                cued,
                cameOn: missing.filter(on),
                stayedOff: missing.filter(id => !on(id)),
                intruders: this.excitatoryIds.filter(id => !members.has(id) && on(id)),
                exact: false,
            };
            result.exact = result.stayedOff.length === 0 && result.intruders.length === 0;
            this.busy = false;
            onDone?.(result);
        });
        return cued;
    }

    /** How strongly the pattern's neurons are wired to each other, 0..1 of the cap. */
    public strength(pattern: StoredPattern): number {
        const members = new Set(pattern.nodeIds);
        let sum = 0, count = 0;
        for (const conn of this.net.connections) {
            if (members.has(conn.sourceId) && members.has(conn.targetId)) { sum += conn.weight; count++; }
        }
        return count ? sum / count / this.options.weightCap : 0;
    }

    /** For the canvas: only show links that have actually been learned. */
    public isLearnedLink = (conn: Connection): boolean =>
        conn.weight > this.options.weightCap * 0.4 && !this.inhibitorySet.has(conn.sourceId) && !this.inhibitorySet.has(conn.targetId);
}
