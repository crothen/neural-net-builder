// Shared helpers for the plasticity experiments. Uses the harness unmodified.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../lib/harness.mjs';

export { H };
export const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Private RNG for presentation order, so plastic and frozen arms see the SAME order (the engine's regrowth
 *  consumes Math.random, which would otherwise desynchronise the arms). */
export function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function shuffle(arr, r) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
}

/** Gap between items. reset:true = harness resetState (which zeroes net.tickCount, so the engine's
 *  every-100-ticks synaptic scaling never fires with 40-tick items). keepTick restores tickCount (workaround). */
export function gap(ctx, { reset = true, keepTick = false, settleTicks = 10 } = {}) {
    if (reset) { const t = ctx.net.tickCount; H.resetState(ctx); if (keepTick) ctx.net.tickCount = t; }
    else H.settle(ctx, settleTicks);
}

/** Pattern completion measured directly: cosine of a partial-cue response with the full-cue response of its own
 *  word versus other words. Also returns mean firing rate / active fraction on full cues. */
export function completion(ctx, ds, { reset = true, ticks = 40 } = {}) {
    const prev = H.setPlasticity(ctx, false);
    const trial = (cs) => { if (reset) H.resetState(ctx); else H.settle(ctx, 10); return H.present(ctx, cs, ticks); };
    const full = ds.words.map(w => trial(w.concepts));
    let rate = 0, af = 0;
    for (const f of full) { const a = H.activity(f); rate += a.rate; af += a.activeFrac; }
    let own = 0, other = 0, n = 0;
    ds.words.forEach((w, wi) => {
        for (const cue of H.partialCues(ds, wi)) {
            const p = trial(cue).counts;
            own += H.cosine(p, full[wi].counts);
            let o = 0; for (let j = 0; j < full.length; j++) if (j !== wi) o += H.cosine(p, full[j].counts);
            other += o / (full.length - 1); n++;
        }
    });
    H.setPlasticity(ctx, prev);
    return { rate: rate / full.length, activeFrac: af / full.length, cosOwn: n ? own / n : null, cosOther: n ? other / n : null, centroids: full.map(f => f.counts) };
}

