// Readout experiments: trace recorder + offline replay.
//
// The word readout is strictly feed-forward (brain -> word nodes, nothing flows back), so the brain's activity
// does not depend on the readout rule. We therefore run the REAL engine once per (dataset, seed, plasticity
// setting) following exactly the runStandard() protocol, record which brain neurons were active on every tick of
// the word-training phase and of the evaluation, and then replay any number of readout rules / output-node
// settings on those traces. The replay maths is a copy of harness stepReadout()/present()/evaluate().
// Winning configurations are re-checked through the real harness (see verify.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildNet, attachReadout, present, resetState, setPlasticity, brainSeparability,
    loadDataset, partialCues, shuffled,
} from '../lib/harness.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TRACE_DIR = path.join(HERE, 'traces');

// ---------------------------------------------------------------- recording

/**
 * Follow runStandard() step by step (same RNG consumption) and record brain activity.
 * Returns { dataset, seed, nBrain, nWords, train: [{ teacher, ticks: [[idx...], ...] }], eval: [{ word, kind, ticks }] }.
 */
export function record({ dataset: dsName, seed, plasticDuringWords = true, conceptEpochs = 5, wordEpochs = 20, ticks = 40, evalPlastic = false }) {
    const dataset = loadDataset(dsName);
    const ctx = buildNet({ nConcepts: dataset.concepts.length, seed });
    attachReadout(ctx, { nWords: dataset.words.length });
    brainSeparability(ctx, dataset, { ticks }); // runStandard measures this first; keep the same state/RNG path

    for (let e = 0; e < conceptEpochs; e++) for (const c of shuffled(dataset.concepts.map((_, i) => i))) { resetState(ctx); present(ctx, [c], ticks); }

    let cur = null; let nonUnit = 0;
    const rec = { rule: () => {
        const idx = [];
        for (let i = 0; i < ctx.brainNodes.length; i++) {
            const a = ctx.brainNodes[i].activation;
            if (a > 0) { idx.push(i); if (a !== 1) nonUnit++; }
        }
        cur.push(idx);
    } };

    const train = [];
    if (!plasticDuringWords) setPlasticity(ctx, false);
    for (let e = 0; e < wordEpochs; e++) for (const wi of shuffled(dataset.words.map((_, i) => i))) {
        resetState(ctx); cur = [];
        present(ctx, dataset.words[wi].concepts, ticks, { teacher: wi, learn: rec });
        train.push({ teacher: wi, ticks: cur });
    }
    if (!plasticDuringWords) setPlasticity(ctx, true);

    const ev = [];
    const prev = evalPlastic ? null : setPlasticity(ctx, false);
    dataset.words.forEach((w, wi) => {
        resetState(ctx); cur = [];
        present(ctx, w.concepts, ticks, { teacher: wi, learn: rec });
        ev.push({ word: wi, kind: 'full', ticks: cur });
        for (const cue of partialCues(dataset, wi)) {
            resetState(ctx); cur = [];
            present(ctx, cue, ticks, { teacher: wi, learn: rec });
            ev.push({ word: wi, kind: 'partial', ticks: cur });
        }
    });
    if (prev) setPlasticity(ctx, prev);
    return { dataset: dsName, seed, plasticDuringWords, wordEpochs, ticksPer: ticks, nBrain: ctx.brainNodes.length, nWords: dataset.words.length, nonUnit, train, eval: ev };
}

export function tracePath(ds, seed, plastic, tag = '') {
    return path.join(TRACE_DIR, `${ds}-s${seed}-${plastic ? 'plastic' : 'frozen'}${tag}.json`);
}

export function loadTrace(ds, seed, plastic, tag = '') {
    return JSON.parse(fs.readFileSync(tracePath(ds, seed, plastic, tag), 'utf8'));
}

// ---------------------------------------------------------------- replay

function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function argmax(arr) {
    let best = -1, bv = -Infinity, tie = false;
    for (let i = 0; i < arr.length; i++) { if (arr[i] > bv) { bv = arr[i]; best = i; tie = false; } else if (arr[i] === bv) tie = true; }
    return tie ? -1 : best;
}

/**
 * Replay a readout configuration on a recorded trace.
 * cfg:
 *   node { threshold, decay, maxPotential }   default 0.5 / 0.1 / 3 (app LEARNED_OUTPUT node)
 *   normalize   true = input is the MEAN over incoming connections (engine brain->output rule), false = sum
 *   coverage, w0
 *   rule        name (see RULES) or function (S, teacher, idx) => void
 *   lr, wMin, wMax, margin, anti, l2, ...   rule parameters (see RULES)
 *   forceTeacher  set firing[teacher] = 1 before the rule runs (the harness does this for 'hebb')
 *   lateral     k: each word node's input is reduced by k * (sum of the OTHER word nodes' firing on the previous tick)
 *   epochs      use only the first `epochs` epochs of the training trace
 *   skip        ticks not counted in the statistics (default 2)
 */
