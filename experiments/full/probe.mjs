// Feasibility probe for big brains on the full word list: build time, memory, ms per tick, activity.
//   node experiments/full/probe.mjs <size> [coveragePercent=2] [inputWeightMax=1]
import fs from 'node:fs';
import { buildNet, present, resetState, loadDataset, activity } from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const size = Number(process.argv[2] || 2000);
const coverage = Number(process.argv[3] || 2);
const wMax = Number(process.argv[4] || 1);
const genome = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;
const ds = loadDataset('full');

let t0 = performance.now();
const b = genomeToBuild(genome, size);
const ctx = buildNet({ nConcepts: ds.concepts.length, seed: 1, ...b, inputLink: { coverage, localizer: 100 }, inputWeight: { min: 0, max: wMax } });
const buildMs = performance.now() - t0;
const mem = process.memoryUsage();
console.log(`size ${size}: build ${(buildMs / 1000).toFixed(1)} s, ${ctx.net.connections.length} connections, heap ${(mem.heapUsed / 1e6).toFixed(0)} MB, rss ${(mem.rss / 1e6).toFixed(0)} MB`);

t0 = performance.now();
let rate = 0, active = 0; const n = 3;
for (let w = 0; w < n; w++) { resetState(ctx); const a = activity(present(ctx, ds.words[w].concepts, 40)); rate += a.rate; active += a.activeFrac; }
const ms = (performance.now() - t0) / (n * 40);
console.log(`size ${size}: ${ms.toFixed(1)} ms/tick | firing rate ${(rate / n).toFixed(3)}, ${(100 * active / n).toFixed(0)}% of neurons active per word (${ds.words.slice(0, n).map(w => w.concepts.length).join(', ')} concepts)`);
