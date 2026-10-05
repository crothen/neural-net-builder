// Speed table: build time and ms/tick by brain size, plasticity on/off (adapted from experiments/bench.mjs).
//   node experiments/scale/speed.mjs [sizes] [ticks=300] [warmup=100]
import { buildNet, present, setPlasticity, loadDataset } from '../lib/harness.mjs';
import { saveJson } from './common.mjs';

const sizes = (process.argv[2] || '25,50,100,200,400,800,1600').split(',').map(Number);
const ticks = Number(process.argv[3] || 300), warmup = Number(process.argv[4] || 100);
const out = [];
for (const dn of ['medium', 'full']) {
    const ds = loadDataset(dn);
    const cov = dn === 'full' ? 5 : 20;
    const word = ds.words[0].concepts;
    for (const n of sizes) {
        if (dn === 'full' && n > 800) continue;
        const row = { dataset: dn, coverage: cov, n };
        for (const plastic of [false, true]) {
            const b0 = performance.now();
            const ctx = buildNet({ nConcepts: ds.concepts.length, brain: { nodeCount: n }, inputLink: { coverage: cov }, seed: 1 });
            const buildMs = performance.now() - b0;
            setPlasticity(ctx, plastic);
            present(ctx, word, warmup);
            const t0 = performance.now();
            present(ctx, word, ticks);
            const ms = (performance.now() - t0) / ticks;
            row[plastic ? 'msTickOn' : 'msTickOff'] = +ms.toFixed(3);
            row.buildMs = Math.round(Math.min(row.buildMs ?? Infinity, buildMs));
            row.conns = ctx.net.connections.length;
        }
        out.push(row);
        console.log(`${dn.padEnd(6)} cov ${cov} n=${String(n).padStart(4)} | build ${row.buildMs} ms | ms/tick off ${row.msTickOff} on ${row.msTickOn} | conns ${row.conns}`);
    }
}
saveJson('speed.json', out);
