// Sweep 2: error-corrective rules with an INTEGRATING output node (retention 0.8-0.95) and properly scaled lr.
//   node experiments/readout/sweep2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadTrace, replayMany, fmt, HERE } from './lib.mjs';

const seeds = [1, 2, 3, 4, 5];
const T = { tiny: seeds.map(s => loadTrace('tiny', s, true)), medium: seeds.map(s => loadTrace('medium', s, true)) };
const results = [];
function run(label, cfg) {
    const row = { label, cfg: { ...cfg } };
    for (const ds of ['tiny', 'medium']) row[ds] = replayMany(T[ds], cfg);
    row.score = Math.min(row.tiny.fullDrive.mean, row.medium.fullDrive.mean) + Math.min(row.tiny.fullFire.mean, row.medium.fullFire.mean) + 0.25 * (row.tiny.partialFire.mean + row.medium.partialFire.mean) / 2;
    results.push(row);
}
const cell = (s) => `${fmt(s.fullDrive.mean)} ${fmt(s.fullFire.mean)} ${fmt(s.partialDrive.mean)} ${fmt(s.partialFire.mean)} ${fmt(s.exclusive.mean)} ${fmt(s.duty.mean)} ${fmt(s.othersDuty.mean)}`;

for (const d of [0.8, 0.9, 0.95]) for (const lr of [2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3]) {
    const node = { decay: d, maxPotential: 3 };
    run(`perceptron d=${d} lr=${lr}`, { rule: 'perceptron', lr, normalize: false, node });
    for (const hi of [2, 3, 4]) run(`delta hi=${hi} d=${d} lr=${lr}`, { rule: 'delta', lr, hi, normalize: false, node });
    for (const margin of [0.5, 1, 2]) run(`margin m=${margin}/0.5 d=${d} lr=${lr}`, { rule: 'margin', lr, margin, marginLo: 0.5, normalize: false, node });
    for (const margin of [1, 2]) run(`margin m=${margin}/1.0 d=${d} lr=${lr}`, { rule: 'margin', lr, margin, marginLo: 1, normalize: false, node });
}
results.sort((a, b) => b.score - a.score);
console.log('columns per dataset: fullDrive fullFire partialDrive partialFire exclusive duty othersDuty   (mean of 5 seeds, brain plastic)');
for (const r of results.slice(0, 40)) console.log(`${r.label.padEnd(34)} tiny ${cell(r.tiny)} | medium ${cell(r.medium)}`);
console.log('...worst 5'); for (const r of results.slice(-5)) console.log(`${r.label.padEnd(34)} tiny ${cell(r.tiny)} | medium ${cell(r.medium)}`);
fs.writeFileSync(path.join(HERE, 'results-sweep2.json'), JSON.stringify(results, null, 1));
