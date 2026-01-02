
import React, { useState } from 'react';
import type { ModuleConfig } from '../engine/types';
import type { NeuralCanvasHandle } from './NeuralCanvas';

interface CheckerModalProps {
    isOpen: boolean;
    onClose: () => void;
    checkerModuleId: string | null;
    modules: ModuleConfig[];
    canvasRef: React.RefObject<NeuralCanvasHandle | null>;
}

export const CheckerModal: React.FC<CheckerModalProps> = ({ isOpen, onClose, checkerModuleId, modules, canvasRef }) => {
    if (!isOpen || !checkerModuleId) return null;

    const [activeTab, setActiveTab] = useState<'SUBJECT' | 'CONCEPT'>('SUBJECT');
    const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
    const [analysisResults, setAnalysisResults] = useState<{ conceptId: string, label: string, score: number }[]>([]);

    const [conceptFilter, setConceptFilter] = useState('');
    const [selectedConceptIds, setSelectedConceptIds] = useState<Set<string>>(new Set());
    const [inferenceResults, setInferenceResults] = useState<{ id: string, label: string, activation: number }[]>([]);

    const trainingMod = modules.find(m => m.type === 'TRAINING_DATA');
    const candidateLabels = trainingMod && trainingMod.trainingData ? trainingMod.trainingData.map((r: any) => r[trainingMod.trainingConfig?.wordColumn || 'Word']) : [];

    const conceptModules = modules.filter(m => m.type === 'CONCEPT');

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.8)', zIndex: 2000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
            <div style={{
                width: '800px', height: '600px', background: '#1e1e24',
                borderRadius: '8px', border: '1px solid #444',
                display: 'flex', flexDirection: 'column', padding: '20px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, color: '#00ffff' }}>Verification Matrix</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
                </div>

                <div style={{ display: 'flex', borderBottom: '1px solid #444', marginBottom: '20px' }}>
                    <button
                        style={{ padding: '10px 20px', background: activeTab === 'SUBJECT' ? '#333' : 'transparent', border: 'none', color: activeTab === 'SUBJECT' ? '#fff' : '#888', cursor: 'pointer', borderBottom: activeTab === 'SUBJECT' ? '2px solid #00ffff' : 'none' }}
                        onClick={() => setActiveTab('SUBJECT')}
                    >
                        Check Subject (Reverse)
                    </button>
                    <button
                        style={{ padding: '10px 20px', background: activeTab === 'CONCEPT' ? '#333' : 'transparent', border: 'none', color: activeTab === 'CONCEPT' ? '#fff' : '#888', cursor: 'pointer', borderBottom: activeTab === 'CONCEPT' ? '2px solid #00ffff' : 'none' }}
                        onClick={() => setActiveTab('CONCEPT')}
                    >
                        Infer from Concepts (Forward)
                    </button>
                </div>

                <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                    {activeTab === 'SUBJECT' && (
                        <div style={{ flex: 1, display: 'flex', gap: '20px' }}>
                            {/* Subject List */}
                            <div style={{ width: '250px', borderRight: '1px solid #444', overflowY: 'auto', paddingRight: '10px' }}>
                                <h4 style={{ marginTop: 0 }}>Learned Subjects</h4>
                                {candidateLabels.length === 0 && <div style={{ color: '#666' }}>No Training Data found.</div>}
                                {candidateLabels.map((label: string, i: number) => (
                                    <div
                                        key={i}
                                        onClick={() => {
                                            const conf = canvasRef.current?.getTrainingConfig();
                                            let nodeId = '';
                                            if (conf && conf.labelMappings && conf.labelMappings[label]) {
                                                const m = conf.labelMappings[label];
                                                nodeId = `${m.moduleId}-${m.nodeIndex}`;
                                            }

                                            setSelectedSubjectId(nodeId || label);

                                            if (nodeId && canvasRef.current) {
                                                const res = canvasRef.current.analyzeSubject(nodeId);
                                                setAnalysisResults(res);
                                            } else {
                                                setAnalysisResults([]);
                                            }
                                        }}
                                        style={{
                                            padding: '8px', background: selectedSubjectId && (selectedSubjectId === label || selectedSubjectId.includes(label)) ? 'rgba(0, 255, 255, 0.2)' : '#333',
                                            color: selectedSubjectId && (selectedSubjectId === label || selectedSubjectId.includes(label)) ? '#00ffff' : '#ccc',
                                            cursor: 'pointer', marginBottom: '2px', borderRadius: '4px'
                                        }}
                                    >
                                        {label}
                                    </div>
                                ))}
                            </div>
                            {/* Results */}
                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                <h4 style={{ marginTop: 0 }}>Associated Concepts (Sensitivity)</h4>
                                {analysisResults.length === 0 && <div style={{ color: '#666', fontStyle: 'italic' }}>Select a subject to analyze its composition.</div>}
                                {analysisResults.length > 0 && (
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ textAlign: 'left', color: '#888', borderBottom: '1px solid #444' }}>
                                                <th style={{ padding: '8px' }}>Concept</th>
                                                <th style={{ padding: '8px' }}>Score (Impact)</th>
                                                <th style={{ padding: '8px', width: '100px' }}>Strength</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {analysisResults.map((res: any, i: number) => {
                                                const maxScore = Math.max(...analysisResults.map(r => Math.abs(r.score)));
                                                const pct = maxScore > 0 ? (res.score / maxScore) * 100 : 0;
                                                return (
                                                    <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                                                        <td style={{ padding: '8px' }}>{res.label}</td>
                                                        <td style={{ padding: '8px', color: res.score > 0 ? '#0f0' : '#f00' }}>{res.score.toFixed(4)}</td>
                                                        <td style={{ padding: '8px' }}>
                                                            <div style={{ width: '100%', height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                                                                <div style={{ width: `${Math.abs(pct)}%`, height: '100%', background: res.score > 0 ? '#0f0' : '#f00', opacity: 0.7 }}></div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    )}

                    {activeTab === 'CONCEPT' && (
                        <div style={{ flex: 1, display: 'flex', gap: '20px' }}>
                            {/* Concept Selector */}
                            <div style={{ width: '300px', borderRight: '1px solid #444', overflowY: 'auto', paddingRight: '10px' }}>
                                <input
                                    type="text"
                                    placeholder="Filter Concepts..."
                                    value={conceptFilter}
                                    onChange={e => setConceptFilter(e.target.value)}
                                    style={{ width: '100%', padding: '8px', marginBottom: '10px', background: '#111', border: '1px solid #444', color: '#fff' }}
                                />
                                {conceptModules.map(mod => (
                                    <div key={mod.id}>
                                        <h5 style={{ margin: '10px 0 5px', color: '#00aeff' }}>{mod.name || mod.label}</h5>
                                        {(mod.concepts || []).filter((c: any) => c.label.toLowerCase().includes(conceptFilter.toLowerCase())).map((c: any) => {
                                            const nodeId = `${mod.id}-${c.id}`;
                                            const isSel = selectedConceptIds.has(nodeId);
                                            return (
                                                <div
                                                    key={c.id}
                                                    onClick={() => {
                                                        const next = new Set(selectedConceptIds);
                                                        if (isSel) next.delete(nodeId);
                                                        else next.add(nodeId);
                                                        setSelectedConceptIds(next);
                                                    }}
                                                    style={{
                                                        padding: '4px 8px', margin: '2px 0', cursor: 'pointer',
                                                        background: isSel ? '#00ffff' : '#333',
                                                        color: isSel ? '#000' : '#ccc',
                                                        borderRadius: '4px', fontSize: '0.9rem'
                                                    }}
                                                >
                                                    {c.label}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ))}
                            </div>

                            {/* Action & Results */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <div style={{ marginBottom: '20px' }}>
                                    <button
                                        className="primary"
                                        style={{ width: '100%', padding: '15px', fontSize: '1.1rem', background: selectedConceptIds.size > 0 ? '#00eeff' : '#555', color: selectedConceptIds.size > 0 ? '#000' : '#888', cursor: selectedConceptIds.size > 0 ? 'pointer' : 'not-allowed' }}
                                        disabled={selectedConceptIds.size === 0}
                                        onClick={() => {
                                            if (canvasRef.current) {
                                                const res = canvasRef.current.runInference(Array.from(selectedConceptIds));
                                                setInferenceResults(res);
                                            }
                                        }}
                                    >
                                        RUN INFERENCE ({selectedConceptIds.size})
                                    </button>
                                </div>

                                <div style={{ flex: 1, overflowY: 'auto' }}>
                                    <h4 style={{ marginTop: 0 }}>Likely Subjects</h4>
                                    {inferenceResults.length === 0 && <div style={{ color: '#666', fontStyle: 'italic' }}>Run inference to see results.</div>}
                                    {inferenceResults.length > 0 && (
                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                            <thead>
                                                <tr style={{ textAlign: 'left', color: '#888', borderBottom: '1px solid #444' }}>
                                                    <th style={{ padding: '8px' }}>Subject</th>
                                                    <th style={{ padding: '8px' }}>Activation</th>
                                                    <th style={{ padding: '8px' }}>Certainty</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {inferenceResults.slice(0, 10).map((res: any, i: number) => { // Top 10
                                                    const pct = res.activation * 100;
                                                    return (
                                                        <tr key={i} style={{ borderBottom: '1px solid #333' }}>
                                                            <td style={{ padding: '8px', fontWeight: 'bold', color: i === 0 ? '#fff' : '#ccc' }}>{res.label}</td>
                                                            <td style={{ padding: '8px' }}>{res.activation.toFixed(2)}</td>
                                                            <td style={{ padding: '8px' }}>
                                                                <div style={{ width: '100%', height: '8px', background: '#333', borderRadius: '4px', overflow: 'hidden' }}>
                                                                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: '#00aeff' }}></div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
