// Sanity check: my fused measure() against the harness's own brainSeparability / linearCeiling (medium, 200 neurons).
import { buildNet, brainSeparability, linearCeiling, loadDataset } from '../lib/harness.mjs';
import { measure } from './common.mjs';

const dataset = loadDataset(process.argv[2] || 'medium');
const n = Number(process.argv[3] || 200);
for (const seed of [1, 2, 3]) {
    const brain = { nodeCount: n, hebbianLearning: false, sustainability: { synapticScaling: false } };
    let ctx = buildNet({ nConcepts: dataset.concepts.length, seed, brain });
    const t0 = Date.now();
    const bs = brainSeparability(ctx, dataset); const lc = linearCeiling(ctx, dataset);
    const t1 = Date.now();
    ctx = buildNet({ nConcepts: dataset.concepts.length, seed, brain });
    const m0 = measure(ctx, dataset, { warmupReps: 0 });
    ctx = buildNet({ nConcepts: dataset.concepts.length, seed, brain });
    const m1 = measure(ctx, dataset, { warmupReps: 1 });
    console.log(`seed ${seed} harness: nc ${bs.full.toFixed(2)}/${bs.partial.toFixed(2)} cos ${bs.meanPairCos.toFixed(2)} lin ${lc.full.toFixed(2)}/${lc.partial.toFixed(2)} (${t1 - t0}ms)` +
        ` | mine w0: nc ${m0.ncFull.toFixed(2)}/${m0.ncPartial.toFixed(2)} cos ${m0.meanPairCos.toFixed(2)} lin ${m0.linFull.toFixed(2)}/${m0.linPartial.toFixed(2)} (${m0.ms}ms)` +
        ` | mine w1: nc ${m1.ncFull.toFixed(2)}/${m1.ncPartial.toFixed(2)} lin ${m1.linFull.toFixed(2)}/${m1.linPartial.toFixed(2)} rate ${m1.rate.toFixed(3)} thr ${m1.meanThr.toFixed(2)}`);
}
