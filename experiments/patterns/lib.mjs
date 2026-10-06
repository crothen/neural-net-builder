// Small-brain Hebbian tasks with configurable dynamics, learning rule and feedback inhibition:
//   trial()         pattern completion (store K patterns, cue each with half)
//   sequenceTrial() sequence replay (store A -> B -> C -> D, cue A, do the others follow in order?)
// Used by search.mjs, capacity.mjs and evolve.mjs. No teacher anywhere: the brain learns by itself.
import { NeuralNet } from '../lib/engine.mjs';
import { seedRandom, shuffled } from '../lib/harness.mjs';

/** Defaults = the first hand-picked setup (see completion.mjs). */
export const DEFAULTS = {
    cap: 0.25,          // largest weight a learned excitatory synapse can reach
    lr: 0.1,            // learning rate
    rule: 'window',     // 'window': silent senders are weakened | 'keep': silent senders are left alone
    window: 2,          // how many ticks back a sender still counts as "fired together" with the receiver
    sameTick: 1,        // 1: a sender firing in the same tick counts too | 0: only earlier ticks (sender before receiver)
    retention: 0.8,     // share of the potential a neuron keeps per tick (the engine calls this "decay")
    refractory: 1,
    threshold: 1,
    fatigue: 0,         // threshold jump after each spike ...
    recovery: 0.1,      // ... and how fast it comes back down per tick
    nInh: 0,            // inhibitory neurons (fixed weights, not learned)
    wEI: 0.05,          // excitatory -> inhibitory weight, lowest
    wEIspread: 1.6,     // highest = lowest x spread, so inhibitory neurons switch on one after another
    wIE: 0.3,           // inhibitory -> excitatory weight (subtracted)
    exposures: 3,       // how often each pattern / sequence is shown
    exposeTicks: 20,    // pattern completion: one exposure stimulates the pattern for this long
    cueTicks: 20,       // pattern completion: the half-pattern cue lasts this long
    seqTicks: 10,       // sequences: each element is stimulated for this long, one after the other
    seqCueTicks: 5,     // sequences: the first element is cued for this long, then the brain runs free
    stim: 3,            // weight of the direct stimulation input
};

/** Build the brain: N excitatory neurons (+ an inhibitory pool), all-to-all, each with its own stimulation input. */
export function buildBrain(params, N, seed) {
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
    for (const n of neurons) { n.neuronType = 'EXCITATORY'; n.fatigue = p.fatigue; n.recovery = p.recovery; }
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

    const recent = new Uint8Array(N).fill(255); // ticks since each neuron last fired
    const cur = new Uint8Array(N);
    /** Run `ticks` ticks with `on` stimulated; learn if asked. Returns spike counts, and per-tick firing if wanted. */
    const run = (on, ticks, learn, perTick) => {
        const counts = new Float32Array(N);
        const frames = perTick ? [] : null;
        for (let t = 0; t < ticks; t++) {
            for (const i of on) stim[i].trigger(1);
            net.step();
            for (let i = 0; i < N; i++) { cur[i] = neurons[i].isFiring ? 1 : 0; counts[i] += cur[i]; if (cur[i]) recent[i] = 0; else if (recent[i] < 255) recent[i]++; }
            if (frames) frames.push(Uint8Array.from(cur));
            if (learn) for (let j = 0; j < N; j++) {
                if (!cur[j]) continue;
                for (const { conn, src } of incoming[j]) {
                    const r = recent[src];
                    const pre = r <= p.window && (p.sameTick || r >= 1) ? 1 : 0;
                    if (p.rule === 'keep') conn.weight += p.lr * pre * (1 - conn.weight / p.cap);
                    else conn.weight += p.lr * (pre - conn.weight / p.cap);
                }
            }
        }
        return frames ? { counts, frames } : counts;
    };
    const reset = () => { net.resetState(); recent.fill(255); for (const n of neurons) n.currentThreshold = n.threshold; };
    return { p, net, neurons, run, reset, N };
}

/**
 * Pattern completion: teach K random patterns of `size` neurons, then cue each with a random half.
 * Returns averages over the K patterns: completed, intruders, exact (all missing came on, nothing else), lingers.
 */
