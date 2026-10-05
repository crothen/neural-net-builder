// Sanity check of the built-in 'delta' readout rule (frozen brain during word teaching).
import { runStandard } from '../lib/harness.mjs';
const fmt = (x) => (x == null ? ' n/a' : x.toFixed(2));
const variants = {
    'agent rule (mean-normalised, lr 0.04)': { readout: { normalize: true, node: { decay: 0.95 } }, learn: { rule: 'delta', lr: 0.04 } },
    'nlms (sum, lr 0.004)': { readout: { normalize: false, node: { decay: 0.95 } }, learn: { rule: 'delta', lr: 0.004, nlms: true } },
    'nlms (sum, lr 0.01)': { readout: { normalize: false, node: { decay: 0.95 } }, learn: { rule: 'delta', lr: 0.01, nlms: true } },
};
for (const [name, v] of Object.entries(variants)) for (const dataset of ['medium']) {
    const rows = [1, 2, 3].map(seed => runStandard({ dataset, seed, plasticDuringWords: false, linear: false, ...v }).eval);
    const m = (k) => fmt(rows.reduce((s, r) => s + r[k], 0) / rows.length);
    console.log(`${name.padEnd(40)} ${dataset}: fullDrive ${m('fullDrive')} fullFire ${m('fullFire')} partialDrive ${m('partialDrive')} partialFire ${m('partialFire')}`);
}
