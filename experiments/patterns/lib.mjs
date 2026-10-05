// Pattern-completion trial on a small brain with configurable dynamics, learning rule and feedback inhibition.
// Used by search.mjs (parameter search) and capacity.mjs (how many patterns fit).
import { NeuralNet } from '../lib/engine.mjs';
import { seedRandom, shuffled } from '../lib/harness.mjs';

/** Defaults = the first hand-picked setup (see completion.mjs). */
export const DEFAULTS = {
    cap: 0.25,          // largest weight a learned excitatory synapse can reach
    lr: 0.1,            // learning rate
    rule: 'window',     // 'window': silent senders are weakened | 'keep': silent senders are left alone
    window: 2,          // how many ticks back a sender still counts as "active together" with the receiver
    retention: 0.8,     // share of the potential a neuron keeps per tick (the engine calls this "decay")
    refractory: 1,
    threshold: 1,
    nInh: 0,            // inhibitory neurons (fixed weights, not learned)
    wEI: 0.05,          // excitatory -> inhibitory weight, lowest
    wEIspread: 1.6,     // highest = lowest x spread, so inhibitory neurons switch on one after another
    wIE: 0.3,           // inhibitory -> excitatory weight (subtracted)
    exposures: 3,
    exposeTicks: 20,
    cueTicks: 20,
    stim: 3,            // weight of the direct stimulation input
};

/**
 * Teach K random patterns of `size` neurons (out of N excitatory ones), then cue each with a random half.
 * Returns averages over the K patterns:
 *   completed  share of the pattern's missing neurons that came on
 *   intruders  share of the neurons outside the pattern that came on
 *   exact      1 if all missing neurons came on and nothing else did
 *   lingers    share of the pattern still firing 20-30 ticks after the cue stopped
 */
export function trial(params, { N = 100, size = 10, K = 5, seed = 1, cueFraction = 0.5 } = {}) {
    const p = { ...DEFAULTS, ...params };
    seedRandom(seed);
    const net = new NeuralNet();
    const total = N + p.nInh;
    net.addModule({ id: 'stim', type: 'INPUT', x: 0, y: 0, nodeCount: N, depth: 1, height: 600, activationType: 'PULSE' });
    net.addModule({
        id: 'brain', type: 'BRAIN', x: 600, y: 0, nodeCount: total, radius: 200, hebbianLearning: false, isLocalized: false,
        synapsesPerNode: total - 1, threshold: p.threshold, decay: p.retention, refractoryPeriod: p.refractory,
    });
    const neurons = Array.from({ length: N }, (_, i) => net.nodes.get(`brain-${i}`));
    const stim = Array.from({ length: N }, (_, i) => net.nodes.get(`stim-0-${i}`));
    const inhibitory = new Set(Array.from({ length: p.nInh }, (_, i) => `brain-${N + i}`));
    for (const n of neurons) n.neuronType = 'EXCITATORY';
    for (const id of inhibitory) net.nodes.get(id).neuronType = 'INHIBITORY';
    const index = new Map(neurons.map((n, i) => [n.id, i]));
    const incoming = Array.from({ length: N }, () => []);
    for (const c of net.connections) {
        const fromI = inhibitory.has(c.sourceId), toI = inhibitory.has(c.targetId);
        if (fromI) c.weight = toI ? 0 : -p.wIE;
        else if (toI) c.weight = p.wEI * (1 + Math.random() * (p.wEIspread - 1));
        else { c.weight = Math.random() * 0.02; incoming[index.get(c.targetId)].push({ conn: c, src: index.get(c.sourceId) }); }
    }
    for (let i = 0; i < N; i++) net.addConnection({ id: `s-${i}`, sourceId: stim[i].id, targetId: neurons[i].id, weight: p.stim });

    // recent[i] = ticks since neuron i last fired (large when it has not)
    const recent = new Uint8Array(N).fill(255), cur = new Uint8Array(N);
    const run = (on, ticks, learn) => {
        const counts = new Float32Array(N);
        for (let t = 0; t < ticks; t++) {
            for (const i of on) stim[i].trigger(1);
            net.step();
            for (let i = 0; i < N; i++) { cur[i] = neurons[i].isFiring ? 1 : 0; counts[i] += cur[i]; if (cur[i]) recent[i] = 0; else if (recent[i] < 255) recent[i]++; }
            if (learn) for (let j = 0; j < N; j++) {
                if (!cur[j]) continue;
                for (const { conn, src } of incoming[j]) {
                    const pre = recent[src] <= p.window ? 1 : 0;
                    if (p.rule === 'keep') conn.weight += p.lr * pre * (1 - conn.weight / p.cap);
                    else conn.weight += p.lr * (pre - conn.weight / p.cap);
                }
            }
        }
        return counts;
    };
    const reset = () => { net.resetState(); recent.fill(255); };

    const all = Array.from({ length: N }, (_, i) => i);
    const patterns = Array.from({ length: K }, () => shuffled(all).slice(0, size));
    for (let e = 0; e < p.exposures; e++) for (const k of shuffled(patterns.map((_, i) => i))) { reset(); run(patterns[k], p.exposeTicks, true); }

    const m = { completed: 0, intruders: 0, exact: 0, lingers: 0 };
    for (const pat of patterns) {
        const cue = shuffled(pat).slice(0, Math.max(1, Math.floor(size * cueFraction)));
        const members = new Set(pat), cued = new Set(cue);
        reset();
        const during = run(cue, p.cueTicks, false);
        run([], 20, false);
        const late = run([], 10, false);
        let done = 0, missing = 0, intr = 0, out = 0, ling = 0;
        for (let i = 0; i < N; i++) {
            if (members.has(i)) { if (!cued.has(i)) { missing++; if (during[i] >= 2) done++; } if (late[i] >= 1) ling++; }
            else { out++; if (during[i] >= 2) intr++; }
        }
        m.completed += done / missing / K; m.intruders += intr / out / K; m.exact += (done === missing && intr === 0 ? 1 : 0) / K; m.lingers += ling / size / K;
    }
    return m;
}

/** Average of trial() over seeds. */
export function score(params, opts, seeds) {
    const acc = { completed: 0, intruders: 0, exact: 0, lingers: 0 };
    for (const seed of seeds) { const r = trial(params, { ...opts, seed }); for (const k of Object.keys(acc)) acc[k] += r[k] / seeds.length; }
    return acc;
}
