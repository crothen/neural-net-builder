// Q1/Q4/Q5 sweep: frozen brain vs default plasticity vs variants, same seed, same presentation order.
//   node experiments/plasticity/sweep.mjs <batch> [seeds]
// Appends to sweep-results.json (keyed by condition name).
import { runProtocol, ms, saveJson, loadJson } from './lib.mjs';

const FROZEN = { hebbianLearning: false, sustainability: { synapticScaling: false } };
const S = (o) => ({ sustainability: o });

const CONDS = {
    // --- batch a: core
    'naive':             { brain: FROZEN, conceptEpochs: 0, wordEpochs: 0 },   // measurement only (m1 == untrained brain)
    'frozen':            { brain: FROZEN },
    'frozen-noAdaptThr': { brain: { hebbianLearning: false, sustainability: { synapticScaling: false, adaptiveThreshold: false } } },
    'default':           { brain: {} },
    'noWordPlast':       { brain: {}, plasticDuringWords: false },
    'asLoaded-frozen':   { brain: FROZEN, paramMode: 'asLoaded' },
    'asLoaded-default':  { brain: {}, paramMode: 'asLoaded' },
    // --- batch b: rule parameters
    'lr0.001':           { brain: { learningRate: 0.001 } },
    'lr0.05':            { brain: { learningRate: 0.05 } },
    'regrow0':           { brain: { regrowthRate: 0 } },
    'regrow1':           { brain: { regrowthRate: 1 } },
    'prune0':            { brain: { pruningThreshold: 0 } },
    'prune0.02':         { brain: { pruningThreshold: 0.02 } },
    // --- batch c: budget
    'target1.5':         { brain: S({ targetSum: 1.5 }) },
    'target6':           { brain: S({ targetSum: 6 }) },
    'target12':          { brain: S({ targetSum: 12 }) },
    'keepTick-scaleOn':  { brain: {}, keepTick: true },          // scaling really fires (tickCount preserved over resets)
    'keepTick-scaleOff': { brain: S({ synapticScaling: false }), keepTick: true },
    // --- batch d: phase A length
    'cEp0':              { brain: {}, conceptEpochs: 0 },
    'cEp20':             { brain: {}, conceptEpochs: 20 },
    'cEp50':             { brain: {}, conceptEpochs: 50 },
    'frozen-cEp50':      { brain: FROZEN, conceptEpochs: 50 },
    // --- batch e: app-realistic, no reset between items (10-tick settle gap); measured without reset too
    'nr-frozen':         { brain: FROZEN, reset: false },
    'nr-default':        { brain: {}, reset: false },
    'nr-scaleOff':       { brain: S({ synapticScaling: false }), reset: false },
    'nr-asLoaded-frozen':  { brain: FROZEN, reset: false, paramMode: 'asLoaded' },
    'nr-asLoaded-default': { brain: {}, reset: false, paramMode: 'asLoaded' },
};
const BATCH = {
    a: ['naive', 'frozen', 'frozen-noAdaptThr', 'default', 'noWordPlast'],
    a2: ['asLoaded-frozen', 'asLoaded-default', 'cEp0'],
    b: ['lr0.001', 'lr0.05', 'regrow0', 'regrow1'],
    c: ['prune0', 'prune0.02', 'target1.5', 'target6'],
    d: ['cEp20', 'cEp50', 'frozen-cEp50'],
    e: ['target12', 'nr-frozen', 'nr-default', 'nr-scaleOff'],
};

const batch = process.argv[2] || 'a';
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const all = loadJson('sweep-results.json') || {};
const t0 = Date.now();

for (const name of BATCH[batch]) {
    const cfg = CONDS[name];
    const runs = seeds.map(seed => ({ seed, ...runProtocol({ dataset: 'medium', seed, skipM0: true, ...cfg }) }));
    all[name] = { cfg, runs };
    const col = (m, k, d) => ms(runs.map(r => r[m][k]), d);
    console.log(`\n== ${name}  (${runs[0].ticks} ticks, ${Math.round(runs.reduce((a, r) => a + r.ms, 0) / 1000)} s)`);
    for (const m of ['m1', 'm2']) {
        console.log(`  ${m} sep ${col(m, 'sepFull')}/${col(m, 'sepPartial')} lin ${col(m, 'linFull')}/${col(m, 'linPartial')} pairCos ${col(m, 'pairCos')} cosOwn-Other ${col(m, 'cosMargin')}` +
            ` | concept ${col(m, 'conceptAcc')} sel ${col(m, 'selFrac')} resp ${col(m, 'respFrac')} selIdx ${col(m, 'selIdx', 3)} wIn/wOut ${col(m, 'wIn', 3)}/${col(m, 'wOut', 3)}` +
            ` | rate ${col(m, 'rate', 3)} act ${col(m, 'activeFrac')} conns ${col(m, 'conns', 0)} exc ${col(m, 'exc', 0)} inh ${col(m, 'inh', 0)} |w| ${col(m, 'meanAbs', 3)} max ${col(m, 'maxAbs')} thr ${col(m, 'meanThr')}` +
            (m === 'm2' ? ` | readout ${col(m, 'evFull')}/${col(m, 'evPartial')}` : ''));
    }
    saveJson('sweep-results.json', all);
}
console.log(`\ntotal ${Math.round((Date.now() - t0) / 1000)} s`);
