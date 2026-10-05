// Compact tables from sweep-results.json / longrun-results.json / proto-results.json (mean±sd over seeds).
//   node experiments/plasticity/summarize.mjs
import { loadJson, ms } from './lib.mjs';

const pad = (s, n) => String(s).padEnd(n);
for (const file of ['sweep-results.json', 'proto-results.json']) {
    const all = loadJson(file);
    if (!all) continue;
    console.log(`\n### ${file}  (medium, 5 concept epochs + 10 word epochs unless the name says otherwise; m1 = after phase A, m2 = after phase B)`);
    console.log(pad('condition', 20) + ['A:linPart', 'A:sepPart', 'A:pairCos', 'B:linPart', 'B:sepPart', 'B:pairCos', 'B:cosMargin', 'B:selIdx', 'B:selFrac', 'B:wIn', 'B:wOut', 'B:rate', 'B:conns', 'B:inh', 'B:|w|', 'B:max', 'B:thr', 'B:readout'].map(h => pad(h, 12)).join(''));
    for (const [name, { runs }] of Object.entries(all)) {
        const c = (m, k, d = 2) => pad(ms(runs.map(r => r[m]?.[k]), d), 12);
        console.log(pad(name, 20) + c('m1', 'linPartial') + c('m1', 'sepPartial') + c('m1', 'pairCos') + c('m2', 'linPartial') + c('m2', 'sepPartial') + c('m2', 'pairCos') + c('m2', 'cosMargin') +
            c('m2', 'selIdx', 3) + c('m2', 'selFrac') + c('m2', 'wIn', 3) + c('m2', 'wOut', 3) + c('m2', 'rate', 3) + c('m2', 'conns', 0) + c('m2', 'inh', 0) + c('m2', 'meanAbs', 3) + c('m2', 'maxAbs') + c('m2', 'meanThr') + c('m2', 'evFull'));
    }
}
const lr = loadJson('longrun-results.json');
if (lr) for (const [arm, bySeed] of Object.entries(lr)) {
    const runs = Object.values(bySeed);
    console.log(`\n### longrun ${arm} (seeds ${runs.map(x => x.seed).join(',')}; tick = continuation ticks after 10.4k ticks of training)`);
    console.log(pad('tick', 7) + ['conns', 'exc', 'inh', '|w|', 'max', 'thr', 'rate', 'pairCos', 'sepPart', 'linPart', 'selIdx', 'evFull', 'evPart', 'fixFull', 'fixPart', 'driftCos'].map(h => pad(h, 12)).join(''));
    runs[0].snaps.forEach((s0, i) => {
        const c = (k, d = 2) => pad(ms(runs.map(x => x.snaps[i]?.[k]), d), 12);
        console.log(pad(s0.tick, 7) + c('conns', 0) + c('exc', 0) + c('inh', 0) + c('meanAbs', 3) + c('maxAbs') + c('meanThr') + c('rate', 3) + c('pairCos') + c('sepPartial') + c('linPartial') + c('selIdx', 3) + c('evFull') + c('evPartial') + c('fixFull') + c('fixPartial') + c('driftCos'));
    });
}
