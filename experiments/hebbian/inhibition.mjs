// Does letting INHIBITION learn alongside excitation make Hebbian learning useful?
//   node experiments/hebbian/inhibition.mjs <setup> [datasets=short,medium] [seeds=21,22,23] [stage1Passes=10] [conditions=all]
// setup: default | evolved
//
// Stage 1 (each word's concepts together, no word node) runs one of these on the brain's internal synapses:
//   frozen        nothing
//   shrink        control, no learning: every excitatory weight x 0.22
//   exc xN        bounded causal Hebbian on excitatory synapses only, cap = N x mean initial weight:
//                   when target j fires:  w += 0.05 * (pre(t-1) - w / cap)
//   exc+inh xN    the same, plus inhibitory synapses that learn:
//                   when inhibitory source i fired one tick ago:  strength(i->j) += 0.02 * (rate_j - target)
//                 rate_j is the target's recent firing rate, target = 5%. Inhibition onto a neuron grows while
//                 that neuron fires too much in the contexts where the inhibitory neuron is active, and relaxes
//                 otherwise. Strength stays in [0, 4 x mean initial], so the synapse can never turn excitatory.
// Stage 2: brain frozen, words taught with the delta rule (20 passes).
// Tests: all concepts; one missing; a random half of the concepts; all concepts plus 2 wrong ones.
import fs from 'node:fs';
import {
    buildNet, attachReadout, present, resetState, argmax, cosine, loadDataset, shuffled, seedRandom, partialCues, activity,
} from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const setupName = process.argv[2] || 'default';
const datasets = (process.argv[3] || 'short,medium').split(',');
const seeds = (process.argv[4] || '21,22,23').split(',').map(Number);
const STAGE1 = Number(process.argv[5] || 10);
const ALL = ['frozen', 'shrink', 'exc x2', 'exc x4', 'exc+inh x2', 'exc+inh x4', 'exc+inh x8'];
const conditions = process.argv[6] && process.argv[6] !== 'all' ? process.argv[6].split(',') : ALL;
const SIZE = 200, TICKS = 40, LR_E = 0.05, LR_I = 0.02, TARGET_RATE = 0.05, TRACE = 0.1, INH_CAP = 4;
const FROZEN = { hebbianLearning: false, sustainability: { synapticScaling: false, adaptiveThreshold: false } };
const genome = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const SETUPS = {
    evolved: () => ({ ...genomeToBuild(genome, SIZE), readoutCoverage: genome.readoutCoverage }),
    default: () => ({ brain: { nodeCount: SIZE, ...FROZEN }, readoutCoverage: 1 }),
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(0) + '%').padStart(4);
const out = [];

