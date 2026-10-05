// Combinations of the promising one-at-a-time settings (fixed brain, plasticity off).
//   node experiments/dynamics/combos.mjs <dataset> [nameFilterRegex] [nSeeds=3]
import { runGroup } from './lib.mjs';

const adOff = { sustainability: { adaptiveThreshold: false } };
export const COMBOS = {
    'DEFAULT': {},
    'thr1.5': { brain: { threshold: 1.5 } },
    'thr2': { brain: { threshold: 2 } },
    'thr1.5 adOff': { brain: { threshold: 1.5, ...adOff } },
    'thr2 adOff': { brain: { threshold: 2, ...adOff } },
    'thr1.5 iwm1': { brain: { threshold: 1.5, initialWeightModifier: 1 } },
    'thr1.5 iwm1 adOff': { brain: { threshold: 1.5, initialWeightModifier: 1, ...adOff } },
    'iwm1 adOff': { brain: { initialWeightModifier: 1, ...adOff } },
    'thr1 inh0.5': { brain: { threshold: 1 }, inhibitoryFraction: 0.5 },
    'thr1.5 inh0.3 iwm0.4': { brain: { threshold: 1.5, initialWeightModifier: 0.4 }, inhibitoryFraction: 0.3 },
    'thr1.5 loc30': { brain: { threshold: 1.5 }, inputLink: { localizer: 30 } },
    'thr1.5 iwm1 loc30 adOff': { brain: { threshold: 1.5, initialWeightModifier: 1, ...adOff }, inputLink: { localizer: 30 } },
    'thr2 iwm1000 fat0 adOff (pure FF)': { brain: { threshold: 2, initialWeightModifier: 1000, fatigue: 0, recovery: 0, ...adOff } },
    'thr1.5 iwm1 fat0 adOff': { brain: { threshold: 1.5, initialWeightModifier: 1, fatigue: 0, recovery: 0, ...adOff } },
    'asApp thr1.5': { brain: { threshold: 1.5 }, paramMode: 'asApp' },
    'asApp thr1.5 iwm1': { brain: { threshold: 1.5, initialWeightModifier: 1 }, paramMode: 'asApp' },
    'coverage 5': { inputLink: { coverage: 5 } },
    'coverage 10': { inputLink: { coverage: 10 } },
    'inh0.5': { inhibitoryFraction: 0.5 },
    'localizer 100': { inputLink: { localizer: 100 } },
    'syn1': { brain: { synapsesPerNode: 1 } },
    'decay0.5': { brain: { decay: 0.5 } },
    'fat0 rec0': { brain: { fatigue: 0, recovery: 0 } },
    'adaptive off': { brain: { ...adOff } },
    'asApp default': { paramMode: 'asApp' },
    'asLoaded default': { paramMode: 'asLoaded' },
    'thr1.5 cov10 iwm1 adOff': { brain: { threshold: 1.5, initialWeightModifier: 1, ...adOff }, inputLink: { coverage: 10 } },
};

if (process.argv[1].endsWith('combos.mjs')) {
    const dataset = process.argv[2] || 'medium';
    const re = new RegExp(process.argv[3] || '.');
    const nSeeds = Number(process.argv[4] || 3);
    const list = Object.entries(COMBOS).filter(([n]) => re.test(n));
    runGroup('combos', dataset, list, Array.from({ length: nSeeds }, (_, i) => i + 1));
}
