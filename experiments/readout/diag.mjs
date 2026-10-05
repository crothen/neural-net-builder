// Hypothesis check: why does the baseline readout fail?
//   node experiments/readout/diag.mjs
import fs from 'node:fs';
import path from 'node:path';
import { runStandard, loadDataset } from '../lib/harness.mjs';
import { loadTrace, replay, HERE } from './lib.mjs';

const out = { check: [], baseline: [] };

// 1. Replay == real harness? (tiny, seeds 1-3, default perceptron)
for (const seed of [1, 2, 3]) {
    const real = runStandard({ dataset: 'tiny', seed, linear: false }).eval;
    const rp = replay(loadTrace('tiny', seed, true), { rule: 'perceptron', lr: 0.05 });
    const row = { seed, real: [real.fullDrive, real.partialDrive, real.fullFire], replay: [rp.fullDrive, rp.partialDrive, rp.fullFire], realWrong: real.wrong };
    out.check.push(row);
    console.log('harness vs replay', JSON.stringify(row));
}

// 2. Baseline anatomy
for (const ds of ['tiny', 'medium']) {
    const dataset = loadDataset(ds);
    const isSubset = (a, b) => dataset.words[a].concepts.every(c => dataset.words[b].concepts.includes(c));
    for (const seed of [1, 2, 3, 4, 5]) {
        const tr = loadTrace(ds, seed, true);
        const p = replay(tr, { rule: 'perceptron', lr: 0.05 });
        const h = replay(tr, { rule: 'hebb', lr: 0.05, forceTeacher: true });
        let same = true; for (let w = 0; w < tr.nWords && same; w++) for (let i = 0; i < tr.nBrain; i++) if (p.W[w][i] !== h.W[w][i]) { same = false; break; }
        const wrong = p.wrong.map(([w, g]) => ({ word: dataset.words[w].word, got: g >= 0 ? dataset.words[g].word : null, gotIsSuperset: g >= 0 && isSubset(w, g) }));
        const row = {
            ds, seed, fullDrive: p.fullDrive, fullFire: p.fullFire, maxPotentialInTraining: +p.maxPotTrain.toFixed(4), threshold: 0.5,
            ticksAnyNodeFired: p.trainFireTicks, weightsIdenticalToHebb: same, wMaxAbs: +p.wMaxAbs.toFixed(2),
            nWrong: wrong.length, wrongToSuperset: wrong.filter(x => x.gotIsSuperset).length, wrong,
        };
        out.baseline.push(row);
        console.log(JSON.stringify(row));
    }
}
fs.writeFileSync(path.join(HERE, 'results-diag.json'), JSON.stringify(out, null, 1));
