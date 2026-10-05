// Headless experiment harness around the REAL app engine (src/engine/NeuralNet.ts, bundled to ./engine.mjs).
//
// Rebuild the bundle after any engine change (run from the repo root):
//   npx esbuild experiments/lib/engine-entry.ts --bundle --format=esm --outfile=experiments/lib/engine.mjs
//
// Network shape used everywhere:   concepts (INPUT module) --> brain (BRAIN module) --> word readout
//
// The brain is simulated by the unmodified engine (net.step()). The engine on master has NO rule that trains
// brain->output weights, so the word readout lives in this harness: a weight matrix W[word][brainNeuron] plus a
// simulation of the app's output node maths (see stepReadout). It is feed-forward only, so it is exactly what the
// engine would compute if those connections existed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NeuralNet } from './engine.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ---------------------------------------------------------------- RNG

/** Replace Math.random with a seeded generator (the engine uses Math.random everywhere). */
export function seedRandom(seed) {
    let a = (seed >>> 0) || 1;
    Math.random = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---------------------------------------------------------------- Defaults (from src/initial-setup/initial-network.json)

/** The BRAIN module exactly as the app's default network defines it. */
export const DEFAULT_BRAIN = {
    nodeCount: 200,
    radius: 270,
    activationType: 'SUSTAINED',
    threshold: 0.5,
    refractoryPeriod: 1,
    hebbianLearning: true,
    learningRate: 0.01,
    regrowthRate: 0.1,
    isLocalized: true,
    localizationLeak: 20,
    fatigue: 0.5,
    recovery: 0.1,
    sustainability: { synapticScaling: true, targetSum: 2.9, adaptiveThreshold: true, targetRate: 0.05, adaptationSpeed: 0.001 },
    synapsesPerNode: 20,
    initialWeightModifier: 0.2,
};

/** Default input->brain link in the app's default network. */
export const DEFAULT_INPUT_LINK = { coverage: 20, localizer: 10 };

// ---------------------------------------------------------------- Datasets

function parseCsvLine(line) {
    const out = []; let cur = ''; let q = false;
    for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) { out.push(cur); cur = ''; }
        else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
}

function readCsv(file) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim().length);
    const header = parseCsvLine(lines[0]);
    return { header, rows: lines.slice(1).map(parseCsvLine) };
}

const TINY_CONCEPTS = ['warm', 'cold', 'bright', 'dark', 'yellow', 'blue'];
const TINY_WORDS = {
    Fire: ['warm', 'bright', 'yellow'],
    Ice: ['cold', 'bright', 'blue'],
    Night: ['cold', 'dark', 'blue'],
    Sky: ['bright', 'blue'],
    Sand: ['warm', 'yellow'],
    Lemon: ['bright', 'yellow'],
    Cave: ['cold', 'dark'],
    Ember: ['warm', 'dark'],
};

const MEDIUM_CONCEPTS = ['warm', 'cold', 'bright', 'dark', 'yellow', 'blue', 'red', 'green', 'wet', 'dry', 'hard', 'soft'];
const MEDIUM_WORDS = {
    ...TINY_WORDS,
    Blood: ['warm', 'red', 'wet'],
    Grass: ['green', 'soft', 'wet'],
    Rock: ['cold', 'hard', 'dry'],
    Ocean: ['cold', 'blue', 'wet'],
    Desert: ['warm', 'yellow', 'dry'],
    Snow: ['cold', 'bright', 'soft', 'wet'],
    Lava: ['warm', 'bright', 'red', 'wet'],
    Moss: ['green', 'soft', 'dark'],
    Brick: ['red', 'hard', 'dry'],
    Cloud: ['bright', 'soft', 'wet'],
    Leaf: ['green', 'dry'],
    Steel: ['cold', 'hard', 'bright'],
};

function fromMap(name, concepts, wordMap) {
    return {
        name,
        concepts,
        words: Object.entries(wordMap).map(([word, cs]) => ({ word, concepts: cs.map(c => concepts.indexOf(c)) })),
    };
}

function fromRepoCsv(name, trainingFile, conceptFile) {
    const { header, rows } = readCsv(trainingFile);
    const concepts = []; const offsets = {};
    for (const col of header.slice(2)) {
        offsets[col] = concepts.length;
        const { rows: cRows } = readCsv(conceptFile(col));
        for (const r of cRows) concepts.push(`${col}:${r[1]}`);
    }
    const words = rows.map(r => {
        const cs = [];
        header.slice(2).forEach((col, k) => {
            const cell = r[2 + k] || '';
            for (const id of cell.split(';').map(s => s.trim()).filter(Boolean)) cs.push(offsets[col] + parseInt(id, 10) - 1);
        });
        return { word: r[1], concepts: cs };
    });
    return { name, concepts, words };
}

