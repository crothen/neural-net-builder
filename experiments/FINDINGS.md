# Can a brain learn concepts and words? — findings

Experiments run 4–5 October 2026 against the engine in `src/engine/NeuralNet.ts`, headlessly in Node.
Four agents each studied one question (word readout, neuron dynamics, plasticity, size), followed by two
evolutionary searches over initial brain setups and a confirmation run on fresh seeds.

## Short answer

Yes. A brain learns words made of several concepts (Fire = warm + bright + yellow) close to perfectly, including
when one concept is missing — but only with three things the app does not do today:

1. a delta rule for the word (output) nodes, with an output node that holds its potential (retention 0.95);
2. a brain that fires sparsely (the default spreads activity to about 90% of neurons);
3. the brain's own Hebbian learning switched off — as currently implemented. The rule has defects; a corrected,
   bounded version is stable and rescues the default brain (Finding 7).

## Setup used in every experiment

```
concept inputs  -->  brain  -->  word outputs
(one input node      (BRAIN       (one output node per word,
 per concept)         module)      taught with a teacher signal)
```

- **Concepts are inputs, not something that is trained.** Presenting a word means firing all of its concept
  inputs every tick for 40 ticks. Each concept is already identifiable from the brain's response without any
  training (100% in every condition tested).
- **One output node per word.** The winner is the word node that fired most during the presentation.
- **Teaching:** each word is presented 20 times (20 epochs, random order, state reset between items) while its
  word node is taught. For the 50-word list that is 50 × 20 × 40 = 40,000 ticks.
- **Testing:** every word with all of its concepts ("full cue"), and with one concept left out ("partial cue").
  A partial cue is only used when the remaining concepts still fit exactly one word.

### Word lists

| Name | Concept inputs | Word outputs | Concepts per word | Source |
|---|---|---|---|---|
| tiny | 6 (warm, cold, bright, dark, yellow, blue) | 8 (Fire, Ice, Night, Sky, Sand, Lemon, Cave, Ember) | 2–3 | written for this test |
| medium | 12 (tiny + red, green, wet, dry, hard, soft) | 20 | 2–4 | written for this test |
| short | 60 (20 colours, 20 shapes, 20 textures) | 50 | 3–11 | repo, `development` branch |
| full | 1000 (20 categories × 50) | 121 | 42–123 | repo, `concepts/` on `master` |

- `tiny` deliberately contains subsets (Sand and Lemon are subsets of Fire), so a purely additive readout fails.
- `short` tops out at 98%: Radio and Remote have identical concepts.
- `tiny` has only 3 usable partial cues and `medium` 17, so their partial-cue numbers are coarse.
- `full` was only tested with an offline readout (see "Size and capacity"), not the taught one.

## Final results

Taught word readout, five fresh seeds (21–25), brain frozen unless stated. Shown as full cue / partial cue.

| Setup | Neurons | tiny | medium | short (max 98%) |
|---|---|---|---|---|
| App as it runs today (class-default neurons, learning on) | 200 | 95% / 73% | 67% / 52% | 2% / 3% |
| Default values shown in the UI, brain frozen | 200 | 85% / 27% | 45% / 6% | 7% / 0% |
| Threshold 1.5 | 200 | 100% / 67% | 100% / 93% | 90% / 76% |
| Threshold 1.5 + weak internal weights | 200 | 100% / 67% | 100% / 98% | 96% / 94% |
| Threshold 1.5 + weak internal weights + 10% input connectivity | 200 | 100% / 87% | 100% / 98% | 98% / 97% |
| Threshold 1.5 + weak internal weights, **learning on** | 200 | 100% / 80% | 89% / 64% | 31% / 9% |
| Evolved at 200 neurons | 50 | 97% / 53% | 99% / 62% | 92% / 82% |
| Evolved at 200 neurons | 200 | 100% / 100% | 100% / 93% | 98% / 99% |
| Evolved at 200 neurons | 400 | 100% / 93% | 100% / 99% | 98% / 98% |
| **Evolved at 50 neurons** | 50 | 100% / 93% | 100% / 93% | 98% / 96% |
| **Evolved at 50 neurons** | 200 | 100% / 100% | 100% / 100% | 98% / 99% |
| **Evolved at 50 neurons** | 400 | 100% / 100% | 100% / 98% | 98% / 99% |
| Threshold 1.5 + weak internal weights | 50 | 100% / 80% | 100% / 92% | 92% / 79% |
| Default values shown in the UI, brain frozen | 50 | 65% / 27% | 40% / 15% | 12% / 2% |

The setup evolved at 50 neurons is the best all-rounder: it holds from 50 to 400 neurons without retuning.

## Recommended brain setup

Best genome from the 50-neuron search (`evolve/results-main-n50.json`, finalist 1):

| Setting | App default | Recommended | Settable in the app today? |
|---|---|---|---|
| Inhibitory share | 20% | 50% | No — hard-coded in `addModule` |
| Decay (retention per tick) | 0.9 | 0.51 | Yes |
| Threshold | 0.5 | 0.6 | Yes |
| Max input weight | 0.5 | 1.33 | No — hard-coded in `connectModules` |
| Input connectivity (coverage) | 20% | 20% | Yes |
| Input localization leak (localizer) | 10% | 83% | Yes |
| Internal wiring | localized, 20% leak | not localized | Partly — connecting with localizer < 100 forces it back on |
| Synapses per neuron | 20 | 35 | Yes |
| Internal weight modifier (higher = weaker) | 0.2 | 0.72 | Yes |
| Refractory period | 1 | 1 | Yes |
| Fatigue / recovery | 0.5 / 0.1 | 0.31 / 0.5 | Yes, but only reach neurons after a UI edit |
| Output connectivity | 50% | 100% | Yes |
| Hebbian learning, synaptic scaling | on | off | Yes |

