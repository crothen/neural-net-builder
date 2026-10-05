// Reverse recall: activate a WORD and see whether its CONCEPTS come back, and whether other words that share
// concepts light up too.
//   node experiments/reverse/reverse.mjs [datasets=tiny,medium,short] [seeds=21,22,23,24,25] [size=200] [gains=0.5,1,2,4]
//
// The forward network (concepts -> brain -> words) has no path back, and the engine's input nodes cannot receive
// input, so two things are added here:
//   word -> brain feedback : one extra input node per word, connected to every brain neuron. Its weights are
//                            learned while the word is taught, by plain Hebbian co-activity
//                            (weight ~ how often that neuron fired while the word was being taught), or taken
//                            from the forward word weights turned around ("transpose").
//   brain -> concept output: one output node per concept, taught with the same delta rule as the word nodes
//                            (teacher = "this concept is currently on"), or read through the fixed input weights
//                            turned around ("transpose", no learning).
// The feedback is silent during teaching and only switched on for recall.
import fs from 'node:fs';
import { buildNet, loadDataset, shuffled, resetState, cosine } from '../lib/harness.mjs';
import { genomeToBuild } from '../evolve/fitness.mjs';

const datasets = (process.argv[2] || 'tiny,medium,short').split(',');
const seeds = (process.argv[3] || '21,22,23,24,25').split(',').map(Number);
const SIZE = Number(process.argv[4] || 200);
const GAINS = (process.argv[5] || '0.5,1,2,4').split(',').map(Number);
const TICKS = 40, SKIP = 5, EPOCHS = 20;
const GENOME = JSON.parse(fs.readFileSync(new URL('../evolve/results-main-n50.json', import.meta.url), 'utf8')).final[0].genome;

