// Record brain activity traces with the real engine (see lib.mjs).
//   node experiments/readout/record.mjs <dataset> <seeds e.g. 1,2,3> <plastic: 1|0|both> [wordEpochs=20] [tag]
import fs from 'node:fs';
import { record, tracePath, TRACE_DIR } from './lib.mjs';

const ds = process.argv[2] || 'tiny';
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const pl = process.argv[4] || 'both';
const wordEpochs = Number(process.argv[5] || 20);
const tag = process.argv[6] || '';
fs.mkdirSync(TRACE_DIR, { recursive: true });

for (const plastic of pl === 'both' ? [true, false] : [pl === '1']) {
    for (const seed of seeds) {
        const t0 = Date.now();
        const tr = record({ dataset: ds, seed, plasticDuringWords: plastic, wordEpochs });
        fs.writeFileSync(tracePath(ds, seed, plastic, tag), JSON.stringify(tr));
        let n = 0, ticks = 0; for (const p of tr.train) for (const t of p.ticks) { n += t.length; ticks++; }
        console.log(`${ds} seed ${seed} plastic ${plastic}: ${ticks} train ticks, mean active ${(n / ticks).toFixed(1)}/${tr.nBrain}, nonUnit ${tr.nonUnit}, eval trials ${tr.eval.length}, ${Date.now() - t0} ms`);
    }
}
