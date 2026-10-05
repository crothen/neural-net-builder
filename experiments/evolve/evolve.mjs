// Evolutionary search over initial brain setups.
//   node experiments/evolve/evolve.mjs [--pop 16] [--gens 12] [--size 200] [--datasets medium,short] [--seeds 1,2]
//                                      [--workers 4] [--readout readout.json] [--out results.json] [--tag name]
// Each genome is scored on every dataset x seed (see fitness.mjs); fitness is the mean. The best genomes are
// re-scored at the end on fresh seeds, so the reported winners are not just lucky on the search seeds.
import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENES, DEFAULT_GENOME, scoreGenome } from './fitness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- master
function args() {
    const a = { pop: 16, gens: 12, size: 200, datasets: 'medium,short', seeds: '1,2', workers: 4, finalSeeds: '11,12,13,14,15', tag: 'run' };
    for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
    return a;
}

function makePool(n) {
    const workers = Array.from({ length: n }, () => fork(fileURLToPath(import.meta.url), ['--worker']));
    const pending = new Map(); const queue = []; const idle = [...workers]; let nextId = 0;
    const pump = () => { while (idle.length && queue.length) { const w = idle.pop(); const job = queue.shift(); w._job = job.id; w.send(job); } };
    for (const w of workers) w.on('message', (msg) => {
        const p = pending.get(msg.id); pending.delete(msg.id); idle.push(w);
        if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
        pump();
    });
    return {
        run: (genome, opts) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); queue.push({ id, genome, opts }); pump(); }),
        close: () => workers.forEach(w => w.kill()),
    };
}

// The search itself uses its own generator so worker results never depend on master-side randomness.
let rngState = 987654321;
const rnd = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) | 0; return (rngState >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

function clampGene(name, v) {
    const [lo, hi, kind] = GENES[name];
    if (kind === 'bool') return v >= 0.5 ? 1 : 0;
    v = Math.min(hi, Math.max(lo, v));
    return kind === 'int' || kind === 'logint' ? Math.round(v) : +v.toFixed(4);
}

function randomGenome() {
    const g = {};
    for (const [name, [lo, hi, kind]] of Object.entries(GENES)) {
        if (kind === 'bool') g[name] = rnd() < 0.5 ? 1 : 0;
        else if (kind.startsWith('log')) g[name] = clampGene(name, Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo))));
        else g[name] = clampGene(name, lo + rnd() * (hi - lo));
    }
    return g;
}

function mutate(parent, strength) {
    const g = { ...parent };
    for (const [name, [lo, hi, kind]] of Object.entries(GENES)) {
        if (rnd() > 0.35) continue; // each gene mutates with 35% probability
        if (kind === 'bool') { if (rnd() < 0.5) g[name] = g[name] ? 0 : 1; }
        else if (kind.startsWith('log')) g[name] = clampGene(name, g[name] * Math.exp(gauss() * strength * Math.log(hi / lo) * 0.5));
        else g[name] = clampGene(name, g[name] + gauss() * strength * (hi - lo) * 0.5);
    }
    return g;
}

const crossover = (a, b) => Object.fromEntries(Object.keys(GENES).map(k => [k, rnd() < 0.5 ? a[k] : b[k]]));
const keyOf = (g) => Object.keys(GENES).map(k => g[k]).join('|');

