// Shared helpers for the scale/capacity experiments (agent "scale").
// measure() = harness brainSeparability + linearCeiling fused so the same presentations feed both metrics
// (halves the cost) and so partial cues can be capped per word (needed for `full`: ~10k leave-one-out cues).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNet, present, resetState, setPlasticity, partialCues, cosine, loadDataset } from '../lib/harness.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Small local RNG so cue sampling does not consume / depend on the engine's Math.random stream. */
export function lcg(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export function subsetWords(dataset, n, seed = 7) {
    if (n >= dataset.words.length) return dataset;
    const rnd = lcg(seed);
    const idx = dataset.words.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const keep = idx.slice(0, n).sort((a, b) => a - b);
    return { ...dataset, name: `${dataset.name}${n}`, words: keep.map(i => dataset.words[i]) };
}

/**
 * Frozen-brain measurement.
 * opts: ticks 40, trainReps 3, warmupReps 1 (un-recorded passes so adaptive thresholds settle), maxPartial (cap of
 *       leave-one-out cues per word, Infinity = all), halfCues (number of random 50%-of-concepts cues per word, 0 = none),
 *       epochs 300 (softmax), cueSeed.
 * Returns { linFull, linPartial, linHalf, linTrain, ncFull, ncPartial, ncHalf, meanPairCos, rate, activeFrac, satFrac,
 *           meanThr, nPartial, ms }
 */
export function measure(ctx, dataset, opts = {}) {
    const { ticks = 40, trainReps = 3, warmupReps = 1, maxPartial = Infinity, halfCues = 0, epochs = 300, lr = 0.5, skip = 2, cueSeed = 11 } = opts;
    const t0 = Date.now();
    const prev = setPlasticity(ctx, false);
    const nB = ctx.brainNodes.length, nW = dataset.words.length;
    const rnd = lcg(cueSeed);
    let rate = 0, active = 0, sat = 0, nAct = 0;
    const trial = (cs, stat = false) => {
        resetState(ctx);
        const res = present(ctx, cs, ticks, { skip });
        if (stat) {
            let tot = 0, a = 0, s = 0;
            // "saturated" = firing in >= 30% of counted ticks (refractory 1 + jitter caps the rate near 0.4)
            for (const c of res.counts) { tot += c; if (c > 0) a++; if (c >= 0.3 * res.ticks) s++; }
            rate += tot / (nB * res.ticks); active += a / nB; sat += s / nB; nAct++;
        }
        return res.counts;
    };
    for (let r = 0; r < warmupReps; r++) dataset.words.forEach(w => trial(w.concepts));

    const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); };
    const X = [], Y = [];
    const cent = dataset.words.map(() => new Float32Array(nB));
    for (let r = 0; r < trainReps; r++) dataset.words.forEach((w, wi) => {
        const c = trial(w.concepts, true);
        X.push(norm(c)); Y.push(wi);
        if (r < 2) for (let i = 0; i < nB; i++) cent[wi][i] += c[i];
    });

    // softmax fit (same as harness.linearCeiling)
    const W = Array.from({ length: nW }, () => new Float32Array(nB)); const b = new Float32Array(nW);
    const scores = (x) => { const z = new Float32Array(nW); for (let w = 0; w < nW; w++) { let s = b[w]; const Ww = W[w]; for (let i = 0; i < nB; i++) s += Ww[i] * x[i]; z[w] = s; } return z; };
    for (let e = 0; e < epochs; e++) for (let n = 0; n < X.length; n++) {
        const z = scores(X[n]); let m = -Infinity; for (const v of z) if (v > m) m = v;
        let sum = 0; const p = Float32Array.from(z, v => { const q = Math.exp(v - m); sum += q; return q; });
        for (let w = 0; w < nW; w++) { const g = (w === Y[n] ? 1 : 0) - p[w] / sum; if (Math.abs(g) < 1e-4) continue; b[w] += lr * g; const Ww = W[w], x = X[n]; for (let i = 0; i < nB; i++) if (x[i]) Ww[i] += lr * g * x[i]; }
    }
    const best = (z) => { let k = 0; for (let w = 1; w < z.length; w++) if (z[w] > z[k]) k = w; return k; };
    const lin = (v) => best(scores(norm(v)));
    const nc = (v) => { let k = -1, bv = -Infinity; cent.forEach((c, i) => { const s = cosine(v, c); if (s > bv) { bv = s; k = i; } }); return k; };
    let tr = 0; X.forEach((x, n) => { if (best(scores(x)) === Y[n]) tr++; });

    let lf = 0, lp = 0, lh = 0, cf = 0, cp = 0, ch = 0, nPart = 0, nHalf = 0;
    dataset.words.forEach((w, wi) => {
        const v = trial(w.concepts);
        if (lin(v) === wi) lf++; if (nc(v) === wi) cf++;
        let cues = partialCuesFast(dataset, wi);
        if (cues.length > maxPartial) { cues = cues.map(c => [rnd(), c]).sort((a, b) => a[0] - b[0]).slice(0, maxPartial).map(x => x[1]); }
        for (const cue of cues) { const pv = trial(cue); nPart++; if (lin(pv) === wi) lp++; if (nc(pv) === wi) cp++; }
        for (let h = 0; h < halfCues; h++) {
            const cue = w.concepts.filter(() => rnd() < 0.5);
            if (cue.length < 1) continue;
            const owners = dataset.words.filter(o => cue.every(c => o.concepts.includes(c)));
            if (owners.length !== 1) continue;
            const hv = trial(cue); nHalf++; if (lin(hv) === wi) lh++; if (nc(hv) === wi) ch++;
        }
    });
    let pc = 0, np = 0;
    for (let i = 0; i < nW; i++) for (let j = i + 1; j < nW; j++) { pc += cosine(cent[i], cent[j]); np++; }
    let thr = 0; for (const n of ctx.brainNodes) thr += n.threshold;
    setPlasticity(ctx, prev);
    return {
        linFull: lf / nW, linPartial: nPart ? lp / nPart : null, linHalf: nHalf ? lh / nHalf : null, linTrain: tr / X.length,
        ncFull: cf / nW, ncPartial: nPart ? cp / nPart : null, ncHalf: nHalf ? ch / nHalf : null,
        meanPairCos: np ? pc / np : 0, rate: rate / nAct, activeFrac: active / nAct, satFrac: sat / nAct,
        meanThr: thr / nB, nPartial: nPart, nHalf, ms: Date.now() - t0,
    };
}

