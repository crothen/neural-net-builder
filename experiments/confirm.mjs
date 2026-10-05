// Combined confirmation: named brain setups x datasets x seeds, word readout taught with the delta rule.
//   node experiments/confirm.mjs [configs=all] [datasets=tiny,medium,short] [seeds=21,22,23,24,25] [sizes=200]
// Scores are the taught word readout: "fire" = the word node that fired most (what you would see in the app),
// full = all of the word's concepts presented, partial = one concept left out.
import fs from 'node:fs';
import { runStandard } from './lib/harness.mjs';
import { genomeToBuild } from './evolve/fitness.mjs';

const FROZEN = { hebbianLearning: false, sustainability: { synapticScaling: false, adaptiveThreshold: false } };
const DELTA_NLMS = { readout: { normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } }, learn: { rule: 'delta', lr: 0.004, nlms: true } };

// Evolved winners are read from the evolution result files when present.
const evolved = (file, i = 0) => {
    try { return JSON.parse(fs.readFileSync(new URL(`./evolve/${file}`, import.meta.url), 'utf8')).final[i].genome; } catch { return null; }
};

export const CONFIGS = {
    // What the browser app runs today after loading its default network: class-default neurons, brain learning on.
    'app-today (learning on)': () => ({ paramMode: 'asLoaded', conceptEpochs: 5, plasticDuringWords: true }),
    // The default network with the values its UI shows, brain frozen.
    'default-frozen': () => ({ brain: { ...FROZEN }, conceptEpochs: 0 }),
    // Dynamics study: threshold 1.5.
    'threshold-1.5': () => ({ brain: { ...FROZEN, threshold: 1.5 }, conceptEpochs: 0 }),
    // Dynamics study: threshold 1.5 + weak recurrence.
    'threshold-1.5 + weak-recurrence': () => ({ brain: { ...FROZEN, threshold: 1.5, initialWeightModifier: 1 }, conceptEpochs: 0 }),
    // ... plus sparser input, as the size study suggests.
    'threshold-1.5 + weak-recurrence + coverage-10': () => ({ brain: { ...FROZEN, threshold: 1.5, initialWeightModifier: 1 }, inputLink: { coverage: 10 }, conceptEpochs: 0 }),
    // The same setup with the brain's Hebbian learning left on throughout.
    'threshold-1.5 + weak-recurrence, learning on': () => ({ brain: { threshold: 1.5, initialWeightModifier: 1, sustainability: { adaptiveThreshold: false } }, conceptEpochs: 5, plasticDuringWords: true }),
    'evolved-n200': (n) => { const g = evolved('results-main-n200.json'); return g && { ...genomeToBuild(g, n), conceptEpochs: 0, readoutCoverage: g.readoutCoverage }; },
    'evolved-n50': (n) => { const g = evolved('results-main-n50.json'); return g && { ...genomeToBuild(g, n), conceptEpochs: 0, readoutCoverage: g.readoutCoverage }; },
};

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
    const pick = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(';') : Object.keys(CONFIGS);
    const datasets = (process.argv[3] || 'tiny,medium,short').split(',');
    const seeds = (process.argv[4] || '21,22,23,24,25').split(',').map(Number);
    const sizes = (process.argv[5] || '200').split(',').map(Number);
    const fmt = (x) => (x == null ? ' n/a' : x.toFixed(2));
    const ms = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return `${fmt(m)}±${fmt(Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length))}`; };
    const out = [];

    for (const size of sizes) for (const name of pick) {
        const make = CONFIGS[name];
        if (!make) { console.log(`unknown config ${name}`); continue; }
        for (const dataset of datasets) {
            const rows = [];
            for (const seed of seeds) {
                const cfg = make(size);
                if (!cfg) break;
                const { readoutCoverage, ...rest } = cfg;
                const r = runStandard({
                    dataset, seed, linear: false, wordEpochs: 20, ...DELTA_NLMS, ...rest,
                    brain: { nodeCount: size, ...(rest.brain || {}) },
                    readout: { ...DELTA_NLMS.readout, ...(readoutCoverage ? { coverage: readoutCoverage } : {}) },
                });
                rows.push({ seed, fullFire: r.eval.fullFire, partialFire: r.eval.partialFire, fullDrive: r.eval.fullDrive, partialDrive: r.eval.partialDrive, rate: r.eval.rate, activeFrac: r.eval.activeFrac, pairCos: r.after.meanPairCos });
            }
            if (!rows.length) { console.log(`${name}: no result file yet, skipped`); break; }
            const col = (k) => rows.map(r => r[k] ?? r.fullFire);
            console.log(`n=${String(size).padEnd(4)} ${name.padEnd(46)} ${dataset.padEnd(6)} | fire full ${ms(col('fullFire'))} partial ${ms(col('partialFire'))} | drive full ${ms(col('fullDrive'))} partial ${ms(col('partialDrive'))} | active ${ms(col('activeFrac'))} pairCos ${ms(col('pairCos'))}`);
            out.push({ size, name, dataset, seeds, rows });
        }
    }
    const file = new URL(`./confirm-results-${Date.now()}.json`, import.meta.url);
    fs.writeFileSync(file, JSON.stringify(out, null, 1));
}
