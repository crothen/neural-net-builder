// Generic frozen-brain config runner (used mostly for the `full` dataset and the word-count / wiring sweeps).
//   node experiments/scale/full.mjs <tag> <seeds> <cfg> [<cfg> ...]
//   cfg = dataset:nWords:n:coverage:inputWeight:localizer:synapses      ('d' = default; inputWeight 'd' = engine uniform [0,0.5],
//         a number x = uniform [0, x])
// Results are appended to runs.json under "<tag>|<cfg>".
import { frozenRun, agg, f, saveJson, loadJson, loadDataset, subsetWords } from './common.mjs';

const tag = process.argv[2];
const seeds = process.argv[3].split(',').map(Number);
const cfgs = process.argv.slice(4);
const out = 'runs.json';
const all = loadJson(out, {});
const KEYS = ['linFull', 'linPartial', 'linHalf', 'ncFull', 'ncPartial', 'ncHalf', 'meanPairCos', 'rate', 'activeFrac', 'satFrac', 'meanThr', 'buildMs', 'ms', 'conns'];
const cache = {};

for (const spec of cfgs) {
    const [dn, nw, n, cov, w, loc, syn] = spec.split(':');
    const base = cache[dn] || (cache[dn] = loadDataset(dn));
    const dataset = nw === 'd' || nw === undefined ? base : subsetWords(base, Number(nw));
    const big = dn === 'full';
    const brain = { nodeCount: Number(n) };
    if (syn && syn !== 'd') brain.synapsesPerNode = Number(syn);
    const inputLink = {};
    if (cov && cov !== 'd') inputLink.coverage = Number(cov);
    if (loc && loc !== 'd') inputLink.localizer = Number(loc);
    const inputWeight = w && w !== 'd' ? { min: 0, max: Number(w) } : undefined;
    const measure = big ? { trainReps: 2, maxPartial: 1, halfCues: 2 } : {};
    const rows = seeds.map(seed => frozenRun({ dataset, seed, brain, inputLink, inputWeight, measure }));
    const a = agg(rows, KEYS);
    all[`${tag}|${spec}`] = { tag, spec, dataset: dn, nWords: dataset.words.length, seeds, agg: a, rows };
    console.log(`${spec.padEnd(28)} W=${dataset.words.length} | lin ${f(a.linFull)} / ${f(a.linPartial)} / half ${f(a.linHalf)} | nc ${f(a.ncFull)} / ${f(a.ncPartial)} / half ${f(a.ncHalf)} | cos ${f(a.meanPairCos)} | rate ${f(a.rate)} act ${f(a.activeFrac)} sat ${f(a.satFrac)} thr ${f(a.meanThr)} | conns ${a.conns.mean} build ${a.buildMs.mean}ms run ${a.ms.mean}ms`);
    saveJson(out, all);
}
