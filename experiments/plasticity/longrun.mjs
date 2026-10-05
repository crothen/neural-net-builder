// Q2 (long-run stability) + Q3 (forgetting / drift) + part of Q4.
// Protocol per (arm, seed):
//   1. train as the app would: phase A (5 concept epochs) + phase B (10 word epochs, readout taught), brain plastic
//      unless the arm is "never".
//   2. T0: evaluate() the taught readout, and fit an offline linear readout ONCE (fixed afterwards).
//   3. continuation WITHOUT any readout teaching: the same words again, or unrelated random concept combinations,
//      with brain plasticity on or off. Snapshots along the way.
//   node experiments/plasticity/longrun.mjs <arm[,arm]> [seeds]
import { H, rng, shuffle, gap, assemblyStats, fitLinear, testLinear, saveJson, loadJson, ms } from './lib.mjs';

const FROZEN = { hebbianLearning: false, sustainability: { synapticScaling: false } };
const ARMS = {
    'full-on-words':      { paramMode: 'full', cont: 'words', plastic: true, contTicks: 50000 },
    'full-off-words':     { paramMode: 'full', cont: 'words', plastic: false, contTicks: 50000 },
    'full-on-random':     { paramMode: 'full', cont: 'random', plastic: true, contTicks: 20000 },
    'full-off-random':    { paramMode: 'full', cont: 'random', plastic: false, contTicks: 20000 },
    'full-never':         { paramMode: 'full', cont: 'words', plastic: false, contTicks: 50000, brain: FROZEN },
    'asLoaded-on-words':  { paramMode: 'asLoaded', cont: 'words', plastic: true, contTicks: 50000 },
    'asLoaded-off-words': { paramMode: 'asLoaded', cont: 'words', plastic: false, contTicks: 50000 },
    'asLoaded-on-random': { paramMode: 'asLoaded', cont: 'random', plastic: true, contTicks: 20000 },
    'asLoaded-never':     { paramMode: 'asLoaded', cont: 'words', plastic: false, contTicks: 50000, brain: FROZEN },
    'full-nr-on-words':   { paramMode: 'full', cont: 'words', plastic: true, contTicks: 50000, reset: false },
    'full-nr-off-words':  { paramMode: 'full', cont: 'words', plastic: false, contTicks: 50000, reset: false },
};
const SNAPS = [0, 2000, 5000, 10000, 20000, 35000, 50000];
const HEAVY = new Set([0, 10000, 50000, 20000]);

function snapshot(ctx, ds, model, ref, tick, heavy) {
    const s = { tick };
    const sep = H.brainSeparability(ctx, ds);
    s.sepFull = sep.full; s.sepPartial = sep.partial; s.pairCos = sep.meanPairCos;
    const e = H.evaluate(ctx, ds);
    s.evFull = e.fullDrive; s.evPartial = e.partialDrive; s.rate = e.rate; s.activeFrac = e.activeFrac;
    const t = testLinear(ctx, ds, model);
    s.fixFull = t.full; s.fixPartial = t.partial;
    // representational drift: cosine of each word's response now with its response at T0
    const prev = H.setPlasticity(ctx, false);
    const cur = ds.words.map(w => { H.resetState(ctx); return H.present(ctx, w.concepts, 40).counts; });
    H.setPlasticity(ctx, prev);
    if (ref.length === 0) cur.forEach(c => ref.push(c));
    s.driftCos = cur.reduce((a, c, i) => a + H.cosine(c, ref[i]), 0) / cur.length;
    if (heavy) {
        const l = H.linearCeiling(ctx, ds); s.linFull = l.full; s.linPartial = l.partial;
        const c = H.conceptSeparability(ctx, ds.concepts.length); s.conceptAcc = c.accuracy; s.selFrac = c.selectiveFrac; s.silent = c.silentConcepts;
        const as = assemblyStats(ctx, ds.concepts.length); s.selIdx = as.selIdx; s.wIn = as.wIn; s.wOut = as.wOut;
    }
    const w = H.brainWeightStats(ctx);
    s.conns = w.internalConns; s.exc = w.excitatory; s.inh = w.inhibitory; s.meanAbs = w.meanAbs; s.maxAbs = w.maxAbs;
    let th = 0; for (const n of ctx.brainNodes) th += n.threshold; s.meanThr = th / ctx.brainNodes.length;
    return s;
}