for (const dsName of datasets) {
    const ds = loadDataset(dsName);
    const owners = (cue) => ds.words.filter(o => cue.every(c => o.concepts.includes(c))).length;

    console.log(`\n=== ${setupName} | ${dsName} (${ds.words.length} words) | brain ${SIZE} | stage 1 = ${STAGE1} passes | ${seeds.length} seeds`);
    console.log('condition      | all concepts | one missing | half | +2 wrong | half-cue brain state vs full | active | word similarity | exc w mean | inh strength mean');
    for (const cond of conditions) {
        const rows = seeds.map(seed => {
            // Test cues depend only on the seed, so every condition is scored on the same ones.
            seedRandom(5000 + seed);
            const halfCues = [], noisyCues = [];
            ds.words.forEach((w, wi) => {
                const k = Math.ceil(w.concepts.length / 2); let found = 0;
                for (let a = 0; a < 30 && found < 2 && w.concepts.length >= 2; a++) { const cue = shuffled(w.concepts).slice(0, k); if (owners(cue) === 1) { halfCues.push({ wi, cue }); found++; } }
                const others = ds.concepts.map((_, c) => c).filter(c => !w.concepts.includes(c));
                noisyCues.push({ wi, cue: [...w.concepts, ...shuffled(others).slice(0, 2)] });
            });

            const { readoutCoverage, ...build } = SETUPS[setupName]();
            const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...build });
            attachReadout(ctx, { nWords: ds.words.length, coverage: readoutCoverage, normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } });
            const { net, brainNodes } = ctx; const nB = brainNodes.length;
            const order = () => shuffled(ds.words.map((_, i) => i));

            const index = new Map(brainNodes.map((n, i) => [n.id, i]));
            const excIn = Array.from({ length: nB }, () => []), inhOut = Array.from({ length: nB }, () => []);
            const exc = [], inh = [];
            for (const c of net.connections) {
                if (!(c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-'))) continue;
                const s = index.get(c.sourceId), t = index.get(c.targetId);
                if (brainNodes[s].neuronType === 'EXCITATORY') { excIn[t].push({ conn: c, src: s }); exc.push(c); } else { inhOut[s].push({ conn: c, tgt: t }); inh.push(c); }
            }
            const meanExc = mean(exc.map(c => c.weight)), meanInh = mean(inh.map(c => -c.weight));

            // ---- stage 1
            const [kind, capStr] = cond.split(' x'); const capFactor = Number(capStr || 0);
            if (kind === 'shrink') for (const c of exc) c.weight *= 0.22;
            if (kind === 'exc' || kind === 'exc+inh') {
                const cap = capFactor * meanExc, inhMax = INH_CAP * meanInh;
                const prev = new Uint8Array(nB), cur = new Uint8Array(nB), rate = new Float32Array(nB);
                for (let e = 0; e < STAGE1; e++) for (const wi of order()) {
                    resetState(ctx); prev.fill(0);
                    for (let t = 0; t < TICKS; t++) {
                        for (const c of ds.words[wi].concepts) ctx.conceptNodes[c].trigger(1);
                        net.step();
                        for (let i = 0; i < nB; i++) { cur[i] = brainNodes[i].activation > 0 ? 1 : 0; rate[i] += TRACE * (cur[i] - rate[i]); }
                        for (let j = 0; j < nB; j++) {
                            if (cur[j]) for (const { conn, src } of excIn[j]) conn.weight += LR_E * (prev[src] - conn.weight / cap);
                            if (kind === 'exc+inh' && prev[j]) for (const { conn, tgt } of inhOut[j]) {
                                let m = -conn.weight + LR_I * (rate[tgt] - TARGET_RATE);
                                conn.weight = -(m < 0 ? 0 : m > inhMax ? inhMax : m);
                            }
                        }
                        prev.set(cur);
                    }
                }
            }

            // ---- stage 2: brain frozen, words taught
            for (let e = 0; e < 20; e++) for (const wi of order()) { resetState(ctx); present(ctx, ds.words[wi].concepts, TICKS, { teacher: wi, learn: { rule: 'delta', lr: 0.004, nlms: true } }); }

            // ---- tests
            const run = (cue) => { resetState(ctx); return present(ctx, cue, TICKS); };
            const fullStates = ds.words.map(w => run(w.concepts));
            const full = mean(fullStates.map((r, wi) => (argmax(r.wordFire) === wi ? 1 : 0)));
            const missing = []; ds.words.forEach((_, wi) => { for (const cue of partialCues(ds, wi)) missing.push(argmax(run(cue).wordFire) === wi ? 1 : 0); });
            const half = [], completion = [];
            for (const { wi, cue } of halfCues) { const r = run(cue); half.push(argmax(r.wordFire) === wi ? 1 : 0); completion.push(cosine(r.counts, fullStates[wi].counts)); }
            const noisy = noisyCues.map(({ wi, cue }) => (argmax(run(cue).wordFire) === wi ? 1 : 0));
            let pc = 0, np = 0; for (let a = 0; a < fullStates.length; a++) for (let b = a + 1; b < fullStates.length; b++) { pc += cosine(fullStates[a].counts, fullStates[b].counts); np++; }
            return {
                seed, full, missing: mean(missing), half: mean(half), noisy: mean(noisy), completion: mean(completion), nHalf: half.length,
                active: mean(fullStates.map(r => activity(r).activeFrac)), similarity: pc / np, excW: mean(exc.map(c => c.weight)), inhW: mean(inh.map(c => -c.weight)),
            };
        });
        const m = (k) => mean(rows.map(r => r[k]));
        console.log(`${cond.padEnd(14)} | ${pct(m('full'))}         | ${pct(m('missing'))}        | ${pct(m('half'))} | ${pct(m('noisy'))}     | ${m('completion').toFixed(2)}                         | ${pct(m('active'))}   | ${m('similarity').toFixed(2)}            | ${m('excW').toFixed(3)}      | ${m('inhW').toFixed(3)}`);
        out.push({ setup: setupName, dataset: dsName, condition: cond, stage1: STAGE1, rows });
    }
}
fs.writeFileSync(new URL(`./inhibition-${setupName}.json`, import.meta.url), JSON.stringify(out, null, 1));
