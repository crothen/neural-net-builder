// Evolve brain settings for self-taught learning: pattern completion and sequence replay, no teacher.
//   node experiments/patterns/evolve.mjs [--pop 32] [--gens 30] [--workers 4] [--seeds 1,2,3,4] [--tag main] [--task patterns|simon]
// --task simon: fitness = rounds survived in the Simon game (9 tiles, growing sequence), 70% without repeated
// tiles and 30% with, each divided by 9.
// Learning phase: the brain is shown patterns / sequences with its Hebbian rule on.
// Verification phase: learning off; half-pattern cues must bring back exactly their pattern, and the first
// pattern of a chain must make the others follow in order.
// Fitness = 0.25 x exact recall (5 patterns) + 0.25 x exact recall (10 patterns) + 0.5 x sequence score (4 steps),
// averaged over the seeds. Finalists are re-scored on seeds the search never saw.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { score, sequenceScore, simonScore } from './lib.mjs';

/** Genes: [min, max, kind]; kind = lin | log | int | bool | choice(list). */
const GENES = {
    cap: [0.03, 0.5, 'log'],
    lr: [0.01, 0.5, 'log'],
    rule: [['window', 'keep'], null, 'choice'],
    window: [0, 4, 'int'],
    sameTick: [0, 1, 'bool'],
    retention: [0.3, 0.95, 'lin'],
    refractory: [0, 3, 'int'],
    fatigue: [0, 1.5, 'lin'],
    recovery: [0.02, 0.6, 'log'],
    nInh: [[0, 5, 10, 20], null, 'choice'],
    wEI: [0.01, 0.3, 'log'],
    wEIspread: [1, 4, 'lin'],
    wIE: [0.02, 0.8, 'log'],
    exposures: [1, 3, 'int'],
    seqTicks: [5, 15, 'int'],
    seqCueTicks: [2, 8, 'int'],
    context: [0, 1, 'bool'],
};
/** The pattern-memory demo's settings, as the starting point. */
const SEED_GENOME = { cap: 0.111, lr: 0.028, rule: 'keep', window: 2, sameTick: 1, retention: 0.838, refractory: 0, fatigue: 0, recovery: 0.1, nInh: 5, wEI: 0.041, wEIspread: 1.706, wIE: 0.207, exposures: 1, seqTicks: 10, seqCueTicks: 5, context: 0 };

export function evaluate(genome, seeds, task = 'patterns') {
    if (task === 'simon') {
        const plain = simonScore(genome, { repeats: false }, seeds), rep = simonScore(genome, { repeats: true }, seeds);
        return { fitness: (0.7 * plain.rounds + 0.3 * rep.rounds) / 9, rounds: plain.rounds, roundsRepeats: rep.rounds, k5: 0, k10: 0, seqSteps: 0, seqOrder: 0, seqIntruders: 0 };
    }
    const k5 = score(genome, { N: 100, size: 10, K: 5 }, seeds);
    const k10 = score(genome, { N: 100, size: 10, K: 10 }, seeds);
    const seq = sequenceScore(genome, { N: 100, size: 10, length: 4 }, seeds);
    return { fitness: 0.25 * k5.exact + 0.25 * k10.exact + 0.5 * seq.score, k5: k5.exact, k10: k10.exact, seqSteps: seq.steps, seqOrder: seq.order, seqIntruders: seq.intruders };
}

function args() {
    const a = { pop: 32, gens: 30, workers: 4, seeds: '1,2,3,4', finalSeeds: '101,102,103,104,105,106,107,108', tag: 'main', task: 'patterns' };
    for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
    return a;
}

function makePool(n) {
    const workers = Array.from({ length: n }, () => fork(fileURLToPath(import.meta.url), ['--worker']));
    const pending = new Map(); const queue = []; const idle = [...workers]; let nextId = 0;
    const pump = () => { while (idle.length && queue.length) { const w = idle.pop(); const job = queue.shift(); w.send(job); } };
    for (const w of workers) w.on('message', (msg) => {
        const p = pending.get(msg.id); pending.delete(msg.id); idle.push(w);
        if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
        pump();
    });
    return {
        run: (genome, seeds, task) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); queue.push({ id, genome, seeds, task }); pump(); }),
        close: () => workers.forEach(w => w.kill()),
    };
}

let rngState = 424242;
const rnd = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0; return (rngState >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

function clamp(name, v) {
    const [lo, hi, kind] = GENES[name];
    if (kind === 'choice') return v;
    if (kind === 'bool') return v >= 0.5 ? 1 : 0;
    v = Math.min(hi, Math.max(lo, v));
    return kind === 'int' ? Math.round(v) : +v.toFixed(4);
}
function randomGene(name) {
    const [lo, hi, kind] = GENES[name];
    if (kind === 'choice') return lo[Math.floor(rnd() * lo.length)];
    if (kind === 'bool') return rnd() < 0.5 ? 1 : 0;
    if (kind === 'log') return clamp(name, Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo))));
    return clamp(name, lo + rnd() * (hi - lo));
}
const randomGenome = () => Object.fromEntries(Object.keys(GENES).map(k => [k, randomGene(k)]));
function mutate(parent, strength) {
    const g = { ...parent };
    for (const [name, [lo, hi, kind]] of Object.entries(GENES)) {
        if (rnd() > 0.3) continue;
        if (kind === 'choice' || kind === 'bool') { if (rnd() < 0.5) g[name] = randomGene(name); }
        else if (kind === 'log') g[name] = clamp(name, g[name] * Math.exp(gauss() * strength * Math.log(hi / lo) * 0.5));
        else g[name] = clamp(name, g[name] + gauss() * strength * (hi - lo) * 0.5);
    }
    return g;
}
const crossover = (a, b) => Object.fromEntries(Object.keys(GENES).map(k => [k, rnd() < 0.5 ? a[k] : b[k]]));
const keyOf = (g) => Object.keys(GENES).map(k => g[k]).join('|');

