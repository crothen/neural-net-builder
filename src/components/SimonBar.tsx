import React, { useEffect, useRef, useState } from 'react';
import type { NeuralCanvasHandle } from './NeuralCanvas';
import { SimonGame, SIMON_DEFAULTS } from '../demos/simon';
import type { RoundResult } from '../demos/simon';

interface SimonBarProps {
    canvasRef: React.RefObject<NeuralCanvasHandle | null>;
    onNetworkChanged: () => void;
    onRun: () => void;
    onClose: () => void;
}

const TILE_COLORS = ['#ff5f5f', '#ffb000', '#fff06b', '#7dff6b', '#5fffe1', '#5fb4ff', '#c79bff', '#ff5fd2', '#ffffff'];

type Phase = { kind: 'idle' } | { kind: 'showing', step: number, total: number } | { kind: 'replaying' } | { kind: 'result', result: RoundResult };

/** Simon on a 3x3 board: the Brain watches the sequence light up, then has to press it back by itself. */
export const SimonBar: React.FC<SimonBarProps> = ({ canvasRef, onNetworkChanged, onRun, onClose }) => {
    const gameRef = useRef<SimonGame | null>(null);
    const [lit, setLit] = useState<number | null>(null);        // tile currently lit on the board
    const [pressed, setPressed] = useState<number[]>([]);        // tiles the Brain pressed this round
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const [round, setRound] = useState(0);
    const [stepSignal, setStepSignal] = useState(SIMON_DEFAULTS.stepSignal);
    const [repeats, setRepeats] = useState(SIMON_DEFAULTS.repeats);

    const build = (opts?: { stepSignal?: boolean, repeats?: boolean }) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const game = new SimonGame(canvas.getNet(), { stepSignal: opts?.stepSignal ?? stepSignal, repeats: opts?.repeats ?? repeats });
        gameRef.current = game;
        setLit(null); setPressed([]); setRound(0); setPhase({ kind: 'idle' });
        onNetworkChanged();
        canvas.fitToView({ bottom: 230 });
        onRun();
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        build();
        return () => { canvas?.setView(undefined); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Canvas: ring the lit tile's neurons in its colour, draw only learned links.
    useEffect(() => {
        const game = gameRef.current;
        if (!game) return;
        const marks = new Map<string, { color: string, bold?: boolean }>();
        const highlight = lit ?? (pressed.length ? pressed[pressed.length - 1] : null);
        if (highlight !== null) for (const id of game.tiles[highlight]) marks.set(id, { color: TILE_COLORS[highlight], bold: true });
        canvasRef.current?.setView({ nodeMarks: marks, connectionFilter: game.isLearnedLink, restingAlpha: 0.22 });
    }, [lit, pressed, round, canvasRef]);

    const game = gameRef.current;
    const busy = phase.kind === 'showing' || phase.kind === 'replaying';

    const play = () => {
        if (!game || busy || game.gameOver) return;
        const total = game.round + 1;
        setPressed([]);
        setPhase({ kind: 'showing', step: 0, total });
        game.playRound(
            tile => { setLit(tile); if (tile === null) setPhase({ kind: 'replaying' }); else setPhase(p => ({ kind: 'showing', step: (p.kind === 'showing' ? p.step : 0) + 1, total })); },
            tile => { setPressed(p => [...p, tile]); setLit(tile); setTimeout(() => setLit(null), 350); },
            result => { setLit(null); setRound(game.round); setPhase({ kind: 'result', result }); },
        );
        onRun();
    };

    const tileName = (t: number) => String(t + 1);
    let status: React.ReactNode = 'The Brain watches tiles light up, then presses them back from memory. Play round 1.';
    if (game && phase.kind === 'showing') status = `Round ${phase.total}: showing the sequence (${Math.min(phase.step, phase.total)}/${phase.total}). Learning is on.`;
    if (game && phase.kind === 'replaying') status = `Round ${game.round + 1}: the first tile was cued; now the Brain presses the rest by itself. Learning is off.`;
    if (game && phase.kind === 'result') {
        const r = phase.result;
        status = (
            <>
                <strong className={r.passed ? 'pm-good' : 'pm-bad'}>{r.passed ? `Round ${r.round} passed.` : `Game over in round ${r.round}.`}</strong>{' '}
                Shown {r.shown.map(tileName).join(' ')}, pressed {r.pressed.length ? r.pressed.map(tileName).join(' ') : 'nothing'}.
                {r.passed && r.round >= game.options.maxRounds ? ' That was the last round: the whole board sequence was learned.' : ''}
            </>
        );
    }
    if (game && phase.kind === 'idle' && game.round > 0) status = `${game.round} round${game.round > 1 ? 's' : ''} passed. Next round adds one tile.`;

    return (
        <div className="pattern-memory-bar simon-bar">
            <div className="pm-row">
                <span className="pm-title">Simon</span>
                <span className="simon-round">Round {Math.min((game?.round ?? 0) + 1, game?.options.maxRounds ?? 9)} of {game?.options.maxRounds ?? 9}</span>
                <span className="pm-spacer" />
                <label className="simon-option"><input type="checkbox" checked={repeats} disabled={busy} onChange={e => { setRepeats(e.target.checked); build({ repeats: e.target.checked }); }} /> repeats</label>
                <label className="simon-option"><input type="checkbox" checked={stepSignal} disabled={busy} onChange={e => { setStepSignal(e.target.checked); build({ stepSignal: e.target.checked }); }} title="Tell the Brain which step it is on. Without it, a tile that appears twice in the sequence is ambiguous." /> step signal</label>
                <button className="pm-quiet" onClick={() => build()} disabled={busy} title="New Brain, new sequence">Start over</button>
                <button className="pm-quiet" onClick={onClose} title="Hide these controls">×</button>
            </div>
            <div className="simon-body">
                <div className="simon-board">
                    {Array.from({ length: 9 }, (_, t) => (
                        <div key={t} className={`simon-tile ${lit === t ? 'lit' : ''}`} style={{ borderColor: TILE_COLORS[t], background: lit === t ? TILE_COLORS[t] : 'transparent', color: lit === t ? '#000' : TILE_COLORS[t] }}>{t + 1}</div>
                    ))}
                </div>
                <div className="simon-side">
                    <button className="primary" onClick={play} disabled={!game || busy || game.gameOver}>
                        {game?.gameOver ? 'Game over' : `Play round ${(game?.round ?? 0) + 1}`}
                    </button>
                    <div className="pm-status">{status}</div>
                    <div className="pm-legend">Board tile lights = shown / pressed · rings on the canvas = that tile's neurons · lines = learned links</div>
                </div>
            </div>
        </div>
    );
};
