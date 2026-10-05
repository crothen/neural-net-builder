// How many patterns fit? Fresh-seed check of a setup found by search.mjs.
//   node experiments/patterns/capacity.mjs [setup=best|first] [neurons=100] [patternSize=10] [patterns=1,2,5,10,15,20,30] [seeds=20] [cue=0.5]
// Seeds start at 101, so none of them were used by the search.
import { score, DEFAULTS } from './lib.mjs';

/** Best setup from the 600-sample search (search-*.json). */
export const BEST = {
    cap: 0.111, lr: 0.028, rule: 'keep', window: 2, retention: 0.838, refractory: 0, exposures: 1,
    nInh: 5, wEI: 0.041, wEIspread: 1.706, wIE: 0.207,
};

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('patterns/capacity.mjs');
if (isMain) {
    const setup = process.argv[2] === 'first' ? {} : BEST;
    const N = Number(process.argv[3] || 100), size = Number(process.argv[4] || 10);
    const counts = (process.argv[5] || '1,2,5,10,15,20,30').split(',').map(Number);
    const seeds = Array.from({ length: Number(process.argv[6] || 20) }, (_, i) => 101 + i);
    const cueFraction = Number(process.argv[7] || 0.5);
    const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';
    console.log(`${process.argv[2] === 'first' ? 'first hand-picked setup' : 'best setup from the search'}: ${N} neurons${setup.nInh ? ' + ' + setup.nInh + ' inhibitory' : ''}, patterns of ${size}, cue = ${Math.round(cueFraction * 100)}% of the pattern, ${seeds.length} fresh seeds`);
    console.log('patterns | exact recall | completed | intruders | lingers after cue');
    for (const K of counts) {
        const r = score({ ...DEFAULTS, ...setup }, { N, size, K, cueFraction }, seeds);
        console.log(`${String(K).padStart(8)} | ${pct(r.exact).padStart(12)} | ${pct(r.completed).padStart(9)} | ${pct(r.intruders).padStart(9)} | ${pct(r.lingers).padStart(17)}`);
    }
}