async function main() {
    const a = args();
    const datasets = a.datasets.split(','), seeds = a.seeds.split(',').map(Number), finalSeeds = a.finalSeeds.split(',').map(Number);
    const readout = a.readout ? JSON.parse(fs.readFileSync(path.resolve(HERE, a.readout), 'utf8')) : {};
    const size = Number(a.size), popSize = Number(a.pop), gens = Number(a.gens);
    const pool = makePool(Number(a.workers));
    const cache = new Map();

    const score = async (g, useSeeds) => {
        const jobs = [];
        for (const dataset of datasets) for (const seed of useSeeds) jobs.push(pool.run(g, { dataset, seed, nodeCount: size, readout }).then(r => ({ dataset, seed, ...r })));
        const parts = await Promise.all(jobs);
        const mean = (k) => parts.reduce((s, p) => s + p[k], 0) / parts.length;
        const byDataset = Object.fromEntries(datasets.map(d => { const ps = parts.filter(p => p.dataset === d); return [d, +(ps.reduce((s, p) => s + p.fitness, 0) / ps.length).toFixed(3)]; }));
        return { fitness: mean('fitness'), taughtFull: mean('taughtFull'), taughtPartial: mean('taughtPartial'), linearFull: mean('linearFull'), linearPartial: mean('linearPartial'), rate: mean('rate'), activeFrac: mean('activeFrac'), byDataset };
    };
    const scoreCached = async (g) => { const k = keyOf(g); if (!cache.has(k)) cache.set(k, await score(g, seeds)); return cache.get(k); };

    const t0 = Date.now();
    let population = [DEFAULT_GENOME, ...Array.from({ length: popSize - 1 }, randomGenome)];
    const history = [];
    let ranked = [];
    for (let gen = 0; gen < gens; gen++) {
        const scored = await Promise.all(population.map(async g => ({ g, s: await scoreCached(g) })));
        ranked = scored.sort((x, y) => y.s.fitness - x.s.fitness);
        const best = ranked[0], meanFit = ranked.reduce((s, r) => s + r.s.fitness, 0) / ranked.length;
        history.push({ gen, best: best.s.fitness, mean: meanFit, bestGenome: best.g });
        console.log(`gen ${String(gen).padStart(2)} | best ${best.s.fitness.toFixed(3)} (taught ${best.s.taughtFull.toFixed(2)}/${best.s.taughtPartial.toFixed(2)} linear ${best.s.linearFull.toFixed(2)}/${best.s.linearPartial.toFixed(2)} rate ${best.s.rate.toFixed(3)}) | mean ${meanFit.toFixed(3)} | ${((Date.now() - t0) / 1000).toFixed(0)}s`);

        // Next generation: keep the top quarter, fill with mutated crossovers of tournament winners.
        const elite = ranked.slice(0, Math.max(2, Math.floor(popSize / 4))).map(r => r.g);
        const pick = () => { const x = ranked[Math.floor(rnd() * ranked.length)], y = ranked[Math.floor(rnd() * ranked.length)]; return (x.s.fitness > y.s.fitness ? x : y).g; };
        const strength = 0.5 * (1 - gen / gens) + 0.1; // anneal mutation size
        const next = [...elite]; const seen = new Set(next.map(keyOf));
        while (next.length < popSize) {
            const child = mutate(rnd() < 0.7 ? crossover(pick(), pick()) : pick(), strength);
            if (!seen.has(keyOf(child))) { seen.add(keyOf(child)); next.push(child); }
        }
        population = next;
    }

    // Re-score the finalists and the app default on seeds the search never saw.
    const finalists = [...new Map([...cache.entries()].sort((x, y) => y[1].fitness - x[1].fitness).slice(0, 5)).keys()];
    const byKey = new Map(); for (const r of ranked) byKey.set(keyOf(r.g), r.g);
    for (const h of history) byKey.set(keyOf(h.bestGenome), h.bestGenome);
    const final = [];
    for (const k of finalists) {
        const g = byKey.get(k) || Object.fromEntries(Object.keys(GENES).map((name, i) => [name, Number(k.split('|')[i])]));
        final.push({ genome: g, search: cache.get(k), fresh: await score(g, finalSeeds) });
    }
    const defaultFresh = await score(DEFAULT_GENOME, finalSeeds);
    final.sort((x, y) => y.fresh.fitness - x.fresh.fitness);

    console.log(`\nFresh-seed check (${finalSeeds.length} seeds x ${datasets.join('+')}), brain ${size}:`);
    console.log(`  app default        fitness ${defaultFresh.fitness.toFixed(3)} taught ${defaultFresh.taughtFull.toFixed(2)}/${defaultFresh.taughtPartial.toFixed(2)} linear ${defaultFresh.linearFull.toFixed(2)}/${defaultFresh.linearPartial.toFixed(2)} rate ${defaultFresh.rate.toFixed(3)} ${JSON.stringify(defaultFresh.byDataset)}`);
    final.forEach((f, i) => console.log(`  finalist ${i + 1}         fitness ${f.fresh.fitness.toFixed(3)} taught ${f.fresh.taughtFull.toFixed(2)}/${f.fresh.taughtPartial.toFixed(2)} linear ${f.fresh.linearFull.toFixed(2)}/${f.fresh.linearPartial.toFixed(2)} rate ${f.fresh.rate.toFixed(3)} ${JSON.stringify(f.fresh.byDataset)}\n      ${JSON.stringify(f.genome)}`));

    const out = path.resolve(HERE, a.out || `results-${a.tag}-n${size}.json`);
    fs.writeFileSync(out, JSON.stringify({ args: a, readout, history, final, defaultFresh, evaluated: cache.size, seconds: (Date.now() - t0) / 1000 }, null, 1));
    console.log(`\n${cache.size} setups evaluated in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${path.relative(process.cwd(), out)}`);
    pool.close();
}

// ---------------------------------------------------------------- entry point (worker or master)
if (process.argv[2] === '--worker') {
    process.on('message', (job) => {
        try {
            process.send({ id: job.id, result: scoreGenome(job.genome, job.opts) });
        } catch (err) {
            process.send({ id: job.id, error: String(err && err.stack || err) });
        }
    });
} else {
    await main();
}
