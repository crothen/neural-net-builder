// Two-stage training with a CORRECTED Hebbian rule in stage 1 (prototype: applied from this script, the engine's
// own plasticity is switched off, so no pruning / regrowth / tax).
//   node experiments/hebbian/twostage-v2.mjs <setup> <rule> [datasets=medium,short] [seeds=21,22,23] [stage1=0,2,5,20,50] [lr=0.05] [wMaxFactor=2]
// setup: evolved | threshold | default
// rule:
//   same   - bounded, same-tick:  when the target fires, w += lr * (pre(t)   - w / wMax)
//   causal - bounded, causal:     when the target fires, w += lr * (pre(t-1) - w / wMax)
//   shrink - control, NO learning: any stage-1 value above 0 just multiplies every excitatory internal weight by
//            the 9th argument (default 0.22, the average shrinkage the causal rule produces on the default brain)
// Both learning rules only touch excitatory-source internal synapses, keep every weight inside [0, wMax] and cannot change its
// sign. An input that was active moves towards wMax, one that was silent decays towards 0, so each weight settles
// at wMax x "how often was this input active when the target fired". wMax = wMaxFactor x the brain's mean
// initial excitatory weight. "causal" uses the source's activity one tick earlier, because a spike needs one tick
// to arrive and the source is refractory by then - the engine's same-tick rule can never see that pairing.
import fs from 'node:fs';
import {
    buildNet, attachReadout, present, resetState, evaluate, brainSeparability, brainWeightStats, loadDataset, shuffled,
} from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const setupName = process.argv[2] || 'evolved';
const rule = process.argv[3] || 'causal';
const datasets = (process.argv[4] || 'medium,short').split(',');
const seeds = (process.argv[5] || '21,22,23').split(',').map(Number);
const stage1List = (process.argv[6] || '0,2,5,20,50').split(',').map(Number);
const LR = Number(process.argv[7] || 0.05);
const WMAX_FACTOR = Number(process.argv[8] || 2);
const SHRINK = Number(process.argv[9] || 0.22);
const SIZE = 200, TICKS = 40;
const FROZEN = { hebbianLearning: false, sustainability: { synapticScaling: false, adaptiveThreshold: false } };
const genome = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;

const SETUPS = {
    evolved: () => ({ ...genomeToBuild(genome, SIZE), readoutCoverage: genome.readoutCoverage }),
    threshold: () => ({ brain: { nodeCount: SIZE, threshold: 1.5, initialWeightModifier: 1, ...FROZEN }, inputLink: { coverage: 10 }, readoutCoverage: 1 }),
    default: () => ({ brain: { nodeCount: SIZE, ...FROZEN }, readoutCoverage: 1 }),
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(0) + '%').padStart(4);
const out = [];

for (const dsName of datasets) {
    const ds = loadDataset(dsName);
    console.log(`\n=== ${setupName} | ${dsName} (${ds.words.length} words) | brain ${SIZE} | rule "${rule}" lr ${LR} wMax x${WMAX_FACTOR} | ${seeds.length} seeds`);
    console.log('stage-1 passes | after stage 1: brain partial-cue ceiling, word similarity, active, mean / largest excitatory weight | after 5 word passes: full / missing | after 20: full / missing');
    for (const stage1 of stage1List) {
        const rows = seeds.map(seed => {
            const { readoutCoverage, ...build } = SETUPS[setupName]();
            const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...build });
            attachReadout(ctx, { nWords: ds.words.length, coverage: readoutCoverage, normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } });
            const { net, brainNodes } = ctx; const nB = brainNodes.length;
            const order = () => shuffled(ds.words.map((_, i) => i));

            // Excitatory-source internal synapses, grouped by target neuron.
            const index = new Map(brainNodes.map((n, i) => [n.id, i]));
            const incoming = Array.from({ length: nB }, () => []);
            let sum = 0, count = 0;
            for (const c of net.connections) {
                if (!(c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-'))) continue;
                if (net.nodes.get(c.sourceId).neuronType !== 'EXCITATORY') continue;
                incoming[index.get(c.targetId)].push({ conn: c, src: index.get(c.sourceId) });
                sum += c.weight; count++;
            }
            const wMax = WMAX_FACTOR * (sum / count);

            // Stage 1: each word's concepts together, corrected Hebbian rule on, nothing taught.
            const prev = new Uint8Array(nB), cur = new Uint8Array(nB);
            if (rule === 'shrink' && stage1 > 0) for (const list of incoming) for (const { conn } of list) conn.weight *= SHRINK;
            for (let e = 0; e < (rule === 'shrink' ? 0 : stage1); e++) for (const wi of order()) {
                resetState(ctx); prev.fill(0);
                for (let t = 0; t < TICKS; t++) {
                    for (const c of ds.words[wi].concepts) ctx.conceptNodes[c].trigger(1);
                    net.step();
                    for (let i = 0; i < nB; i++) cur[i] = brainNodes[i].activation > 0 ? 1 : 0;
                    const pre = rule === 'causal' ? prev : cur;
                    for (let j = 0; j < nB; j++) {
                        if (!cur[j]) continue; // learning is gated by the target firing
                        for (const { conn, src } of incoming[j]) conn.weight += LR * (pre[src] - conn.weight / wMax);
                    }
                    prev.set(cur);
                }
            }

            // Stage 2: brain frozen, words taught with the delta rule.
            let wSum = 0, wLargest = 0;
            for (const list of incoming) for (const { conn } of list) { wSum += conn.weight; if (conn.weight > wLargest) wLargest = conn.weight; }
            const sep = brainSeparability(ctx, ds, { ticks: TICKS });
            const teach = (epochs) => { for (let e = 0; e < epochs; e++) for (const wi of order()) { resetState(ctx); present(ctx, ds.words[wi].concepts, TICKS, { teacher: wi, learn: { rule: 'delta', lr: 0.004, nlms: true } }); } };
            teach(5); const e5 = evaluate(ctx, ds, { ticks: TICKS });
            teach(15); const e20 = evaluate(ctx, ds, { ticks: TICKS });
            return {
                seed, sepPartial: sep.partial, pairCos: sep.meanPairCos, active: e20.activeFrac, meanW: wSum / count, largestW: wLargest, wMax,
                full5: e5.fullFire, part5: e5.partialFire, full20: e20.fullFire, part20: e20.partialFire, conns: brainWeightStats(ctx).internalConns,
            };
        });
        const m = (k) => mean(rows.map(r => r[k]));
        console.log(`${String(stage1).padStart(8)}       | ${pct(m('sepPartial'))} ceiling, similarity ${m('pairCos').toFixed(2)}, active ${pct(m('active'))}, w ${m('meanW').toFixed(3)} / ${m('largestW').toFixed(3)} (cap ${m('wMax').toFixed(3)}) | ${pct(m('full5'))} / ${pct(m('part5'))} | ${pct(m('full20'))} / ${pct(m('part20'))}`);
        out.push({ setup: setupName, rule, lr: LR, wMaxFactor: WMAX_FACTOR, dataset: dsName, stage1, rows });
    }
}
fs.writeFileSync(new URL(`./twostage-v2-${setupName}-${rule}-lr${LR}-w${WMAX_FACTOR}.json`, import.meta.url), JSON.stringify(out, null, 1));
