// Random search over the small-brain setup for pattern completion with SEVERAL stored patterns.
//   node experiments/patterns/search.mjs [samples=60] [searchSeed=1] [N=100] [size=10]
// Each sampled setup is scored on 5 and on 10 stored patterns (6 seeds each); score = share of cues that bring back
// exactly their own pattern. Prints the best setups and writes search-<searchSeed>.json.
import fs from 'node:fs';
import { score } from './lib.mjs';

const SAMPLES = Number(process.argv[2] || 60);
const SEARCH_SEED = Number(process.argv[3] || 1);
const N = Number(process.argv[4] || 100), SIZE = Number(process.argv[5] || 10);
let a = SEARCH_SEED * 7919;
const rnd = () => { a = (Math.imul(a, 1664525) + 1013904223) | 0; return (a >>> 0) / 4294967296; };
const uni = (lo, hi) => lo + rnd() * (hi - lo);
const logu = (lo, hi) => Math.exp(uni(Math.log(lo), Math.log(hi)));
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const round = (x) => +x.toFixed(3);

const results = [];
for (let s = 0; s < SAMPLES; s++) {
    const nInh = pick([0, 5, 10, 20]);
    const params = {
        cap: round(logu(0.04, 0.4)), lr: round(logu(0.02, 0.5)), rule: pick(['window', 'keep']), window: pick([0, 1, 2, 3]),
        retention: round(uni(0.3, 0.9)), refractory: pick([0, 1, 2]), exposures: pick([1, 3]),
        nInh, wEI: round(logu(0.01, 0.2)), wEIspread: round(uni(1, 4)), wIE: round(logu(0.02, 0.6)),
    };
    const s5 = score(params, { N, size: SIZE, K: 5 }, [1, 2, 3, 4, 5, 6]);
    const s10 = score(params, { N, size: SIZE, K: 10 }, [1, 2, 3, 4, 5, 6]);
    results.push({ params, exact: (s5.exact + s10.exact) / 2, s5, s10 });
}
results.sort((x, y) => y.exact - x.exact || (y.s10.completed - y.s10.intruders) - (x.s10.completed - x.s10.intruders));
fs.writeFileSync(new URL(`./search-${SEARCH_SEED}.json`, import.meta.url), JSON.stringify(results, null, 1));
const pct = (x) => (x * 100).toFixed(0) + '%';
for (const r of results.slice(0, 6)) console.log(`exact ${pct(r.exact)} | 5 patterns: ${pct(r.s5.exact)} exact, ${pct(r.s5.completed)} completed, ${pct(r.s5.intruders)} intruders | 10 patterns: ${pct(r.s10.exact)} exact, ${pct(r.s10.completed)} completed, ${pct(r.s10.intruders)} intruders | ${JSON.stringify(r.params)}`);
