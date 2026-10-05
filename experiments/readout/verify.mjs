// Verify the recommended readout through the REAL harness (runStandard + evaluate), not the replay.
//   node experiments/readout/verify.mjs <wordEpochs=20> <plastic: 1|0|both> [seeds=1,2,3] [lr=0.04] [decay=0.95] [hi=3] [datasets=tiny,medium]
import fs from 'node:fs';
import path from 'node:path';
import { runStandard } from '../lib/harness.mjs';
import { HERE, meanSd, fmt } from './lib.mjs';

const wordEpochs = Number(process.argv[2] || 20);
const pl = process.argv[3] || 'both';
const seeds = (process.argv[4] || '1,2,3').split(',').map(Number);
const lr = Number(process.argv[5] || 0.04);
const decay = Number(process.argv[6] || 0.95);
const hi = Number(process.argv[7] || 3);
const datasets = (process.argv[8] || 'tiny,medium').split(',');

/** Delta rule on the word node's potential. Local: pre activation, own potential, teacher bit. */
export function deltaRule({ lr, hi }) {
    return (ctx, taught) => {
        const r = ctx.readout, target = hi * r.node.threshold, pre = ctx.brainNodes;
        for (let w = 0; w < r.nWords; w++) {
            const err = (w === taught ? target : 0) - r.potential[w];   // potential is clipped at 0, so err <= 0 for other words
            if (err === 0) continue;
            const Ww = r.W[w], m = r.mask[w];
            for (let i = 0; i < pre.length; i++) if (m[i] && pre[i].activation > 0) Ww[i] += lr * err * pre[i].activation;
        }
    };
}

const out = [];
for (const plastic of pl === 'both' ? [true, false] : [pl === '1']) for (const dataset of datasets) {
    const rows = seeds.map(seed => {
        const r = runStandard({ dataset, seed, wordEpochs, plasticDuringWords: plastic, linear: false,
            readout: { normalize: true, node: { threshold: 0.5, decay, maxPotential: 3 } }, learn: { rule: deltaRule({ lr, hi }) } });
        console.log(`${dataset} seed ${seed} plastic ${plastic} epochs ${wordEpochs}: drive ${fmt(r.eval.fullDrive)}/${fmt(r.eval.partialDrive)} fire ${fmt(r.eval.fullFire)}/${fmt(r.eval.partialFire)} brain ${fmt(r.after.full)}/${fmt(r.after.partial)} wrong ${JSON.stringify(r.eval.wrong)} ${r.ms} ms`);
        return { seed, ...r.eval, brainFull: r.after.full, brainPartial: r.after.partial };
    });
    const s = Object.fromEntries(['fullDrive', 'fullFire', 'partialDrive', 'partialFire', 'brainFull', 'brainPartial'].map(k => [k, meanSd(rows.map(r => r[k]))]));
    console.log(`== ${dataset} plastic ${plastic} epochs ${wordEpochs} lr ${lr} decay ${decay} hi ${hi}: fullDrive ${fmt(s.fullDrive.mean)}±${fmt(s.fullDrive.sd)} fullFire ${fmt(s.fullFire.mean)}±${fmt(s.fullFire.sd)} partialDrive ${fmt(s.partialDrive.mean)}±${fmt(s.partialDrive.sd)} partialFire ${fmt(s.partialFire.mean)}±${fmt(s.partialFire.sd)} | brain ceiling partial ${fmt(s.brainPartial.mean)}`);
    out.push({ dataset, plastic, wordEpochs, lr, decay, hi, normalize: true, seeds, summary: s, rows });
}
const f = path.join(HERE, 'results-verify.json');
const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
fs.writeFileSync(f, JSON.stringify(prev.concat(out), null, 1));