async function main() {
    const a = args();
    const seeds = a.seeds.split(',').map(Number), finalSeeds = a.finalSeeds.split(',').map(Number);
    const popSize = Number(a.pop), gens = Number(a.gens);
    const pool = makePool(Number(a.workers));
    const cache = new Map();
    const scoreCached = async (g) => { const k = keyOf(g); if (!cache.has(k)) cache.set(k, await pool.run(g, seeds, a.task)); return cache.get(k); };
    const fmt = (s) => a.task === 'simon' ? `fitness ${s.fitness.toFixed(3)} | Simon rounds survived: ${s.rounds.toFixed(1)} without repeats, ${s.roundsRepeats.toFixed(1)} with` : `fitness ${s.fitness.toFixed(3)} | patterns ${(s.k5 * 100).toFixed(0)}% / ${(s.k10 * 100).toFixed(0)}% exact | sequence ${(s.seqSteps * 100).toFixed(0)}% of steps, whole chain ${(s.seqOrder * 100).toFixed(0)}%, intruders ${(s.seqIntruders * 100).toFixed(0)}%`;

    const t0 = Date.now();
    let population = [SEED_GENOME, ...Array.from({ length: popSize - 1 }, randomGenome)];
    const history = [];
    for (let gen = 0; gen < gens; gen++) {
        const scored = await Promise.all(population.map(async g => ({ g, s: await scoreCached(g) })));
        const ranked = scored.sort((x, y) => y.s.fitness - x.s.fitness);
        const best = ranked[0], meanFit = ranked.reduce((s, r) => s + r.s.fitness, 0) / ranked.length;
        history.push({ gen, best: best.s, bestGenome: best.g, mean: meanFit });
        console.log(`gen ${String(gen).padStart(2)} | best ${fmt(best.s)} | mean ${meanFit.toFixed(3)} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        const elite = ranked.slice(0, Math.max(2, Math.floor(popSize / 4))).map(r => r.g);
        const pick = () => { const x = ranked[Math.floor(rnd() * ranked.length)], y = ranked[Math.floor(rnd() * ranked.length)]; return (x.s.fitness > y.s.fitness ? x : y).g; };
        const strength = 0.5 * (1 - gen / gens) + 0.1;
        const next = [...elite]; const seen = new Set(next.map(keyOf));
        while (next.length < popSize) {
            const child = mutate(rnd() < 0.7 ? crossover(pick(), pick()) : pick(), strength);
            if (!seen.has(keyOf(child))) { seen.add(keyOf(child)); next.push(child); }
        }
        population = next;
    }

    // Finalists on fresh seeds
    const byKey = new Map(); for (const h of history) byKey.set(keyOf(h.bestGenome), h.bestGenome);
    for (const g of population) byKey.set(keyOf(g), g);
    const top = [...cache.entries()].sort((x, y) => y[1].fitness - x[1].fitness).slice(0, 5).map(([k]) => k).filter(k => byKey.has(k));
    const final = [];
    for (const k of top) { const g = byKey.get(k); final.push({ genome: g, search: cache.get(k), fresh: await pool.run(g, finalSeeds, a.task) }); }
    const seedFresh = await pool.run(SEED_GENOME, finalSeeds, a.task);
    final.sort((x, y) => y.fresh.fitness - x.fresh.fitness);
    console.log(`\nFresh-seed check (${finalSeeds.length} seeds):`);
    console.log(`  starting point (demo settings): ${fmt(seedFresh)}`);
    final.forEach((f, i) => console.log(`  finalist ${i + 1}: ${fmt(f.fresh)}\n      ${JSON.stringify(f.genome)}`));
    fs.writeFileSync(new URL(`./evolve-${a.tag}.json`, import.meta.url), JSON.stringify({ args: a, history, final, seedFresh, evaluated: cache.size, seconds: (Date.now() - t0) / 1000 }, null, 1));
    console.log(`\n${cache.size} settings evaluated in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    pool.close();
}

// ---------------------------------------------------------------- entry point (worker or master)
if (process.argv[2] === '--worker') {
    process.on('message', (job) => {
        try { process.send({ id: job.id, result: evaluate(job.genome, job.seeds, job.task) }); }
        catch (err) { process.send({ id: job.id, error: String(err && err.stack || err) }); }
    });
} else {
    await main();
}

