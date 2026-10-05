// Checks the IN-APP pattern memory (src/demos/patternMemory.ts + the engine's 'window' rule) against the
// experiment: teach K patterns once each, cue each with a random half, count exact recalls.
//   node experiments/patterns/app-check.mjs [patterns=1,2,5,10] [seeds=20]
import { NeuralNet, PatternMemory } from '../lib/engine.mjs';
import { seedRandom } from '../lib/harness.mjs';

const counts = (process.argv[2] || '1,2,5,10').split(',').map(Number);
const SEEDS = Number(process.argv[3] || 20);
const pct = (x) => (x * 100).toFixed(0).padStart(3) + '%';
console.log('patterns | exact recall | missing neurons that came on | wrong neurons that came on');
for (const K of counts) {
    let exact = 0, on = 0, missing = 0, intr = 0, outside = 0, trials = 0;
    for (let seed = 101; seed < 101 + SEEDS; seed++) {
        seedRandom(seed);
        const net = new NeuralNet();
        const memory = new PatternMemory(net);
        const run = () => { let guard = 0; while (memory.busy && guard++ < 1000) net.step(); };
        for (let k = 0; k < K; k++) memory.addPattern();
        for (const p of memory.patterns) { memory.teach(p); run(); }
        for (const p of memory.patterns) {
            let result; memory.recall(p, r => { result = r; }); run();
            trials++; if (result.exact) exact++;
            on += result.cameOn.length; missing += result.cameOn.length + result.stayedOff.length;
            intr += result.intruders.length; outside += memory.excitatoryIds.length - p.nodeIds.length;
        }
    }
    console.log(`${String(K).padStart(8)} | ${pct(exact / trials).padStart(12)} | ${pct(on / missing).padStart(28)} | ${pct(intr / outside).padStart(25)}`);
}
