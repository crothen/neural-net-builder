import { NeuralNet } from '../engine/NeuralNet';
import type { Connection } from '../engine/Connection';

/**
 * Simon with a Brain: a 3x3 board of tiles, each tile a group of neurons. Round k lights tiles 1..k one after the
 * other while the Brain learns (Hebbian only, no teacher). Then the first tile is cued briefly and the Brain has
 * to "press" the rest in order by itself: a tile counts as pressed when most of its neurons fire.
 *
 * Settings: evolved for this game in experiments/patterns (see experiments/FINDINGS.md, Finding 13). On fresh
 * seeds this setup survives 8.0 of 9 rounds without repeated tiles and 7.6 with. The step signal is what makes
 * repeated tiles possible; the large fatigue is what makes one tile's neurons hand over to the next.
 */
export const SIMON_DEFAULTS = {
    tiles: 9,
    tileSize: 10,          // neurons per tile
    inhibitory: 5,
    stepSize: 5,           // neurons per "step" signal (only with stepSignal)
    stepSignal: true,      // tell the Brain which step it is on (makes repeated tiles distinguishable)
    repeats: true,         // may the sequence repeat a tile?
    maxRounds: 9,
    showTicks: 11,         // each tile is lit (stimulated) for this long while the sequence is shown
    cueTicks: 4,           // the first tile is cued for this long before the Brain is on its own
    stimulation: 3,
    weightCap: 0.495,
    learningRate: 0.3657,
    window: 4,
    sameTick: true,
    weakenSilent: true,
    retention: 0.8958,
    refractory: 0,
    fatigue: 1.0634,
    recovery: 0.0952,
    excToInh: 0.01,
    excToInhSpread: 3.3755,
    inhToExc: 0.4125,
};

/**
 * Settings evolved for playing WITHOUT the step signal (no repeated tiles): 8.2 of 9 rounds on fresh seeds.
 * Very different brain: tiny weights, short memory, a refractory period, strong fatigue, no inhibitory pool,
 * and only senders that fired BEFORE the receiver count.
 */
export const SIMON_NO_STEP_SIGNAL = {
    ...SIMON_DEFAULTS,
    stepSignal: false,
    repeats: false,
    inhibitory: 0,
    showTicks: 10,
    cueTicks: 3,
    weightCap: 0.03,
    learningRate: 0.3036,
    window: 4,
    sameTick: false,
    weakenSilent: true,
    retention: 0.4696,
    refractory: 2,
    fatigue: 0.8473,
    recovery: 0.6,
    excToInh: 0.0612,
    excToInhSpread: 1.3692,
    inhToExc: 0.0709,
};

export type SimonOptions = Partial<typeof SIMON_DEFAULTS>;

export interface RoundResult {
    round: number;
    shown: number[];
    pressed: number[];
    passed: boolean;
}

export const SIMON_MODULE_ID = 'simon';

export class SimonGame {
    public readonly options: typeof SIMON_DEFAULTS;
    public readonly tiles: string[][] = [];     // neuron ids per tile
    public readonly steps: string[][] = [];     // neuron ids per step signal
    public sequence: number[] = [];
    public round: number = 0;                   // rounds passed so far
    public busy: boolean = false;
    public gameOver: boolean = false;

    private readonly net: NeuralNet;
    private readonly inhibitorySet = new Set<string>();
    private readonly excitatoryIds: string[] = [];

    constructor(net: NeuralNet, options: SimonOptions = {}) {
        this.net = net;
        // Two evolved brains: one that uses the step signal, one that manages without it.
        this.options = { ...(options.stepSignal === false ? SIMON_NO_STEP_SIGNAL : SIMON_DEFAULTS), ...options };
        const o = this.options;
        const excitatory = o.tiles * o.tileSize + (o.stepSignal ? o.maxRounds * o.stepSize : 0);
        const total = excitatory + o.inhibitory;

        net.clear();
        net.addModule({
            id: SIMON_MODULE_ID, type: 'BRAIN', x: 600, y: 400, nodeCount: total, radius: 260, name: 'Simon', label: 'Simon',
            synapsesPerNode: total - 1, isLocalized: false, localizationLeak: 0,
            threshold: 1, decay: o.retention, refractoryPeriod: o.refractory,
            hebbianLearning: false, hebbianRule: 'window', hebbianWindow: o.window, hebbianSameTick: o.sameTick,
            hebbianWeakenSilent: o.weakenSilent, weightCap: o.weightCap, learningRate: o.learningRate, regrowthRate: 0,
        });
        for (let i = 0; i < total; i++) {
            const id = `${SIMON_MODULE_ID}-${i}`;
            const node = net.nodes.get(id)!;
            node.fatigue = o.fatigue;
            node.recovery = o.recovery;
            if (i < o.inhibitory) { node.neuronType = 'INHIBITORY'; this.inhibitorySet.add(id); }
            else { node.neuronType = 'EXCITATORY'; this.excitatoryIds.push(id); }
        }
        for (const conn of net.connections) {
            const fromInhibitory = this.inhibitorySet.has(conn.sourceId), toInhibitory = this.inhibitorySet.has(conn.targetId);
            if (fromInhibitory) conn.weight = toInhibitory ? 0 : -o.inhToExc;
            else if (toInhibitory) conn.weight = o.excToInh * (1 + Math.random() * (o.excToInhSpread - 1));
            else conn.weight = Math.random() * 0.02;
        }
        // tiles and step signals are random, disjoint groups of excitatory neurons
        const pool = this.excitatoryIds.slice();
        for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
        for (let t = 0; t < o.tiles; t++) this.tiles.push(pool.slice(t * o.tileSize, (t + 1) * o.tileSize));
        if (o.stepSignal) for (let k = 0; k < o.maxRounds; k++) this.steps.push(pool.slice(o.tiles * o.tileSize + k * o.stepSize, o.tiles * o.tileSize + (k + 1) * o.stepSize));
        this.newSequence();
    }

