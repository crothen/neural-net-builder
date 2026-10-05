// Final comparison table (offline replay, 5 seeds, plastic and frozen brain during word training, 20 word epochs).
//   node experiments/readout/table.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadTrace, replayMany, fmt, HERE } from './lib.mjs';
const seeds = [1, 2, 3, 4, 5];
const cfgs = [
    ['baseline perceptron lr .05, node d=.1, norm', { rule: 'perceptron', lr: 0.05 }],
    ['hebb lr .05, node d=.1, norm', { rule: 'hebb', lr: 0.05, forceTeacher: true }],
    ['perceptron lr .5 (only lr scaled), d=.1, norm', { rule: 'perceptron', lr: 0.5 }],
    ['perceptron lr .02, d=.95, norm', { rule: 'perceptron', lr: 0.02, node: { decay: 0.95 } }],
    ['margin perceptron m=1/.5 lr .1, d=.95, norm', { rule: 'margin', margin: 1, marginLo: 0.5, lr: 0.1, node: { decay: 0.95 } }],
    ['hebb + L2 norm, th=1.2 d=.5, sum', { rule: 'hebbL2', lr: 0.05, l2: 1, normalize: false, node: { decay: 0.5, threshold: 1.2 } }],
    ['hebb + anti .1, w in [-1,1], d=.9, sum', { rule: 'hebbAnti', lr: 0.01, anti: 0.1, wMin: -1, wMax: 1, normalize: false, node: { decay: 0.9 } }],
    ['delta hi=3 lr 2, d=.1 (no integration), norm', { rule: 'delta2', lr: 2, hi: 3 }],
    ['delta hi=2 lr .04, d=.95, norm', { rule: 'delta2', lr: 0.04, hi: 2, node: { decay: 0.95 } }],
    ['delta hi=3 lr .04, d=.9, norm', { rule: 'delta2', lr: 0.04, hi: 3, node: { decay: 0.9 } }],
    ['DELTA hi=3 lr .04, d=.95, norm  (recommended)', { rule: 'delta2', lr: 0.04, hi: 3, node: { decay: 0.95 } }],
    ['delta hi=3 lr .0002, d=.95, sum (same thing)', { rule: 'delta2', lr: 0.0002, hi: 3, normalize: false, node: { decay: 0.95 } }],
    ['delta hi=3 lr .04, d=.95, norm, coverage 0.3', { rule: 'delta2', lr: 0.04, hi: 3, coverage: 0.3, node: { decay: 0.95 } }],
    ['delta + pre trace hi=3 lr .004, d=.95, norm', { rule: 'delta2', useTrace: true, lr: 0.004, hi: 3, node: { decay: 0.95 } }],
];
const out = [];
for (const plastic of [true, false]) {
    console.log(`=== brain ${plastic ? 'PLASTIC' : 'FROZEN'} in word phase | per dataset: fullDrive fullFire partialDrive partialFire exclusive | hard-WTA fullFire exclusive`);
    const T = { tiny: seeds.map(s => loadTrace('tiny', s, plastic)), medium: seeds.map(s => loadTrace('medium', s, plastic)) };
    for (const [label, cfg] of cfgs) {
        const row = { label, plastic, cfg }; let line = label.padEnd(48);
        for (const ds of ['tiny', 'medium']) { const s = row[ds] = replayMany(T[ds], cfg); line += ` ${ds[0].toUpperCase()} ${fmt(s.fullDrive.mean)}(${fmt(s.fullDrive.min)}) ${fmt(s.fullFire.mean)}(${fmt(s.fullFire.min)}) ${fmt(s.partialDrive.mean)} ${fmt(s.partialFire.mean)} ${fmt(s.exclusive.mean)} | ${fmt(s.fullFireWta.mean)} ${fmt(s.exclusiveWta.mean)} ||`; }
        console.log(line); out.push(row);
    }
}
fs.writeFileSync(path.join(HERE, 'results-table.json'), JSON.stringify(out, null, 1));
