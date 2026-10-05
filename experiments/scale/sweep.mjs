// Brain size sweep, frozen brain, default parameters.
//   node experiments/scale/sweep.mjs <datasets=tiny,medium,short> <sizes=25,50,100,200,400,800> <seeds=1,2,3> [tag]
import { frozenRun, agg, f, saveJson, loadJson, loadDataset } from './common.mjs';

const datasets = (process.argv[2] || 'tiny,medium,short').split(',');
const sizes = (process.argv[3] || '25,50,100,200,400,800').split(',').map(Number);
const seeds = (process.argv[4] || '1,2,3').split(',').map(Number);
const out = 'sweep.json';
const all = loadJson(out, {});
const KEYS = ['linFull', 'linPartial', 'ncFull', 'ncPartial', 'meanPairCos', 'rate', 'activeFrac', 'satFrac', 'meanThr', 'buildMs', 'ms'];

for (const dn of datasets) {
    const dataset = loadDataset(dn);
    for (const n of sizes) {
        const rows = seeds.map(seed => frozenRun({ dataset, seed, brain: { nodeCount: n } }));
        const a = agg(rows, KEYS);
        all[`${dn}|${n}`] = { dataset: dn, n, seeds, agg: a, rows };
        console.log(`${dn.padEnd(7)} n=${String(n).padStart(4)} | lin ${f(a.linFull)} / ${f(a.linPartial)} | nc ${f(a.ncFull)} / ${f(a.ncPartial)} | cos ${f(a.meanPairCos)} | rate ${f(a.rate)} active ${f(a.activeFrac)} sat ${f(a.satFrac)} thr ${f(a.meanThr)} | build ${a.buildMs.mean}ms run ${a.ms.mean}ms`);
        saveJson(out, all);
    }
}
