// How long does teaching the words take? Times the teaching loop only, and checks accuracy after each epoch count.
//   node experiments/timing.mjs [dataset=short] [size=200] [seeds=21,22,23]
import fs from 'node:fs';
import { buildNet, attachReadout, present, resetState, evaluate, loadDataset, shuffled } from './lib/harness.mjs';
import { genomeToBuild } from './evolve/fitness.mjs';

const dsName = process.argv[2] || 'short';
const size = Number(process.argv[3] || 200);
const seeds = (process.argv[4] || '21,22,23').split(',').map(Number);
const TICKS = 40;
const genome = JSON.parse(fs.readFileSync(new URL('./evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const ds = loadDataset(dsName);
const checkpoints = [1, 2, 3, 5, 10, 20];
const rows = checkpoints.map(() => ({ ms: [], full: [], partial: [] }));
const build = [];

for (const seed of seeds) {
    let t0 = performance.now();
    const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...genomeToBuild(genome, size) });
    attachReadout(ctx, { nWords: ds.words.length, coverage: genome.readoutCoverage, normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } });
    build.push(performance.now() - t0);

    let trainMs = 0, epoch = 0;
    checkpoints.forEach((target, k) => {
        t0 = performance.now();
        for (; epoch < target; epoch++) {
            for (const wi of shuffled(ds.words.map((_, i) => i))) {
                resetState(ctx);
                present(ctx, ds.words[wi].concepts, TICKS, { teacher: wi, learn: { rule: 'delta', lr: 0.004, nlms: true } });
            }
        }
        trainMs += performance.now() - t0; // evaluation below is not counted
        const ev = evaluate(ctx, ds, { ticks: TICKS });
        rows[k].ms.push(trainMs); rows[k].full.push(ev.fullFire); rows[k].partial.push(ev.partialFire);
    });
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`${dsName}: ${ds.words.length} words, ${ds.concepts.length} concepts, brain ${size}, ${TICKS} ticks per presentation, ${seeds.length} seeds`);
console.log(`build network: ${mean(build).toFixed(0)} ms`);
checkpoints.forEach((e, k) => {
    const ticks = e * ds.words.length * TICKS;
    console.log(`${String(e).padStart(2)} epochs = ${String(ticks).padStart(6)} ticks: ${mean(rows[k].ms).toFixed(0).padStart(6)} ms (${(mean(rows[k].ms) / ticks).toFixed(3)} ms/tick) | full cue ${(mean(rows[k].full) * 100).toFixed(0)}% | one concept missing ${(mean(rows[k].partial) * 100).toFixed(0)}%`);
});
