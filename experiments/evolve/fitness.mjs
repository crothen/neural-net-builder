// Fitness of one brain setup ("genome") for the evolutionary search.
import {
    buildNet, attachReadout, present, resetState, evaluate, linearCeiling, loadDataset, shuffled, activity,
} from '../lib/harness.mjs';

/** Genes: [min, max, scale]. 'log' genes mutate multiplicatively, 'int' genes are rounded, 'bool' genes flip. */
export const GENES = {
    inputCoverage: [2, 90, 'log'],          // % of the brain each concept reaches (app default 20)
    inputLocalizer: [0, 100, 'lin'],        // % of input connections that ignore topography (app default 10)
    inputWeightMax: [0.1, 1.5, 'log'],      // input weights are uniform in [0, max] (engine default 0.5)
    isLocalized: [0, 1, 'bool'],            // internal wiring to nearest neighbours (app default true)
    localizationLeak: [0, 100, 'lin'],      // % of internal connections that go to a random neuron (app default 20)
    synapsesPerNode: [2, 60, 'logint'],     // outgoing internal connections per neuron (app default 20)
    initialWeightModifier: [0.05, 1, 'log'],// larger = weaker internal weights (app default 0.2)
    inhibitoryFraction: [0, 0.5, 'lin'],    // engine hard-codes 0.2
    threshold: [0.2, 2, 'log'],             // app default 0.5 (1.0 as loaded)
    decay: [0.3, 0.98, 'lin'],              // retention per tick (class default 0.9)
    refractoryPeriod: [0, 5, 'int'],        // app default 1 (2 as loaded)
    fatigue: [0, 1, 'lin'],                 // threshold jump after a spike (app default 0.5)
    recovery: [0.01, 0.5, 'log'],           // threshold recovery per tick (app default 0.1)
    readoutCoverage: [0.05, 1, 'log'],      // fraction of brain neurons each word node listens to (app default 0.5)
};

/** The app's default network expressed as a genome. */
export const DEFAULT_GENOME = {
    inputCoverage: 20, inputLocalizer: 10, inputWeightMax: 0.5, isLocalized: 1, localizationLeak: 20,
    synapsesPerNode: 20, initialWeightModifier: 0.2, inhibitoryFraction: 0.2, threshold: 0.5, decay: 0.9,
    refractoryPeriod: 1, fatigue: 0.5, recovery: 0.1, readoutCoverage: 0.5,
};

export function genomeToBuild(g, nodeCount) {
    return {
        brain: {
            nodeCount,
            hebbianLearning: false, // evolution scores the initial setup; plasticity is studied separately
            sustainability: { synapticScaling: false, adaptiveThreshold: false },
            isLocalized: !!g.isLocalized, localizationLeak: g.localizationLeak,
            synapsesPerNode: g.synapsesPerNode, initialWeightModifier: g.initialWeightModifier,
            threshold: g.threshold, decay: g.decay, refractoryPeriod: g.refractoryPeriod,
            fatigue: g.fatigue, recovery: g.recovery,
        },
        paramMode: 'full',
        inputLink: { coverage: g.inputCoverage, localizer: g.inputLocalizer },
        inputWeight: { min: 0, max: g.inputWeightMax },
        inhibitoryFraction: g.inhibitoryFraction,
    };
}

/**
 * Score one genome on one dataset and seed.
 * opts.readout: optional overrides { learn, node, normalize, wordEpochs, scoreBy } of the taught word readout.
 * Returns the parts and a single `fitness` in [0, 1]:
 *   40% taught-readout full-cue accuracy, 30% taught-readout partial-cue accuracy,
 *   15% linear-ceiling full, 15% linear-ceiling partial.
 * (When a dataset has no usable partial cues, the full-cue score stands in for it.)
 */
export function scoreGenome(g, { dataset, seed, nodeCount = 200, ticks = 30, readout = {} }) {
    const ds = typeof dataset === 'string' ? loadDataset(dataset) : dataset;
    // Connection ids are prefix-matched in the engine; building straight after seeding keeps runs reproducible.
    const ctx = buildNet({ nConcepts: ds.concepts.length, seed, ...genomeToBuild(g, nodeCount) });
    // Readout from the readout study: delta rule on the node potential, node retention 0.95. The NLMS form is used
    // so one learning rate is fair to every genome (brain activity and readout fan-in vary a lot between them).
    attachReadout(ctx, { nWords: ds.words.length, coverage: g.readoutCoverage, node: readout.node || { threshold: 0.5, decay: 0.95, maxPotential: 3 }, normalize: readout.normalize ?? false, w0: readout.w0 });

    const learn = readout.learn || { rule: 'delta', lr: 0.004, nlms: true };
    const wordEpochs = readout.wordEpochs ?? 15;
    for (let e = 0; e < wordEpochs; e++) {
        for (const wi of shuffled(ds.words.map((_, i) => i))) {
            resetState(ctx);
            present(ctx, ds.words[wi].concepts, ticks, { teacher: wi, learn });
        }
    }
    const ev = evaluate(ctx, ds, { ticks });
    const lin = linearCeiling(ctx, ds, { ticks, trainReps: 2, epochs: 150 });

    const key = readout.scoreBy === 'drive' ? 'Drive' : 'Fire'; // "fire" = the word node the user would see firing
    const tFull = ev['full' + key], tPart = ev['partial' + key] ?? tFull;
    const lFull = lin.full, lPart = lin.partial ?? lFull;
    return {
        fitness: 0.4 * tFull + 0.3 * tPart + 0.15 * lFull + 0.15 * lPart,
        taughtFull: tFull, taughtPartial: tPart, linearFull: lFull, linearPartial: lPart,
        rate: ev.rate, activeFrac: ev.activeFrac,
    };
}
