// Pattern completion on a tiny brain - the basic Hebbian test, with no concept inputs and no word nodes.
//   node experiments/patterns/completion.mjs [neurons=40] [patternSize=10] [patterns=1] [exposures=0,1,2,5] [rules=same,causal,window] [seeds=20] [cap=0.25] [inhibitory=0]
//
// Setup: one BRAIN of N excitatory neurons, every neuron connected to every other with a tiny random weight
// (0..0.02), threshold 1, retention 0.8, refractory 1. Each neuron has its own stimulation input, so a neuron
// can be switched on directly. The engine's own plasticity is off; the rule below is applied from this script.
//
// Teaching: a pattern is a random set of neurons. One exposure = stimulate all its neurons for 20 ticks.
// With several patterns, exposures are interleaved in random order.
//
// Hebbian rule (bounded, only when the receiving neuron fires):   w += 0.1 * (pre - w / cap)
//   same   : pre = the sending neuron fired in the same tick
//   causal : pre = the sending neuron fired one tick earlier
//   window : pre = the sending neuron fired in this tick or one of the two before (a short coincidence window)
//   keep   : like window, but a silent sender is left alone instead of being weakened:
//            w += 0.1 * pre * (1 - w / cap).  Nothing is ever unlearned, so one pattern cannot erase another.
// Weights stay in [0, cap] and cannot change sign.
//
// Optional feedback inhibition (last argument = number of inhibitory neurons, added on top of the N): every
// excitatory neuron drives every inhibitory one (fixed weight 0.03-0.08, so they switch on one after another as
// total activity rises above about one pattern's worth) and every inhibitory neuron pushes down every excitatory
// one (fixed weight -0.3). These weights are not learned. Patterns use excitatory neurons only.
//
// Test: reset, stimulate a random HALF of a pattern for 20 ticks, then switch the stimulation off for 20 more.
//   completed : share of the pattern's other neurons that come on (fire at least twice while the cue is on)
//   intruders : share of the neurons outside the pattern that come on
//   exact     : all missing neurons came on and nothing else did
//   lingers   : share of the pattern still firing 10-20 ticks after the cue was switched off
import { NeuralNet } from '../lib/engine.mjs';
import { seedRandom, shuffled } from '../lib/harness.mjs';

const N = Number(process.argv[2] || 40);
const SIZE = Number(process.argv[3] || 10);
const patternCounts = (process.argv[4] || '1').split(',').map(Number);
const exposuresList = (process.argv[5] || '0,1,2,5').split(',').map(Number);
const rules = (process.argv[6] || 'same,causal,window').split(',');
const SEEDS = Number(process.argv[7] || 20);
const CAP = Number(process.argv[8] || 0.25);
const N_INH = Number(process.argv[9] || 0);
const LR = 0.1, EXPOSE_TICKS = 20, CUE_TICKS = 20, AFTER_TICKS = 20, STIM_WEIGHT = 3;

function build(seed) {
    seedRandom(seed);
    const net = new NeuralNet();
    net.addModule({ id: 'stim', type: 'INPUT', x: 0, y: 0, nodeCount: N, depth: 1, height: 600, activationType: 'PULSE' });
    net.addModule({
        id: 'brain', type: 'BRAIN', x: 600, y: 0, nodeCount: N + N_INH, radius: 200, hebbianLearning: false, isLocalized: false,
        synapsesPerNode: N + N_INH - 1, threshold: 1, decay: 0.8, refractoryPeriod: 1,
    });
    const neurons = Array.from({ length: N }, (_, i) => net.nodes.get(`brain-${i}`));
    const inhibitory = new Set(Array.from({ length: N_INH }, (_, i) => `brain-${N + i}`));
    for (const id of inhibitory) net.nodes.get(id).neuronType = 'INHIBITORY';
    const stim = Array.from({ length: N }, (_, i) => net.nodes.get(`stim-0-${i}`));
    for (const n of neurons) n.neuronType = 'EXCITATORY';
    // recurrent weights: tiny and random; incoming[j] = synapses into neuron j
    const index = new Map(neurons.map((n, i) => [n.id, i]));
    const incoming = Array.from({ length: N }, () => []);
    for (const c of net.connections) {
        const fromI = inhibitory.has(c.sourceId), toI = inhibitory.has(c.targetId);
        if (fromI) c.weight = toI ? 0 : -0.3;                          // inhibitory -> excitatory, fixed
        else if (toI) c.weight = 0.03 + Math.random() * 0.05;           // excitatory -> inhibitory, fixed
        else { c.weight = Math.random() * 0.02; incoming[index.get(c.targetId)].push({ conn: c, src: index.get(c.sourceId) }); }
    }
    for (let i = 0; i < N; i++) net.addConnection({ id: `s-${i}`, sourceId: stim[i].id, targetId: neurons[i].id, weight: STIM_WEIGHT });
    return { net, neurons, stim, incoming };
}