/**
 * name:
 *   'tiny'   - 6 concepts (warm cold bright dark yellow blue), 8 words (Fire = warm+bright+yellow ...). Has subset
 *              relations on purpose (Sand and Lemon are subsets of Fire), so a purely additive readout is not enough.
 *   'medium' - 12 concepts, 20 words (superset of tiny).
 *   'short'  - repo list from the development branch: 60 concepts (20 colours, 20 shapes, 20 textures), 50 words.
 *   'full'   - repo list on master: 20 categories x 50 concepts = 1000 concepts, 120 words (random associations).
 *   'real'   - hand-written, semantically real list in concepts-real/ (built by experiments/datasets/build-real.mjs).
 * Returns { name, concepts: string[], words: [{ word, concepts: number[] }] }.
 */
export function loadDataset(name) {
    if (name === 'tiny') return fromMap('tiny', TINY_CONCEPTS, TINY_WORDS);
    if (name === 'medium') return fromMap('medium', MEDIUM_CONCEPTS, MEDIUM_WORDS);
    if (name === 'short') {
        const ref = path.join(REPO, 'experiments', '_ref');
        return fromRepoCsv('short', path.join(ref, 'training_data_short.csv'), col => path.join(ref, `${col.toLowerCase()}_short.csv`));
    }
    if (name === 'full') {
        const dir = path.join(REPO, 'concepts');
        return fromRepoCsv('full', path.join(dir, 'training-data.csv'), col => path.join(dir, `${col}.csv`));
    }
    if (name === 'real') {
        const dir = path.join(REPO, 'concepts-real');
        return fromRepoCsv('real', path.join(dir, 'training-data.csv'), col => path.join(dir, 'groups', `${col}.csv`));
    }
    throw new Error(`unknown dataset ${name}`);
}

/** Groups of words that share an identical concept set (no readout can separate those). */
export function duplicateGroups(dataset) {
    const groups = new Map();
    dataset.words.forEach((w, i) => {
        const key = w.concepts.slice().sort((a, b) => a - b).join(',');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(i);
    });
    return [...groups.values()].filter(g => g.length > 1);
}

/**
 * Leave-one-out partial cues of word wi that still identify it: the remaining concepts must be a subset of
 * exactly one word. (In 'tiny', Fire minus bright is warm+yellow, which IS Sand - that cue is not a fair test.)
 */
export function partialCues(dataset, wi) {
    const w = dataset.words[wi];
    const cues = [];
    if (w.concepts.length < 2) return cues;
    for (let k = 0; k < w.concepts.length; k++) {
        const cue = w.concepts.filter((_, j) => j !== k);
        const owners = dataset.words.filter(o => cue.every(c => o.concepts.includes(c)));
        if (owners.length === 1) cues.push(cue);
    }
    return cues;
}

// ---------------------------------------------------------------- Building the network

/**
 * Push module-level parameters onto the brain's nodes.
 *
 * IMPORTANT engine quirk: the app does NOT do this consistently.
 *   - addModule passes threshold/decay/refractoryPeriod/bias/maxPotential to nodes, but NOT fatigue/recovery/sustainability.
 *   - fromJSON (how the default network is loaded) restores nodes with class defaults: threshold 1.0, decay 0.9,
 *     refractoryPeriod 2, fatigue 0, recovery 0, no adaptive threshold - whatever the module config says.
 *   - node.sustainability (adaptive threshold) is never set anywhere in the app, so that toggle is a no-op.
 * mode 'full'   : every parameter reaches the nodes (what the UI config *intends*).
 * mode 'asApp'  : only what addModule wires (threshold, decay, refractoryPeriod, bias, maxPotential).
 * mode 'asLoaded': class defaults, as after loading the default JSON.
 */
