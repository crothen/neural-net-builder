// Q5 prototype - NEEDS AN ENGINE CHANGE to exist in the app. The engine's Hebbian block is switched off and a
// replacement rule is applied from this script after every net.step() (weights adjusted between steps):
//   for every excitatory brain-internal synapse whose TARGET fired this tick:
//       w += lr * (x_pre - theta)      x_pre = 1 if the source fired on this or the previous tick, else 0
//       w clipped to [0, wMax]
// i.e. potentiation for (causal or coincident) pre-post pairs, DEPRESSION of inputs that were silent when the
// neuron fired (the missing term in the engine), a hard weight cap instead of the budget tax, no pruning/regrowth.
//   node experiments/plasticity/proto.mjs [seeds]
import { H, runProtocol, ms, saveJson, loadJson } from './lib.mjs';

const FROZEN = { hebbianLearning: false, sustainability: { synapticScaling: false } };

function makeRule({ lr = 0.01, theta = 0.3, wMax = 0.6 }) {
    return (ctx, cs, ticks, opts = {}) => {
        const nB = ctx.brainNodes.length;
        if (!ctx._proto) {
            const idx = new Map(ctx.brainNodes.map((n, i) => [n.id, i]));
            ctx._proto = {
                prev: new Uint8Array(nB),
                conns: ctx.net.connections
                    .filter(c => idx.has(c.sourceId) && idx.has(c.targetId) && ctx.net.nodes.get(c.sourceId).neuronType === 'EXCITATORY')
                    .map(c => ({ c, si: idx.get(c.sourceId), src: ctx.net.nodes.get(c.sourceId), tgt: ctx.net.nodes.get(c.targetId) })),
            };
        }
        const P = ctx._proto;
        const counts = new Float32Array(nB);
        for (let t = 0; t < ticks; t++) {
            for (let i = 0; i < nB; i++) P.prev[i] = ctx.brainNodes[i].isFiring ? 1 : 0;
            const res = H.present(ctx, cs, 1, { ...opts, skip: 0 });
            if (t >= 2) for (let i = 0; i < nB; i++) counts[i] += res.counts[i];
            for (const e of P.conns) {
                if (!e.tgt.isFiring) continue;
                const x = (P.prev[e.si] || e.src.isFiring) ? 1 : 0;
                let w = e.c.weight + lr * (x - theta);
                e.c.weight = w < 0 ? 0 : w > wMax ? wMax : w;
            }
        }
        return { counts, wordDrive: null, wordFire: null, ticks: Math.max(1, ticks - 2) };
    };
}

const CONDS = {
    'frozen':              { brain: FROZEN },
    'proto-lr0.01-th0.3':  { brain: FROZEN, customPresent: makeRule({ lr: 0.01, theta: 0.3, wMax: 0.6 }) },
    'proto-lr0.01-th0.15': { brain: FROZEN, customPresent: makeRule({ lr: 0.01, theta: 0.15, wMax: 0.6 }) },
    'proto-lr0.003-th0.3': { brain: FROZEN, customPresent: makeRule({ lr: 0.003, theta: 0.3, wMax: 0.6 }) },
};
const names = (process.argv[3] || Object.keys(CONDS).join(',')).split(',');
const seeds = (process.argv[2] || '1,2,3').split(',').map(Number);
const all = loadJson('proto-results.json') || {};
for (const name of names) {
    const cfg = CONDS[name];
    const runs = seeds.map(seed => ({ seed, ...runProtocol({ dataset: 'medium', seed, skipM0: true, ...cfg }) }));
    all[name] = { runs };
    const col = (m, k, d) => ms(runs.map(r => r[m][k]), d);
    console.log(`\n== ${name}  (${Math.round(runs.reduce((a, r) => a + r.ms, 0) / 1000)} s)`);
    for (const m of ['m1', 'm2']) {
        console.log(`  ${m} sep ${col(m, 'sepFull')}/${col(m, 'sepPartial')} lin ${col(m, 'linFull')}/${col(m, 'linPartial')} pairCos ${col(m, 'pairCos')} cosOwn-Other ${col(m, 'cosMargin')}` +
            ` | concept ${col(m, 'conceptAcc')} selIdx ${col(m, 'selIdx', 3)} wIn/wOut ${col(m, 'wIn', 3)}/${col(m, 'wOut', 3)}` +
            ` | rate ${col(m, 'rate', 3)} act ${col(m, 'activeFrac')} |w| ${col(m, 'meanAbs', 3)} max ${col(m, 'maxAbs')} thr ${col(m, 'meanThr')}`);
    }
    saveJson('proto-results.json', all);
}