/** Delta-rule readout over brain spikes (same maths as the harness word readout, but several teachers at once). */
class Readout {
    constructor(n, nB, { threshold = 0.5, decay = 0.95, maxPotential = 3, lr = 0.004, hi = 3 } = {}) {
        Object.assign(this, { n, nB, threshold, decay, maxPotential, lr, hi });
        this.W = Array.from({ length: n }, () => new Float32Array(nB));
        this.potential = new Float32Array(n); this.firing = new Uint8Array(n);
    }
    reset() { this.potential.fill(0); this.firing.fill(0); }
    step(active) {
        for (let u = 0; u < this.n; u++) {
            const W = this.W[u]; let sum = 0;
            for (let k = 0; k < active.length; k++) sum += W[active[k]];
            let p = (this.potential[u] + sum) * this.decay;
            p = p < 0 ? 0 : p > this.maxPotential ? this.maxPotential : p;
            this.potential[u] = p; this.firing[u] = p >= this.threshold ? 1 : 0;
        }
    }
    learn(active, isTarget) {
        if (!active.length) return;
        const step = this.lr / active.length;
        for (let u = 0; u < this.n; u++) {
            const err = (isTarget[u] ? this.hi * this.threshold : 0) - this.potential[u];
            if (err === 0) continue;
            const W = this.W[u];
            for (let k = 0; k < active.length; k++) W[active[k]] += step * err;
        }
    }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const activeOf = (ctx) => { const a = []; for (let i = 0; i < ctx.brainNodes.length; i++) if (ctx.brainNodes[i].activation > 0) a.push(i); return a; };

function runSeed(dsName, seed) {
    const ds = loadDataset(dsName);
    const nC = ds.concepts.length, nW = ds.words.length;
    const ctx = buildNet({ nConcepts: nC, seed, ...genomeToBuild(GENOME, SIZE) });
    const { net, brainNodes } = ctx; const nB = brainNodes.length;

    // Extra input node per word, wired to every brain neuron with weight 0 (set after teaching).
    net.addModule({ id: 'wordsin', type: 'INPUT', x: 1200, y: 400, nodeCount: nW, depth: 1, height: 600, activationType: 'PULSE' });
    const wordIn = Array.from({ length: nW }, (_, w) => net.nodes.get(`wordsin-0-${w}`));
    const fb = Array.from({ length: nW }, (_, w) => brainNodes.map((b, i) => {
        net.addConnection({ id: `fb-${w}-${i}`, sourceId: wordIn[w].id, targetId: b.id, weight: 0 });
        return net.connections[net.connections.length - 1];
    }));
    // Fixed concept -> brain input weights, for the "turned around" concept read-out.
    const Win = Array.from({ length: nC }, () => new Float32Array(nB));
    for (const c of net.connections) if (c.sourceId.startsWith('concepts-0-')) Win[Number(c.sourceId.split('-')[2])][Number(c.targetId.split('-')[1])] = c.weight;

    const words = new Readout(nW, nB), concepts = new Readout(nC, nB);
    const coRate = Array.from({ length: nW }, () => new Float32Array(nB)); // Hebbian trace: word taught x neuron fired
    const isWord = ds.words.map((_, w) => Uint8Array.from({ length: nW }, (_, k) => (k === w ? 1 : 0)));
    const hasConcept = ds.words.map(w => Uint8Array.from({ length: nC }, (_, c) => (w.concepts.includes(c) ? 1 : 0)));

    /** Drive the brain for TICKS ticks from concepts and/or a word node; returns what happened. */
    const run = ({ cue = [], word = -1, teach = -1 }) => {
        resetState(ctx); words.reset(); concepts.reset();
        const counts = new Float32Array(nB), wFire = new Float32Array(nW), wPot = new Float32Array(nW), cFire = new Float32Array(nC), cBack = new Float32Array(nC);
        for (let t = 0; t < TICKS; t++) {
            for (const c of cue) ctx.conceptNodes[c].trigger(1);
            if (word >= 0) wordIn[word].trigger(1);
            net.step();
            const active = activeOf(ctx);
            words.step(active); concepts.step(active);
            if (teach >= 0) {
                words.learn(active, isWord[teach]); concepts.learn(active, hasConcept[teach]);
                for (const i of active) coRate[teach][i] += 1;
            }
            if (t < SKIP) continue;
            for (const i of active) { counts[i]++; for (let c = 0; c < nC; c++) cBack[c] += Win[c][i]; }
            for (let w = 0; w < nW; w++) { wFire[w] += words.firing[w]; wPot[w] += words.potential[w]; }
            for (let c = 0; c < nC; c++) cFire[c] += concepts.firing[c];
        }
        const n = TICKS - SKIP;
        return { counts, wFire: wFire.map(x => x / n), wPot: wPot.map(x => x / n), cFire: cFire.map(x => x / n), cBack };
    };

    // ---- teach (forward): word readout, concept readout and the Hebbian feedback trace all learn together
    for (let e = 0; e < EPOCHS; e++) for (const w of shuffled(ds.words.map((_, i) => i))) run({ cue: ds.words[w].concepts, teach: w });

    // ---- forward reference: each word's true concepts
    const fwd = ds.words.map(w => run({ cue: w.concepts }));
    const argmax = (a) => { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; };
    const shared = (a, b) => ds.words[a].concepts.filter(c => ds.words[b].concepts.includes(c)).length;
    const CAP = 5;
    // How active are OTHER word nodes, grouped by the number of concepts they share with the activated word.
    // "cos" is how similar the brain state is to the one the other word normally evokes (what a non-selective
    // readout would see); fire/pot/spiking are the taught, selective word nodes.
    const spread = (res, w, acc, ref) => {
        for (let o = 0; o < nW; o++) {
            if (o === w) continue;
            const s = Math.min(shared(w, o), CAP);
            (acc[s] ??= { fire: [], pot: [], spiking: [], cos: [] });
            acc[s].fire.push(res.wFire[o]); acc[s].pot.push(res.wPot[o] / (res.wPot[w] || 1)); acc[s].spiking.push(res.wFire[o] > 0 ? 1 : 0);
            acc[s].cos.push(cosine(res.counts, ref[o].counts));
        }
    };
    const fwdSpread = {}; fwd.forEach((r, w) => spread(r, w, fwdSpread, fwd));
    const out = { forwardAcc: mean(fwd.map((r, w) => (argmax(r.wFire) === w ? 1 : 0))), fwdSpread, byMode: {} };

    // ---- reverse: switch the feedback on, activate one word node, no concept input
    const topK = (scores, k) => [...scores.keys()].sort((a, b) => scores[b] - scores[a]).slice(0, k);
    for (const mode of ['hebbian', 'transpose']) for (const gain of GAINS) {
        for (let w = 0; w < nW; w++) {
            const src = mode === 'hebbian' ? coRate[w] : words.W[w];
            let mx = 0; for (let i = 0; i < nB; i++) if (src[i] > mx) mx = src[i];
            for (let i = 0; i < nB; i++) fb[w][i].weight = mx > 0 ? gain * Math.max(0, src[i]) / mx : 0;
        }
        const m = { brainId: [], cosOwn: [], cosOther: [], precAtK: [], backPrecAtK: [], prec: [], recall: [], exact: [], selfWord: [], loopWord: [], rate: [] };
        const revSpread = {};
        ds.words.forEach((word, w) => {
            const r = run({ word: w });
            const cos = fwd.map(f => cosine(r.counts, f.counts));
            m.brainId.push(argmax(cos) === w ? 1 : 0); m.cosOwn.push(cos[w]); m.cosOther.push(mean(cos.filter((_, o) => o !== w)));
            m.rate.push(mean([...r.counts]) / (TICKS - SKIP));
            const truth = new Set(word.concepts), k = word.concepts.length;
            m.precAtK.push(topK(r.cFire, k).filter(c => truth.has(c)).length / k);
            m.backPrecAtK.push(topK(r.cBack, k).filter(c => truth.has(c)).length / k);
            const recalled = [...r.cFire.keys()].filter(c => r.cFire[c] > 0.5); // concept node fired on most ticks
            const hit = recalled.filter(c => truth.has(c)).length;
            m.prec.push(recalled.length ? hit / recalled.length : 0); m.recall.push(hit / k);
            m.exact.push(hit === k && recalled.length === k ? 1 : 0);
            m.selfWord.push(argmax(r.wFire) === w && r.wFire[w] > 0 ? 1 : 0);
            spread(r, w, revSpread, fwd);
            // closed loop: feed the recalled concepts back in as ordinary input (word node off)
            const loop = recalled.length ? run({ cue: recalled }) : null;
            m.loopWord.push(loop && argmax(loop.wFire) === w && loop.wFire[w] > 0 ? 1 : 0);
        });
        out.byMode[`${mode}@${gain}`] = { ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, mean(v)])), revSpread };
        for (let w = 0; w < nW; w++) for (let i = 0; i < nB; i++) fb[w][i].weight = 0;
    }
    return out;
}