export function applyBrainNodeParams(ctx, params, mode = 'full') {
    for (const n of ctx.brainNodes) {
        if (mode === 'asLoaded') {
            n.threshold = 1.0; n.decay = 0.9; n.refractoryPeriod = 2; n.fatigue = 0; n.recovery = 0; n.sustainability = undefined;
        } else {
            if (params.threshold !== undefined) n.threshold = params.threshold;
            if (params.decay !== undefined) n.decay = params.decay;
            if (params.refractoryPeriod !== undefined) n.refractoryPeriod = params.refractoryPeriod;
            if (params.bias !== undefined) n.bias = params.bias;
            if (params.maxPotential !== undefined) n.maxPotential = params.maxPotential;
            if (mode === 'full') {
                if (params.fatigue !== undefined) n.fatigue = params.fatigue;
                if (params.recovery !== undefined) n.recovery = params.recovery;
                n.sustainability = params.sustainability?.adaptiveThreshold ? { ...params.sustainability } : undefined;
            }
        }
        n.currentThreshold = n.threshold;
    }
}

/**
 * Build concepts -> brain. Returns ctx used by every other function.
 *
 * opts:
 *   nConcepts            number of concept input nodes
 *   brain                overrides merged over DEFAULT_BRAIN (nodeCount, threshold, decay, refractoryPeriod, fatigue,
 *                        recovery, learningRate, hebbianLearning, pruningThreshold, regrowthRate, isLocalized,
 *                        localizationLeak, synapsesPerNode, initialWeightModifier, maxPotential, bias, sustainability{...})
 *   paramMode            'full' | 'asApp' | 'asLoaded'  (see applyBrainNodeParams). Default 'full'.
 *   inputLink            { coverage, localizer } merged over DEFAULT_INPUT_LINK. coverage = % of brain each concept
 *                        reaches; localizer = % leak (0 = strictly topographic, 100 = random targets).
 *   inputWeight          if set, every concept->brain weight becomes this value; if { min, max } uniform in range.
 *                        Default: engine's own init, uniform [0, 0.5].
 *   inhibitoryFraction   engine hard-codes 0.2. If set, neuron types are re-drawn and internal wiring redone.
 *   seed                 seeds Math.random first.
 *   NetClass             optional subclass of NeuralNet (to prototype an engine change without touching src/).
 */
export function buildNet(opts) {
    const { nConcepts, brain = {}, paramMode = 'full', inputLink = {}, inputWeight, inhibitoryFraction, seed, NetClass = NeuralNet } = opts;
    if (seed !== undefined) seedRandom(seed);

    const net = new NetClass();
    const brainCfg = { ...DEFAULT_BRAIN, ...brain, sustainability: { ...DEFAULT_BRAIN.sustainability, ...(brain.sustainability || {}) } };
    const link = { ...DEFAULT_INPUT_LINK, ...inputLink };

    net.addModule({ id: 'concepts', type: 'INPUT', x: 0, y: 400, nodeCount: nConcepts, depth: 1, height: 600, activationType: 'PULSE' });
    net.addModule({ id: 'brain', type: 'BRAIN', x: 600, y: 400, depth: 1, ...brainCfg });

    const ctx = {
        net,
        brainCfg: net.modules.get('brain'),
        conceptNodes: Array.from({ length: nConcepts }, (_, i) => net.nodes.get(`concepts-0-${i}`)),
        brainNodes: Array.from({ length: brainCfg.nodeCount }, (_, i) => net.nodes.get(`brain-${i}`)),
        readout: null,
        ticks: 0,
    };
    // What "plasticity on" means for this brain (setPlasticity(ctx, true) restores exactly this)
    ctx._hebbWanted = !!ctx.brainCfg.hebbianLearning;
    ctx._scaleWanted = !!ctx.brainCfg.sustainability?.synapticScaling;

    if (inhibitoryFraction !== undefined) {
        for (const n of ctx.brainNodes) n.neuronType = Math.random() < inhibitoryFraction ? 'INHIBITORY' : 'EXCITATORY';
        net.rewireInternalConnections('brain');
    }

    applyBrainNodeParams(ctx, brainCfg, paramMode);

    net.connectModules('concepts', 'brain', 'ALL', 'ALL', link.coverage, link.localizer);
    if (inputWeight !== undefined) {
        for (const c of net.connections) {
            if (!c.sourceId.startsWith('concepts-')) continue;
            c.weight = typeof inputWeight === 'number' ? inputWeight : inputWeight.min + Math.random() * (inputWeight.max - inputWeight.min);
        }
    }
    return ctx;
}

/** Turn brain plasticity (Hebbian + pruning/regrowth + synaptic scaling) on or off. Returns the previous state. */
export function setPlasticity(ctx, on) {
    const prev = { hebb: ctx.brainCfg.hebbianLearning, scale: ctx.brainCfg.sustainability?.synapticScaling };
    ctx.brainCfg.hebbianLearning = typeof on === 'object' ? on.hebb : on && (ctx._hebbWanted ?? true);
    if (ctx.brainCfg.sustainability) ctx.brainCfg.sustainability.synapticScaling = typeof on === 'object' ? on.scale : on && (ctx._scaleWanted ?? true);
    return prev;
}

