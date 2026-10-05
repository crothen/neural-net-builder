// Sanity check: dynamics/lib.mjs measure() vs the harness's own brainSeparability/linearCeiling, default brain,
// plus paramMode comparison (full / asApp / asLoaded) for the default config with the brain held fixed.
//   node experiments/dynamics/check.mjs [dataset=medium]
import { brainSeparability, linearCeiling } from '../lib/harness.mjs';
import { build, measure, ds, stats, runGroup } from './lib.mjs';

const dataset = process.argv[2] || 'medium';
const t0 = Date.now();
const per = [1, 2, 3].map(seed => {
    const ctx = build({}, ds(dataset), seed);
    const sep = brainSeparability(ctx, ds(dataset));
    const lin = linearCeiling(ctx, ds(dataset));
    return { linFull: lin.full, linPart: lin.partial, sepFull: sep.full, sepPart: sep.partial, pairCos: sep.meanPairCos };
});
console.log('harness functions:', JSON.stringify(stats(per)), `${Date.now() - t0} ms`);
const t1 = Date.now();
const mine = [1, 2, 3].map(seed => measure({}, dataset, seed));
console.log('measure()        :', JSON.stringify(stats(mine)), `${Date.now() - t1} ms`);

runGroup('parammode', dataset, [
    ['default full', { paramMode: 'full' }],
    ['default asApp', { paramMode: 'asApp' }],
    ['default asLoaded', { paramMode: 'asLoaded' }],
    ['full, adaptive off', { brain: { sustainability: { adaptiveThreshold: false } } }],
    ['full, fatigue 0', { brain: { fatigue: 0, recovery: 0 } }],
    ['full, adaptive off + fatigue 0', { brain: { fatigue: 0, recovery: 0, sustainability: { adaptiveThreshold: false } } }],
]);
