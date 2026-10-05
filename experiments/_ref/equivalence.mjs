// Checks that the optimised engine (experiments/lib/engine.mjs, built from src/) behaves EXACTLY like the
// original one (engine-old.mjs, built from git HEAD): same seed + same script => identical weights and node state.
//   node experiments/_ref/equivalence.mjs
import fs from 'node:fs';
import { NeuralNet as NewNet } from '../lib/engine.mjs';
import { NeuralNet as OldNet } from './engine-old.mjs';

function seed(s) {
    let a = s >>> 0;
    Math.random = () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function snapshot(net) {
    const nodes = [...net.nodes.values()].map(n => [n.id, n.potential, n.activation, n.isFiring, n.refractoryTimer, n.threshold, n.currentThreshold, n.averageFiringRate]);
    const conns = net.connections.map(c => [c.sourceId, c.targetId, c.weight, c.signalStrength]);
    const incoming = [...net.incoming.entries()].map(([k, v]) => [k, v.map(c => c.sourceId)]);
    return JSON.stringify({ tick: net.tickCount, nodes, conns, incoming });
}

const defaultNet = JSON.parse(fs.readFileSync('src/initial-setup/initial-network.json', 'utf8'));
const BRAIN = defaultNet.modules.find(m => m.type === 'BRAIN');

const scenarios = {
    // The app's default network, exactly as the browser loads it, inputs driven in a rotating pattern.
    'default network (fromJSON)': (net, tick) => {
        if (tick === 0) net.fromJSON(JSON.parse(JSON.stringify(defaultNet)));
        const inputs = [...net.nodes.values()].filter(n => n.type === 'INPUT');
        inputs.forEach((n, i) => { if ((tick + i * 7) % 23 < 9) n.trigger(1); });
    },
    // Freshly built default brain with every plasticity feature on, plus fatigue pushed to the nodes.
    'fresh brain, all plasticity': (net, tick) => {
        if (tick === 0) {
            net.addModule({ id: 'in', type: 'INPUT', x: 0, y: 400, nodeCount: 8, depth: 1, height: 600, activationType: 'PULSE' });
            net.addModule({ ...JSON.parse(JSON.stringify(BRAIN)), id: 'brain', regrowthRate: 1.6, pruningThreshold: 0.06 });
            net.addModule({ id: 'out', type: 'SUSTAINED_OUTPUT', x: 900, y: 400, nodeCount: 6, depth: 1, height: 600, gain: 3, decay: 0.9, threshold: 1 });
            net.connectModules('in', 'brain', 'ALL', 'ALL', 20, 10);
            net.connectModules('brain', 'out', 'ALL', 'ALL', 50, 100);
            net.updateModule('brain', { fatigue: 0.5, recovery: 0.1, threshold: 0.5 });
        }
        for (let i = 0; i < 8; i++) if (Math.floor(tick / 40) % 8 === i || (tick % 3 === 0 && i === 7 - (Math.floor(tick / 40) % 8))) net.nodes.get(`in-0-${i}`).trigger(1);
    },
    // Several module types, two brains feeding each other (brain normalisation), layers, pulse + sustained outputs,
    // and topology edits through the public API while running (exercises cache invalidation).
    'mixed modules + live edits': (net, tick) => {
        if (tick === 0) {
            net.addModule({ id: 'in', type: 'INPUT', x: 0, y: 400, nodeCount: 6, depth: 1, height: 600, activationType: 'PULSE' });
            net.addModule({ id: 'noise', type: 'INPUT', x: 0, y: 900, nodeCount: 3, depth: 1, height: 200, activationType: 'PULSE' });
            net.addModule({ id: 'ba', type: 'BRAIN', x: 400, y: 400, nodeCount: 60, radius: 150, threshold: 0.5, decay: 0.9, refractoryPeriod: 1, synapsesPerNode: 8, regrowthRate: 0.5, sustainability: { synapticScaling: true, targetSum: 2.5, adaptiveThreshold: false, targetRate: 0.05, adaptationSpeed: 0.001, scalingPeriod: 50 } });
            net.addModule({ id: 'bb', type: 'BRAIN', x: 900, y: 400, nodeCount: 40, radius: 120, threshold: 0.4, decay: 0.8, refractoryPeriod: 2, synapsesPerNode: 6, learningRate: 0.03 });
            net.addModule({ id: 'layer', type: 'LAYER', x: 1300, y: 400, nodeCount: 5, depth: 3, height: 400, threshold: 0.3 });
            net.addModule({ id: 'out', type: 'OUTPUT', x: 1700, y: 400, nodeCount: 4, depth: 1, height: 300, threshold: 0.05 });
            net.addModule({ id: 'sus', type: 'SUSTAINED_OUTPUT', x: 1700, y: 900, nodeCount: 4, depth: 1, height: 300, gain: 3, decay: 0.9, threshold: 1 });
            net.addModule({ id: 'sus2', type: 'SUSTAINED_OUTPUT', x: 2000, y: 900, nodeCount: 3, depth: 1, height: 300, gain: 2, decay: 0.8, threshold: 0.5 });
            net.connectModules('in', 'ba', 'ALL', 'ALL', 40, 20);
            net.connectModules('noise', 'bb', 'ALL', 'ALL', 30, 100);
            net.connectModules('ba', 'bb', 'ALL', 'ALL', 30, 50);
            net.connectModules('bb', 'ba', 'ALL', 'ALL', 10, 100);
            net.connectModules('bb', 'layer', 'ALL', 'LEFT', 60, 100);
            net.connectModules('layer', 'out', 'RIGHT', 'ALL', 100, 100);
            net.connectModules('ba', 'sus', 'ALL', 'ALL', 50, 100);
            net.connectModules('sus', 'sus2', 'ALL', 'ALL', 100, 100);
            net.connectModules('sus', 'out', 'ALL', 'ALL', 100, 100);
            for (const n of net.nodes.values()) if (n.id.startsWith('noise-')) { n.inputType = 'NOISE'; n.inputFrequency = 3; }
        }
        if (tick === 300) net.updateModule('ba', { nodeCount: 75 });
        if (tick === 500) net.updateModule('ba', { fatigue: 0.3, recovery: 0.05, threshold: 0.45 });
        if (tick === 700) net.disconnectModules('bb', 'ba');
        if (tick === 900) net.connectModules('bb', 'ba', 'ALL', 'ALL', 20, 100);
        if (tick === 1100) net.updateModule('bb', { synapsesPerNode: 9 });
        if (tick === 1300) net.removeModule('sus2');
        if (tick === 1500) net.updateModule('layer', { depth: 2 });
        if (tick === 1700) net.resetState();
        for (let i = 0; i < 6; i++) if ((tick + i * 5) % 17 < 6) net.nodes.get(`in-0-${i}`).trigger(1);
    },
};

let allOk = true;
for (const [name, script] of Object.entries(scenarios)) {
    const TICKS = 2500;
    const run = (Net) => {
        seed(12345);
        const realNow = Date.now; let fake = 1e12; Date.now = () => fake++;
        const net = new Net();
        const snaps = [];
        const t0 = performance.now();
        for (let t = 0; t < TICKS; t++) { script(net, t); net.step(); if (t % 250 === 249 || t < 5) snaps.push(snapshot(net)); }
        const ms = performance.now() - t0;
        Date.now = realNow;
        return { snaps, ms, conns: net.connections.length };
    };
    const a = run(OldNet), b = run(NewNet);
    const firstDiff = a.snaps.findIndex((s, i) => s !== b.snaps[i]);
    const ok = firstDiff < 0;
    allOk &&= ok;
    console.log(`${ok ? 'IDENTICAL' : 'DIFFERENT (snapshot ' + firstDiff + ')'}  ${name}: ${TICKS} ticks, ${a.conns} conns at end | old ${(a.ms / TICKS).toFixed(2)} ms/tick -> new ${(b.ms / TICKS).toFixed(2)} ms/tick (${(a.ms / b.ms).toFixed(1)}x)`);
}
process.exit(allOk ? 0 : 1);
