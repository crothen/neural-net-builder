// Diagnostic: WHICH weights run away in the long run? Classifies brain-internal connections by source neuron type
// and weight sign after N ticks of word presentations with default plasticity (paramMode full, reset between items).
//   node experiments/plasticity/diag.mjs [ticks] [seeds]
import { H, rng, shuffle, saveJson, ms } from './lib.mjs';

const N = +(process.argv[2] || 30000);
const seeds = (process.argv[3] || '1,2,3').split(',').map(Number);
const ds = H.loadDataset('medium');
const out = [];
for (const seed of seeds) {
    const ctx = H.buildNet({ nConcepts: ds.concepts.length, seed });
    const r = rng(seed * 7919 + 13);
    const wIdx = ds.words.map((_, i) => i);
    const classify = () => {
        const k = { excPos: [0, 0, 0], excNeg: [0, 0, 0], inhNeg: [0, 0, 0], inhPos: [0, 0, 0] }; // [count, sum|w|, max|w|]
        for (const c of ctx.net.connections) {
            if (!(c.sourceId.startsWith('brain-') && c.targetId.startsWith('brain-'))) continue;
            const t = ctx.net.nodes.get(c.sourceId).neuronType === 'EXCITATORY' ? 'exc' : 'inh';
            const e = k[t + (c.weight >= 0 ? 'Pos' : 'Neg')];
            const a = Math.abs(c.weight); e[0]++; e[1] += a; if (a > e[2]) e[2] = a;
        }
        const o = {};
        for (const [name, [n, s, m]] of Object.entries(k)) { o[name + 'N'] = n; o[name + 'Mean'] = n ? s / n : 0; o[name + 'Max'] = m; }
        return o;
    };
    const res = { seed, at0: classify() };
    let tick = 0, queue = [];
    while (tick < N) {
        if (!queue.length) queue = shuffle(wIdx, r);
        H.resetState(ctx); H.present(ctx, ds.words[queue.pop()].concepts, 40); tick += 40;
    }
    res.atN = classify();
    out.push(res);
}
saveJson('diag-results.json', { ticks: N, runs: out });
for (const when of ['at0', 'atN']) {
    console.log(`\n${when === 'at0' ? 'initial wiring' : `after ${N} plastic ticks`}  (source type + weight sign: count, mean |w|, max |w|; mean±sd over seeds ${seeds.join(',')})`);
    for (const k of ['excPos', 'excNeg', 'inhNeg', 'inhPos'])
        console.log(`  ${k.padEnd(7)} n ${ms(out.map(o => o[when][k + 'N']), 0).padEnd(10)} mean|w| ${ms(out.map(o => o[when][k + 'Mean']), 3).padEnd(14)} max|w| ${ms(out.map(o => o[when][k + 'Max']), 2)}`);
}