export function replay(trace, cfg = {}) {
    const nB = trace.nBrain, nW = trace.nWords;
    const node = { threshold: 0.5, decay: 0.1, maxPotential: 3, ...(cfg.node || {}) };
    const { normalize = true, coverage = 1, w0 = 0, skip = 2, lateral = 0 } = cfg;
    const rand = rng(1000 + trace.seed);
    const W = Array.from({ length: nW }, () => new Float32Array(nB).fill(w0));
    const mask = Array.from({ length: nW }, () => { const m = new Uint8Array(nB); for (let i = 0; i < nB; i++) m[i] = rand() < coverage ? 1 : 0; return m; });
    if (coverage < 1) for (let w = 0; w < nW; w++) for (let i = 0; i < nB; i++) if (!mask[w][i]) W[w][i] = 0;
    const fanIn = mask.map(m => Math.max(1, m.reduce((a, b) => a + b, 0)));
    const S = { nW, nB, W, mask, fanIn, node, normalize, cfg, potential: new Float32Array(nW), firing: new Uint8Array(nW), trace: new Float32Array(nB), prevFiring: new Uint8Array(nW), drive: new Float32Array(nW) };
    const rule = typeof cfg.rule === 'function' ? cfg.rule : RULES[cfg.rule || 'perceptron'];

    const step = (idx) => {
        let nPrev = 0; if (lateral) { for (let w = 0; w < nW; w++) nPrev += S.firing[w]; S.prevFiring.set(S.firing); }
        for (let w = 0; w < nW; w++) {
            const Ww = W[w]; let sum = 0;
            for (let k = 0; k < idx.length; k++) sum += Ww[idx[k]]; // masked weights stay 0
            let input = normalize ? sum / fanIn[w] : sum;
            S.drive[w] = input; // the harness records the feed-forward drive
            if (lateral) input -= lateral * (nPrev - S.prevFiring[w]);
            let p = (S.potential[w] + input) * node.decay;
            if (p < 0) p = 0; if (p > node.maxPotential) p = node.maxPotential;
            S.potential[w] = p; S.firing[w] = p >= node.threshold ? 1 : 0;
        }
    };

    const perEpoch = trace.train.length / trace.wordEpochs;
    const nTrain = Math.min(trace.train.length, Math.round((cfg.epochs ?? trace.wordEpochs) * perEpoch));
    const passes = cfg.passes ?? 1; // >1 = run through the recorded training trace again (approximates more word epochs)
    let maxPot = 0, trainFireTicks = 0;
    for (let n = 0; n < nTrain * passes; n++) {
        const pr = trace.train[n % nTrain];
        S.potential.fill(0); S.firing.fill(0);
        S.trace.fill(0);
        for (let k = 0; k < pr.ticks.length; k++) {
            const idx = pr.ticks[k];
            step(idx);
            for (let w = 0; w < nW; w++) { if (S.potential[w] > maxPot) maxPot = S.potential[w]; trainFireTicks += S.firing[w]; }
            if (cfg.forceTeacher) S.firing[pr.teacher] = 1;
            rule(S, pr.teacher, idx);
        }
    }

    let fd = 0, ff = 0, pd = 0, pf = 0, nFull = 0, nPart = 0, excl = 0, duty = 0, others = 0, silent = 0, ffW = 0, pfW = 0, exclW = 0;
    const wrong = [], wrongFire = [];
    for (const ev of trace.eval) {
        S.potential.fill(0); S.firing.fill(0);
        const wordDrive = new Float32Array(nW), wordFire = new Float32Array(nW), wordFireW = new Float32Array(nW);
        ev.ticks.forEach((idx, t) => {
            step(idx);
            if (t >= skip) {
                for (let w = 0; w < nW; w++) { wordDrive[w] += S.drive[w]; wordFire[w] += S.firing[w]; }
                const top = argmax(S.potential); if (top >= 0 && S.firing[top]) wordFireW[top]++; // hard winner-take-all variant
            }
        });
        const d = argmax(wordDrive), f = argmax(wordFire), fW = argmax(wordFireW);
        if (ev.kind === 'full') { if (fW === ev.word) ffW++; let o = 0; for (let w = 0; w < nW; w++) if (w !== ev.word) o += wordFireW[w]; if (wordFireW[ev.word] > 0 && o === 0) exclW++; } else if (fW === ev.word) pfW++;
        if (ev.kind === 'full') {
            nFull++; if (d === ev.word) fd++; else wrong.push([ev.word, d]);
            if (f === ev.word) ff++; else wrongFire.push({ word: ev.word, got: f, ownTicks: wordFire[ev.word], bestOtherTicks: Math.max(...[...wordFire].filter((_, w) => w !== ev.word)) });
            let other = 0; for (let w = 0; w < nW; w++) if (w !== ev.word) other += wordFire[w];
            if (wordFire[ev.word] > 0 && other === 0) excl++;
            if (wordFire.every(x => x === 0)) silent++;
            duty += wordFire[ev.word] / (ev.ticks.length - skip); others += other / (ev.ticks.length - skip);
        } else { nPart++; if (d === ev.word) pd++; if (f === ev.word) pf++; }
    }
    let wAbs = 0, wMaxAbs = 0; for (const Ww of W) for (const v of Ww) { const a = Math.abs(v); wAbs += a; if (a > wMaxAbs) wMaxAbs = a; }
    return {
        fullDrive: fd / nFull, fullFire: ff / nFull, partialDrive: nPart ? pd / nPart : null, partialFire: nPart ? pf / nPart : null,
        fullFireWta: ffW / nFull, partialFireWta: nPart ? pfW / nPart : null, exclusiveWta: exclW / nFull, // same, if only the highest-potential node may fire
        exclusive: excl / nFull,        // right node fired and NO other node fired at all (full cues)
        duty: duty / nFull,             // fraction of ticks the right node is firing (full cues)
        othersDuty: others / nFull,     // summed firing fraction of all wrong nodes (full cues)
        silent: silent / nFull,         // no node fired at all
        maxPotTrain: maxPot, trainFireTicks, wMeanAbs: wAbs / (nW * nB), wMaxAbs, wrong, wrongFire, W,
    };
}