export function trial(params, { N = 100, size = 10, K = 5, seed = 1, cueFraction = 0.5 } = {}) {
    const b = buildBrain(params, N, seed);
    const { p, run, reset } = b;
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

/**
 * Sequence replay: teach a chain of `length` patterns shown one after the other (each for seqTicks, no gap),
 * `exposures` times. Then cue only the first pattern briefly and let the brain run free.
 * A pattern counts as "on" at tick t when at least half of its neurons fired in ticks t-2..t.
 * Returns:
 *   steps     share of the later patterns that came on, each after the one before it (0..1)
 *   order     1 if every later pattern came on in the right order, else 0
 *   intruders share of neurons outside the chain that fired at least twice during the free run
 *   score     steps x (1 - intruders)
 */
export function sequenceTrial(params, { N = 100, size = 10, length = 4, seed = 1 } = {}) {
    const b = buildBrain(params, N, seed);
    const { p, run, reset } = b;
    const all = shuffled(Array.from({ length: N }, (_, i) => i));
    const chain = Array.from({ length }, (_, k) => all.slice(k * size, (k + 1) * size)); // disjoint patterns

    for (let e = 0; e < p.exposures; e++) { reset(); for (const pat of chain) run(pat, p.seqTicks, true); }

    reset();
    const freeTicks = length * p.seqTicks * 2;
    const cue = run(chain[0], p.seqCueTicks, false, true);
    const free = run([], freeTicks, false, true);
    const frames = [...cue.frames, ...free.frames];
    const inChain = new Set(chain.flat());

    // onset of each pattern: first tick where >= half its neurons fired within the last 3 ticks
    const onset = chain.map(pat => {
        for (let t = 0; t < frames.length; t++) {
            let on = 0;
            for (const i of pat) if (frames[t][i] || (t > 0 && frames[t - 1][i]) || (t > 1 && frames[t - 2][i])) on++;
            if (on * 2 >= pat.length) return t;
        }
        return -1;
    });
    let steps = 0;
    for (let k = 1; k < length; k++) if (onset[k] >= 0 && onset[k - 1] >= 0 && onset[k] > onset[k - 1]) steps++;
    let intr = 0, out = 0;
    for (let i = 0; i < N; i++) if (!inChain.has(i)) { out++; if (free.counts[i] >= 2) intr++; }
    const intruders = out ? intr / out : 0;
    return { steps: steps / (length - 1), order: steps === length - 1 ? 1 : 0, intruders, onset, score: (steps / (length - 1)) * (1 - intruders) };
}

/** Average of trial() over seeds. */
export function score(params, opts, seeds) {
    const acc = { completed: 0, intruders: 0, exact: 0, lingers: 0 };
    for (const seed of seeds) { const r = trial(params, { ...opts, seed }); for (const k of Object.keys(acc)) acc[k] += r[k] / seeds.length; }
    return acc;
}

/** Average of sequenceTrial() over seeds. */
export function sequenceScore(params, opts, seeds) {
    const acc = { steps: 0, order: 0, intruders: 0, score: 0 };
    for (const seed of seeds) { const r = sequenceTrial(params, { ...opts, seed }); for (const k of Object.keys(acc)) acc[k] += r[k] / seeds.length; }
    return acc;
}

/**
 * "Simon" with a brain: 9 tiles = 9 disjoint groups of `size` neurons. Round k shows tiles s1..sk one after the
 * other (seqTicks each, learning on). Verification: learning off, cue s1 briefly, let the brain run free and read
 * off the order in which tile groups come on. The round is passed if that order is exactly s1..sk.
 * Returns { rounds: rounds passed before the first failure, replayed: what came back in the last round }.
 * opts.repeats: allow a tile to appear more than once in the sequence (default false).
 * params.context (0/1): a "step" signal. With it on, a small extra group of neurons for step k is stimulated
 * together with the k-th tile while the sequence is shown, and during replay the game switches that signal on
 * for step k+1 as soon as the brain has "pressed" k tiles. It makes repeated tiles distinguishable.
 */
export function simonTrial(params, { N = 100, size = 10, tiles = 9, maxRounds = 9, repeats = false, seed = 1 } = {}) {
    const context = !!params.context, ctxSize = 5;
    if (context) N = Math.max(N, tiles * size + maxRounds * ctxSize);
    const b = buildBrain(params, N, seed);
    const { p, run, reset } = b;
    const all = shuffled(Array.from({ length: N }, (_, i) => i));
    const groups = Array.from({ length: tiles }, (_, k) => all.slice(k * size, (k + 1) * size));
    const ctx = Array.from({ length: maxRounds }, (_, k) => context ? all.slice(tiles * size + k * ctxSize, tiles * size + (k + 1) * ctxSize) : []);
    const sequence = [];
    const order = shuffled(groups.map((_, i) => i));
    for (let k = 0; k < maxRounds; k++) sequence.push(repeats ? Math.floor(Math.random() * tiles) : order[k % tiles]);

    let rounds = 0, replayed = [];
    for (let k = 1; k <= maxRounds; k++) {
        const shown = sequence.slice(0, k);
        reset();
        shown.forEach((t, step) => run([...groups[t], ...ctx[step]], p.seqTicks, true));

        // Verification, tick by tick: cue the first tile briefly, then let the brain run. A tile is "pressed"
        // when >= half its neurons fired within the last 3 ticks; with context on, each press switches the step
        // signal to the next step.
        reset();
        replayed = [];
        const frames = [];
        const wasOn = new Array(tiles).fill(false);
        const total = p.seqCueTicks + (k + 1) * p.seqTicks * 2;
        for (let t = 0; t < total; t++) {
            const step = Math.min(replayed.length, maxRounds - 1);
            const on = [...(t < p.seqCueTicks ? groups[shown[0]] : []), ...(context ? ctx[t < p.seqCueTicks ? 0 : step] : [])];
            frames.push(run(on, 1, false, true).frames[0]);
            for (let g = 0; g < tiles; g++) {
                let n = 0;
                for (const i of groups[g]) if (frames[t][i] || (t > 0 && frames[t - 1][i]) || (t > 1 && frames[t - 2][i])) n++;
                const isOn = n * 2 >= size;
                if (isOn && !wasOn[g]) replayed.push(g);
                wasOn[g] = isOn;
            }
            if (replayed.length > shown.length) break;
        }
        if (replayed.length === shown.length && replayed.every((g, i) => g === shown[i])) rounds++;
        else break;
    }
    return { rounds, sequence, replayed };
}

/** Average rounds survived over seeds. */
export function simonScore(params, opts, seeds) {
    let sum = 0; const hist = {};
    for (const seed of seeds) { const r = simonTrial(params, { ...opts, seed }); sum += r.rounds; hist[r.rounds] = (hist[r.rounds] || 0) + 1; }
    return { rounds: sum / seeds.length, hist };
}