/** Do neurons that respond to the same concept have stronger excitatory links than neurons that do not? */
export function assemblyStats(ctx, nConcepts, { ticks = 40 } = {}) {
    const prev = H.setPlasticity(ctx, false);
    const nB = ctx.brainNodes.length;
    const member = Array.from({ length: nB }, () => []);
    const s1 = new Float64Array(nB), s2 = new Float64Array(nB);
    for (let c = 0; c < nConcepts; c++) {
        H.resetState(ctx);
        const v = H.present(ctx, [c], ticks).counts;
        for (let i = 0; i < nB; i++) { if (v[i] > 0) member[i].push(c); s1[i] += v[i]; s2[i] += v[i] * v[i]; }
    }
    H.setPlasticity(ctx, prev);
    // Treves-Rolls lifetime sparseness per neuron over concepts: 0 = same response to every concept, ->1 = one concept only
    let sp = 0, nSp = 0;
    for (let i = 0; i < nB; i++) if (s2[i] > 0) { const a = (s1[i] / nConcepts) ** 2 / (s2[i] / nConcepts); sp += (1 - a) / (1 - 1 / nConcepts); nSp++; }
    // structural assemblies: the neurons a concept's input connections land on
    const wired = Array.from({ length: nB }, () => []);
    for (const c of ctx.net.connections) if (c.sourceId.startsWith('concepts-')) wired[+c.targetId.slice(6)].push(c.sourceId);
    let sSame = 0, nSame = 0, sDiff = 0, nDiff = 0, sIn = 0, nIn = 0, sOut = 0, nOut = 0;
    for (const c of ctx.net.connections) {
        if (!(c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-'))) continue;
        if (c.weight <= 0) continue;
        const si = +c.sourceId.slice(6), ti = +c.targetId.slice(6);
        const a = member[si], b = member[ti];
        if (a.length && b.length) { if (a.some(x => b.includes(x))) { sSame += c.weight; nSame++; } else { sDiff += c.weight; nDiff++; } }
        const wa = wired[si], wb = wired[ti];
        if (wa.length && wb.length) { if (wa.some(x => wb.includes(x))) { sIn += c.weight; nIn++; } else { sOut += c.weight; nOut++; } }
    }
    return { wSame: nSame ? sSame / nSame : 0, nSame, wDiff: nDiff ? sDiff / nDiff : 0, nDiff, massSame: sSame, massDiff: sDiff,
        selIdx: nSp ? sp / nSp : 0, wIn: nIn ? sIn / nIn : 0, nIn, wOut: nOut ? sOut / nOut : 0, nOut, massIn: sIn, massOut: sOut };
}

/** Offline softmax readout fitted ONCE (same maths as harness linearCeiling), so it can be re-tested later
 *  without refitting: a clean measure of how much the brain's code drifts under an ideal fixed readout. */
export function fitLinear(ctx, ds, { ticks = 40, trainReps = 3, epochs = 300, lr = 0.5 } = {}) {
    const prev = H.setPlasticity(ctx, false);
    const nB = ctx.brainNodes.length, nW = ds.words.length;
    const X = [], Y = [];
    for (let r = 0; r < trainReps; r++) ds.words.forEach((w, wi) => { H.resetState(ctx); X.push(norm(H.present(ctx, w.concepts, ticks).counts)); Y.push(wi); });
    const W = Array.from({ length: nW }, () => new Float32Array(nB)); const b = new Float32Array(nW);
    for (let e = 0; e < epochs; e++) for (let n = 0; n < X.length; n++) {
        const z = scores(W, b, X[n]); let m = -Infinity; for (const v of z) if (v > m) m = v;
        let sum = 0; const p = Float32Array.from(z, v => { const q = Math.exp(v - m); sum += q; return q; });
        for (let w = 0; w < nW; w++) { const g = (w === Y[n] ? 1 : 0) - p[w] / sum; if (Math.abs(g) < 1e-4) continue; b[w] += lr * g; const Ww = W[w], x = X[n]; for (let i = 0; i < nB; i++) if (x[i]) Ww[i] += lr * g * x[i]; }
    }
    H.setPlasticity(ctx, prev);
    return { W, b };
}
function norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return Float32Array.from(v, x => x / s); }
function scores(W, b, x) { const z = new Float32Array(W.length); for (let w = 0; w < W.length; w++) { let s = b[w]; const Ww = W[w]; for (let i = 0; i < x.length; i++) s += Ww[i] * x[i]; z[w] = s; } return z; }
export function testLinear(ctx, ds, model, { ticks = 40 } = {}) {
    const prev = H.setPlasticity(ctx, false);
    const predict = (v) => { const z = scores(model.W, model.b, norm(v)); let best = 0; for (let w = 1; w < z.length; w++) if (z[w] > z[best]) best = w; return best; };
    let full = 0, part = 0, nPart = 0;
    ds.words.forEach((w, wi) => {
        H.resetState(ctx); if (predict(H.present(ctx, w.concepts, ticks).counts) === wi) full++;
        for (const cue of H.partialCues(ds, wi)) { nPart++; H.resetState(ctx); if (predict(H.present(ctx, cue, ticks).counts) === wi) part++; }
    });
    H.setPlasticity(ctx, prev);
    return { full: full / ds.words.length, partial: nPart ? part / nPart : null };
}

/** One snapshot of everything we track. Flat object of numbers. */
export function measure(ctx, ds, { linear = true, concept = true, readout = false, reset = true } = {}) {
    const out = {};
    const sep = H.brainSeparability(ctx, ds, { reset });
    out.sepFull = sep.full; out.sepPartial = sep.partial; out.pairCos = sep.meanPairCos;
    if (linear) { const l = H.linearCeiling(ctx, ds, { reset }); out.linFull = l.full; out.linPartial = l.partial; }
    const comp = completion(ctx, ds, { reset });
    out.rate = comp.rate; out.activeFrac = comp.activeFrac; out.cosOwn = comp.cosOwn; out.cosOther = comp.cosOther; out.cosMargin = comp.cosOwn - comp.cosOther;
    if (concept) {
        const c = H.conceptSeparability(ctx, ds.concepts.length);
        out.conceptAcc = c.accuracy; out.silent = c.silentConcepts; out.respFrac = c.respondingFrac; out.selFrac = c.selectiveFrac;
        const a = assemblyStats(ctx, ds.concepts.length);
        out.wSame = a.wSame; out.wDiff = a.wDiff; out.nSame = a.nSame; out.nDiff = a.nDiff;
        out.selIdx = a.selIdx; out.wIn = a.wIn; out.wOut = a.wOut; out.massIn = a.massIn; out.massOut = a.massOut;
    }
    if (readout) { const e = H.evaluate(ctx, ds, { reset }); out.evFull = e.fullDrive; out.evPartial = e.partialDrive; out.evFullFire = e.fullFire; }
    const w = H.brainWeightStats(ctx);
    out.conns = w.internalConns; out.meanAbs = w.meanAbs; out.maxAbs = w.maxAbs; out.exc = w.excitatory; out.inh = w.inhibitory;
    let th = 0; for (const n of ctx.brainNodes) th += n.threshold; out.meanThr = th / ctx.brainNodes.length;
    // mean concept->brain weight (should never change; synaptic scaling does change it when it fires)
    let iw = 0, ni = 0; for (const c of ctx.net.connections) if (c.sourceId.startsWith('concepts-')) { iw += c.weight; ni++; }
    out.inW = ni ? iw / ni : 0;
    return out;
}

/** Two-phase protocol with snapshots before (m0), after phase A (m1) and after phase B (m2). */
export function runProtocol(cfg) {
    const t0 = Date.now();
    const ds = typeof cfg.dataset === 'string' ? H.loadDataset(cfg.dataset) : cfg.dataset;
    const { conceptEpochs = 5, wordEpochs = 10, ticks = 40, reset = true, keepTick = false, plasticDuringWords = true, measureReset = true } = cfg;
    const ctx = H.buildNet({ nConcepts: ds.concepts.length, brain: cfg.brain, paramMode: cfg.paramMode ?? 'full', seed: cfg.seed, NetClass: cfg.NetClass });
    H.attachReadout(ctx, { nWords: ds.words.length });
    if (cfg.onBuilt) cfg.onBuilt(ctx);
    const r = rng(cfg.seed * 7919 + 13);
    const g = () => gap(ctx, { reset, keepTick });
    const learn = { rule: 'perceptron', lr: 0.05 };
    const m0 = cfg.skipM0 ? null : measure(ctx, ds, { reset: measureReset });
    const cIdx = ds.concepts.map((_, i) => i), wIdx = ds.words.map((_, i) => i);
    let trainRate = 0, nTrain = 0;
    for (let e = 0; e < conceptEpochs; e++) for (const c of shuffle(cIdx, r)) { g(); present(ctx, [c], ticks, {}, cfg); }
    const m1 = measure(ctx, ds, { reset: measureReset });
    if (!plasticDuringWords) H.setPlasticity(ctx, false);
    for (let e = 0; e < wordEpochs; e++) for (const wi of shuffle(wIdx, r)) { g(); const res = present(ctx, ds.words[wi].concepts, ticks, { teacher: wi, learn }, cfg); trainRate += H.activity(res).rate; nTrain++; }
    if (!plasticDuringWords) H.setPlasticity(ctx, true);
    const m2 = measure(ctx, ds, { reset: measureReset, readout: true });
    m2.trainRate = nTrain ? trainRate / nTrain : 0;
    return { m0, m1, m2, ticks: ctx.ticks, ms: Date.now() - t0 };
}

/** present() that optionally runs a custom per-tick rule (cfg.afterStep) - only used for rule prototypes. */
export function present(ctx, cs, ticks, opts, cfg) {
    if (!cfg || !cfg.customPresent) return H.present(ctx, cs, ticks, opts);
    return cfg.customPresent(ctx, cs, ticks, opts);
}

export function stats(xs) {
    xs = xs.filter(x => typeof x === 'number' && Number.isFinite(x));
    if (!xs.length) return { mean: null, sd: null, min: null, max: null };
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return { mean: m, sd: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length), min: Math.min(...xs), max: Math.max(...xs) };
}
export const f2 = (x, d = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(d));
export const ms = (xs, d = 2) => { const s = stats(xs); return s.mean === null ? 'n/a' : `${s.mean.toFixed(d)}±${s.sd.toFixed(d)}`; };

export function saveJson(name, obj) {
    fs.writeFileSync(path.join(HERE, name), JSON.stringify(obj, null, 1));
}
export function loadJson(name) {
    const p = path.join(HERE, name);
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