Best genome from the 200-neuron search, for comparison: coverage 31%, localizer 73%, max input weight 1.5,
localized with 48% leak, 9 synapses per neuron, weight modifier 0.26, inhibitory 50%, threshold 0.83, decay 0.39,
refractory 1, fatigue 0.75, recovery 0.5, output connectivity 62%.

**Usable without engine changes:** threshold 1.5, internal weight modifier 1, input connectivity 10%, learning
off (row 5 of the results table).

### What the two searches agree on

- About half the neurons inhibitory (45–50% in every top finalist but one).
- Fast decay: retention 0.39–0.51 instead of 0.9.
- Strong inputs (max weight 1.3–1.5) that land on mostly random neurons (localizer 66–92%).
- Fast threshold recovery (0.42–0.5).
- Input connectivity of 20–31%: the 20% default is about right.

Not sensitive (varied widely among equally good finalists): synapses per neuron (9–38), internal localization,
output connectivity (41–100%).

Inhibitory share, max input weight and recovery ended at the edge of the allowed search range, so the true
optimum may lie beyond them.

## Finding 1 — the word nodes need a delta rule

The engine on `master` has no rule that trains brain → output weights. With a simple Hebbian or perceptron rule
and the app's Learned Output node (threshold 0.5, retention 0.1), the default 200-neuron brain scored 50–75%
on `tiny` and the output node never fired.

Why it failed:

- The node never reached threshold: peak potential 0.12–0.17 against 0.5. The error signal was therefore always
  zero and the perceptron rule collapsed into plain Hebbian.
- With plain Hebbian, a word whose concepts are a superset of another's always wins (15 of 16 errors on `tiny`:
  Sand and Lemon answered as Fire, Sky as Ice, Cave as Night).
- Brain activity is sparse in time: about 18 of 200 neurons fire per tick, never the same ones on consecutive
  ticks, and the brain is silent for the first 3–8 ticks. A node with retention 0.1 sees one random sample per
  tick and flickers.

