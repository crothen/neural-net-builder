// The IN-APP Simon game (src/demos/simon.ts + engine rule), headless: rounds survived over seeds.
//   node experiments/patterns/simon-app-check.mjs [seeds=12] [repeats=1] [stepSignal=0]
import { NeuralNet, SimonGame } from '../lib/engine.mjs';
import { seedRandom } from '../lib/harness.mjs';
const SEEDS = Number(process.argv[2] || 12), repeats = process.argv[3] !== '0', stepSignal = process.argv[4] === '1';
let sum = 0; const hist = {};
for (let seed = 101; seed < 101 + SEEDS; seed++) {
    seedRandom(seed);
    const net = new NeuralNet();
    const game = new SimonGame(net, { repeats, stepSignal });
    while (!game.gameOver && game.round < game.options.maxRounds) {
        let done = false;
        game.playRound(() => {}, () => {}, () => { done = true; });
        let guard = 0; while (!done && guard++ < 5000) net.step();
        if (!done) break;
    }
    sum += game.round; hist[game.round] = (hist[game.round] || 0) + 1;
}
console.log(`in-app Simon (repeats ${repeats ? 'yes' : 'no'}, step signal ${stepSignal ? 'on' : 'off'}): rounds survived mean ${(sum / SEEDS).toFixed(1)} | ${JSON.stringify(hist)}`);