// ---------------------------------------------------------------- Word readout (harness side)

/**
 * Attach a word readout.
 *   nWords
 *   coverage     fraction (0..1) of brain neurons each word node listens to. Default 1.
 *   w0           initial weight. Default 0.
 *   node         { threshold, decay, maxPotential } of the simulated output node. Defaults mirror the app's
 *                LEARNED_OUTPUT node (populateLearnedOutput): threshold 0.5, decay 0.1, maxPotential 3.
 *                NOTE "decay" is a retention factor in this engine: potential = (potential + input) * decay.
 *   normalize    true = the engine's brain->output normalisation (input = MEAN over the node's incoming brain
 *                connections of activation*weight). false = plain sum (what a SUSTAINED_OUTPUT module gets).
 */
export function attachReadout(ctx, { nWords, coverage = 1, w0 = 0, node = {}, normalize = true }) {
    const nB = ctx.brainNodes.length;
    const W = Array.from({ length: nWords }, () => new Float32Array(nB).fill(w0));
    const mask = Array.from({ length: nWords }, () => {
        const m = new Uint8Array(nB);
        for (let i = 0; i < nB; i++) m[i] = Math.random() < coverage ? 1 : 0;
        return m;
    });
    ctx.readout = {
        nWords, W, mask, normalize,
        fanIn: mask.map(m => Math.max(1, m.reduce((a, b) => a + b, 0))),
        node: { threshold: 0.5, decay: 0.1, maxPotential: 3, ...node },
        potential: new Float32Array(nWords),
        firing: new Uint8Array(nWords),
        drive: new Float32Array(nWords),
    };
    return ctx.readout;
}

/** One tick of the readout, using the brain activations left by the last net.step(). Mirrors SustainedOutputNode. */
function stepReadout(ctx) {
    const r = ctx.readout;
    const act = ctx.brainNodes;
    // Only a fraction of neurons fire per tick: collect them once instead of scanning every neuron per word.
    const idx = r.activeIdx || (r.activeIdx = new Int32Array(act.length));
    const val = r.activeVal || (r.activeVal = new Float32Array(act.length));
    let n = 0;
    for (let i = 0; i < act.length; i++) { const a = act[i].activation; if (a > 0) { idx[n] = i; val[n] = a; n++; } }
    r.activeCount = n;
    for (let w = 0; w < r.nWords; w++) {
        const Ww = r.W[w], m = r.mask[w];
        let sum = 0;
        for (let k = 0; k < n; k++) { const i = idx[k]; if (m[i]) sum += val[k] * Ww[i]; }
        const input = r.normalize ? sum / r.fanIn[w] : sum;
        r.drive[w] = input;
        let p = (r.potential[w] + input) * r.node.decay;
        if (p < 0) p = 0;
        if (p > r.node.maxPotential) p = r.node.maxPotential;
        r.potential[w] = p;
        r.firing[w] = p >= r.node.threshold ? 1 : 0;
    }
}

/**
 * Built-in per-tick readout learning rules (local: each weight only sees its pre neuron and its own word node).
 *   'hebb'       dW[t][i] = lr * pre_i               for the taught word t only (teacher forces t to fire)
 *   'perceptron' dW[w][i] = lr * (target_w - fired_w) * pre_i   for every word (error-corrective, still local)
 *   'delta'      dW[w][i] = lr * (target_w - potential_w) * pre_i   with target = hi * threshold for the taught
 *                word and 0 for the others. Found by the readout study to be the rule that works (use it with an
 *                output node retention of about 0.95). hi defaults to 3. With nlms: true, lr is divided by the
 *                number of active inputs of that node this tick, which makes one lr work for any brain size,
 *                firing rate or readout coverage (use lr of about 0.004 and normalize: false).
 * opts: { rule, lr, wMin, wMax, l1, hi, nlms }   l1 = if set, each word's weights are rescaled so sum(|w|) <= l1.
 * Pass a function (ctx, teacherIdx) => void as `rule` for anything custom.
 * Uses the active-neuron list left by the stepReadout() call of the same tick.
 */
