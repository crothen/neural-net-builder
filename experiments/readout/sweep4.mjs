// Sweep 4: do the best delta-rule candidates converge to 1.00 with more training? Plastic and frozen brain. Lists the failures.
//   node experiments/readout/sweep4.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadTrace, replay, meanSd, fmt, HERE } from './lib.mjs';
import { loadDataset } from '../lib/harness.mjs';

const seeds = [1, 2, 3, 4, 5];
const results = [];
const cands = [
    ['delta d=0.9 hi=3 lr=2e-4', { rule: 'delta2', lr: 2e-4, hi: 3, node: { decay: 0.9 } }],
    ['delta d=0.95 hi=3 lr=1e-4', { rule: 'delta2', lr: 1e-4, hi: 3, node: { decay: 0.95 } }],
    ['delta d=0.95 hi=3 lr=2e-4', { rule: 'delta2', lr: 2e-4, hi: 3, node: { decay: 0.95 } }],
    ['delta+trace d=0.95 hi=3 lr=1e-5', { rule: 'delta2', useTrace: true, lr: 1e-5, hi: 3, node: { decay: 0.95 } }],
    ['delta+trace d=0.95 hi=3 lr=2e-5', { rule: 'delta2', useTrace: true, lr: 2e-5, hi: 3, node: { decay: 0.95 } }],
];
for (const plastic of [true, false]) {
    console.log(`=== brain ${plastic ? 'PLASTIC' : 'FROZEN'} during word training. columns: fullDrive fullFire partialDrive partialFire exclusive | WTA fullFire partialFire exclusive`);
    for (const [label, base] of cands) for (const passes of [1, 2, 4]) {
        const row = { label, plastic, passes, cfg: base }; let out = `${label.padEnd(32)} x${passes} `; const fails = [];
        for (const ds of ['tiny', 'medium']) {
            const D = loadDataset(ds);
            const rs = seeds.map(s => { const r = replay(loadTrace(ds, s, plastic), { ...base, passes, normalize: false }); for (const f of r.wrongFire) fails.push(`${ds}/s${s}:${D.words[f.word].word}->${f.got >= 0 ? D.words[f.got].word : 'tie/none'}(${f.ownTicks}v${f.bestOtherTicks})`); return r; });
            const m = (k) => meanSd(rs.map(r => r[k]));
            row[ds] = Object.fromEntries(['fullDrive', 'fullFire', 'partialDrive', 'partialFire', 'exclusive', 'fullFireWta', 'partialFireWta', 'exclusiveWta', 'duty', 'othersDuty'].map(k => [k, m(k)]));
            const c = row[ds];
            out += `${ds[0].toUpperCase()} ${fmt(c.fullDrive.mean)} ${fmt(c.fullFire.mean)} ${fmt(c.partialDrive.mean)} ${fmt(c.partialFire.mean)} ${fmt(c.exclusive.mean)} | ${fmt(c.fullFireWta.mean)} ${fmt(c.partialFireWta.mean)} ${fmt(c.exclusiveWta.mean)} || `;
        }
        row.fireFailures = fails; results.push(row);
        console.log(out + fails.join(' '));
    }
}
fs.writeFileSync(path.join(HERE, 'results-sweep4.json'), JSON.stringify(results, null, 1));
