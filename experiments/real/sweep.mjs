// How small can the brain get? Brain size x number of words on a word list, brain frozen, words taught with the
// delta rule.
//   node experiments/real/sweep.mjs [sizes=25,50,100,200,400] [wordCounts=100,250,all] [seeds=21,22,23] [passes=5,10] [dataset=real] [tag=main]
// Brain: the evolved setup. Input connectivity is set from the list itself so the drive per neuron stays where
// the setup was tuned (average concepts per word x connectivity x mean input weight = 0.8).
// Word subsets are random draws from the whole list (same draw for every brain size).
// Tests per word: all concepts; one concept missing; a random half; all concepts plus 2 wrong ones. The missing
// and half cues are only used when they still fit exactly one word of the subset.
// A word counts as recalled when its node fired most.
import fs from 'node:fs';
import { buildNet, attachReadout, present, resetState, argmax, loadDataset, shuffled, seedRandom, activity } from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const sizes = (process.argv[2] || '25,50,100,200,400').split(',').map(Number);
const wordCounts = (process.argv[3] || '100,250,all').split(',');
const seeds = (process.argv[4] || '21,22,23').split(',').map(Number);
const checkpoints = (process.argv[5] || '5,10').split(',').map(Number);
const dsName = process.argv[6] || 'real';
const tag = process.argv[7] || 'main';
const TICKS = 40;
const genome = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const full = loadDataset(dsName);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const pct = (x) => (x == null || Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(0) + '%').padStart(4);
const out = [];
const outFile = new URL(`./sweep-${dsName}-${tag}.json`, import.meta.url);

console.log(`${dsName}: ${full.words.length} words, ${full.concepts.length} concepts, ${mean(full.words.map(w => w.concepts.length)).toFixed(1)} concepts per word on average`);
console.log('neurons | words | input conn. | after ' + checkpoints.map(c => `${c} passes: all / missing / half / +2 wrong`).join(' | after ') + ' | active | teach s');

for (const wc of wordCounts) {
    const nWords = wc === 'all' ? full.words.length : Math.min(Number(wc), full.words.length);
    for (const size of sizes) {
        const rows = seeds.map(seed => {
            // The word subset and the test cues depend only on the seed.
            seedRandom(9000 + seed);
            const ds = { ...full, words: shuffled(full.words).slice(0, nWords) };
            const sets = ds.words.map(w => new Set(w.concepts));
            const owners = (cue) => { let n = 0; for (const s of sets) { if (cue.every(c => s.has(c))) n++; if (n > 1) break; } return n; };
            const cues = ds.words.map(w => {
                const pick = (make) => { for (let a = 0; a < 10; a++) { const cue = make(); if (cue.length && owners(cue) === 1) return cue; } return null; };
                const others = () => { const o = []; while (o.length < 2) { const c = Math.floor(Math.random() * ds.concepts.length); if (!w.concepts.includes(c) && !o.includes(c)) o.push(c); } return o; };
                return {
                    all: w.concepts,
                    missing: pick(() => { const k = Math.floor(Math.random() * w.concepts.length); return w.concepts.filter((_, i) => i !== k); }),
                    half: pick(() => shuffled(w.concepts).slice(0, Math.ceil(w.concepts.length / 2))),
                    wrong: [...w.concepts, ...others()],
                };
            });
            const meanConcepts = mean(ds.words.map(w => w.concepts.length));
            const coverage = Math.max(1, Math.min(50, 100 * 0.8 / (meanConcepts * genome.inputWeightMax / 2)));

            const b = genomeToBuild(genome, size);
            const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...b, inputLink: { coverage, localizer: genome.inputLocalizer } });
            attachReadout(ctx, { nWords, coverage: genome.readoutCoverage, normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } });

            const test = () => {
                const score = { all: [], missing: [], half: [], wrong: [] }; const act = [];
                ds.words.forEach((_, wi) => {
                    for (const kind of Object.keys(score)) {
                        if (!cues[wi][kind]) continue;
                        resetState(ctx);
                        const r = present(ctx, cues[wi][kind], TICKS);
                        score[kind].push(argmax(r.wordFire) === wi ? 1 : 0);
                        if (kind === 'all') act.push(activity(r).activeFrac);
                    }
                });
                return { all: mean(score.all), missing: mean(score.missing), half: mean(score.half), wrong: mean(score.wrong), active: mean(act), nMissing: score.missing.length, nHalf: score.half.length };
            };

            const results = {}; let ms = 0, epoch = 0;
            for (const cp of checkpoints) {
                const t0 = performance.now();
                for (; epoch < cp; epoch++) for (const wi of shuffled(ds.words.map((_, i) => i))) {
                    resetState(ctx);
                    present(ctx, ds.words[wi].concepts, TICKS, { teacher: wi, learn: { rule: 'delta', lr: 0.004, nlms: true } });
                }
                ms += performance.now() - t0;
                results[cp] = { ...test(), teachSeconds: ms / 1000 };
            }
            return { seed, coverage, results };
        });
        const cell = (cp) => ['all', 'missing', 'half', 'wrong'].map(k => pct(mean(rows.map(r => r.results[cp][k])))).join(' / ');
        const last = checkpoints[checkpoints.length - 1];
        console.log(`${String(size).padStart(7)} | ${String(nWords).padStart(5)} | ${mean(rows.map(r => r.coverage)).toFixed(0).padStart(9)}%  | ${checkpoints.map(cell).join(' | ')} | ${pct(mean(rows.map(r => r.results[last].active)))} | ${mean(rows.map(r => r.results[last].teachSeconds)).toFixed(0)}`);
        out.push({ dataset: dsName, size, nWords, rows });
        fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    }
}
