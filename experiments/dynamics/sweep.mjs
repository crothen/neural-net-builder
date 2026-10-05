// One-at-a-time sweeps around the default brain (fixed network, plasticity off, paramMode 'full').
//   node experiments/dynamics/sweep.mjs <dataset> <group[,group...]> [nSeeds=3] [lite]
// groups: threshold decay refractory fatigue adaptive maxPotential inhib synapses iwm local coverage localizer inputWeight
// `lite` keeps only the entries flagged for the expensive 'short' dataset.
import { runGroup } from './lib.mjs';

const adapt = (o) => ({ sustainability: { adaptiveThreshold: true, ...o } });
const G = {
    threshold: [0.2, 0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 2.8].map(v => [`threshold ${v}`, { brain: { threshold: v } }, [0.2, 1.0, 2.0].includes(v)]),
    decay: [0.3, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99].map(v => [`decay ${v}`, { brain: { decay: v } }, [0.5, 0.99].includes(v)]),
    refractory: [0, 1, 2, 4, 8].map(v => [`refractory ${v}`, { brain: { refractoryPeriod: v } }, [0, 4].includes(v)]),
    fatigue: [[0, 0], [0.2, 0.1], [0.5, 0.1], [0.5, 0.02], [0.5, 0.5], [1, 0.1], [2, 0.1], [2, 0.02]]
        .map(([f, r]) => [`fatigue ${f} recovery ${r}`, { brain: { fatigue: f, recovery: r } }, (f === 0) || (f === 2 && r === 0.1)]),
    adaptive: [
        ['adaptive off', { brain: { sustainability: { adaptiveThreshold: false } } }, true],
        ['adaptive on (default)', { brain: adapt({}) }, false],
        ['adaptive speed 0.01', { brain: adapt({ adaptationSpeed: 0.01 }) }, false],
        ['adaptive on, warmup 10 ep', { brain: adapt({}), warmupEpochs: 10 }, false],
        ['adaptive speed 0.01, warmup 10 ep', { brain: adapt({ adaptationSpeed: 0.01 }), warmupEpochs: 10 }, true],
        ['adaptive target 0.02 sp .01 wu10', { brain: adapt({ adaptationSpeed: 0.01, targetRate: 0.02 }), warmupEpochs: 10 }, false],
        ['adaptive target 0.2 sp .01 wu10', { brain: adapt({ adaptationSpeed: 0.01, targetRate: 0.2 }), warmupEpochs: 10 }, false],
    ],
    maxPotential: [0.6, 1, 2, 3, 6, 10].map(v => [`maxPotential ${v}`, { brain: { maxPotential: v } }, [1, 10].includes(v)]),
    inhib: [0, 0.1, 0.2, 0.3, 0.5, 0.7].map(v => [`inhibitoryFraction ${v}`, { inhibitoryFraction: v }, [0, 0.5].includes(v)]),
    synapses: [1, 5, 10, 20, 40, 80].map(v => [`synapsesPerNode ${v}`, { brain: { synapsesPerNode: v } }, [1, 80].includes(v)]),
    // idealWeight = min(0.5, 1 / (synapses * iwm)); bigger modifier = weaker internal weights
    iwm: [0.05, 0.1, 0.2, 0.4, 1, 5, 1000].map(v => [`initialWeightModifier ${v}`, { brain: { initialWeightModifier: v } }, [0.1, 1, 1000].includes(v)]),
    local: [
        ['localized leak 0', { brain: { localizationLeak: 0 } }, false],
        ['localized leak 20 (default)', { brain: { localizationLeak: 20 } }, false],
        ['localized leak 50', { brain: { localizationLeak: 50 } }, false],
        ['localized leak 100', { brain: { localizationLeak: 100 } }, true],
        ['localized, rewired (control)', { unlocalize: 'control' }, true],
        ['NOT localized (rewired)', { unlocalize: true }, true],
    ],
    coverage: [5, 10, 20, 35, 50, 80, 100].map(v => [`coverage ${v}`, { inputLink: { coverage: v } }, [5, 10, 50].includes(v)]),
    localizer: [0, 10, 30, 60, 100].map(v => [`localizer ${v}`, { inputLink: { localizer: v } }, [0, 100].includes(v)]),
    inputWeight: [
        ...[0.03, 0.06, 0.1, 0.25, 0.5, 1.0].map(v => [`inputWeight ${v}`, { inputWeight: v }, [0.06, 1.0].includes(v)]),
        ['inputWeight U[0,0.25]', { inputWeight: { min: 0, max: 0.25 } }, true],
        ['inputWeight U[0,1]', { inputWeight: { min: 0, max: 1 } }, false],
        ['inputWeight U[0.2,0.3]', { inputWeight: { min: 0.2, max: 0.3 } }, false],
    ],
};

const dataset = process.argv[2] || 'medium';
const groups = (process.argv[3] || Object.keys(G).join(',')).split(',');
const nSeeds = Number(process.argv[4] || 3);
const lite = process.argv[5] === 'lite';
const seeds = Array.from({ length: nSeeds }, (_, i) => i + 1);
for (const g of groups) {
    const list = G[g].filter(e => !lite || e[2]).map(([n, c]) => [n, c]);
    if (g === groups[0]) list.unshift(['DEFAULT', {}]);
    runGroup(`oat-${g}`, dataset, list, seeds);
}