// partialCues from the harness is O(words * concepts^2 * words); fine for small sets, slow for `full`
// (121 words x ~80 concepts x 121 owners x includes). Same semantics, with Sets.
const setCache = new WeakMap();
function partialCuesFast(dataset, wi) {
    let sets = setCache.get(dataset.words);
    if (!sets) { sets = dataset.words.map(w => new Set(w.concepts)); setCache.set(dataset.words, sets); }
    const w = dataset.words[wi]; const cues = [];
    if (w.concepts.length < 2) return cues;
    for (let k = 0; k < w.concepts.length; k++) {
        const cue = w.concepts.filter((_, j) => j !== k);
        let owners = 0;
        for (const s of sets) { let ok = true; for (const c of cue) if (!s.has(c)) { ok = false; break; } if (ok) owners++; if (owners > 1) break; }
        if (owners === 1) cues.push(cue);
    }
    return cues;
}

/** Build a frozen brain and measure it. cfg: { dataset (object), seed, brain, inputLink, inputWeight, measure:{...} } */
export function frozenRun(cfg) {
    const t0 = Date.now();
    const ctx = buildNet({
        nConcepts: cfg.dataset.concepts.length, seed: cfg.seed,
        brain: { ...(cfg.brain || {}), hebbianLearning: false, sustainability: { ...(cfg.brain?.sustainability || {}), synapticScaling: false } },
        inputLink: cfg.inputLink, inputWeight: cfg.inputWeight,
    });
    const buildMs = Date.now() - t0;
    const m = measure(ctx, cfg.dataset, cfg.measure || {});
    return { ...m, buildMs, conns: ctx.net.connections.length };
}

export function agg(rows, keys) {
    const out = {};
    for (const k of keys) {
        const xs = rows.map(r => r[k]).filter(x => typeof x === 'number');
        if (!xs.length) { out[k] = null; continue; }
        const m = xs.reduce((a, b) => a + b, 0) / xs.length;
        out[k] = { mean: +m.toFixed(3), sd: +Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length).toFixed(3), min: +Math.min(...xs).toFixed(3) };
    }
    return out;
}

export const f = (x) => (x === null || x === undefined ? ' n/a ' : `${x.mean.toFixed(2)}±${x.sd.toFixed(2)}`);

export function saveJson(name, data) {
    fs.writeFileSync(path.join(HERE, name), JSON.stringify(data, null, 1));
}
export function loadJson(name, fallback) {
    const p = path.join(HERE, name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : fallback;
}
export { loadDataset, partialCues };
