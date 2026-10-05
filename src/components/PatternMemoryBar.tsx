import React, { useEffect, useRef, useState } from 'react';
import type { NeuralCanvasHandle } from './NeuralCanvas';
import { PatternMemory } from '../demos/patternMemory';
import type { RecallResult, StoredPattern } from '../demos/patternMemory';

interface PatternMemoryBarProps {
    canvasRef: React.RefObject<NeuralCanvasHandle | null>;
    /** Called after the network was replaced, so the rest of the UI can refresh. */
    onNetworkChanged: () => void;
    /** Make sure the simulation is running at a speed that is pleasant to watch. */
    onRun: () => void;
    onClose: () => void;
}

type Phase =
    | { kind: 'idle' }
    | { kind: 'teaching', pattern: StoredPattern }
    | { kind: 'recalling', pattern: StoredPattern, cued: string[] }
    | { kind: 'result', result: RecallResult };

const INTRUDER_COLOR = '#ff3b3b';

/**
 * Controls for the pattern-memory demo, drawn over the canvas: pick a pattern, teach it (all of its neurons
 * stimulated together), then show half of it and watch the Brain fill in the rest.
 */
export const PatternMemoryBar: React.FC<PatternMemoryBarProps> = ({ canvasRef, onNetworkChanged, onRun, onClose }) => {
    const memoryRef = useRef<PatternMemory | null>(null);
    const [patterns, setPatterns] = useState<StoredPattern[]>([]);
    const [selected, setSelected] = useState(0);
    const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
    const [progress, setProgress] = useState(0);

    const build = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const memory = new PatternMemory(canvas.getNet());
        for (let i = 0; i < 3; i++) memory.addPattern();
        memoryRef.current = memory;
        setPatterns([...memory.patterns]);
        setSelected(0);
        setPhase({ kind: 'idle' });
        onNetworkChanged();
        canvas.fitToView({ bottom: 150 });
        onRun();
    };

    // Build the Brain when the demo opens; hand the canvas back when it closes.
    useEffect(() => {
        const canvas = canvasRef.current;
        build();
        return () => { canvas?.setView(undefined); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Rings on the canvas: the selected pattern, what is being stimulated, and what came on by mistake.
    useEffect(() => {
        const memory = memoryRef.current;
        const pattern = patterns[selected];
        if (!memory || !pattern) return;
        const marks = new Map<string, { color: string, bold?: boolean }>();
        const stimulated = phase.kind === 'teaching' ? pattern.nodeIds
            : phase.kind === 'recalling' ? phase.cued
                : phase.kind === 'result' ? phase.result.cued : [];
        const bold = new Set(stimulated);
        for (const id of pattern.nodeIds) marks.set(id, { color: pattern.color, bold: bold.has(id) });
        if (phase.kind === 'result') for (const id of phase.result.intruders) marks.set(id, { color: INTRUDER_COLOR, bold: true });
        canvasRef.current?.setView({ nodeMarks: marks, connectionFilter: memory.isLearnedLink, restingAlpha: 0.22 });
    }, [patterns, selected, phase, canvasRef]);

    // Progress of the running stimulation (the tick counter restarts with every teach / show).
    useEffect(() => {
        if (phase.kind !== 'teaching' && phase.kind !== 'recalling') return;
        const timer = setInterval(() => setProgress(canvasRef.current?.getTickCount() ?? 0), 80);
        return () => clearInterval(timer);
    }, [phase, canvasRef]);

    const memory = memoryRef.current;
    const pattern = patterns[selected];
    const busy = phase.kind === 'teaching' || phase.kind === 'recalling';

    const teach = () => {
        if (!memory || !pattern || busy) return;
        setProgress(0);
        setPhase({ kind: 'teaching', pattern });
        memory.teach(pattern, () => { setPatterns([...memory.patterns]); setPhase({ kind: 'idle' }); });
        onRun();
    };

    const recall = () => {
        if (!memory || !pattern || busy) return;
        setProgress(0);
        const cued = memory.recall(pattern, result => setPhase({ kind: 'result', result }));
        setPhase({ kind: 'recalling', pattern, cued });
        onRun();
    };

    const addPattern = () => {
        if (!memory || busy) return;
        memory.addPattern();
        setPatterns([...memory.patterns]);
        setSelected(memory.patterns.length - 1);
        setPhase({ kind: 'idle' });
    };

    const select = (index: number) => {
        if (busy) return;
        setSelected(index);
        setPhase({ kind: 'idle' });
    };

    let status: React.ReactNode = 'Pick a pattern, teach it, then show half of it.';
    if (memory && pattern) {
        const o = memory.options;
        if (phase.kind === 'teaching') {
            status = `Teaching ${pattern.label}: all ${pattern.nodeIds.length} of its neurons are stimulated together (${Math.min(progress, o.teachTicks)}/${o.teachTicks} ticks).`;
        } else if (phase.kind === 'recalling') {
            status = `Showing ${phase.cued.length} of ${pattern.label}'s ${pattern.nodeIds.length} neurons (thick rings). Do the others come on? (${Math.min(progress, o.cueTicks)}/${o.cueTicks} ticks)`;
        } else if (phase.kind === 'result') {
            const r = phase.result;
            const missing = r.cameOn.length + r.stayedOff.length;
            status = (
                <>
                    <strong className={r.exact ? 'pm-good' : 'pm-bad'}>
                        {r.exact ? 'Recalled.' : r.cameOn.length === 0 ? 'Nothing came back.' : r.stayedOff.length > 0 ? 'Incomplete.' : 'Not clean.'}
                    </strong>{' '}
                    {r.cameOn.length} of {missing} missing neurons came on
                    {r.intruders.length === 0 ? ', and no neuron outside the pattern did.' : `, and ${r.intruders.length} outside the pattern came on too (red rings).`}
                </>
            );
        } else if (pattern.exposures === 0) {
            status = `${pattern.label} has not been taught yet. Teach it, then show half of it.`;
        } else {
            status = `${pattern.label} was taught ${pattern.exposures}x and is wired at ${Math.round(memory.strength(pattern) * 100)}% strength. Show half of it to test recall.`;
        }
    }

    return (
        <div className="pattern-memory-bar">
            <div className="pm-row">
                <span className="pm-title">Pattern memory</span>
                {patterns.map((p, i) => (
                    <button
                        key={p.label + i}
                        className={`pm-chip ${i === selected ? 'selected' : ''}`}
                        style={{ borderColor: p.color, background: i === selected ? p.color : 'transparent', color: i === selected ? '#000' : p.color }}
                        onClick={() => select(i)}
                        disabled={busy}
                        title={p.exposures ? `Taught ${p.exposures}x` : 'Not taught yet'}
                    >
                        {p.label}{p.exposures > 0 ? ' ✓' : ''}
                    </button>
                ))}
                <button className="pm-chip pm-add" onClick={addPattern} disabled={busy} title="Add another random pattern">+</button>
                <span className="pm-spacer" />
                <button className="pm-quiet" onClick={build} disabled={busy} title="Forget everything and start with a fresh Brain">Start over</button>
                <button className="pm-quiet" onClick={onClose} title="Hide these controls">×</button>
            </div>
            <div className="pm-row">
                <button className="primary" onClick={teach} disabled={busy || !pattern}>Teach {pattern?.label}</button>
                <button className="primary" onClick={recall} disabled={busy || !pattern}>Show half of {pattern?.label}</button>
            </div>
            <div className="pm-status">{status}</div>
            <div className="pm-legend">Ring = belongs to the pattern · thick ring = stimulated · lit up = firing · lines = learned links</div>
        </div>
    );
};
