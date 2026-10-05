// Confirmation with the harness's standard two-phase protocol, brain plasticity at its defaults (Hebbian + scaling on).
//   node experiments/dynamics/standard.mjs <dataset> <comboName[;comboName...]> [seeds=1,2,3] [wordEpochs=20]
import fs from 'node:fs';
import path from 'node:path';
import { runStandard } from '../lib/harness.mjs';
import { COMBOS } from './combos.mjs';
import { RESULTS, stats } from './lib.mjs';

const dataset = process.argv[2] || 'medium';
const names = (process.argv[3] || 'DEFAULT').split(';');
const seeds = (process.argv[4] || '1,2,3').split(',').map(Number);
const wordEpochs = Number(process.argv[5] || 20);
fs.mkdirSync(RESULTS, { recursive: true });
const file = path.join(RESULTS, `standard-${dataset}.json`);
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const f = (x) => (x === null || x === undefined ? ' n/a' : x.toFixed(2));

for (const name of names) {
    const cfg = COMBOS[name];
    if (!cfg) throw new Error(`unknown combo ${name}`);
    const key = `${name} | wordEpochs ${wordEpochs}`;
    out[key] = out[key] || { cfg, wordEpochs, perSeed: {} };
    for (const seed of seeds) {
        const r = runStandard({ dataset, seed, wordEpochs, brain: cfg.brain, paramMode: cfg.paramMode, inputLink: cfg.inputLink, inputWeight: cfg.inputWeight, inhibitoryFraction: cfg.inhibitoryFraction });
        const flat = {
            beforeFull: r.before.full, beforePart: r.before.partial, beforeCos: r.before.meanPairCos,
            afterFull: r.after.full, afterPart: r.after.partial, afterCos: r.after.meanPairCos,
            linFull: r.linear.full, linPart: r.linear.partial,
            driveFull: r.eval.fullDrive, drivePart: r.eval.partialDrive, fireFull: r.eval.fullFire, firePart: r.eval.partialFire,
            rate: r.eval.rate, active: r.eval.activeFrac, conceptAcc: r.concept.accuracy, selective: r.concept.selectiveFrac,
            conns: r.weights.internalConns, wMeanAbs: r.weights.meanAbs, ms: r.ms,
        };
        out[key].perSeed[seed] = flat;
        out[key].stats = stats(Object.values(out[key].perSeed));
        fs.writeFileSync(file, JSON.stringify(out, null, 1));
        console.log(`${dataset} ${name.padEnd(22)} seed ${seed} | sep before ${f(flat.beforeFull)}/${f(flat.beforePart)} cos ${f(flat.beforeCos)} | after ${f(flat.afterFull)}/${f(flat.afterPart)} cos ${f(flat.afterCos)} | linear ${f(flat.linFull)}/${f(flat.linPart)} | drive ${f(flat.driveFull)}/${f(flat.drivePart)} | rate ${flat.rate.toFixed(3)} active ${f(flat.active)} | conns ${flat.conns} | ${(r.ms / 1000).toFixed(0)} s`);
    }
}
