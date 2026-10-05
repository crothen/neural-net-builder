// Sweep 1: rule families x output-node settings (offline replay on recorded traces, 5 seeds, brain plastic during words).
//   node experiments/readout/sweep1.mjs
import fs from 'node:fs';
import path from 'node:path';
import { loadTrace, replayMany, line, HERE } from './lib.mjs';

const seeds = [1, 2, 3, 4, 5];
const T = { tiny: seeds.map(s => loadTrace('tiny', s, true)), medium: seeds.map(s => loadTrace('medium', s, true)) };
const results = [];
function run(label, cfg) {
    const row = { label, cfg: { ...cfg } };
    for (const ds of ['tiny', 'medium']) { row[ds] = replayMany(T[ds], cfg); console.log(line(`${ds.padEnd(6)} ${label}`, row[ds])); }
    results.push(row);
}

console.log('--- A. stock perceptron, only scale changes');
for (const lr of [0.05, 0.5, 2, 5, 20, 50]) run(`perc norm=T d=0.1 th=0.5 lr=${lr}`, { rule: 'perceptron', lr });
for (const d of [0.1, 0.5, 0.9]) for (const lr of [0.002, 0.01, 0.05, 0.2]) run(`perc norm=F d=${d} th=0.5 lr=${lr}`, { rule: 'perceptron', lr, normalize: false, node: { decay: d } });

console.log('--- B. margin perceptron on potential');
for (const d of [0.1, 0.5, 0.9]) for (const margin of [0.25, 0.5, 0.8]) for (const lr of [0.002, 0.01, 0.05]) run(`margin norm=F d=${d} m=${margin} lr=${lr}`, { rule: 'margin', lr, margin, normalize: false, node: { decay: d } });

console.log('--- C. delta rule on potential');
for (const d of [0.1, 0.5, 0.9]) for (const hi of [1.5, 2, 3]) for (const lr of [0.002, 0.01, 0.05]) run(`delta norm=F d=${d} hi=${hi} lr=${lr}`, { rule: 'delta', lr, hi, normalize: false, node: { decay: d } });

console.log('--- D. Hebbian variants (no error signal); threshold has to be hand-tuned');
for (const th of [0.3, 0.5, 0.8, 1.2]) for (const d of [0.5, 0.9]) {
    run(`hebbL2 norm=F d=${d} th=${th} l2=1`, { rule: 'hebbL2', lr: 0.05, l2: 1, normalize: false, node: { decay: d, threshold: th } });
    run(`hebbL1 norm=F d=${d} th=${th} l1=3`, { rule: 'hebbL1', lr: 0.05, l1: 3, normalize: false, node: { decay: d, threshold: th } });
    run(`instar norm=F d=${d} th=${th} wT=0.1`, { rule: 'instar', lr: 0.01, wTarget: 0.1, normalize: false, node: { decay: d, threshold: th } });
}
for (const anti of [0.1, 0.3, 1]) for (const d of [0.5, 0.9]) run(`hebbAnti norm=F d=${d} anti=${anti} w in [-1,1] lr=0.01`, { rule: 'hebbAnti', lr: 0.01, anti, wMin: -1, wMax: 1, normalize: false, node: { decay: d } });

fs.writeFileSync(path.join(HERE, 'results-sweep1.json'), JSON.stringify(results, null, 1));