function learnReadout(ctx, teacher, opts) {
    const r = ctx.readout;
    if (typeof opts.rule === 'function') return opts.rule(ctx, teacher);
    const { rule = 'perceptron', lr = 0.05, wMin = -Infinity, wMax = Infinity, l1, hi = 3, nlms = false } = opts;
    const idx = r.activeIdx, val = r.activeVal, n = r.activeCount;
    for (let w = 0; w < r.nWords; w++) {
        let err;
        if (rule === 'hebb') err = w === teacher ? 1 : 0;
        else if (rule === 'delta') err = (w === teacher ? hi * r.node.threshold : 0) - r.potential[w];
        else err = (w === teacher ? 1 : 0) - r.firing[w];
        if (err === 0) continue;
        const Ww = r.W[w], m = r.mask[w];
        let step = lr;
        if (nlms) {
            let active = 0;
            for (let k = 0; k < n; k++) if (m[idx[k]]) active++;
            if (active === 0) continue;
            step = lr / active;
        }
        for (let k = 0; k < n; k++) {
            const i = idx[k];
            if (!m[i]) continue;
            let v = Ww[i] + step * err * val[k];
            Ww[i] = v < wMin ? wMin : v > wMax ? wMax : v;
        }
        if (l1) {
            let s = 0; for (let i = 0; i < Ww.length; i++) s += Math.abs(Ww[i]);
            if (s > l1) { const f = l1 / s; for (let i = 0; i < Ww.length; i++) Ww[i] *= f; }
        }
    }
}

// ---------------------------------------------------------------- Running

/** Zero potentials/activations (the app's "Reset State"). Thresholds, fatigue and weights are kept. */
export function resetState(ctx) {
    ctx.net.resetState();
    if (ctx.readout) { ctx.readout.potential.fill(0); ctx.readout.firing.fill(0); }
}

/** Run with no input. */
export function settle(ctx, ticks) {
    for (let t = 0; t < ticks; t++) { ctx.net.step(); ctx.ticks++; if (ctx.readout) stepReadout(ctx); }
}

/**
 * Present a set of concepts for `ticks` ticks (each concept input fires every tick).
 * opts:
 *   teacher     word index to teach (requires learn)
 *   learn       readout learning options (see learnReadout); omitted = readout frozen
 *   skip        ticks at the start that are not counted in the returned statistics. Default 2.
 *   inputEvery  drive the inputs only every Nth tick (1 = every tick). Default 1.
 * Returns { counts: Float32Array(brain spikes per neuron), wordDrive, wordFire (Float32Array per word, or null), ticks }.
 */
export function present(ctx, conceptIdxs, ticks, opts = {}) {
    const { teacher = -1, learn, skip = 2, inputEvery = 1 } = opts;
    const nB = ctx.brainNodes.length;
    const counts = new Float32Array(nB);
    const r = ctx.readout;
    const wordDrive = r ? new Float32Array(r.nWords) : null;
    const wordFire = r ? new Float32Array(r.nWords) : null;

    for (let t = 0; t < ticks; t++) {
        if (t % inputEvery === 0) for (const c of conceptIdxs) ctx.conceptNodes[c].trigger(1);
        ctx.net.step(); ctx.ticks++;
        if (r) {
            stepReadout(ctx);
            if (teacher >= 0 && learn) {
                if (learn.rule === 'hebb' || learn.forceTeacher) r.firing[teacher] = 1;
                learnReadout(ctx, teacher, learn);
            }
        }
        if (t >= skip) {
            for (let i = 0; i < nB; i++) if (ctx.brainNodes[i].isFiring) counts[i]++;
            if (r) for (let w = 0; w < r.nWords; w++) { wordDrive[w] += r.drive[w]; wordFire[w] += r.firing[w]; }
        }
    }
    return { counts, wordDrive, wordFire, ticks: Math.max(1, ticks - skip) };
}

// ---------------------------------------------------------------- Measurement helpers

export function argmax(arr) {
    let best = -1, bv = -Infinity, tie = false;
    for (let i = 0; i < arr.length; i++) {
        if (arr[i] > bv) { bv = arr[i]; best = i; tie = false; } else if (arr[i] === bv) tie = true;
    }
    return tie ? -1 : best; // a tie (e.g. all zero) is "no answer"
}

