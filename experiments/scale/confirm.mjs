// Confirm a few sizes with the harness's runStandard (brain plasticity ON, two-phase protocol).
//   node experiments/scale/confirm.mjs <seeds> <cfg> ...     cfg = dataset:n:conceptEpochs:wordEpochs[:coverage]
import { runStandard } from '../lib/harness.mjs';
import { agg, f, saveJson, loadJson } from './common.mjs';

const seeds = process.argv[2].split(',').map(Number);
const all = loadJson('confirm.json', {});
for (const spec of process.argv.slice(3)) {
    const [dataset, n, ce, we, cov] = spec.split(':');
    const rows = seeds.map(seed => {
        const r = runStandard({ dataset, seed, brain: { nodeCount: Number(n) }, conceptEpochs: Number(ce), wordEpochs: Number(we), inputLink: cov ? { coverage: Number(cov) } : undefined });
        return {
            beforeFull: r.before.full, beforePartial: r.before.partial, afterFull: r.after.full, afterPartial: r.after.partial, afterCos: r.after.meanPairCos,
            linFull: r.linear.full, linPartial: r.linear.partial, readFull: r.eval.fullDrive, readPartial: r.eval.partialDrive, readFire: r.eval.fullFire,
            rate: r.eval.rate, activeFrac: r.eval.activeFrac, conceptAcc: r.concept.accuracy, conns: r.weights.internalConns, meanAbsW: r.weights.meanAbs, ms: r.ms, ticks: r.ticks,
        };
    });
    const a = agg(rows, Object.keys(rows[0]));
    all[spec] = { spec, seeds, agg: a, rows };
    console.log(`${spec.padEnd(18)} | nc before ${f(a.beforeFull)}/${f(a.beforePartial)} after ${f(a.afterFull)}/${f(a.afterPartial)} cos ${f(a.afterCos)} | lin ${f(a.linFull)}/${f(a.linPartial)} | readout drive ${f(a.readFull)}/${f(a.readPartial)} fire ${f(a.readFire)} | rate ${f(a.rate)} act ${f(a.activeFrac)} | internal conns ${a.conns.mean} | ${a.ticks.mean} ticks ${a.ms.mean}ms`);
    saveJson('confirm.json', all);
}
