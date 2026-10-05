// `full` dataset with brain plasticity ON during word presentations (runStandard is unaffordable on `full`:
// its evaluate() runs ~10k leave-one-out cues). Trains `epochs` passes over the words, then the frozen measure().
//   node experiments/scale/fullplastic.mjs <seeds> <n> <coverage> <epochs> [dataset=full]
import { buildNet, present, resetState, shuffled, brainWeightStats } from '../lib/harness.mjs';
import { measure, agg, f, saveJson, loadJson, loadDataset } from './common.mjs';

const seeds = process.argv[2].split(',').map(Number);
const n = Number(process.argv[3]), cov = Number(process.argv[4]), epochs = Number(process.argv[5]);
const dataset = loadDataset(process.argv[6] || 'full');
const big = dataset.name === 'full';
const rows = seeds.map(seed => {
    const ctx = buildNet({ nConcepts: dataset.concepts.length, seed, brain: { nodeCount: n }, inputLink: { coverage: cov } });
    const w0 = brainWeightStats(ctx);
    const t0 = Date.now(); let ticks = 0;
    for (let e = 0; e < epochs; e++) for (const wi of shuffled(dataset.words.map((_, i) => i))) { resetState(ctx); present(ctx, dataset.words[wi].concepts, 40); ticks += 40; }
    const trainMs = Date.now() - t0;
    const w1 = brainWeightStats(ctx);
    const m = measure(ctx, dataset, big ? { trainReps: 2, maxPartial: 1, halfCues: 2 } : {});
    return { ...m, trainMsPerTick: trainMs / ticks, connsBefore: w0.internalConns, connsAfter: w1.internalConns, meanAbsBefore: w0.meanAbs, meanAbsAfter: w1.meanAbs };
});
const a = agg(rows, Object.keys(rows[0]));
const all = loadJson('fullplastic.json', {});
all[`${dataset.name}|${n}|${cov}|${epochs}`] = { n, cov, epochs, seeds, agg: a, rows };
saveJson('fullplastic.json', all);
console.log(`${dataset.name} n=${n} cov=${cov} epochs=${epochs} | lin ${f(a.linFull)} / ${f(a.linPartial)} / half ${f(a.linHalf)} | nc ${f(a.ncFull)} / ${f(a.ncPartial)} / half ${f(a.ncHalf)} | cos ${f(a.meanPairCos)} rate ${f(a.rate)} thr ${f(a.meanThr)} | internal conns ${a.connsBefore.mean} -> ${a.connsAfter.mean}, mean|w| ${a.meanAbsBefore.mean} -> ${a.meanAbsAfter.mean} | train ${a.trainMsPerTick.mean} ms/tick`);