const fmt = (x) => (Number.isNaN(x) || x == null ? ' n/a' : x.toFixed(2));
const all = {};
for (const dsName of datasets) {
    const runs = seeds.map(s => runSeed(dsName, s));
    all[dsName] = runs;
    console.log(`\n=== ${dsName} | brain ${SIZE} | ${seeds.length} seeds | forward word accuracy ${fmt(mean(runs.map(r => r.forwardAcc)))}`);
    console.log('feedback       brain looks like  cos own/other  concepts: top-k  fired prec/recall  exact set  top-k via input weights  own word fires  loop->word  rate');
    for (const key of Object.keys(runs[0].byMode)) {
        const g = (k) => mean(runs.map(r => r.byMode[key][k]));
        console.log(`${key.padEnd(14)} ${fmt(g('brainId')).padStart(8)}          ${fmt(g('cosOwn'))}/${fmt(g('cosOther'))}        ${fmt(g('precAtK'))}        ${fmt(g('prec'))}/${fmt(g('recall'))}       ${fmt(g('exact'))}             ${fmt(g('backPrecAtK'))}               ${fmt(g('selfWord'))}         ${fmt(g('loopWord'))}     ${g('rate').toFixed(3)}`);
    }
    const table = (label, pick) => {
        const rows = [0, 1, 2, 3, 4, 5].map(s => {
            const xs = runs.map(pick).map(sp => sp[s]).filter(Boolean);
            if (!xs.length) return null;
            return `shared ${s}${s === 5 ? '+' : ' '}: brain similarity ${fmt(mean(xs.map(x => mean(x.cos))))} | word node: any spike ${fmt(mean(xs.map(x => mean(x.spiking))))}, fires ${fmt(mean(xs.map(x => mean(x.fire))))} of ticks, potential ${fmt(mean(xs.map(x => mean(x.pot))))} of own word (n=${xs.reduce((a, x) => a + x.fire.length, 0)})`;
        }).filter(Boolean);
        console.log(`  other word nodes, ${label}:\n    ` + rows.join('\n    '));
    };
    table('FORWARD (true concepts presented)', r => r.fwdSpread);
    for (const key of Object.keys(runs[0].byMode).filter(k => k.startsWith('hebbian'))) table(`REVERSE ${key}`, r => r.byMode[key].revSpread);
}
fs.writeFileSync(new URL(`./results-n${SIZE}.json`, import.meta.url), JSON.stringify({ size: SIZE, seeds, gains: GAINS, genome: GENOME, results: all }, null, 1));
