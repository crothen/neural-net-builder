// Sweep 3: delta rule refinements - non-target gain, presynaptic eligibility trace, more training, winner-take-all output.
//   node experiments/readout/sweep3.mjs
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
const cell = (s) => `${fmt(s.fullDrive.mean)} ${fmt(s.fullFire.mean)} ${fmt(s.partialDrive.mean)} ${fmt(s.partialFire.mean)} ${fmt(s.exclusive.mean)} ${fmt(s.othersDuty.mean)} |wta ${fmt(s.fullFireWta.mean)} ${fmt(s.partialFireWta.mean)} ${fmt(s.exclusiveWta.mean)}`;

for (const d of [0.9, 0.95]) for (const hi of [2, 3]) for (const negGain of [1, 3]) for (const passes of [1, 2]) {
    const node = { decay: d, maxPotential: 3 };
    for (const lr of [5e-5, 1e-4, 2e-4, 5e-4]) run(`delta2 d=${d} hi=${hi} neg=${negGain} x${passes} lr=${lr}`, { rule: 'delta2', lr, hi, negGain, passes, normalize: false, node });
    for (const lr of [5e-6, 1e-5, 2e-5, 5e-5]) run(`delta2+trace d=${d} hi=${hi} neg=${negGain} x${passes} lr=${lr}`, { rule: 'delta2', useTrace: true, lr, hi, negGain, passes, normalize: false, node });
}
results.sort((a, b) => b.score - a.score);
console.log('columns per dataset: fullDrive fullFire partialDrive partialFire exclusive othersDuty | with hard WTA: fullFire partialFire exclusive   (mean of 5 seeds, brain plastic)');
for (const r of results.slice(0, 45)) console.log(`${r.label.padEnd(44)} T ${cell(r.tiny)} || M ${cell(r.medium)}`);
fs.writeFileSync(path.join(HERE, 'results-sweep3.json'), JSON.stringify(results, null, 1));