export function cosine(a, b) {
    let ab = 0, aa = 0, bb = 0;
    for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
    return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** Activity summary of a spike-count vector from present(). */
export function activity(res) {
    let total = 0, active = 0;
    for (const c of res.counts) { total += c; if (c > 0) active++; }
    return { rate: total / (res.counts.length * res.ticks), activeFrac: active / res.counts.length };
}

/** Internal brain weight summary (to spot pruning collapse or runaway growth). */
export function brainWeightStats(ctx) {
    let n = 0, sumAbs = 0, exc = 0, inh = 0, maxAbs = 0;
    for (const c of ctx.net.connections) {
        if (!(c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-'))) continue;
        n++; const a = Math.abs(c.weight); sumAbs += a; if (a > maxAbs) maxAbs = a;
        if (c.weight >= 0) exc++; else inh++;
    }
    return { internalConns: n, meanAbs: n ? sumAbs / n : 0, maxAbs, excitatory: exc, inhibitory: inh };
}

/**
 * Standard evaluation of the word readout. Brain plasticity is switched off while testing unless
 * opts.plastic is true (in the app it would stay on, so check both if it matters).
 *
 * For every word: full cue; and every unambiguous leave-one-out partial cue (see partialCues).
 * A trial is correct when the taught word wins. Two notions of "wins":
 *   drive : largest summed input to the word node (information is in the weights)
 *   fire  : the simulated app output node that fired most (what the user would SEE in the app)
 * Returns { fullDrive, fullFire, partialDrive, partialFire, nFull, nPartial, rate, activeFrac, wrong: [...] }.
 */
export function evaluate(ctx, dataset, opts = {}) {
    const { ticks = 40, settleTicks = 10, reset = true, plastic = false, skip = 2 } = opts;
    const prev = plastic ? null : setPlasticity(ctx, false);
    let fd = 0, ff = 0, pd = 0, pf = 0, nFull = 0, nPartial = 0, rate = 0, af = 0;
    const wrong = [];
    const trial = (cs) => {
        if (reset) resetState(ctx); else settle(ctx, settleTicks);
        return present(ctx, cs, ticks, { skip });
    };
    dataset.words.forEach((w, wi) => {
        const res = trial(w.concepts);
        const a = activity(res); rate += a.rate; af += a.activeFrac;
        const wd = argmax(res.wordDrive), wf = argmax(res.wordFire);
        nFull++; if (wd === wi) fd++; else wrong.push({ word: w.word, got: wd >= 0 ? dataset.words[wd].word : null });
        if (wf === wi) ff++;
        for (const cue of partialCues(dataset, wi)) {
            const pr = trial(cue);
            nPartial++;
            if (argmax(pr.wordDrive) === wi) pd++;
            if (argmax(pr.wordFire) === wi) pf++;
        }
    });
    if (prev) setPlasticity(ctx, prev);
    return {
        fullDrive: fd / nFull, fullFire: ff / nFull,
        partialDrive: nPartial ? pd / nPartial : null, partialFire: nPartial ? pf / nPartial : null,
        nFull, nPartial, rate: rate / nFull, activeFrac: af / nFull, wrong,
    };
}

/**
 * Readout-independent ceiling: how separable are the brain's responses themselves?
 * Presents every word `trainReps` times, builds a mean response (centroid) per word, then classifies fresh
 * presentations (full cue and unambiguous leave-one-out partial cues) by nearest centroid (cosine).
 * If this is low, no readout rule can work and the brain parameters are the problem.
 * Also returns meanPairCos: average cosine between different words' centroids (1 = all words look the same).
 */
export function brainSeparability(ctx, dataset, opts = {}) {
    const { ticks = 40, trainReps = 2, testReps = 1, reset = true, settleTicks = 10, skip = 2 } = opts;
    const prev = setPlasticity(ctx, false);
    const trial = (cs) => { if (reset) resetState(ctx); else settle(ctx, settleTicks); return present(ctx, cs, ticks, { skip }); };
    const nB = ctx.brainNodes.length;
    const cent = dataset.words.map(() => new Float32Array(nB));
    for (let r = 0; r < trainReps; r++) dataset.words.forEach((w, wi) => { const res = trial(w.concepts); for (let i = 0; i < nB; i++) cent[wi][i] += res.counts[i]; });
    const classify = (v) => { let best = -1, bv = -Infinity; cent.forEach((c, i) => { const s = cosine(v, c); if (s > bv) { bv = s; best = i; } }); return best; };
    let full = 0, nFull = 0, part = 0, nPart = 0;
    for (let r = 0; r < testReps; r++) dataset.words.forEach((w, wi) => {
        nFull++; if (classify(trial(w.concepts).counts) === wi) full++;
        for (const cue of partialCues(dataset, wi)) { nPart++; if (classify(trial(cue).counts) === wi) part++; }
    });
    let pc = 0, np = 0;
    for (let i = 0; i < cent.length; i++) for (let j = i + 1; j < cent.length; j++) { pc += cosine(cent[i], cent[j]); np++; }
    setPlasticity(ctx, prev);
    return { full: full / nFull, partial: nPart ? part / nPart : null, meanPairCos: np ? pc / np : 0 };
}

/**
 * Second ceiling: the best a LINEAR readout could do. Records brain responses to every word (trainReps full-cue
 * presentations), fits a softmax classifier on the spike-count vectors offline, then tests it on fresh full-cue
 * and unambiguous partial-cue presentations. Unlike nearest-centroid it can learn to tell a word from its
 * supersets/subsets, so this is the number an ideal word readout should reach.
 * Returns { full, partial, trainAcc }.
 */
export function linearCeiling(ctx, dataset, opts = {}) {
    const { ticks = 40, trainReps = 3, epochs = 300, lr = 0.5, reset = true, settleTicks = 10, skip = 2 } = opts;
    const prev = setPlasticity(ctx, false);
    const trial = (cs) => { if (reset) resetState(ctx); else settle(ctx, settleTicks); return present(ctx, cs, ticks, { skip }).counts; };
    const nB = ctx.brainNodes.length, nW = dataset.words.length;
    const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); };
    const X = [], Y = [];
    for (let r = 0; r < trainReps; r++) dataset.words.forEach((w, wi) => { X.push(norm(trial(w.concepts))); Y.push(wi); });
    const W = Array.from({ length: nW }, () => new Float32Array(nB)); const b = new Float32Array(nW);
    const scores = (x) => { const z = new Float32Array(nW); for (let w = 0; w < nW; w++) { let s = b[w]; const Ww = W[w]; for (let i = 0; i < nB; i++) s += Ww[i] * x[i]; z[w] = s; } return z; };
    for (let e = 0; e < epochs; e++) for (let n = 0; n < X.length; n++) {
        const z = scores(X[n]); let m = -Infinity; for (const v of z) if (v > m) m = v;
        let sum = 0; const p = Float32Array.from(z, v => { const q = Math.exp(v - m); sum += q; return q; });
        for (let w = 0; w < nW; w++) { const g = (w === Y[n] ? 1 : 0) - p[w] / sum; if (Math.abs(g) < 1e-4) continue; b[w] += lr * g; const Ww = W[w], x = X[n]; for (let i = 0; i < nB; i++) if (x[i]) Ww[i] += lr * g * x[i]; }
    }
    const predict = (v) => { const z = scores(norm(v)); let best = 0; for (let w = 1; w < nW; w++) if (z[w] > z[best]) best = w; return best; };
    let tr = 0; X.forEach((x, n) => { const z = scores(x); let best = 0; for (let w = 1; w < nW; w++) if (z[w] > z[best]) best = w; if (best === Y[n]) tr++; });
    let full = 0, part = 0, nPart = 0;
    dataset.words.forEach((w, wi) => {
        if (predict(trial(w.concepts)) === wi) full++;
        for (const cue of partialCues(dataset, wi)) { nPart++; if (predict(trial(cue)) === wi) part++; }
    });
    setPlasticity(ctx, prev);
    return { full: full / nW, partial: nPart ? part / nPart : null, trainAcc: tr / X.length };
}

/**
 * Concept-level check: present each concept alone `reps` times; classify a fresh single-concept presentation by
 * nearest centroid. Also reports how selective neurons are (fraction of responding neurons that respond to one
 * concept only) - a rough "has the brain formed one assembly per concept" measure.
 */
export function conceptSeparability(ctx, nConcepts, opts = {}) {
    const { ticks = 40, reps = 2, skip = 2 } = opts;
    const prev = setPlasticity(ctx, false);
    const nB = ctx.brainNodes.length;
    const cent = Array.from({ length: nConcepts }, () => new Float32Array(nB));
    for (let r = 0; r < reps; r++) for (let c = 0; c < nConcepts; c++) { resetState(ctx); const res = present(ctx, [c], ticks, { skip }); for (let i = 0; i < nB; i++) cent[c][i] += res.counts[i]; }
    let ok = 0, silent = 0;
    for (let c = 0; c < nConcepts; c++) {
        resetState(ctx); const v = present(ctx, [c], ticks, { skip }).counts;
        if (!v.some(x => x > 0)) silent++;
        let best = -1, bv = -Infinity; cent.forEach((k, i) => { const s = cosine(v, k); if (s > bv) { bv = s; best = i; } });
        if (best === c) ok++;
    }
    let responding = 0, selective = 0;
    for (let i = 0; i < nB; i++) { let k = 0; for (let c = 0; c < nConcepts; c++) if (cent[c][i] > 0) k++; if (k > 0) responding++; if (k === 1) selective++; }
    setPlasticity(ctx, prev);
    return { accuracy: ok / nConcepts, silentConcepts: silent, respondingFrac: responding / nB, selectiveFrac: responding ? selective / responding : 0 };
}

// ---------------------------------------------------------------- Standard two-phase protocol

/**
 * The protocol the development branch sketches:
 *   Phase A "concepts"    : each concept alone, conceptEpochs times (brain plasticity on) - lets assemblies form.
 *   Phase B "association" : each word's concepts together, wordEpochs times, with the word node taught.
 * cfg:
 *   dataset (name or object), seed, brain, paramMode, inputLink, inputWeight, inhibitoryFraction   -> buildNet
 *   readout { coverage, w0, node, normalize }                                                     -> attachReadout
 *   learn   { rule, lr, wMin, wMax, l1, forceTeacher }                                            -> readout rule
 *   conceptEpochs (default 5), wordEpochs (default 20), ticks (40), settleTicks (10), reset (true)
 *   plasticDuringWords (default true): keep brain Hebbian on in phase B
 *   evalOpts: passed to evaluate();  linear: false skips the linearCeiling measurement
 * Returns { dataset, nConcepts, nWords, nBrain,
 *           before / after : brainSeparability before and after training,
 *           linear         : linearCeiling after training,
 *           eval           : evaluate() of the taught word readout,
 *           concept        : conceptSeparability, weights: brainWeightStats, ticks, ms }.
 */
export function runStandard(cfg) {
    const t0 = Date.now();
    const dataset = typeof cfg.dataset === 'string' ? loadDataset(cfg.dataset) : cfg.dataset;
    const { conceptEpochs = 5, wordEpochs = 20, ticks = 40, settleTicks = 10, reset = true, plasticDuringWords = true } = cfg;
    const ctx = buildNet({ nConcepts: dataset.concepts.length, brain: cfg.brain, paramMode: cfg.paramMode, inputLink: cfg.inputLink, inputWeight: cfg.inputWeight, inhibitoryFraction: cfg.inhibitoryFraction, seed: cfg.seed ?? 1 });
    attachReadout(ctx, { nWords: dataset.words.length, ...(cfg.readout || {}) });
    const learn = { rule: 'perceptron', lr: 0.05, ...(cfg.learn || {}) };
    const gap = () => { if (reset) resetState(ctx); else settle(ctx, settleTicks); };

    const before = brainSeparability(ctx, dataset, { ticks });

    for (let e = 0; e < conceptEpochs; e++) for (const c of shuffled(dataset.concepts.map((_, i) => i))) { gap(); present(ctx, [c], ticks); }

    if (!plasticDuringWords) setPlasticity(ctx, false);
    for (let e = 0; e < wordEpochs; e++) for (const wi of shuffled(dataset.words.map((_, i) => i))) { gap(); present(ctx, dataset.words[wi].concepts, ticks, { teacher: wi, learn }); }
    if (!plasticDuringWords) setPlasticity(ctx, true);

    const evalRes = evaluate(ctx, dataset, { ticks, ...(cfg.evalOpts || {}) });
    const after = brainSeparability(ctx, dataset, { ticks });
    const linear = cfg.linear === false ? null : linearCeiling(ctx, dataset, { ticks });
    const concept = conceptSeparability(ctx, dataset.concepts.length, { ticks });
    return {
        dataset: dataset.name, nConcepts: dataset.concepts.length, nWords: dataset.words.length, nBrain: ctx.brainNodes.length,
        before, after, linear, eval: evalRes, concept, weights: brainWeightStats(ctx), ticks: ctx.ticks, ms: Date.now() - t0,
    };
}

/** Mean and standard deviation over seeds for a metric extractor. */
export function overSeeds(seeds, fn) {
    const vals = seeds.map(fn);
    const keys = Object.keys(vals[0]);
    const out = {};
    for (const k of keys) {
        const xs = vals.map(v => v[k]).filter(x => typeof x === 'number');
        if (!xs.length) continue;
        const m = xs.reduce((a, b) => a + b, 0) / xs.length;
        out[k] = { mean: +m.toFixed(3), sd: +Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length).toFixed(3) };
    }
    return out;
}
