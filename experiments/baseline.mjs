// Baseline: the app's default brain on each dataset, with the standard two-phase protocol.
//   node experiments/baseline.mjs [dataset ...]
import { runStandard } from './lib/harness.mjs';

const datasets = process.argv.slice(2).length ? process.argv.slice(2) : ['tiny'];
const fmt = (x) => (x === null || x === undefined ? ' n/a' : x.toFixed(2));

for (const dataset of datasets) {
    for (const paramMode of ['full', 'asLoaded']) {
        for (const seed of [1, 2, 3]) {
            const r = runStandard({ dataset, seed, paramMode });
            console.log(
                `${dataset.padEnd(6)} ${paramMode.padEnd(8)} seed ${seed} | brain ceiling before ${fmt(r.before.full)}/${fmt(r.before.partial)} after ${fmt(r.after.full)}/${fmt(r.after.partial)} (pairCos ${fmt(r.after.meanPairCos)})` +
                ` | linear ${fmt(r.linear.full)}/${fmt(r.linear.partial)} | readout drive ${fmt(r.eval.fullDrive)}/${fmt(r.eval.partialDrive)} fire ${fmt(r.eval.fullFire)}/${fmt(r.eval.partialFire)}` +
                ` | concepts ${fmt(r.concept.accuracy)} silent ${r.concept.silentConcepts} | rate ${r.eval.rate.toFixed(3)} active ${fmt(r.eval.activeFrac)}` +
                ` | conns ${r.weights.internalConns} | ${r.ticks} ticks ${r.ms} ms`
            );
        }
    }
}
