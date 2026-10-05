// Full word list (121 words, 1000 concepts), brain frozen (no Hebbian), word nodes taught with the delta rule.
//   node experiments/full/train.mjs <size> [evalAt=3,6,10] [seed=21] [coveragePercent=2] [inputWeightMax=1]
// Brain: the evolved setup, except the inputs. Words here have 42-123 concepts instead of 3-11, so the input is
// scaled down to keep the drive per neuron similar: each concept reaches 2% of the brain (instead of 20%) with
// weights up to 1.0, on random neurons.
// Test cues per word: all concepts, a random half, a random quarter, and 10 random concepts.
// Two scores per cue: "fires" = the right word node fired most (what you would see in the app); "strongest" = the
// right word node received the most input, even if no node reached its firing threshold.
// Pass "stop" as 7th argument to stop at the first checkpoint with 99% on all-concept cues.
import fs from 'node:fs';
import { buildNet, attachReadout, present, resetState, argmax, loadDataset, shuffled, activity } from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const size = Number(process.argv[2] || 1000);
const evalAt = (process.argv[3] || '3,6,10').split(',').map(Number);
const seed = Number(process.argv[4] || 21);
const coverage = Number(process.argv[5] || 2);
const wMax = Number(process.argv[6] || 1);
const earlyStop = process.argv[7] === 'stop';
const TICKS = 40;
const genome = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const ds = loadDataset('full');
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const result = { size, seed, coverage, wMax, words: ds.words.length, concepts: ds.concepts.length, checkpoints: [] };
const outFile = new URL(`./result-n${size}-s${seed}.json`, import.meta.url);

let t0 = performance.now();
const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...genomeToBuild(genome, size), inputLink: { coverage, localizer: 100 }, inputWeight: { min: 0, max: wMax } });
attachReadout(ctx, { nWords: ds.words.length, coverage: 1, normalize: false, node: { threshold: 0.5, decay: 0.95, maxPotential: 3 } });
result.buildSeconds = (performance.now() - t0) / 1000;
result.connections = ctx.net.connections.length;
log(`brain ${size}: built in ${result.buildSeconds.toFixed(0)} s, ${result.connections} connections, ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);

// Fixed test cues (drawn once, so every checkpoint and brain size sees the same ones).
const subset = (cs, n) => shuffled(cs).slice(0, Math.max(1, n));
const cues = ds.words.map(w => ({ full: w.concepts, half: subset(w.concepts, Math.round(w.concepts.length / 2)), quarter: subset(w.concepts, Math.round(w.concepts.length / 4)), ten: subset(w.concepts, 10) }));

function evaluate() {
    const t = performance.now();
    const score = { full: 0, half: 0, quarter: 0, ten: 0 }, drive = { full: 0, half: 0, quarter: 0, ten: 0 }; let rate = 0, active = 0, soloFire = 0;
    ds.words.forEach((w, wi) => {
        for (const kind of Object.keys(score)) {
            resetState(ctx);
            const r = present(ctx, cues[wi][kind], TICKS);
            if (argmax(r.wordFire) === wi) score[kind]++;
            if (argmax(r.wordDrive) === wi) drive[kind]++;
            if (kind === 'full') {
                const a = activity(r); rate += a.rate; active += a.activeFrac;
                if (argmax(r.wordFire) === wi && r.wordFire.filter(x => x > 0).length === 1) soloFire++;
            }
        }
    });
    const n = ds.words.length;
    return { full: score.full / n, half: score.half / n, quarter: score.quarter / n, ten: score.ten / n,
        driveFull: drive.full / n, driveHalf: drive.half / n, driveQuarter: drive.quarter / n, driveTen: drive.ten / n, onlyRightWordFires: soloFire / n, rate: rate / n, activeFrac: active / n, evalSeconds: (performance.now() - t) / 1000 };
}

let trainMs = 0, trainTicks = 0;
for (let epoch = 1; epoch <= Math.max(...evalAt); epoch++) {
    t0 = performance.now();
    for (const wi of shuffled(ds.words.map((_, i) => i))) {
        resetState(ctx);
        present(ctx, ds.words[wi].concepts, TICKS, { teacher: wi, learn: { rule: 'delta', lr: 0.004, nlms: true } });
        trainTicks += TICKS;
    }
    trainMs += performance.now() - t0;
    log(`pass ${epoch} done: ${(trainMs / 1000).toFixed(0)} s of teaching so far (${(trainMs / trainTicks).toFixed(1)} ms/tick)`);
    if (!evalAt.includes(epoch)) continue;
    const e = evaluate();
    result.checkpoints.push({ epoch, trainSeconds: trainMs / 1000, msPerTick: trainMs / trainTicks, ...e });
    fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
    const p = (x) => (x * 100).toFixed(0) + '%';
    log(`after ${epoch} passes (${(trainMs / 1000).toFixed(0)} s teaching): FIRES all ${p(e.full)} half ${p(e.half)} quarter ${p(e.quarter)} ten ${p(e.ten)} | STRONGEST all ${p(e.driveFull)} half ${p(e.driveHalf)} quarter ${p(e.driveQuarter)} ten ${p(e.driveTen)} | only the right word fires ${p(e.onlyRightWordFires)} | ${p(e.activeFrac)} active | test ${e.evalSeconds.toFixed(0)} s`);
    if (earlyStop && e.full >= 0.99) { log('reached 99% on all-concept cues, stopping'); break; }
}
log('DONE');