// ---------------------------------------------------------------- rules (all local: pre activity, own post state, teacher bit)

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const RULES = {
    /** Harness 'hebb': taught word only, dW = lr * pre. */
    hebb(S, t, idx) {
        const { lr = 0.05, wMin = -Infinity, wMax = Infinity } = S.cfg; const Ww = S.W[t], m = S.mask[t];
        for (const i of idx) if (m[i]) Ww[i] = clamp(Ww[i] + lr, wMin, wMax);
    },
    /** Harness 'perceptron': dW = lr * (target - fired) * pre. */
    perceptron(S, t, idx) {
        const { lr = 0.05, wMin = -Infinity, wMax = Infinity } = S.cfg;
        for (let w = 0; w < S.nW; w++) {
            const err = (w === t ? 1 : 0) - S.firing[w]; if (!err) continue;
            const Ww = S.W[w], m = S.mask[w];
            for (const i of idx) if (m[i]) Ww[i] = clamp(Ww[i] + lr * err, wMin, wMax);
        }
    },
    /**
     * Margin perceptron on the node POTENTIAL (not on the fired bit):
     *   taught word : potential < threshold * (1 + margin)  -> dW = +lr * pre
     *   other words : potential > threshold * (1 - margin)  -> dW = -lr * pre
     */
    margin(S, t, idx) {
        const { lr = 0.05, wMin = -Infinity, wMax = Infinity, margin = 0.5, marginLo = margin } = S.cfg; const th = S.node.threshold;
        for (let w = 0; w < S.nW; w++) {
            const p = S.potential[w];
            const err = w === t ? (p < th * (1 + margin) ? 1 : 0) : (p > th * (1 - marginLo) ? -1 : 0);
            if (!err) continue;
            const Ww = S.W[w], m = S.mask[w];
            for (const i of idx) if (m[i]) Ww[i] = clamp(Ww[i] + lr * err, wMin, wMax);
        }
    },
    /** Delta rule on the potential: dW = lr * (target_potential - potential) * pre, target = hi for taught, lo for others. */
    delta(S, t, idx) {
        const { lr = 0.05, wMin = -Infinity, wMax = Infinity, hi = 2, lo = 0 } = S.cfg; const th = S.node.threshold;
        for (let w = 0; w < S.nW; w++) {
            const err = (w === t ? hi * th : lo * th) - S.potential[w];
            if (w !== t && err > 0) continue; // potential is clipped at 0, nothing to push up
            const Ww = S.W[w], m = S.mask[w];
            for (const i of idx) if (m[i]) Ww[i] = clamp(Ww[i] + lr * err, wMin, wMax);
        }
    },
    /**
     * Delta rule with separate gain for non-target words and an optional presynaptic eligibility trace.
     *   taught word : err = hi * threshold - potential
     *   other words : err = -negGain * potential            (potential is clipped at 0, so only "too high" is punished)
     *   dW = lr * err * pre      or, with useTrace, lr * err * e_i  where e_i = decay * (e_i + pre_i)  (same filter as the node)
     */
    delta2(S, t, idx) {
        const { lr = 1e-4, wMin = -Infinity, wMax = Infinity, hi = 2, negGain = 1, useTrace = false } = S.cfg; const th = S.node.threshold;
        const e = S.trace;
        if (useTrace) { const d = S.node.decay; for (let i = 0; i < e.length; i++) e[i] *= d; for (const i of idx) e[i] += d; }
        for (let w = 0; w < S.nW; w++) {
            const p = S.potential[w];
            const err = w === t ? hi * th - p : -negGain * p;
            if (!err) continue;
            const Ww = S.W[w], m = S.mask[w];
            if (useTrace) { for (let i = 0; i < e.length; i++) if (m[i] && e[i] > 1e-3) Ww[i] = clamp(Ww[i] + lr * err * e[i], wMin, wMax); }
            else for (const i of idx) if (m[i]) Ww[i] = clamp(Ww[i] + lr * err, wMin, wMax);
        }
    },
    /** Hebbian for the taught word plus a constant anti-Hebbian term for all other words: +lr*pre / -anti*lr*pre. */
    hebbAnti(S, t, idx) {
        const { lr = 0.05, wMin = -Infinity, wMax = Infinity, anti = 0.2 } = S.cfg;
        for (let w = 0; w < S.nW; w++) {
            const d = w === t ? lr : -anti * lr; const Ww = S.W[w], m = S.mask[w];
            for (const i of idx) if (m[i]) Ww[i] = clamp(Ww[i] + d, wMin, wMax);
        }
    },
    /** Hebbian on the taught word followed by L2 normalisation of that word's weight vector to length `l2`. */
    hebbL2(S, t, idx) {
        const { lr = 0.05, l2 = 1 } = S.cfg; const Ww = S.W[t], m = S.mask[t];
        for (const i of idx) if (m[i]) Ww[i] += lr;
        let s = 0; for (let i = 0; i < Ww.length; i++) s += Ww[i] * Ww[i];
        if (s > 0) { const f = l2 / Math.sqrt(s); for (let i = 0; i < Ww.length; i++) Ww[i] *= f; }
    },
    /** Hebbian on the taught word followed by L1 normalisation (weight budget, like the brain's synaptic scaling). */
    hebbL1(S, t, idx) {
        const { lr = 0.05, l1 = 1 } = S.cfg; const Ww = S.W[t], m = S.mask[t];
        for (const i of idx) if (m[i]) Ww[i] += lr;
        let s = 0; for (let i = 0; i < Ww.length; i++) s += Math.abs(Ww[i]);
        if (s > 0) { const f = l1 / s; for (let i = 0; i < Ww.length; i++) Ww[i] *= f; }
    },
    /** Hebbian with weight decay on the taught word (presynaptic gating, "Oja/instar"): dW_i = lr * (pre_i * wTarget - W_i) for ALL i. */
    instar(S, t, idx) {
        const { lr = 0.05, wTarget = 1 } = S.cfg; const Ww = S.W[t], m = S.mask[t];
        for (let i = 0; i < Ww.length; i++) if (m[i]) Ww[i] -= lr * Ww[i];
        for (const i of idx) if (m[i]) Ww[i] += lr * wTarget;
    },
};