function run(arm, seed) {
    const a = ARMS[arm];
    const t0 = Date.now();
    const ds = H.loadDataset('medium');
    const reset = a.reset ?? true;
    const ctx = H.buildNet({ nConcepts: ds.concepts.length, brain: a.brain, paramMode: a.paramMode, seed });
    H.attachReadout(ctx, { nWords: ds.words.length });
    const r = rng(seed * 7919 + 13);
    const g = () => gap(ctx, { reset });
    const learn = { rule: 'perceptron', lr: 0.05 };
    const cIdx = ds.concepts.map((_, i) => i), wIdx = ds.words.map((_, i) => i);
    for (let e = 0; e < 5; e++) for (const c of shuffle(cIdx, r)) { g(); H.present(ctx, [c], 40); }
    for (let e = 0; e < 10; e++) for (const wi of shuffle(wIdx, r)) { g(); H.present(ctx, ds.words[wi].concepts, 40, { teacher: wi, learn }); }

    const model = fitLinear(ctx, ds);
    const ref = [];
    const snaps = [snapshot(ctx, ds, model, ref, 0, true)];
    if (!a.plastic) H.setPlasticity(ctx, false);
    const wordSets = new Set(ds.words.map(w => w.concepts.slice().sort((x, y) => x - y).join(',')));
    const randomCombo = () => {
        for (;;) {
            const k = 2 + Math.floor(r() * 3);
            const cs = shuffle(cIdx, r).slice(0, k).sort((x, y) => x - y);
            if (!wordSets.has(cs.join(','))) return cs;
        }
    };
    let tick = 0, queue = [], si = 1;
    const per = 40 + (reset ? 0 : 10);
    while (tick < a.contTicks) {
        let cs;
        if (a.cont === 'words') { if (!queue.length) queue = shuffle(wIdx, r); cs = ds.words[queue.pop()].concepts; }
        else cs = randomCombo();
        g(); H.present(ctx, cs, 40); tick += per;
        if (si < SNAPS.length && tick >= SNAPS[si]) { snaps.push(snapshot(ctx, ds, model, ref, SNAPS[si], HEAVY.has(SNAPS[si]))); si++; }
    }
    return { arm, seed, snaps, ms: Date.now() - t0 };
}

const arms = (process.argv[2] || 'full-never').split(',');
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const all = loadJson('longrun-results.json') || {};
for (const arm of arms) {
    all[arm] = all[arm] || {};
    for (const seed of seeds) { const res = run(arm, seed); all[arm][seed] = res; saveJson('longrun-results.json', all); console.log(`${arm} seed ${seed}: ${Math.round(res.ms / 1000)} s`); }
    const runs = Object.values(all[arm]);
    console.log(`\n== ${arm} (seeds ${runs.map(x => x.seed).join(',')})`);
    console.log('  tick   conns      exc       inh      |w|        max       thr       rate        pairCos    sepPart    linPart    | readout full/partial   | fixedLinear full/partial | driftCos');
    runs[0].snaps.forEach((_, i) => {
        const col = (k, d = 2) => ms(runs.map(x => x.snaps[i]?.[k]), d).padEnd(10);
        console.log(`  ${String(runs[0].snaps[i].tick).padEnd(6)} ${col('conns', 0)} ${col('exc', 0)} ${col('inh', 0)} ${col('meanAbs', 3)} ${col('maxAbs')} ${col('meanThr')} ${col('rate', 3)} ${col('pairCos')} ${col('sepPartial')} ${col('linPartial')} | ${col('evFull')} ${col('evPartial')} | ${col('fixFull')} ${col('fixPartial')} | ${col('driftCos')}`);
    });
}
