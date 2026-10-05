// Diagnoses the engine's Hebbian rule: what it strengthens, and where the unbounded growth comes from.
//   node experiments/hebbian/diag.mjs [setup=default|evolved] [dataset=medium] [seed=21]
import fs from 'node:fs';
import { buildNet, present, resetState, setPlasticity, loadDataset, shuffled } from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const setup = process.argv[2] || 'default';
const ds = loadDataset(process.argv[3] || 'medium');
const seed = Number(process.argv[4] || 21);
const PLASTIC = { hebbianLearning: true, learningRate: 0.01, regrowthRate: 0.1, pruningThreshold: 0.05, sustainability: { synapticScaling: true, targetSum: 2.9, adaptiveThreshold: false } };
const genome = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const build = setup === 'evolved' ? (() => { const b = genomeToBuild(genome, 200); return { ...b, brain: { ...b.brain, ...PLASTIC } }; })() : { brain: { nodeCount: 200, ...PLASTIC } };
const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...build });
const { net } = ctx;
const internal = () => net.connections.filter(c => c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-'));
const originalIds = new Set(internal().map(c => c.id));

// ---- 1. Which firing pairs does the rule see? (measured with plasticity off, so the brain is not changing)
setPlasticity(ctx, false);
let causal = 0, causalAlsoSameTick = 0, sameTick = 0;
const conns = internal().filter(c => net.nodes.get(c.sourceId).neuronType === 'EXCITATORY').map(c => ({ src: net.nodes.get(c.sourceId), tgt: net.nodes.get(c.targetId) }));
const prev = new Map();
for (const w of ds.words) {
    resetState(ctx); prev.clear();
    for (let t = 0; t < 40; t++) {
        for (const c of w.concepts) ctx.conceptNodes[c].trigger(1);
        net.step();
        for (const { src, tgt } of conns) {
            const pre1 = prev.get(src.id) || 0;
            if (pre1 && tgt.activation) { causal++; if (src.activation) causalAlsoSameTick++; }
            if (src.activation && tgt.activation) sameTick++;
        }
        for (const n of ctx.brainNodes) prev.set(n.id, n.activation);
    }
}
console.log(`[${setup}] excitatory internal synapses, one pass over ${ds.words.length} words:`);
console.log(`  source fired one tick BEFORE the target fired (the synapse could have contributed): ${causal} times`);
console.log(`  ... of those, the engine's rule strengthened the synapse: ${causalAlsoSameTick} (${(100 * causalAlsoSameTick / (causal || 1)).toFixed(1)}%)`);
console.log(`  source and target fired in the SAME tick (what the rule rewards): ${sameTick} times`);

// ---- 2. Where does the growth come from? (plasticity on, word presentations)
setPlasticity(ctx, true);
const report = (label) => {
    const cs = internal();
    let signed = 0, abs = 0, max = 0, inhPosOrig = 0, inhPosRegrown = 0, inhNeg = 0, excNeg = 0, excPos = 0, inhPosSum = 0;
    for (const c of cs) {
        signed += c.weight; abs += Math.abs(c.weight); max = Math.max(max, Math.abs(c.weight));
        const inh = net.nodes.get(c.sourceId).neuronType === 'INHIBITORY';
        if (inh && c.weight > 0) { inhPosSum += c.weight; if (originalIds.has(c.id)) inhPosOrig++; else inhPosRegrown++; }
        else if (inh) inhNeg++;
        else if (c.weight < 0) excNeg++; else excPos++;
    }
    console.log(`  ${label.padEnd(12)} conns ${String(cs.length).padStart(5)} | signed sum ${signed.toFixed(0).padStart(6)} | sum of |w| ${abs.toFixed(0).padStart(6)} | largest ${max.toFixed(1).padStart(5)} | inhibitory-source: ${inhNeg} negative, ${inhPosOrig + inhPosRegrown} POSITIVE (${inhPosRegrown} from regrowth, ${inhPosOrig} original; total +${inhPosSum.toFixed(0)}) | excitatory-source: ${excPos} positive, ${excNeg} NEGATIVE`);
};
console.log(`\n[${setup}] internal weights while words are presented with the engine's Hebbian rule on:`);
report('start');
let ticks = 0;
for (const target of [2000, 8000, 16000, 32000]) {
    while (ticks < target) for (const wi of shuffled(ds.words.map((_, i) => i))) { resetState(ctx); present(ctx, ds.words[wi].concepts, 40); ticks += 40; }
    report(`${ticks} ticks`);
}