/** Run `ticks` ticks with the given neurons stimulated; optionally learn. Returns spike counts per neuron. */
function run(b, on, ticks, rule, hist) {
    const counts = new Float32Array(N);
    const h = hist || { p1: new Uint8Array(N), p2: new Uint8Array(N) };
    const cur = new Uint8Array(N);
    for (let t = 0; t < ticks; t++) {
        for (const i of on) b.stim[i].trigger(1);
        b.net.step();
        for (let i = 0; i < N; i++) { cur[i] = b.neurons[i].isFiring ? 1 : 0; counts[i] += cur[i]; }
        if (rule) for (let j = 0; j < N; j++) {
            if (!cur[j]) continue;
            for (const { conn, src } of b.incoming[j]) {
                const pre = rule === 'same' ? cur[src] : rule === 'causal' ? h.p1[src] : (cur[src] || h.p1[src] || h.p2[src]);
                if (rule === 'keep') conn.weight += LR * pre * (1 - conn.weight / CAP);
                else conn.weight += LR * (pre - conn.weight / CAP);
            }
        }
        h.p2.set(h.p1); h.p1.set(cur);
    }
    return counts;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';
console.log(`${N} excitatory neurons${N_INH ? ' + ' + N_INH + ' inhibitory' : ''}, patterns of ${SIZE}, cue = half the pattern, ${SEEDS} seeds, weight cap ${CAP}`);
console.log('patterns | rule   | exposures | completed | intruders | exact | lingers after cue | strongest weight inside / outside a pattern');

for (const K of patternCounts) for (const rule of rules) for (const exposures of exposuresList) {
    const m = { completed: [], intruders: [], exact: [], lingers: [], inside: [], outside: [] };
    for (let seed = 1; seed <= SEEDS; seed++) {
        const b = build(seed);
        const all = Array.from({ length: N }, (_, i) => i);
        const patterns = Array.from({ length: K }, () => shuffled(all).slice(0, SIZE));

        for (let e = 0; e < exposures; e++) for (const k of shuffled(patterns.map((_, i) => i))) { b.net.resetState(); run(b, patterns[k], EXPOSE_TICKS, rule); }

        // weights inside the first pattern vs from it to the outside
        const P0 = new Set(patterns[0]); let wi = 0, ni = 0, wo = 0, no = 0;
        for (let j = 0; j < N; j++) for (const { conn, src } of b.incoming[j]) { if (!P0.has(src)) continue; if (P0.has(j)) { wi += conn.weight; ni++; } else { wo += conn.weight; no++; } }
        m.inside.push(wi / ni); m.outside.push(wo / no);

        for (const p of patterns) {
            const cue = shuffled(p).slice(0, Math.floor(SIZE / 2));
            const members = new Set(p), cued = new Set(cue);
            b.net.resetState();
            const during = run(b, cue, CUE_TICKS, null);
            const after = run(b, [], AFTER_TICKS, null);      // first 10 ticks after the cue
            const late = run(b, [], AFTER_TICKS / 2, null);   // not used; keeps the state moving
            let done = 0, missing = 0, intr = 0, out = 0, ling = 0;
            for (let i = 0; i < N; i++) {
                if (members.has(i)) { if (!cued.has(i)) { missing++; if (during[i] >= 2) done++; } if (late[i] >= 1) ling++; }
                else { out++; if (during[i] >= 2) intr++; }
            }
            void after;
            m.completed.push(done / missing); m.intruders.push(out ? intr / out : 0); m.exact.push(done === missing && intr === 0 ? 1 : 0); m.lingers.push(ling / SIZE);
        }
    }
    console.log(`${String(K).padStart(8)} | ${rule.padEnd(6)} | ${String(exposures).padStart(9)} | ${pct(mean(m.completed)).padStart(9)} | ${pct(mean(m.intruders)).padStart(9)} | ${pct(mean(m.exact)).padStart(5)} | ${pct(mean(m.lingers)).padStart(17)} | ${mean(m.inside).toFixed(3)} / ${mean(m.outside).toFixed(3)}`);
}
