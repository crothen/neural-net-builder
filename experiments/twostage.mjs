// Two-stage training:
//   stage 1: each word's concepts are presented together, brain Hebbian learning ON, no word node involved;
//   stage 2: brain frozen, word nodes taught with the delta rule (the normal word learning).
//   node experiments/twostage.mjs <setup> [datasets=medium,short] [seeds=21,22,23] [stage1Epochs=0,1,2,5,10,20,50] [variant=default]
// setup:   evolved | threshold | default
// variant: default = the engine's plasticity defaults (rate 0.01, regrowth 0.1, pruning 0.05, budget 2.9)
//          gentle  = rate 0.01, no regrowth, budget 1.5 (the least harmful settings from the plasticity study)
//          pruneonly = control with NO Hebbian learning: any stage-1 value above 0 just deletes the internal
//                      connections weaker than the pruning threshold (0.05), which is the first thing stage 1 does
import fs from 'node:fs';
import {
    buildNet, attachReadout, present, resetState, setPlasticity, evaluate, brainSeparability, brainWeightStats,
    loadDataset, shuffled,
} from './lib/harness.mjs';
import { genomeToBuild } from './evolve/fitness.mjs';

const setupName = process.argv[2] || 'evolved';
const datasets = (process.argv[3] || 'medium,short').split(',');
const seeds = (process.argv[4] || '21,22,23').split(',').map(Number);
const stage1List = (process.argv[5] || '0,1,2,5,10,20,50').split(',').map(Number);
const variant = process.argv[6] || 'default';
const SIZE = 200, TICKS = 40;

const genome = JSON.parse(fs.readFileSync(new URL('./evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const PLASTIC = {
    default: { hebbianLearning: true, learningRate: 0.01, regrowthRate: 0.1, pruningThreshold: 0.05, sustainability: { synapticScaling: true, targetSum: 2.9, adaptiveThreshold: false } },
    gentle: { hebbianLearning: true, learningRate: 0.01, regrowthRate: 0, pruningThreshold: 0.05, sustainability: { synapticScaling: false, targetSum: 1.5, adaptiveThreshold: false } },
}[variant === 'pruneonly' ? 'default' : variant];

const SETUPS = {
    // Best setup from the evolutionary search.
    evolved: () => { const b = genomeToBuild(genome, SIZE); return { ...b, brain: { ...b.brain, ...PLASTIC }, readoutCoverage: genome.readoutCoverage }; },
    // Hand-picked: threshold 1.5 + weak internal weights + 10% input connectivity.
    threshold: () => ({ brain: { nodeCount: SIZE, threshold: 1.5, initialWeightModifier: 1, ...PLASTIC }, inputLink: { coverage: 10 }, readoutCoverage: 1 }),
    // The default network with the values its UI shows.
    default: () => ({ brain: { nodeCount: SIZE, ...PLASTIC }, readoutCoverage: 1 }),
};

const out = [];
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (x) => (x == null ? 'n/a' : (x * 100).toFixed(0) + '%').padStart(4);

for (const dsName of datasets) {
    const ds = loadDataset(dsName);
    console.log(`\n=== ${setupName} | ${dsName} (${ds.words.length} words) | brain ${SIZE} | plasticity "${variant}" | ${seeds.length} seeds`);
    console.log('stage-1 passes | after stage 1: brain partial-cue ceiling, word similarity, active, connections, max weight | after 5 word passes: full / missing | after 20: full / missing');
    for (const stage1 of stage1List) {
        const rows = seeds.map(seed => {
            const { readoutCoverage, ...build } = SETUPS[setupName]();
            const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...build });
            attachReadout(ctx, { nWords: ds.words.length, coverage: readoutCoverage, normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } });
            const order = () => shuffled(ds.words.map((_, i) => i));

            // Stage 1: concepts of each word together, Hebbian on, nothing taught.
            if (variant === 'pruneonly') {
                if (stage1 > 0) {
                    ctx.net.connections = ctx.net.connections.filter(c => !(c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-') && Math.abs(c.weight) < 0.05));
                    ctx.net.rebuildIncomingMap();
                }
            } else {
                setPlasticity(ctx, true);
                for (let e = 0; e < stage1; e++) for (const wi of order()) { resetState(ctx); present(ctx, ds.words[wi].concepts, TICKS); }
            }

            // Stage 2: brain frozen from here on.
            setPlasticity(ctx, false);
            const sep = brainSeparability(ctx, ds, { ticks: TICKS });
            const w = brainWeightStats(ctx);
            const teach = (epochs) => { for (let e = 0; e < epochs; e++) for (const wi of order()) { resetState(ctx); present(ctx, ds.words[wi].concepts, TICKS, { teacher: wi, learn: { rule: 'delta', lr: 0.004, nlms: true } }); } };
            teach(5); const e5 = evaluate(ctx, ds, { ticks: TICKS });
            teach(15); const e20 = evaluate(ctx, ds, { ticks: TICKS });
            return {
                seed, sepFull: sep.full, sepPartial: sep.partial, pairCos: sep.meanPairCos, active: e20.activeFrac, rate: e20.rate,
                conns: w.internalConns, maxAbs: w.maxAbs, meanAbs: w.meanAbs,
                full5: e5.fullFire, part5: e5.partialFire, full20: e20.fullFire, part20: e20.partialFire,
            };
        });
        const m = (k) => mean(rows.map(r => r[k]));
        console.log(`${String(stage1).padStart(8)}       | ${pct(m('sepPartial'))} ceiling, similarity ${m('pairCos').toFixed(2)}, active ${pct(m('active'))}, ${m('conns').toFixed(0).padStart(5)} conns, max w ${m('maxAbs').toFixed(1).padStart(4)} | ${pct(m('full5'))} / ${pct(m('part5'))} | ${pct(m('full20'))} / ${pct(m('part20'))}`);
        out.push({ setup: setupName, variant, dataset: dsName, stage1, rows });
    }
}
fs.writeFileSync(new URL(`./twostage-${setupName}-${variant}.json`, import.meta.url), JSON.stringify(out, null, 1));