    private get module() {
        return this.net.modules.get(SIMON_MODULE_ID)!;
    }

    public newSequence() {
        const o = this.options;
        const order = Array.from({ length: o.tiles }, (_, i) => i);
        for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        this.sequence = Array.from({ length: o.maxRounds }, (_, k) => (o.repeats ? Math.floor(Math.random() * o.tiles) : order[k % o.tiles]));
        this.round = 0;
        this.gameOver = false;
    }

    /** The Brain forgets its fatigue between show and replay, like the experiment harness. */
    private reset() {
        this.net.resetState();
        this.net.clearStimulation();
        for (const id of this.excitatoryIds) { const n = this.net.nodes.get(id)!; n.currentThreshold = n.threshold; }
    }

    /**
     * Play the next round: show tiles 1..k (learning on), then let the Brain replay (learning off).
     * onShow(tile)   a tile lights up while the sequence is shown
     * onPress(tile)  the Brain pressed a tile during replay
     * onDone(result)
     */
    public playRound(onShow: (tile: number | null) => void, onPress: (tile: number) => void, onDone: (result: RoundResult) => void) {
        if (this.busy || this.gameOver) return;
        this.busy = true;
        const o = this.options;
        const k = this.round + 1;
        const shown = this.sequence.slice(0, k);
        const net = this.net;

        // --- show phase: one tile after the other, learning on
        this.reset();
        this.module.hebbianLearning = true;
        const showStep = (step: number) => {
            if (step >= shown.length) { onShow(null); this.replay(shown, onPress, onDone); return; }
            onShow(shown[step]);
            net.stimulate([...this.tiles[shown[step]], ...(this.steps[step] || [])], o.showTicks, o.stimulation, () => showStep(step + 1));
        };
        showStep(0);
    }

    private replay(shown: number[], onPress: (tile: number) => void, onDone: (result: RoundResult) => void) {
        const o = this.options;
        const net = this.net;
        this.module.hebbianLearning = false;
        this.reset();
        const pressed: number[] = [];
        const wasOn = new Array(o.tiles).fill(false);
        let ticks = 0;
        const limit = o.cueTicks + (shown.length + 1) * o.showTicks * 2;
        const finish = () => {
            net.afterStep = null;
            net.clearStimulation();
            const passed = pressed.length === shown.length && pressed.every((t, i) => t === shown[i]);
            if (passed) this.round++; else this.gameOver = true;
            this.busy = false;
            onDone({ round: shown.length, shown, pressed, passed });
        };
        // step signal for the step the Brain is on (switches as soon as it has pressed k tiles)
        let stepShown = -1, stepStimulus = 0;
        const driveStep = () => {
            if (!o.stepSignal) return;
            const step = Math.min(pressed.length, o.maxRounds - 1);
            if (step === stepShown) return;
            stepShown = step;
            net.stopStimulus(stepStimulus);
            stepStimulus = net.stimulate(this.steps[step], limit, o.stimulation);
        };
        driveStep();
        net.stimulate(this.tiles[shown[0]], o.cueTicks, o.stimulation);

        net.afterStep = () => {
            ticks++;
            for (let t = 0; t < o.tiles; t++) {
                let on = 0;
                for (const id of this.tiles[t]) if (net.tickCount - net.nodes.get(id)!.lastFiredTick <= 2) on++;
                const isOn = on * 2 >= o.tileSize;
                if (isOn && !wasOn[t]) { pressed.push(t); onPress(t); driveStep(); }
                wasOn[t] = isOn;
            }
            const wrong = pressed.some((t, i) => t !== shown[i]);
            if (wrong || pressed.length >= shown.length || ticks >= limit) finish();
        };
    }

    /** Only learned links between tile neurons are worth drawing. */
    public isLearnedLink = (conn: Connection): boolean =>
        conn.weight > this.options.weightCap * 0.4 && !this.inhibitorySet.has(conn.sourceId) && !this.inhibitorySet.has(conn.targetId);
}
