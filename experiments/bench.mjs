// Micro-benchmark: ms per engine tick for the default brain while a word is presented.
//   node experiments/bench.mjs [sizes=200] [ticks=300] [warmupTicks=0]
import { buildNet, present, setPlasticity } from './lib/harness.mjs';

const sizes = (process.argv[2] || '200').split(',').map(Number);
const ticks = Number(process.argv[3] || 300);
const warmup = Number(process.argv[4] || 0);

for (const n of sizes) {
    for (const plastic of [true, false]) {
        const ctx = buildNet({ nConcepts: 6, brain: { nodeCount: n }, seed: 1 });
        setPlasticity(ctx, plastic);
        if (warmup) present(ctx, [0, 2, 4], warmup);
        const t0 = performance.now();
        const r = present(ctx, [0, 2, 4], ticks);
        const ms = performance.now() - t0;
        let spikes = 0; for (const c of r.counts) spikes += c;
        console.log(`brain ${n} plastic ${plastic}: ${(ms / ticks).toFixed(3)} ms/tick, conns ${ctx.net.connections.length}, spikes ${spikes}`);
    }
}