// ---------------------------------------------------------------- stats helpers

export function meanSd(xs) {
    xs = xs.filter(x => typeof x === 'number');
    if (!xs.length) return { mean: null, sd: null, min: null };
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { mean: +m.toFixed(3), sd: +Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length).toFixed(3), min: +Math.min(...xs).toFixed(3) };
}

const KEYS = ['fullDrive', 'fullFire', 'partialDrive', 'partialFire', 'exclusive', 'duty', 'othersDuty', 'silent', 'fullFireWta', 'partialFireWta', 'exclusiveWta'];

/** Replay cfg on several traces, return mean/sd/min per metric. */
export function replayMany(traces, cfg) {
    const rs = traces.map(tr => replay(tr, cfg));
    const out = {};
    for (const k of KEYS) out[k] = meanSd(rs.map(r => r[k]));
    out.maxPotTrain = meanSd(rs.map(r => r.maxPotTrain)); out.wMaxAbs = meanSd(rs.map(r => r.wMaxAbs));
    return out;
}

export const fmt = (x) => (x === null || x === undefined ? ' n/a' : x.toFixed(2));
export function line(label, s) {
    return `${label.padEnd(58)} fD ${fmt(s.fullDrive.mean)} (min ${fmt(s.fullDrive.min)})  fF ${fmt(s.fullFire.mean)} (min ${fmt(s.fullFire.min)})  pD ${fmt(s.partialDrive.mean)}  pF ${fmt(s.partialFire.mean)}  excl ${fmt(s.exclusive.mean)}  duty ${fmt(s.duty.mean)}  oth ${fmt(s.othersDuty.mean)}`;
}