The rule that works (local: presynaptic activity, the node's own potential, a teacher bit):

```
each tick while word t is being taught:
  for each word node w:
    err = (w == t ? 3 * threshold : 0) - potential[w]
    for each incoming brain connection i:
      weight[w][i] += lr * err * activation[i]
```

- Output node: threshold 0.5, **retention 0.95**, max potential 3. Initial weights 0, negative weights allowed.
- `lr` = 0.04 with the engine's mean-normalised brain input at 200 neurons (it must scale with fan-in), or
  0.0002 with a plain sum.
- The confirmation runs used a normalised variant: `lr` 0.004 divided by the number of active inputs that tick,
  plain sum. One rate then works for any brain size, firing rate or output connectivity.
- With the brain frozen: 100% / 100% on `tiny`, 100% / 90% on `medium` (default brain, 3 seeds).
- Optional winner-take-all between word nodes does not change accuracy but makes the right node the only one
  firing in 99–100% of trials instead of 20–71%.

Tried and rejected: plain Hebbian, Hebbian with a constant anti-Hebbian term, Hebbian with L1 or L2
normalisation, fired-bit perceptron, margin perceptron, a target of 2× threshold, an eligibility trace
(marginal gain, extra state).

## Finding 2 — the brain must fire sparsely

Fixed 200-neuron brain, offline linear readout, partial-cue accuracy:

| Setup | medium | short | Neurons active per word |
|---|---|---|---|
| Default | 86% | 95% | 92% |
| Threshold 1.5 | 100% | 99% | 43% |
| Threshold 1.5 + weak internal weights | 100% | 99% | 33% |

- The default sits in a "spread" regime: recurrent excitation carries activity to about 90% of neurons, so
  words look alike (mean cosine between words 0.91).
- Three regimes: silent (rate ≈ 0), healthy sparse (rate 0.02–0.07, 25–50% active), spread or saturated
  (rate ≥ 0.11, ≥ 90% active).
- **The recurrent wiring contributes nothing positive.** Negligible internal weights, or one synapse per
  neuron, beat the default.

One-at-a-time sweep around the default (`medium`):

| Setting | Effect |
|---|---|
| Threshold | Higher is better up to the potential cap of 3; ≤ 0.35 spreads |
| Decay | Lower is better; 0.3 goes silent |
| Internal weight modifier | Bigger (weaker recurrence) is better; ≤ 0.1 saturates |
| Inhibitory share | More is better; 50–70% best, ≤ 10% saturates |
| Fatigue / recovery | Defaults fine; recovery 0.02 or fatigue 2 break it |
| Refractory period, max potential ≥ 2, internal localization | No real effect |
| Input localizer | More random is better on `medium` (78% → 94–98%), no gain on `short` |
| Input connectivity | Weak at 200 neurons; 10–20% best, 100% worst |
| Input weight | 0.1–0.25 fixed or the default range best; 1.0 fixed worse; 0.03 near-silent |

The adaptive threshold (raising thresholds until firing is sparse) achieves the same as a fixed threshold of
1.5 — but the app never applies it to neurons (see "Engine quirks").

## Finding 3 — the brain's Hebbian learning never helped

This is about the engine's rule as implemented. Finding 7 explains why it fails and tests a corrected rule.

`medium`, 200 neurons, 3 seeds. Partial-cue accuracy from an offline linear readout:

| Condition | Partial cue |
|---|---|
| Brain frozen | 98% |
| Learning on, 5 concept epochs first | 82% |
| Learning on, 20 concept epochs first | 78% |
| Learning on, 50 concept epochs first | 65% |
| Learning on for concepts, off while teaching words | 96% |

- **Concept pre-exposure hurts, and more hurts more.**
- **It does not settle.** Over 50,000 further ticks the largest weight grew from 6.7 to 43, the mean from 0.47
  to 3.2, and partial-cue accuracy fell from 92% to 55%. A never-learning control stayed at 98%.
- **It forgets.** A fixed readout scoring 100% after teaching fell to 92% after 20,000 more ticks and 28% after
  50,000. With learning off it stayed at 100%. Roughly the first 10,000 ticks are safe.
- **No reset between items is worse.** Synaptic scaling then fires and shrinks the input weights (mean 0.25 →
  0.08) until 11–12 of 12 concepts evoke no response.
- **No variant rescued it:** learning rate 0.001–0.05, regrowth 0–1, pruning threshold 0–0.05, weight budget
  1.5–12, and one prototype with a depression term and a weight cap all scored below the frozen brain.

Why the rule runs away:

- Inhibitory synapses drift past zero and turn strongly positive (236 of 237 after 60,000 ticks).
- The weight "tax" is subtracted from negative weights too, making them larger.
- No per-weight bound, no depression term, same-tick coincidence only.
- Regrowth ignores neuron type.

## Finding 4 — size and capacity

Brain frozen, default settings, offline linear readout:

| Word list | Smallest brain for 100% on full cues | Partial cues |
|---|---|---|
| tiny | 25 neurons | 78% at 200, 89% at 800 |
| medium | 50 neurons | 86–90% from 200 up |
| short | 25 neurons | 94% at 50, 97% at 200 |
| full | 25 neurons, only at 5% input connectivity | 97% at 50 with half the concepts missing |

- **Capacity is not the limit.** 25 neurons separate 50–121 words on full cues; it breaks at around 10 neurons
  (1–2 words per neuron). More neurons mainly buy robustness to missing concepts.
- **`full` fails at the default 20% input connectivity** (19%): about 80 concepts fire at once, every neuron is
  clamped at the potential cap, and all words look alike. At 5% it reaches 100%. Rule of thumb: keep
  concepts-per-word × connectivity × mean input weight at or below about 1.
- **Input connectivity at default dynamics:** at 400 neurons on `medium`, partial cues scored 98% at 5%, 96% at
  10%, 90% at 20%, 88% at 50%. With sparse dynamics the evolved setups preferred 20–31%.
- **Synapses per neuron:** weak effect; 40 is slightly better than 20 at about 1.5× the run time.
- **Learning erodes small brains:** with plasticity on for a full training run, a 50-neuron brain fell to 67%
  full cue on `medium`.

## Finding 5 — reverse recall (word → concepts) works, but needs a path back

Question: if a word's output node is activated, do its concepts fire? And do other words that share concepts
spike?

As built, nothing happens: the network is concepts → brain → words with no connection back, and the engine's
input nodes cannot receive input. Two things were added in `reverse/reverse.mjs`:

- **Word → brain feedback.** One extra input node per word, wired to every brain neuron. Its weights are learned
  while the word is taught, by plain Hebbian co-activity (weight ∝ how often that neuron fired while the word was
  taught, scaled so the strongest is 1–2). The feedback is silent during teaching and switched on for recall.
- **Brain → concept outputs.** One output node per concept, taught with the same delta rule as the word nodes
  (teacher = "this concept is currently on"). These are separate nodes, not the concept inputs themselves.

Evolved 50-neuron setup at 200 neurons, brain frozen, five seeds. A word node is activated with no concept input:

| | tiny | medium | short |
|---|---|---|---|
| Brain state matches the one its concepts evoke (cosine, own word / other words) | 0.98 / 0.45 | 0.98 / 0.40 | 0.99 / 0.63 |
| Exactly the word's concepts fire, no others | 100% | 100% | 100% |
| Concepts ranked through the fixed input weights turned around (no concept training) | 100% | 100% | 95% |
| Recalled concepts fed back in as input → same word fires | 100% | 100% | 98% |

- **Yes, reverse recall works**, with Hebbian feedback at a gain of 1 or 2. At 0.5 the brain stays silent.
- **Turning the forward word weights around does not work well** (exact concept set 63% / 60% / 18% at the best
  gain). The delta rule makes those weights discriminative, not descriptive.
- `short` shows 98% in the last row because Radio and Remote are identical.

**Do words with shared concepts spike? Barely.** Other word nodes while one word is activated in reverse
(feedback gain 2):

| Concepts shared with the activated word | Brain similarity to that other word | Other word node spikes at all | Its potential, relative to the activated word |
|---|---|---|---|
| tiny: 0 / 1 / 2 | 0.22 / 0.54 / 0.81 | 0% / 0% / 12% | 0% / 1% / 12% |
| medium: 0 / 1 / 2 / 3 | 0.25 / 0.50 / 0.72 / 0.88 | 0% / 0% / 3% / 30% | 0% / 1% / 6% / 24% |
| short: 0 / 2 / 4 / 5+ | 0.48 / 0.63 / 0.76 / 0.80 | 0% / 0% / 1% / 1% | 0% / 0% / 2% / 4% |

- The brain state itself is graded by overlap: the more concepts two words share, the more alike their brain
  states (0.2–0.5 with none shared, 0.8–0.9 with most shared). So the association is present in the brain.
- The taught word nodes do not show it, because the delta rule trains every other word node to stay silent.
  Only words sharing nearly all concepts spike occasionally (30% of trials on `medium` with 3 shared).
- The same holds in the forward direction, so this is a property of the readout rule, not of the reversal.
- Spreading to related words would need a less selective readout (Hebbian-style or a lower threshold), which is
  the same change that makes supersets beat subsets on full cues. It is a trade-off, not a free addition.

## Finding 6 — two-stage training (Hebbian pre-exposure to word combinations, then frozen word teaching)

Idea: stage 1 presents each word's concepts together with Hebbian learning on and no word node involved;
stage 2 freezes the brain and teaches the word nodes with the delta rule. 200 neurons, three seeds, engine
default plasticity settings. Cells are full cue / one concept missing after 5 and after 20 word-teaching passes.

Evolved setup:

| Stage-1 passes | medium, 5 | medium, 20 | short, 5 | short, 20 | Internal connections (short) | Largest weight (short) |
|---|---|---|---|---|---|---|
| 0 (frozen control) | 88% / 80% | 100% / 98% | 93% / 84% | 98% / 99% | 7000 | 0.2 |
| 1 | 92% / 86% | 100% / 98% | 97% / 93% | 98% / 99% | 790 | 3.0 |
| 2 | 95% / 84% | 100% / 96% | 97% / 93% | 98% / 99% | 846 | 5.8 |
| 5 | 92% / 78% | 100% / 100% | 97% / 90% | 98% / 99% | 1003 | 14.6 |
| 10 | 87% / 75% | 100% / 98% | 93% / 79% | 98% / 99% | 1232 | 30.7 |
| 20 | 87% / 61% | 100% / 96% | 91% / 81% | 98% / 98% | 1667 | 59.8 |
| 50 | 90% / 59% | 100% / 98% | 90% / 74% | 97% / 98% | 2823 | 135.5 |

App default setup (values shown in the UI, adaptive threshold off):

| Stage-1 passes | medium, 20 | short, 20 | Word similarity (medium) |
|---|---|---|---|
| 0 (frozen control) | 43% / 6% | 8% / 0% | 0.93 |
| 1 | 70% / 25% | 33% / 13% | 0.87 |
| 2 | 80% / 31% | 43% / 20% | 0.84 |
| 5 | 92% / 59% | 41% / 18% | 0.77 |
| 10 | 92% / 59% | 38% / 13% | 0.76 |
| 20 | 83% / 47% | 23% / 7% | 0.75 |
| 50 | 78% / 45% | 5% / 3% | 0.75 |

Hand-picked setup (threshold 1.5, weak internal weights, 10% input connectivity):

| Stage-1 passes | medium, 20 | short, 20 | Neurons active (short) |
|---|---|---|---|
| 0 (frozen control) | 100% / 100% | 97% / 97% | 37% |
| 1 | 100% / 100% | 97% / 96% | 39% |
| 2 | 100% / 94% | 97% / 96% | 43% |
| 5 | 100% / 98% | 91% / 80% | 64% |
| 10 | 100% / 96% | 19% / 5% | 92% |
| 20 | 98% / 90% | 28% / 11% | 97% |
| 50 | 72% / 29% | 46% / 17% | 93% |

- **Default brain: a clear win.** Five passes take `medium` from 43% to 92%. Stage 1 reduces the spread of
  activity that makes the default brain's words look alike. It still ends well below the tuned setups.
- **Evolved brain: faster word learning, same final accuracy.** One or two passes lift the 5-pass result on
  `short` from 93% / 84% to 97% / 93%.
- **Long stage 1 hurts.** The largest weight grows by about 3 per pass on `short` and never levels off. The
  hand-picked setup collapses on `short` at 10 passes, when activity spreads to 92% of neurons.
- **Recommended stage-1 length:** one or two passes for a tuned brain, about five for the default.
- **Part of the effect is pruning.** On the evolved setup the first pass deletes about 90% of the internal
  connections, because most start below the 0.05 pruning threshold. A control that only deletes those weak
  connections (7000 → 3163, no Hebbian learning) gave 95% / 87% after 5 passes on `short`: between the frozen
  control (93% / 84%) and real stage 1 (97% / 93%).
- **Regrowth is what degrades long runs on the evolved setup.** With the gentler settings (no regrowth, budget
  1.5) it stays at 95–98% / 90–94% after 5 word passes on `short` for every stage-1 length from 1 to 50, even
  though the largest weight reaches 170.

Scripts and logs: `twostage.mjs`, `twostage-log-*.txt`, `twostage-*.json`.

## Finding 7 — why the engine's Hebbian rule fails, and a corrected rule

"Hebbian never helped" (Finding 3) is a verdict on this implementation, not on the idea. The rule has real
defects, measured on the default 200-neuron brain with `hebbian/diag.mjs`:

1. **It rewards the wrong pairs.** A spike needs one tick to arrive and the sender is then refractory, so a
   source that actually caused its target to fire is never active in the same tick as the target. The rule only
   looks at same-tick pairs. In one pass over 20 words a source fired one tick before its target 85,450 times;
   the rule strengthened that synapse 0 times. It strengthens neurons that share an input instead.
2. **The weight budget does not limit anything.**
   - The "tax" is subtracted from every incoming weight regardless of sign, with no floor at zero. Excitatory
     synapses are pushed negative and keep growing: 812 of 1,783 were negative after 32,000 ticks.
   - The tax is also charged when an inhibitory source fires with its target, although nothing was added, so
     the signed total drifts down (236 → −7,913).
   - Being over budget only switches the tax on; it never pulls the total back. Summed |w| went 933 → 10,871.
3. **Regrowth ignores neuron type.** New connections get a weight in [−0.2, 0.2] whatever the source, and the
   inhibitory ±0.001 step has no sign check, so inhibitory neurons acquire growing positive weights (8 synapses
   on the default brain, up to 85 on the evolved one).
4. **Synaptic scaling was effectively off in these tests.** It runs when `tickCount % 100 === 0`, and
   `resetState()` zeroes the counter; with a reset before every 40-tick item it never fires. Without resets it
   does fire, but it also shrinks the concept → brain input weights until concepts evoke nothing.

### Corrected rule (prototype in `hebbian/twostage-v2.mjs`, applied from the script)

```
when target neuron j fires at tick t, for each excitatory incoming synapse i -> j:
    w += rate * ( pre_i(t-1) - w / cap )
```

- Active inputs move towards the cap, silent ones decay towards 0; each weight settles at cap × "how often was
  this input active just before the target fired".
- Weights stay in [0, cap] and cannot change sign. No tax, pruning or regrowth. Inhibitory synapses are fixed.
- Tested with rate 0.05 and cap = 2 × the brain's mean initial excitatory weight, in the two-stage protocol.

App default brain, after 20 word passes (full cue / one concept missing, three seeds):

| | medium | short |
|---|---|---|
| Frozen, no stage 1 | 43% / 6% | 8% / 0% |
| Engine rule, best stage-1 length | 92% / 59% | 43% / 20% |
| Engine rule, 50 passes | 78% / 45% | 5% / 3% |
| Corrected rule (causal), 2 passes | 100% / 98% | 95% / 81% |
| Corrected rule (causal), 50 passes | 100% / 92% | 95% / 82% |
| Corrected rule (same-tick), 50 passes | 100% / 96% | 93% / 83% |
| Control: every excitatory weight × 0.22, no learning | 100% / 92% | 95% / 87% |

- **Stable and self-limiting.** No degradation from 2 to 50 passes; weights sit at or below the cap.
- **It rescues the default brain** (8% → 95% on `short`) and far outperforms the engine's rule.
- **It does no harm to good brains.** Evolved and hand-picked setups stay at 97–100% for every stage-1 length.
- **It does not beat the control.** Uniformly shrinking the excitatory weights by the same average amount
  (mean 0.176 → 0.039) gives the same result. The gain comes from turning down recurrent excitation, not from
  word-specific structure.
- **Causal vs same-tick timing made no measurable difference** on these tests.
- **A higher cap is worse.** On `medium` the default brain scored 100% / 92% at cap ×2, 80% / 39% at ×4, and
  7% / 0% at ×8 (every neuron active). On `short`: 95% / 82% at ×2, 21–31% / 3% at ×4, 0% at ×8. Stronger
  recurrent excitation spreads activity; it does not complete patterns.

Conclusion: a bounded Hebbian rule works as automatic tuning of an over-excitable brain. Whether the brain can
usefully store the word combinations in its own connections is still open. This task does not need it (the word
nodes do the specific learning), so a test that does — recall from half the concepts, noisy input — would be
the next step, together with inhibition that learns alongside excitation so stronger assemblies do not spread.

## Finding 8 — letting inhibition learn alongside excitation

Question from Finding 7: stronger excitatory links spread activity; would inhibition that learns keep them
confined, so Hebbian assemblies become useful? Prototype in `hebbian/inhibition.mjs`:

```
excitatory (as in Finding 7):   when target j fires:                 w += 0.05 * (pre_i(t-1) - w / cap)
inhibitory:                     when inhibitory source i fired at t-1: strength(i->j) += 0.02 * (rate_j - 0.05)
```

`rate_j` is the target's recent firing rate (running average, 10% per tick). Inhibitory strength is kept in
[0, 4 × mean initial strength], so a synapse can never turn excitatory. Stage 1 = 10 passes, then normal word
teaching with the brain frozen. 200 neurons, three seeds. Two harder tests were added: a random half of the
word's concepts (only cues that still fit exactly one word), and all concepts plus two wrong ones.

Default brain, `short` (all concepts / one missing / half / plus 2 wrong, then neurons active):

| Stage 1 | Accuracy | Active |
|---|---|---|
| None (frozen) | 8% / 1% / 1% / 3% | 100% |
| Control: excitatory weights × 0.22 | 95% / 88% / 80% / 73% | 68% |
| Excitatory only, cap ×2 | 95% / 81% / 73% / 56% | 76% |
| Excitatory + inhibitory, cap ×2 | 94% / 83% / 75% / 60% | 75% |
| Excitatory only, cap ×4 | 27% / 8% / 6% / 11% | 98% |
| Excitatory + inhibitory, cap ×4 | 50% / 26% / 18% / 19% | 94% |
| Excitatory + inhibitory, cap ×8 | 1% / 0% / 0% / 1% | 100% |

Default brain, `medium`: 100% / 98% / 97–98% / 47–53% at cap ×2 with or without inhibition (control 100% / 92%
/ 100% / 50%); cap ×4 gives 78% / 59% without and 90% / 73% with inhibition; cap ×8 collapses (7%).

Evolved brain, `short`:

| Stage 1 | Accuracy | Active | Word similarity |
|---|---|---|---|
| None (frozen) | 98% / 98% / 85% / 96% | 53% | 0.63 |
| Control: excitatory weights × 0.22 | 98% / 99% / 85% / 98% | 51% | 0.62 |
| Excitatory only, cap ×2 | 98% / 99% / 87% / 95% | 52% | 0.62 |
| Excitatory + inhibitory, cap ×2 | 98% / 99% / 91% / 96% | 45% | 0.52 |
| Excitatory + inhibitory, cap ×4 | 98% / 99% / 88% / 96% | 46% | 0.53 |
| Excitatory + inhibitory, cap ×8 | 98% / 99% / 91% / 96% | 47% | 0.53 |

Evolved brain, `medium`: 100% / 96–100% / 100% / 50–57% in every condition.

- **Learned inhibition does not make stronger excitatory links usable.** At cap ×4 it roughly doubles accuracy
  on the default brain but stays far below cap ×2; at ×8 the inhibitory synapses sit at their ceiling and every
  neuron still fires. With 20% inhibitory neurons the default brain cannot hold strong excitation back.
- **At the working cap it adds nothing on the default brain**, which still does not beat the shrink control.
- **One modest gain on the evolved brain:** half-concept recall on `short` goes from 85% to 88–91%.
- **That gain is sparser coding, not pattern completion.** Fewer neurons fire and words look less alike, but the
  brain state for a half cue is slightly further from the full-cue state (similarity 0.75 vs 0.79).
- The evolved brain is far more robust to wrong concepts than the default (96% vs 73% at best on `short`).
  On `medium`, two wrong concepts are a large part of a 2–4 concept word, so that test sits near 50% everywhere.

Conclusion: in this engine, Hebbian learning inside the brain has still not produced anything a simple weight
adjustment does not. Not tried: a higher inhibitory ceiling, more inhibitory neurons on the default brain,
inhibitory neurons that are themselves driven harder by the assembly, or recurrent learning with resets off.

## Finding 9 — the full repo list (121 words, 1,000 concepts), brain frozen

Evolved setup with the inputs scaled for this list: its words have 42–123 concepts (79 on average) instead of
3–11, so each concept reaches 2% of the brain instead of 20%, with weights up to 1.0 on random neurons. Test
cues: all concepts, a random half, a random quarter, and 10 random concepts. "Fires" = the right word node
fired most; "strongest" = it received the most input even if no node reached threshold.

200 neurons, three seeds:

| Passes | All (fires) | Half (fires) | Quarter (fires) | Quarter (strongest) | 10 concepts (strongest) |
|---|---|---|---|---|---|
| 2 | 99% | 17% | 0% | 90% | 69% |
| 4 | 100% | 95% | 0% | 99% | 80% |
| 10 | 100% | 100% | 23% | 100% | 87% |
| 20 | 100% | 100% | 38% | 100% | 88% |

By brain size (one seed each):

| Neurons | Connections | Build | Passes | All / half / quarter (fires) | 10 concepts (strongest) | Teaching time |
|---|---|---|---|---|---|---|
| 200 | 11,000 | < 1 s | 10 | 100% / 100% / 23% | 87% | 32–47 s |
| 2,000 | 110,000 | 4 s | 10 | 100% / 100% / 28% | 100% | 927 s |
| 20,000 | 1,100,000 | 836 s | 4 | 100% / 100% / 0% | 100% | 5,236 s (270 ms per tick) |

- **200 neurons are enough for this list.** A hundred times more neurons buys only one thing: with just 10
  concepts the right word is always the strongest candidate (100% instead of 87%).
- **From 4 passes on, the right word node is the only one firing** on full cues, at every size.
- **Few-concept cues point at the right word but do not make it fire.** The drive is proportional to how many
  concepts are on, so a quarter cue gives a quarter of the input; the node stays under threshold.
- **Cost grows faster than size.** 20,000 neurons take 14 minutes to build and 270 ms per tick; its single test
  (484 presentations) took 78 minutes. Times were measured with other runs sharing the machine.
- **This list is easy** because its word-to-concept links are random: sets of about 79 out of 1,000 barely
  overlap. See the real list below.

Scripts and logs: `full/train.mjs`, `full/log-n*.txt`, `full/result-n*.json`.

## A real word list: `concepts-real/`

Written by an agent to replace the random associations with true ones (Wolf: mammal, predator, canine, gray,
fur, pack, howl, forest ...), and larger in every dimension.

| | Repo full list | `concepts-real/` |
|---|---|---|
| Concept groups | 20 | 36 |
| Concepts | 1,000 | 2,660 |
| Words | 121 | 1,039 |
| Concepts per word | 42–123 (mean 79) | 10–30 (mean 19.9) |
| Associations | random | real, checked for consistency |

- 26 domain files (mammals, birds, sea life, insects and reptiles, fruit, vegetables, food, drinks, trees and
  plants, tools, kitchen, household, furniture, clothing, vehicles, buildings and places, landscape, weather,
  materials, musical instruments, sports and toys, electronics, body parts, professions).
- Groups have natural sizes (Size 7, Color 24, Function 340, Parts 310, Category 282).
- No two words share an identical concept set and none differ by only one concept. Tight families exist
  (Violin/Viola and Orange/Mandarin differ by 4 concepts, Lemon/Lime by 5, Wolf/Coyote and Cup/Mug by 6), but
  840 of the 1,039 words are 10 or more concepts away from their nearest neighbour.
- 126 concepts are used by a single word (signature features such as Meow or Trunk).
- Known weak spots, from the author: Function and Action overlap (Digging / Dig); attire sits under Covering;
  some animal, food and tool rows were not re-checked after a late pruning pass; about 40 words were
  spot-checked.
- Format: `groups/<Group>.csv` (ID, Word), `words/<domain>.csv` (written with labels), and
  `training-data.csv` in the same ID form as `concepts/training-data.csv`, generated by
  `node experiments/datasets/build-real.mjs concepts-real`, which also validates the list.
- Loaded in the harness as `loadDataset('real')`.

## Finding 10 — how small can the brain get on the real list?

Evolved setup, brain frozen, words taught with the delta rule. Input connectivity 6% (set from the list's 19.9
concepts per word). Word subsets are random draws from the 1,039 words. 2–3 seeds. Each cell is all concepts /
one missing / a random half / all plus 2 wrong concepts, after 15 teaching passes; a word counts only if its
node fired most.

| Neurons | 100 words | 250 words | 500 words | 1,039 words |
|---|---|---|---|---|
| 25 | 99% / 98% / 73% / 97% | 89% / 87% / 37% / 75% | 48% / 45% / 13% / 34% | 20% / 18% / 5% / 14% |
| 50 | 100% / 100% / 97% / 100% | 100% / 100% / 85% / 100% | 99% / 98% / 71% / 94% | 90% / 88% / 40% / 70% |
| 100 | 100% / 100% / 100% / 100% | 100% / 100% / 98% / 100% | 100% / 100% / 97% / 100% | 100% / 100% / 91% / 99% |
| 200 | 100% / 100% / 100% / 100% | 100% / 100% / 100% / 100% | 100% / 100% / 99% / 100% | 100% / 100% / 98% / 100% |
| 400 | 100% / 100% / 100% / 100% | – | 100% / 100% / 99% / 100% | 100% / 100% / 99% / 100% |

After only 5 passes on all 1,039 words: 100 neurons 95% / 94% / 47% / 88%, 200 neurons 98% / 98% / 74% / 97%,
400 neurons 98% / 98% / 84% / 98%.

- **100 neurons hold all 1,039 real words at 100%**, also with one concept missing, and 99% with two wrong
  concepts added. That is about ten words per neuron, with 2,660 concept inputs.
- **50 neurons hold 500 words at 99%** and 1,039 at 90%. **25 neurons hold 100 words at 99%.**
- **The capacity limit on full cues is roughly 10–20 words per neuron**: 25 neurons break between 100 and 250
  words, 50 neurons between 500 and 1,039.
- **Recall from half the concepts is what costs neurons.** On the full list it is 40% at 50 neurons, 91% at
  100, 98% at 200 and 99% at 400.
- **More neurons also learn faster**: half-concept recall after 5 passes is 47% / 74% / 84% at 100 / 200 / 400.
- **Beyond 200 neurons there is nothing left to gain** on this list with these tests.
- Teaching time for 15 passes over 1,039 words (shared machine): 17 min at 100 neurons, 23 min at 200, 42 min
  at 400.

Caveats: real overlap exists but most words are far from their nearest neighbour (840 of 1,039 differ from it
by 10 or more concepts), so this is harder than the random list but not a worst case. Not tested: only the
confusable families, fewer than half the concepts, or the taught readout running inside the app.

Scripts and logs: `real/sweep.mjs`, `real/log-*.txt`, `real/sweep-real-*.json`.

## Finding 11 — pattern completion on a tiny brain (Hebbian only, no teacher)

A different use case from words: store patterns in the brain's own connections and bring a whole pattern back
from part of it. No concept inputs, no word nodes, no error signal. Neurons are stimulated directly and the
result is read off which neurons fire.

Setup (`patterns/lib.mjs`): N excitatory neurons, all-to-all with tiny random weights (0–0.02), threshold 1,
each with its own stimulation input. A pattern is a random set of 10 neurons; one exposure = stimulate them
together for 20 ticks. Test: stimulate a random half for 20 ticks. "Exact" = all missing neurons came on and
nothing outside the pattern did. The engine's own plasticity is off; the rule is applied from the script.

**Step 1 — one pattern, 40 neurons, 20 seeds:**

| Rule (what counts as "fired together") | Exposures | Missing neurons that came on | Outside neurons that came on |
|---|---|---|---|
| Same tick | 5 | 22% | 0% |
| Sender one tick earlier | 5 | 15% | 0% |
| Within a 3-tick window | 1 | 100% | 0% |

- **One exposure is enough**, and activity stops when the cue stops.
- **The timing window is what matters.** Neurons stimulated together fire every 2–3 ticks, out of step with
  each other because of the refractory period, so a strict same-tick or one-tick rule only catches about 40% of
  the pairings and the weights stay too weak (0.10 instead of the 0.25 cap).

**Steps 2–3 — several patterns, 100 neurons, 20 fresh seeds, exact recall:**

| Stored patterns | First hand-picked setup | Best setup from a 600-sample search |
|---|---|---|
| 1 | 100% | 100% |
| 2 | 70% | 100% |
| 5 | 25% | 90% |
| 10 | 1% | 59% |
| 15 | – | 24% |
| 20 | – | 1% |

With the best setup the missing neurons always come on (100% at every count); what fails is neurons from other
patterns coming on too (0% of outsiders up to 5 patterns, 2% at 10, 30% at 15, 83% at 20).

Why several patterns are harder, and what fixed part of it:

- **Patterns leak through shared neurons.** Two random patterns of 10 out of 100 share 2 or more neurons about a
  quarter of the time, and two strong links were enough to switch on a neuron of the other pattern.
- **Teaching one pattern damaged another.** With the first rule, a silent sender is weakened whenever the
  receiver fires, so a neuron belonging to two patterns lost its links to the first while the second was taught.
  Leaving silent senders alone ("keep") removed that.
- **Leaked activity gets learned.** If a neuron of pattern A fires while B is being taught, it is wired into B,
  and the patterns merge.
- **Feedback inhibition keeps activity to one pattern's worth.** A small pool of inhibitory neurons, driven by
  all excitatory ones and pushing all of them down, with fixed weights.

Best setup found (`patterns/capacity.mjs`): rule "keep" with a 3-tick window, weight cap 0.111, learning rate
0.028, one exposure, retention 0.838, refractory 0, 5 inhibitory neurons (excitatory → inhibitory 0.041–0.070,
inhibitory → excitatory −0.207). The search scored it 83% at 10 patterns on its own seeds and it gave 59% on
fresh ones, so part of its edge was luck.

Where this stands: one pattern is solid, up to about 5 patterns of 10 on 100 neurons is reliable, 10 is
shaky. An ideal memory of this kind would hold roughly 30 such patterns, because a neuron should only come on
when nearly all cue neurons point at it; here about three links suffice. Not yet done: sequences (A then B),
other pattern sizes and brain sizes, and running the rule inside the engine instead of from a script.

## Engine speed-up

`step()` took about 13 ms per tick with learning on, mostly from filtering and locale-sorting all brain nodes
every tick for regrowth, and re-deriving wiring from Maps. It now caches that structure per topology and updates
the cache incrementally on prune and regrowth.

| Scenario (2,500 ticks) | Before | After |
|---|---|---|
| Default network as loaded | 13.2 ms/tick | 1.0 ms/tick |
| Fresh brain, all plasticity features | 14.1 ms/tick | 1.5 ms/tick |
| Mixed modules with live edits | 2.7 ms/tick | 0.35 ms/tick |

`_ref/equivalence.mjs` runs the old and new engine with the same seed and compares every weight and node state:
identical in all three scenarios.

A second pass made the input summing event-driven: only the outgoing connections of nodes that are active on a
tick are visited, and each target adds what it received in its original order, so the sums are the same numbers
(still identical in the equivalence test; the only theoretical difference is a non-finite weight on a silent
connection). This matters when most sources are silent, as with the real list's 2,660 concept inputs of which
about 20 are on at a time. Cost per tick still grows with the number of active connections and with the number
of nodes: 20,000 neurons ran at 270 ms per tick before this change.

## Engine quirks found (not fixed)

- **Loading a network ignores module settings.** `fromJSON` restores neurons with class defaults (threshold
  1.0, decay 0.9, refractory 2), whatever the module says (the default network says 0.5 and 1).
- **Fatigue and recovery** are not passed to neurons by `addModule`; they only arrive after a UI edit.
- **Adaptive threshold never reaches neurons**, so the toggle does nothing. It also changes `threshold` while
  firing tests `currentThreshold`, so it would only act through fatigue and recovery.
- **Learned Output nodes hard-code retention 0.1** in `populateLearnedOutput`; they cannot fire from brain input.
- **Inhibitory synapses can turn positive** (no sign check in the ±0.001 homeostatic step).
- **`learningRate || 0.01`** turns a rate of 0 into 0.01.
- **Synaptic scaling rescales input weights**, not only internal ones.
- **`connectModules` under-delivers coverage** (samples with replacement, about 86% of nominal) and forces
  internal localization on whenever the localizer is below 100.
- **Module membership by ID prefix** (`startsWith(moduleId)`), so one module ID being a prefix of another mixes
  their connections.

## Caveats

- The word readout lives in the harness, not in the app. It is feed-forward, so it computes what the engine
  would if those connections and that rule existed.
- Evolution scored setups with the brain frozen and adaptive threshold off, on `medium` + `short`, seeds 1–2,
  and re-scored finalists on seeds 11–15. The confirmation table uses seeds 21–25.
- Some agent results used the harness's `paramMode: 'full'`, where the adaptive threshold is active and keeps
  drifting even when the brain is "frozen". Those numbers depend on how much was presented beforehand. The
  evolution and confirmation runs have it off.
- `resetState()` zeroes the tick counter, so with reset between 40-tick items synaptic scaling (every 100 ticks)
  never fires.
- Refractory jitter is random, so responses to the same input vary slightly between presentations.

## Reproducing

Run from the repo root.

| Command | What it does |
|---|---|
| `npx esbuild experiments/lib/engine-entry.ts --bundle --format=esm --outfile=experiments/lib/engine.mjs` | Rebuild the engine bundle after changing `src/engine` |
| `node experiments/_ref/equivalence.mjs` | Old vs new engine, state for state |
| `node experiments/bench.mjs 200,800 1000 3000` | Tick time by brain size |
| `node experiments/baseline.mjs tiny medium` | Default brain, standard protocol |
| `node experiments/confirm.mjs all tiny,medium,short 21,22,23,24,25 200` | The final results table |
| `node experiments/evolve/evolve.mjs --pop 16 --gens 10 --size 200 --workers 2` | Evolutionary search |
| `node experiments/reverse/reverse.mjs tiny,medium,short 21,22,23,24,25 200 1,2` | Reverse recall and spreading |
| `node experiments/twostage.mjs evolved medium,short 21,22,23 0,1,2,5,10,20,50 default` | Two-stage training (setups: evolved, threshold, default; variants: default, gentle, pruneonly) |
| `node experiments/timing.mjs short 200 21,22,23` | Teaching time and accuracy by number of passes |
| `node experiments/full/train.mjs 200 2,4,10,20 21` | Old full list (121 words) on one brain size |
| `node experiments/datasets/build-real.mjs concepts-real` | Validate the real list and regenerate its ID form |
| `node experiments/real/sweep.mjs 25,50,100,200 100,250,500,all 21,22,23 5,15 real main` | Brain size × word count on the real list |
| `node experiments/hebbian/inhibition.mjs default short,medium 21,22,23 10` | Learned inhibition (Finding 8) |
| `node experiments/patterns/completion.mjs 40 10 1 0,1,2,5 same,causal,window 20` | Pattern completion, one pattern, three timing rules |
| `node experiments/patterns/capacity.mjs best 100 10 1,2,5,10,15,20 20` | How many patterns fit (use `first` for the hand-picked setup) |
| `node experiments/patterns/search.mjs 150 1` | Random search over the small-brain setup |
| `node experiments/hebbian/diag.mjs default medium 21` | What the engine's Hebbian rule strengthens, and where the growth comes from |
| `node experiments/hebbian/twostage-v2.mjs default causal` | Two-stage training with the corrected rule (rules: causal, same, shrink; then datasets, seeds, stage-1 lengths, rate, cap factor) |

Files:

- `lib/harness.mjs` — builds concepts → brain → words on the real engine; datasets, readout rules, metrics.
- `evolve/fitness.mjs`, `evolve/evolve.mjs` — genes, fitness, search; results in `evolve/results-main-n*.json`.
- `confirm.mjs` — named setups × word lists × seeds; logs in `confirm-log-*.txt`.
- `reverse/reverse.mjs` — reverse recall; log in `reverse/log-n200.txt`, raw numbers in `reverse/results-n200.json`.
- `readout/`, `dynamics/`, `plasticity/`, `scale/` — each agent's scripts and raw JSON results.
- `readout/traces/` — 15 MB of recorded brain traces, safe to delete.

## Open items

- Build the delta rule and a configurable output-node retention into the engine.
- Make inhibitory share and input weight range configurable.
- Decide whether to fix the engine quirks above; they change how existing networks behave.
- Widen the search ranges for inhibitory share, input weight and recovery.
- Reverse recall needs word → brain feedback connections and concept output nodes in the app; neither exists.
- If related words should light up, try a less selective word readout and measure what it costs on full cues.
- Test the taught readout on the `full` list, and running without a state reset between items.
- Replace the engine's Hebbian rule with the bounded one from Finding 7 (it is stable and tunes an
  over-excitable brain); it lives only in the experiment script so far.
- Show whether recurrent learning can add something a weight shrink cannot: test recall from half the concepts
  and from noisy input, and let inhibition learn alongside excitation.
