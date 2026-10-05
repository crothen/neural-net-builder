// Shared measurement for the dynamics sweeps (fixed brain, no plasticity).
//
// measure() reproduces the harness metrics brainSeparability() + linearCeiling() + activity() with the SAME
// algorithms and hyper-parameters (40 ticks, skip 2, reset between trials, centroid from 2 full-cue reps, softmax
// from 3 full-cue reps, 300 epochs, lr 0.5) but records the brain responses ONCE and reuses them for both
// classifiers, which halves the simulation cost. `check.mjs` compares it against the harness functions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildNet, present, resetState, setPlasticity, loadDataset, partialCues, cosine, activity, brainWeightStats,
} from '../lib/harness.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS = path.join(HERE, 'results');

const dsCache = {};
export function ds(name) { return dsCache[name] || (dsCache[name] = loadDataset(name)); }

/**
 * cfg: { brain, paramMode, inputLink, inputWeight, inhibitoryFraction, post(ctx), warmupEpochs, unlocalize }
 *   Brain plasticity (Hebbian + synaptic scaling) is forced OFF.
 *   unlocalize: true  -> after building, set isLocalized=false and rewire internally (work-around: connectModules
 *                        forces isLocalized=true whenever inputLink.localizer < 100).
 *               'control' -> same rewire-after-inputs but keeping isLocalized=true (controls for the weight change
 *                        caused by rewiring after the input links exist).
 *   warmupEpochs: present every word (40 ticks) this many times before measuring (lets adaptive thresholds move).
 */
export function build(cfg, dataset, seed) {
    const brain = { ...(cfg.brain || {}), hebbianLearning: false };
    brain.sustainability = { ...(brain.sustainability || {}), synapticScaling: false };
    const ctx = buildNet({
        nConcepts: dataset.concepts.length, brain, paramMode: cfg.paramMode || 'full', inputLink: cfg.inputLink,
        inputWeight: cfg.inputWeight, inhibitoryFraction: cfg.inhibitoryFraction, seed,
    });
    if (cfg.unlocalize) {
        ctx.brainCfg.isLocalized = cfg.unlocalize === 'control';
        ctx.net.rewireInternalConnections('brain');
    }
    if (cfg.post) cfg.post(ctx);
    setPlasticity(ctx, false);
    return ctx;
}

