// Look at the temporal structure of recorded brain activity.
import { loadTrace } from './lib.mjs';
import { loadDataset } from '../lib/harness.mjs';
const ds = process.argv[2] || 'tiny', seed = Number(process.argv[3] || 1);
const tr = loadTrace(ds, seed, true); const D = loadDataset(ds);
// active count per tick for the first 3 eval trials
for (const ev of tr.eval.slice(0, 4)) console.log(D.words[ev.word].word, ev.kind, ev.ticks.map(t => t.length).join(' '));
// per-neuron rate per word (eval full), overlap matrix
const full = tr.eval.filter(e => e.kind === 'full');
const rates = full.map(ev => { const r = new Float32Array(tr.nBrain); ev.ticks.forEach((t, k) => { if (k >= 2) for (const i of t) r[i] += 1 / (ev.ticks.length - 2); }); return r; });
rates.forEach((r, w) => { const act = [...r].filter(x => x > 0); const hist = [0, 0, 0, 0, 0]; for (const x of act) hist[Math.min(4, Math.floor(x * 5))]++; console.log(D.words[w].word.padEnd(7), 'neurons active', act.length, 'sum rate', act.reduce((a, b) => a + b, 0).toFixed(1), 'rate hist [0-.2,.2-.4,..]', hist.join(',')); });
// same-word tick-to-tick similarity: jaccard of consecutive ticks and of ticks 2 apart
const jac = (a, b) => { const s = new Set(a); let n = 0; for (const x of b) if (s.has(x)) n++; return n / (a.length + b.length - n || 1); };
for (const lag of [1, 2, 3, 4, 5, 6]) { let s = 0, n = 0; for (const ev of full) for (let t = 5; t + lag < ev.ticks.length; t++) { s += jac(ev.ticks[t], ev.ticks[t + lag]); n++; } console.log('lag', lag, 'mean jaccard', (s / n).toFixed(2)); }
// stability across training: cosine of word rate vector in epoch 1, 10, 20 vs eval
const cos = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb || 1); };
const per = tr.train.length / tr.wordEpochs;
for (const e of [0, 4, 9, 14, 19]) { let s = 0; for (let k = 0; k < per; k++) { const p = tr.train[e * per + k]; const r = new Float32Array(tr.nBrain); p.ticks.forEach((t, kk) => { if (kk >= 2) for (const i of t) r[i]++; }); s += cos(r, rates[p.teacher]); } console.log('epoch', e + 1, 'cos(train response, eval response)', (s / per).toFixed(3)); }
// pairwise cosine between words (eval)
let line = ''; for (let a = 0; a < Math.min(8, full.length); a++) { line += D.words[a].word.padEnd(7) + rates.slice(0, 8).map(r => cos(rates[a], r).toFixed(2)).join(' ') + '\n'; } console.log(line);