export function measure(cfg, datasetName, seed) {
    const dataset = ds(datasetName);
    const ctx = build(cfg, dataset, seed);
    const ticks = 40, skip = 2;
    const trial = (cs) => { resetState(ctx); return present(ctx, cs, ticks, { skip }); };
    for (let e = 0; e < (cfg.warmupEpochs || 0); e++) for (const w of dataset.words) trial(w.concepts);

    const nB = ctx.brainNodes.length, nW = dataset.words.length;
    // --- record
    const train = []; // [rep][word] counts
    for (let r = 0; r < 3; r++) train.push(dataset.words.map(w => trial(w.concepts).counts));
    let rate = 0, af = 0;
    const testFull = dataset.words.map(w => { const res = trial(w.concepts); const a = activity(res); rate += a.rate; af += a.activeFrac; return res.counts; });
    const testPart = []; // { wi, counts }
    dataset.words.forEach((w, wi) => { for (const cue of partialCues(dataset, wi)) testPart.push({ wi, counts: trial(cue).counts }); });

    // --- nearest centroid (as brainSeparability, trainReps 2)
    const cent = dataset.words.map((_, wi) => { const c = new Float32Array(nB); for (let r = 0; r < 2; r++) for (let i = 0; i < nB; i++) c[i] += train[r][wi][i]; return c; });
    const classify = (v) => { let best = -1, bv = -Infinity; cent.forEach((c, i) => { const s = cosine(v, c); if (s > bv) { bv = s; best = i; } }); return best; };
    let sf = 0, sp = 0;
    testFull.forEach((v, wi) => { if (classify(v) === wi) sf++; });
    testPart.forEach(t => { if (classify(t.counts) === t.wi) sp++; });
    let pc = 0, np = 0;
    for (let i = 0; i < nW; i++) for (let j = i + 1; j < nW; j++) { pc += cosine(cent[i], cent[j]); np++; }

    // --- softmax (as linearCeiling)
    const epochs = 300, lr = 0.5;
    const norm = (v) => { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); };
    const X = [], Y = [];
    for (let r = 0; r < 3; r++) dataset.words.forEach((_, wi) => { X.push(norm(train[r][wi])); Y.push(wi); });
    const W = Array.from({ length: nW }, () => new Float32Array(nB)); const b = new Float32Array(nW);
    const scores = (x) => { const z = new Float32Array(nW); for (let w = 0; w < nW; w++) { let s = b[w]; const Ww = W[w]; for (let i = 0; i < nB; i++) s += Ww[i] * x[i]; z[w] = s; } return z; };
    for (let e = 0; e < epochs; e++) for (let n = 0; n < X.length; n++) {
        const z = scores(X[n]); let m = -Infinity; for (const v of z) if (v > m) m = v;
        let sum = 0; const p = Float32Array.from(z, v => { const q = Math.exp(v - m); sum += q; return q; });
        for (let w = 0; w < nW; w++) { const g = (w === Y[n] ? 1 : 0) - p[w] / sum; if (Math.abs(g) < 1e-4) continue; b[w] += lr * g; const Ww = W[w], x = X[n]; for (let i = 0; i < nB; i++) if (x[i]) Ww[i] += lr * g * x[i]; }
    }
    const predict = (v) => { const z = scores(norm(v)); let best = 0; for (let w = 1; w < nW; w++) if (z[w] > z[best]) best = w; return best; };
    let lf = 0, lp = 0;
    testFull.forEach((v, wi) => { if (predict(v) === wi) lf++; });
    testPart.forEach(t => { if (predict(t.counts) === t.wi) lp++; });

    // silent trials (no spikes at all) on full cue
    let silentWords = 0; testFull.forEach(v => { if (!v.some(x => x > 0)) silentWords++; });
    let thr = 0; for (const n of ctx.brainNodes) thr += n.threshold; thr /= nB;
    const ws = brainWeightStats(ctx);
    return {
        linFull: lf / nW, linPart: testPart.length ? lp / testPart.length : null,
        sepFull: sf / nW, sepPart: testPart.length ? sp / testPart.length : null,
        pairCos: np ? pc / np : 0, rate: rate / nW, active: af / nW, silentWords: silentWords / nW,
        meanThr: thr, wMeanAbs: ws.meanAbs, nPart: testPart.length,
    };
}

export function stats(vals) {
    const out = {};
    for (const k of Object.keys(vals[0])) {
        const xs = vals.map(v => v[k]).filter(x => typeof x === 'number');
        if (!xs.length) continue;
        const m = xs.reduce((a, c) => a + c, 0) / xs.length;
        out[k] = { mean: +m.toFixed(3), sd: +Math.sqrt(xs.reduce((a, c) => a + (c - m) ** 2, 0) / xs.length).toFixed(3) };
    }
    return out;
}

const f = (s, k) => (s[k] ? `${s[k].mean.toFixed(2)}±${s[k].sd.toFixed(2)}` : '   n/a   ');

/** Run a list of [name, cfg] on a dataset over seeds, print a table, save JSON (merged into existing file). */
export function runGroup(group, datasetName, configs, seeds = [1, 2, 3]) {
    fs.mkdirSync(RESULTS, { recursive: true });
    const file = path.join(RESULTS, `${group}-${datasetName}.json`);
    const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const t0 = Date.now();
    console.log(`# ${group} / ${datasetName} / seeds ${seeds.join(',')}`);
    console.log(`${'config'.padEnd(34)} linFull   linPart   sepPart   pairCos   rate      active    thr`);
    for (const [name, cfg] of configs) {
        const per = seeds.map(seed => measure(cfg, datasetName, seed));
        const s = stats(per);
        const { post, ...plain } = cfg;
        out[name] = { cfg: plain, seeds, perSeed: per, stats: s };
        console.log(`${name.padEnd(34)} ${f(s, 'linFull')} ${f(s, 'linPart')} ${f(s, 'sepPart')} ${f(s, 'pairCos')} ${f(s, 'rate')} ${f(s, 'active')} ${s.meanThr.mean.toFixed(2)}`);
        fs.writeFileSync(file, JSON.stringify(out, null, 1));
    }
    console.log(`# done in ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.relative(process.cwd(), file)}`);
}
