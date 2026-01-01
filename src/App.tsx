import { useRef, useState, useEffect } from 'react';
import { NeuralCanvas } from './components/NeuralCanvas';
import type { NeuralCanvasHandle } from './components/NeuralCanvas';
import type { ModuleConfig, ConnectionSide, ModuleType } from './engine/types';
import type { Node as NeuralNode } from './engine/Node';
import './App.css';

const Tooltip = ({ text }: { text: string }) => (
  <span className="tooltip-container">?
    <span className="tooltip-text">{text}</span>
  </span>
);

// --- Components ---

const InspectorSection = ({ title, children, defaultOpen = true }: { title: string, children: React.ReactNode, defaultOpen?: boolean }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="inspector-section">
      <div className={`section-header ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        <span className="section-title">{title}</span>
        <span style={{ fontSize: '0.8rem', color: '#888' }}>{isOpen ? '▼' : '▶'}</span>
      </div>
      {isOpen && <div className="section-body">{children}</div>}
    </div>
  );
};

function App() {
  const canvasRef = useRef<NeuralCanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Simulation State ---
  const [simulation, setSimulation] = useState({
    speed: 400,
    paused: false,
    showHidden: true,
    decay: 0.2,
  });

  // --- Creation State ---
  const [newModule, setNewModule] = useState<{
    type: 'BRAIN' | 'LAYER' | 'INPUT' | 'OUTPUT',
    nodes: number,
    depth: number,
    x: number,
    y: number
  }>({ type: 'BRAIN', nodes: 50, depth: 1, x: 400, y: 400 });

  // --- Module Management State ---
  const [modules, setModules] = useState<ModuleConfig[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  // Separate state for nodes of selected module (for renaming)
  const [, setSelectedNodes] = useState<NeuralNode[]>([]);
  const [selectedModuleStats, setSelectedModuleStats] = useState<{ id: string, count: number, direction: 'in' | 'out' | 'self' }[]>([]);

  // --- Connection State (Contextual) ---
  const [connectionTargetId, setConnectionTargetId] = useState<string>('');
  const [connSides, setConnSides] = useState<{ src: ConnectionSide, tgt: ConnectionSide }>({ src: 'ALL', tgt: 'ALL' });
  const [connCoverage, setConnCoverage] = useState<number>(100);
  const [connLocalizer, setConnLocalizer] = useState<number>(0);
  const [isLabelEditorOpen, setIsLabelEditorOpen] = useState(false);

  // --- Node Context Menu State ---
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  // const [menuPos, setMenuPos] = useState({ x: 0, y: 0 }); // No longer needed
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [nodeConnections, setNodeConnections] = useState<{ incoming: any[], outgoing: any[] } | null>(null);
  const [filterModuleIds, setFilterModuleIds] = useState<string[]>(['ALL']);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // --- Helpers ---
  const refreshModules = () => {
    if (canvasRef.current) {
      setModules(canvasRef.current.getModules());
    }
  };

  const refreshInspector = (modId: string | null) => {
    if (!canvasRef.current || !modId) {
      setSelectedNodes([]);
      setSelectedModuleStats([]);
      return;
    }
    // Update nodes
    setSelectedNodes(canvasRef.current.getModuleNodes(modId));
    // Update stats
    if (canvasRef.current.getModuleConnectivity) {
      setSelectedModuleStats(canvasRef.current.getModuleConnectivity(modId));
    }
  };

  // --- Handlers ---

  const handleTypeChange = (type: ModuleType) => {
    let count = 10;
    let depth = 1;

    switch (type) {
      case 'BRAIN': count = 100; break;
      case 'LAYER': count = 10; depth = 5; break;
      case 'INPUT': count = 10; break;
      case 'OUTPUT': count = 10; break;
    }
    setNewModule(prev => ({ ...prev, type, nodes: count, depth }));
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSimulation({ ...simulation, speed: parseInt(e.target.value) });
  };

  const handleDecayChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setSimulation({ ...simulation, decay: val });
    if (canvasRef.current && canvasRef.current.setGlobalDecay) {
      canvasRef.current.setGlobalDecay(val);
    }
  };

  const addModule = () => {
    if (!canvasRef.current) return;
    const id = `${newModule.type.toLowerCase()}-${Date.now()}`;

    const config: ModuleConfig = {
      id,
      type: newModule.type,
      x: newModule.x,
      y: newModule.y,
      nodeCount: newModule.nodes,
      // Constraint: Input always depth 1
      depth: newModule.type === 'INPUT' ? 1 : newModule.depth,
      label: id,
      name: id,
      activationType: newModule.type === 'BRAIN' ? 'SUSTAINED' : 'PULSE',
      threshold: newModule.type === 'BRAIN' ? 0.5 : 0.5,
      refractoryPeriod: newModule.type === 'BRAIN' ? 1 : 2,
      // Hebbian Default: Enable for Brains
      hebbianLearning: newModule.type === 'BRAIN' ? true : undefined,
      learningRate: newModule.type === 'BRAIN' ? 0.01 : undefined,
      radius: 200,
      height: 600
    };

    canvasRef.current.addModule(config);

    if (newModule.type === 'LAYER' || newModule.type === 'OUTPUT') {
      setNewModule(prev => ({ ...prev, x: prev.x + 250 }));
    }
    refreshModules();
  };

  const handleModuleSelect = (id: string | null) => {
    setSelectedModuleId(id);
    setConnectionTargetId('');
    setConnCoverage(100);
    setConnLocalizer(0);
    refreshInspector(id);
  };

  // -- Inspector Updates --

  const handleRename = (id: string, newName: string) => {
    if (canvasRef.current) {
      canvasRef.current.renameModule(id, newName);
      refreshModules();
    }
  };

  const handleUpdateConfig = (id: string, diff: Partial<ModuleConfig>) => {
    if (canvasRef.current && canvasRef.current.updateModule) {
      canvasRef.current.updateModule(id, diff);
      refreshModules();
      refreshInspector(id);
    }
  };

  const handleNodeRename = (nodeId: string, label: string) => {
    if (canvasRef.current) {
      canvasRef.current.updateNode(nodeId, { label });
      // Force refresh to get updated node objects
      if (selectedModuleId) {
        setSelectedNodes(canvasRef.current.getModuleNodes(selectedModuleId));
      }
    }
  };

  const handleConnect = () => {
    if (!canvasRef.current || !selectedModuleId || !connectionTargetId) return;
    canvasRef.current.connectModules(selectedModuleId, connectionTargetId, connSides.src, connSides.tgt, connCoverage, connLocalizer);
    refreshInspector(selectedModuleId);
  };

  const handleDisconnect = (id1: string, id2: string) => {
    if (canvasRef.current && canvasRef.current.disconnectModules) {
      canvasRef.current.disconnectModules(id1, id2);
      refreshInspector(id1);
    }
  };

  const handleClear = () => {
    if (canvasRef.current) {
      canvasRef.current.clear();
      refreshModules();
      handleModuleSelect(null);
    }
  };

  const handleSave = () => {
    if (!canvasRef.current) return;
    const data = canvasRef.current.save();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'neural-network-v2.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleNodeContextMenu = (nodeId: string) => {
    if (canvasRef.current && canvasRef.current.getNodeConnections) {
      const conns = canvasRef.current.getNodeConnections(nodeId);
      setMenuNodeId(nodeId);
      // setMenuPos({ x, y });
      setNodeConnections(conns);
      setIsMenuOpen(true);
    }
  };

  const closeNodeMenu = () => {
    setIsMenuOpen(false);
    setMenuNodeId(null);
  };

  const handleLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (canvasRef.current) {
          canvasRef.current.clear();
          canvasRef.current.load(json);
          setTimeout(() => {
            refreshModules();
            handleModuleSelect(null);
          }, 50);
        }
      } catch (err) { console.error(err); }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  useEffect(() => {
    // Initialize Default Network on Load
    setTimeout(() => {
      if (canvasRef.current) {
        const modules = canvasRef.current.getModules();
        if (modules.length === 0) {
          // Only init if empty
          canvasRef.current.addModule({
            id: 'input-1', type: 'INPUT', x: 200, y: 400, nodeCount: 10, depth: 1, label: 'Input', name: 'Input',
            activationType: 'PULSE', threshold: 0.5, refractoryPeriod: 2, radius: 0, height: 600
          });

          canvasRef.current.addModule({
            id: 'brain-1', type: 'BRAIN', x: 600, y: 400, nodeCount: 200, depth: 1, label: 'Brain', name: 'Brain',
            activationType: 'SUSTAINED', threshold: 0.5, refractoryPeriod: 1, radius: 200, height: 0,
            hebbianLearning: true, learningRate: 0.01,
            isLocalized: true, localizationLeak: 20
          });

          canvasRef.current.addModule({
            id: 'output-1', type: 'OUTPUT', x: 1000, y: 400, nodeCount: 5, depth: 1, label: 'Output', name: 'Output',
            activationType: 'PULSE', threshold: 0.5, refractoryPeriod: 2, radius: 0, height: 600
          });

          // Connections
          canvasRef.current.connectModules('input-1', 'brain-1', 'ALL', 'ALL');
          canvasRef.current.connectModules('brain-1', 'output-1', 'ALL', 'ALL');
        }
        refreshModules();
      }
    }, 50);
  }, []);

  const selectedModule = modules.find(m => m.id === selectedModuleId);
  const otherModules = modules.filter(m => m.id !== selectedModuleId);
  const targetModule = modules.find(m => m.id === connectionTargetId);

  return (
    <div className="app-container">
      {/* 1. LEFT SIDEBAR (Inspector Only) */}
      <aside className="sidebar left-sidebar">
        <div className="sidebar-header">
          <h1>NEURAL ARCHITECT</h1>
        </div>

        <div className="sidebar-content">
          {/* Inspector Panel */}
          {selectedModule ? (
            <>
              <div style={{ marginBottom: '10px', padding: '0 5px' }}>
                <h2 style={{ color: 'var(--accent-color)', marginBottom: '0', fontSize: '1.1rem' }}>{selectedModule.name}</h2>
                <div style={{ fontSize: '0.75rem', color: '#666', fontFamily: 'monospace' }}>ID: {selectedModule.id}</div>
              </div>

              {/* SECTION: GENERAL */}
              <InspectorSection title="General">
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete module "${selectedModule.name}"? This cannot be undone.`)) {
                        if (canvasRef.current) {
                          canvasRef.current.removeModule(selectedModule.id);
                          refreshModules();
                          setSelectedModuleId(null);
                        }
                      }
                    }}
                    style={{
                      background: '#ff4444',
                      color: 'white',
                      border: 'none',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.8rem'
                    }}
                  >
                    Delete Module
                  </button>
                </div>

                <label>Name <Tooltip text="Module identifier" />
                  <input
                    type="text"
                    value={selectedModule.name || selectedModule.label || ''}
                    onChange={(e) => handleRename(selectedModule.id, e.target.value)}
                  />
                </label>

                <div className="input-row">
                  <label>Color <Tooltip text="Visual color tint" />
                    <input
                      type="color"
                      value={selectedModule.color || (selectedModule.type === 'INPUT' ? '#ff00ff' : selectedModule.type === 'OUTPUT' ? '#ffff00' : '#00ffff')}
                      onChange={(e) => handleUpdateConfig(selectedModule.id, { color: e.target.value })}
                      style={{ width: '100%', padding: '2px', height: '30px' }}
                    />
                  </label>
                </div>

                <div className="input-row">
                  <label>Nodes <Tooltip text="Number of neurons" />
                    <input
                      type="number"
                      value={selectedModule.nodeCount}
                      onChange={(e) => handleUpdateConfig(selectedModule.id, { nodeCount: parseInt(e.target.value) })}
                    />
                  </label>
                </div>

                {selectedModule.type === 'LAYER' && (
                  <div className="input-row">
                    <label>Depth <Tooltip text="Number of columns (Layers only)" />
                      <input
                        type="number"
                        value={selectedModule.depth || 1}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { depth: parseInt(e.target.value) })}
                      />
                    </label>
                  </div>
                )}

                {/* SCALING CONTROLS */}
                {selectedModule.type === 'BRAIN' && (
                  <div className="input-row">
                    <label>Size (Radius) <Tooltip text="Physical size of the brain on canvas" />
                      <input
                        type="range"
                        min="50"
                        max="500"
                        step="10"
                        value={selectedModule.radius || 200}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { radius: parseInt(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}
                {(selectedModule.type === 'LAYER' || selectedModule.type === 'INPUT' || selectedModule.type === 'OUTPUT') && (
                  <div className="input-row">
                    <label>V-Spacing (Height) <Tooltip text="Vertical spread of nodes" />
                      <input
                        type="range"
                        min="100"
                        max="1000"
                        step="10"
                        value={selectedModule.height || 600}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { height: parseInt(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}
                {selectedModule.type === 'LAYER' && (
                  <div className="input-row">
                    <label>H-Spacing (Width) <Tooltip text="Horizontal spread of columns" />
                      <input
                        type="range"
                        min="20"
                        max="300"
                        step="10"
                        value={selectedModule.width || 100}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { width: parseInt(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}

              </InspectorSection>

              {/* SECTION: PARAMETERS */}
              <InspectorSection title="Parameters">
                {selectedModule.type === 'INPUT' && (
                  <div className="input-row">
                    <label>Input Pattern <Tooltip text="Auto-generated signal pattern" />
                      <select
                        value={(canvasRef.current?.getModuleNodes(selectedModule.id) || [])[0]?.inputType || 'PULSE'}
                        onChange={(e) => {
                          // Update ALL nodes in this input module
                          const newVal = e.target.value;
                          const nodes = canvasRef.current?.getModuleNodes(selectedModule.id) || [];
                          nodes.forEach(n => {
                            if (canvasRef.current) canvasRef.current.updateNode(n.id, { inputType: newVal } as any);
                          });
                          refreshInspector(selectedModule.id);
                        }}
                        style={{ width: '100%' }}
                      >
                        <option value="PULSE">Pulse (Manual)</option>
                        <option value="SIN">Sin Wave (0.5Hz)</option>
                        <option value="NOISE">White Noise</option>
                      </select>
                    </label>
                  </div>
                )}
                {selectedModule.type !== 'INPUT' && (
                  <div className="input-row">
                    <label>Threshold: {selectedModule.threshold !== undefined ? selectedModule.threshold.toFixed(1) : '1.0'} <Tooltip text="Voltage required to fire (Lower = Sensitive)" />
                      <input
                        type="range"
                        min="0.1"
                        max="5.0"
                        step="0.1"
                        value={selectedModule.threshold !== undefined ? selectedModule.threshold : 1.0}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { threshold: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}

                {(selectedModule.type !== 'INPUT' && selectedModule.type !== 'OUTPUT') && (
                  <div className="input-row">
                    <label>Refractory (Ticks) <Tooltip text="Cycles to wait after firing before firing again" />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={selectedModule.refractoryPeriod !== undefined ? selectedModule.refractoryPeriod : 2}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { refractoryPeriod: parseInt(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}

                {selectedModule.type === 'BRAIN' && (
                  <>
                    <div className="toggle-container" style={{ marginTop: '0' }}>
                      <span className="toggle-label">Hebbian Learning <Tooltip text="Auto-adjust weights based on activity" /></span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!selectedModule.hebbianLearning}
                          onChange={(e) => handleUpdateConfig(selectedModule.id, { hebbianLearning: e.target.checked })}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    {(selectedModule.type === 'BRAIN' && selectedModule.hebbianLearning) && (
                      <div className="inspector-section" style={{ background: 'rgba(0,0,0,0.2)' }}>
                        <div className="section-body" style={{ padding: '10px' }}>
                          <div className="input-row">
                            <label>Learning Rate <Tooltip text="Hebbian learning rate" />
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                max="1"
                                value={selectedModule.learningRate || 0.01}
                                onChange={(e) => handleUpdateConfig(selectedModule.id, { learningRate: parseFloat(e.target.value) })}
                                style={{ width: '100%' }}
                              />
                            </label>
                          </div>
                          <div className="input-row">
                            <label>Pruning Thresh <Tooltip text="Remove connections weaker than this (abs)" />
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="1"
                                value={selectedModule.pruningThreshold !== undefined ? selectedModule.pruningThreshold : 0.05}
                                onChange={(e) => handleUpdateConfig(selectedModule.id, { pruningThreshold: parseFloat(e.target.value) })}
                                style={{ width: '100%' }}
                              />
                            </label>
                          </div>
                          <div className="input-row">
                            <label>Regrowth Rate <Tooltip text="New connections per tick (0.1 = 1 per 10 ticks)" />
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                max="10"
                                value={selectedModule.regrowthRate || 0}
                                onChange={(e) => handleUpdateConfig(selectedModule.id, { regrowthRate: parseFloat(e.target.value) })}
                                style={{ width: '100%' }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="toggle-container" style={{ marginTop: '15px' }}>
                      <span className="toggle-label">Localized Structure <Tooltip text="Spatially optimize internal connections" /></span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!selectedModule.isLocalized}
                          onChange={(e) => {
                            if (window.confirm("Changing localization will rewire internal connections. Continue?")) {
                              handleUpdateConfig(selectedModule.id, { isLocalized: e.target.checked });
                            }
                          }}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    {selectedModule.isLocalized && (
                      <div className="input-row">
                        <label>Leak: {selectedModule.localizationLeak !== undefined ? selectedModule.localizationLeak : 0}% <Tooltip text="0% = Strict Neighbors, 100% = Random" />
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={selectedModule.localizationLeak !== undefined ? selectedModule.localizationLeak : 0}
                            onChange={(e) => handleUpdateConfig(selectedModule.id, { localizationLeak: parseInt(e.target.value) })}
                            style={{ width: '100%' }}
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}
              </InspectorSection>

              {/* SECTION: CONNECTIONS */}
              <InspectorSection title="Connections">
                {selectedModuleStats.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: '#555', fontStyle: 'italic', textAlign: 'center', padding: '10px' }}>No active connections</div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {selectedModuleStats.map((stat, idx) => {
                      const isOut = stat.direction === 'out';
                      const isIn = stat.direction === 'in';
                      const color = isOut ? '#00ffaa' : (isIn ? '#00aaff' : '#aaa');
                      const icon = isOut ? '→' : (isIn ? '←' : '↻');

                      return (
                        <li key={idx} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '0.8rem',
                          background: 'rgba(255,255,255,0.05)',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          borderLeft: `3px solid ${color}`
                        }}>
                          <div
                            onClick={() => {
                              // Load settings into form
                              if (canvasRef.current && canvasRef.current.getModuleConnectionConfig) {
                                const config = canvasRef.current.getModuleConnectionConfig(selectedModule.id, stat.id);
                                if (config) {
                                  // If the saved config src/tgt matches our perspective
                                  setConnectionTargetId(stat.id);
                                  // Need to verify if 'stat.id' is source or target relative to 'selectedModule.id'
                                  // Actually, 'Connect To' assumes Selected is Source. 
                                  // But connection might be Incoming.
                                  // If Incoming, we swap?
                                  // The UI "Connect To" is strictly Outgoing creation.
                                  // If we click an Incoming connection, can we edit it?
                                  // Only if we treat 'selected' as target? 
                                  // No, simpler: Just load the params.
                                  setConnCoverage(config.coverage);
                                  setConnLocalizer(config.localizer);
                                  setConnSides(config.sides);
                                }
                              }
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', flex: 1, cursor: 'pointer' }}
                            title="Click to edit connection settings"
                          >
                            <span style={{ color: color, fontWeight: 'bold' }}>{icon}</span>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                              {modules.find(m => m.id === stat.id)?.name || stat.id}
                            </span>
                            <span style={{ color: '#666', fontSize: '0.7rem' }}>({stat.count} connections)</span>
                          </div>
                          <div
                            role="button"
                            onClick={() => {
                              if (window.confirm("Disconnect these modules?")) {
                                handleDisconnect(selectedModule.id, stat.id);
                              }
                            }}
                            style={{
                              width: '14px',
                              height: '14px',
                              minWidth: '14px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginLeft: '8px',
                              background: 'rgba(255, 50, 50, 0.1)',
                              border: '1px solid #500',
                              borderRadius: '3px',
                              color: '#f55',
                              fontSize: '10px',
                              lineHeight: '1',
                              cursor: 'pointer',
                              flexShrink: 0,
                              userSelect: 'none'
                            }}
                            title="Disconnect"
                          >
                            ×
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}

                <div style={{ borderTop: '1px solid #444', paddingTop: '10px', marginTop: '10px' }}>
                  <h3 style={{ margin: '0 0 5px 0', fontSize: '0.8rem', color: '#aaa' }}>Connect To</h3>
                  <select
                    value={connectionTargetId}
                    onChange={e => {
                      const val = e.target.value;
                      setConnectionTargetId(val);
                      const tgt = modules.find(m => m.id === val);
                      if (tgt && tgt.type === 'BRAIN') {
                        setConnCoverage(50);
                        setConnLocalizer(0);
                      } else {
                        setConnCoverage(100);
                        setConnLocalizer(0);
                      }
                    }}
                    style={{ width: '100%', marginBottom: '8px' }}
                  >
                    <option value="">-- Select Target --</option>
                    {otherModules.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.label} ({m.type})
                      </option>
                    ))}
                  </select>

                  <div className="input-row" style={{ justifyContent: 'space-between' }}>
                    <label style={{ width: '45%' }}>Src
                      <select
                        value={connSides.src}
                        onChange={e => setConnSides({ ...connSides, src: e.target.value as any })}
                        disabled={selectedModule.type !== 'LAYER'}
                      >
                        <option value="ALL">All</option>
                        {selectedModule.type === 'LAYER' && <option value="LEFT">Left</option>}
                        {selectedModule.type === 'LAYER' && <option value="RIGHT">Right</option>}
                      </select>
                    </label>
                    <label style={{ width: '45%' }}>Tgt
                      <select
                        value={connSides.tgt}
                        onChange={e => setConnSides({ ...connSides, tgt: e.target.value as any })}
                        disabled={!targetModule || targetModule.type !== 'LAYER'}
                      >
                        <option value="ALL">All</option>
                        {targetModule?.type === 'LAYER' && <option value="LEFT">Left</option>}
                        {targetModule?.type === 'LAYER' && <option value="RIGHT">Right</option>}
                      </select>
                    </label>
                  </div>

                  <div className="input-row">
                    <label>Coverage: {connCoverage}% <Tooltip text="Percentage of nodes to connect" />
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={connCoverage}
                        onChange={(e) => setConnCoverage(parseInt(e.target.value))}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>

                  {targetModule && targetModule.type === 'BRAIN' && (
                    <div className="input-row">
                      <label>Leak: {connLocalizer}% <Tooltip text="Chance for connection to ignore localization (0 = Strict)" />
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={connLocalizer}
                          onChange={(e) => setConnLocalizer(parseInt(e.target.value))}
                          style={{ width: '100%' }}
                        />
                      </label>
                    </div>
                  )}

                  <button
                    className="primary"
                    onClick={handleConnect}
                    disabled={!connectionTargetId}
                    style={{ marginTop: '10px', opacity: connectionTargetId ? 1 : 0.5 }}
                  >
                    Link
                  </button>
                </div>
              </InspectorSection>

              {/* Node Labels Button (Inputs/Outputs ONLY) */}
              {(selectedModule.type === 'INPUT' || selectedModule.type === 'OUTPUT') && (
                <div style={{ marginTop: '10px' }}>
                  <button onClick={() => setIsLabelEditorOpen(true)} style={{ width: '100%', background: '#444' }}>Edit Node Labels</button>
                </div>
              )}
            </>
          ) : (
            <div className="control-group" style={{ opacity: 0.5, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ textAlign: 'center', color: '#666' }}>
                Select a module<br />to inspect
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* 2. MAIN CANVAS */}
      <main className="canvas-wrapper">
        <NeuralCanvas
          ref={canvasRef}
          speed={simulation.speed}
          paused={simulation.paused}
          showHidden={simulation.showHidden}
          onModuleSelect={handleModuleSelect}
          onNodeContextMenu={handleNodeContextMenu}
        />
      </main>

      {/* 3. BOTTOM PANEL */}
      <section className="bottom-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2>Active Entities ({modules.length})</h2>
        </div>
        <div className="module-list">
          {modules.map(m => (
            <div
              key={m.id}
              className={`module-card ${selectedModuleId === m.id ? 'selected' : ''}`}
              onClick={() => handleModuleSelect(m.id)}
            >
              <span className="module-name">{m.name || m.label}</span>
              <span className="module-type">{m.type} • {m.nodeCount} Nodes</span>
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', fontSize: '0.75rem', opacity: 0.8 }}>
                {(() => {
                  const stats = canvasRef.current?.getModuleConnectivity(m.id);
                  const inCount = stats?.filter(s => s.direction === 'in').reduce((acc, s) => acc + s.count, 0) || 0;
                  const outCount = stats?.filter(s => s.direction === 'out').reduce((acc, s) => acc + s.count, 0) || 0;
                  return (
                    <>
                      <span style={{ color: '#00aaff' }}>In: {inCount}</span>
                      <span style={{ color: '#00ffaa' }}>Out: {outCount}</span>
                    </>
                  );
                })()}
              </div>
              {m.depth && m.depth > 1 && <span className="module-type">Depth: {m.depth}</span>}
            </div>
          ))}
          {modules.length === 0 && <div style={{ color: '#666', padding: '10px' }}>No modules created. Add one from the sidebar.</div>}
        </div>
      </section>

      {/* 4. RIGHT SIDEBAR (Creation & Global) */}
      <aside className="sidebar right-sidebar">
        {/* Creation */}
        <div className="control-group">
          <h2>Create Module</h2>
          <div className="input-row">
            <select
              value={newModule.type}
              onChange={e => handleTypeChange(e.target.value as ModuleType)}
              style={{ flex: 1 }}
            >
              <option value="BRAIN">Brain (Recurrent)</option>
              <option value="LAYER">Layer (Feedfwd)</option>
              <option value="INPUT">Input Layer</option>
              <option value="OUTPUT">Output Layer</option>
            </select>
          </div>
          <div className="input-row">
            <label>Nodes <Tooltip text="Number of neurons in this module" />
              <input type="number" placeholder="Nodes" value={newModule.nodes} onChange={e => setNewModule({ ...newModule, nodes: parseInt(e.target.value) })} style={{ width: '100%' }} />
            </label>
          </div>
          {newModule.type === 'LAYER' && (
            <div className="input-row">
              <label>Depth <Tooltip text="Number of columns (Layers only)" />
                <input type="number" placeholder="Depth" value={newModule.depth} onChange={e => setNewModule({ ...newModule, depth: parseInt(e.target.value) })} style={{ width: '100%' }} />
              </label>
            </div>
          )}
          <button className="primary" onClick={addModule}>+ Add</button>
        </div>

        {/* Global Controls */}
        <div className="control-group" style={{ marginTop: 'auto' }}>
          <h2>Global</h2>
          <label>
            Speed: {simulation.speed}ms <Tooltip text="Ticks duration (ms)" />
            <input type="range" min="1" max="1000" value={simulation.speed} onChange={handleSpeedChange} style={{ width: '100%' }} />
          </label>
          <label>
            Decay: {simulation.decay ? simulation.decay.toFixed(2) : '0.10'} <Tooltip text="Global potential loss per tick" />
            <input type="range" min="0.01" max="0.5" step="0.01" value={simulation.decay || 0.1} onChange={handleDecayChange} style={{ width: '100%' }} />
          </label>

          <div className="toggle-container">
            <span className="toggle-label">Hide Details</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={!simulation.showHidden}
                onChange={() => setSimulation({ ...simulation, showHidden: !simulation.showHidden })}
              />
              <span className="slider"></span>
            </label>
          </div>

          <div className="actions" style={{ display: 'flex', gap: '5px' }}>
            <button onClick={() => setSimulation({ ...simulation, paused: !simulation.paused })} style={{ flex: 2 }}>
              {simulation.paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button onClick={() => {
              setSimulation(prev => ({ ...prev, paused: true }));
              canvasRef.current?.step(1);
            }} style={{ flex: 1 }} title="Step Forward 1">
              &gt;
            </button>
            <button onClick={() => {
              setSimulation(prev => ({ ...prev, paused: true }));
              canvasRef.current?.step(10);
            }} style={{ flex: 1 }} title="Step Forward 10">
              &gt;&gt;
            </button>
          </div>
          <div style={{ marginTop: '5px', textAlign: 'center', fontSize: '0.8rem', color: '#888' }}>
            Steps: {canvasRef.current?.getTickCount ? canvasRef.current.getTickCount() : 0}
          </div>

          <div style={{ marginTop: '10px' }}>
            <button
              onClick={() => {
                if (window.confirm("Reset all Node potentials and activation states? Topology will be preserved.")) {
                  canvasRef.current?.resetState();
                }
              }}
              style={{ background: '#554', color: '#ffc', width: '100%' }}
            >
              Reset State
            </button>
          </div>
          <div style={{ marginTop: '5px' }}>
            <button
              onClick={() => { if (window.confirm("Are you sure you want to DELETE everything? This cannot be undone.")) handleClear(); }}
              style={{ background: '#500', color: '#faa', width: '100%' }}
            >
              Delete Net
            </button>
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '5px' }}>
            <button style={{ background: '#333' }} onClick={handleSave}>Save</button>
            <button style={{ background: '#333' }} onClick={() => fileInputRef.current?.click()}>Load</button>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".json" onChange={handleLoad} />
          </div>
        </div>
      </aside>

      {/* MODAL OVERLAY */}
      {isLabelEditorOpen && selectedModule && (
        <div className="modal-overlay" onClick={() => setIsLabelEditorOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Edit Labels: {selectedModule.name}</span>
              <button className="modal-close" onClick={() => setIsLabelEditorOpen(false)}>×</button>
            </div>
            <div className="modal-body">
              {canvasRef.current && (
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {canvasRef.current.getModuleNodes(selectedModule.id).map(node => (
                    <div key={node.id} className="label-row" style={{ display: 'flex', gap: '10px', marginBottom: '5px' }}>
                      <span>Node {node.id.split('-').pop()}</span>
                      <input
                        type="text"
                        placeholder="Label..."
                        value={node.label}
                        onChange={(e) => handleNodeRename(node.id, e.target.value)}
                        style={{ flex: 1, padding: '4px', background: '#222', border: '1px solid #444', color: '#fff' }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* NODE INSPECTOR MODAL */}
      {isMenuOpen && menuNodeId && nodeConnections && (
        <div className="modal-overlay" onClick={closeNodeMenu}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{
              // Center Position
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',

              // Sizing
              width: '500px',
              maxWidth: '90vw',
              height: '80vh',
              maxHeight: '80vh',

              display: 'flex',
              flexDirection: 'column',
              margin: 0
            }}
          >
            <div className="modal-header">
              <span className="modal-title" style={{ fontSize: '14px' }}>
                Node: {menuNodeId} <br />
                <span style={{ fontSize: '10px', color: '#aaa', fontWeight: 'normal' }}>
                  In: {nodeConnections.incoming.length} | Out: {nodeConnections.outgoing.length}
                </span>
              </span>
              <button className="modal-close" onClick={closeNodeMenu} style={{ width: '24px', height: '24px', lineHeight: '20px', padding: 0, textAlign: 'center' }}>×</button>
            </div>

            <div style={{ padding: '10px', background: '#222', borderBottom: '1px solid #444' }}>
              <select
                multiple
                value={filterModuleIds}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, option => option.value);
                  // Toggle behavior for 'ALL'
                  if (selected.includes('ALL') && !filterModuleIds.includes('ALL')) {
                    setFilterModuleIds(['ALL']);
                  } else if (selected.includes('ALL') && selected.length > 1) {
                    setFilterModuleIds(selected.filter(x => x !== 'ALL'));
                  } else if (selected.length === 0) {
                    setFilterModuleIds(['ALL']);
                  } else {
                    setFilterModuleIds(selected);
                  }
                }}
                style={{ width: '100%', height: '80px', padding: '5px', background: '#111', border: '1px solid #333', color: '#fff' }}
              >
                <option value="ALL">All Modules</option>
                {/* Extract Unique Modules from Connections */}
                {Array.from(new Set([
                  ...nodeConnections.incoming.map((c: any) => c.sourceId.split('-')[0] + '-' + c.sourceId.split('-')[1]),
                  ...nodeConnections.outgoing.map((c: any) => c.targetId.split('-')[0] + '-' + c.targetId.split('-')[1])
                ])).map((modId) => (
                  <option key={modId} value={modId}>{modId}</option>
                ))}
              </select>

              <div style={{ marginTop: '5px', display: 'flex', gap: '5px' }}>
                <button
                  style={{ flex: 1, fontSize: '10px', padding: '4px' }}
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                >
                  Sort Wgt {sortOrder === 'asc' ? '▲' : '▼'}
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ flex: 1, overflowY: 'auto', fontSize: '12px' }}>
              <h4 style={{ margin: '5px 0', color: '#888' }}>Incoming ({nodeConnections.incoming.length})</h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {nodeConnections.incoming
                  .filter((c: any) => filterModuleIds.includes('ALL') || filterModuleIds.some(fid => c.sourceId.startsWith(fid)))
                  .sort((a: any, b: any) => sortOrder === 'asc' ? a.weight - b.weight : b.weight - a.weight)
                  .map((c: any) => (
                    <li key={c.id} style={{ padding: '4px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                      <span>← {c.sourceId}</span>
                      <span style={{ color: c.weight > 0 ? '#4fd' : '#f55' }}>{c.weight.toFixed(3)}</span>
                    </li>
                  ))}
              </ul>

              <h4 style={{ margin: '10px 0 5px', color: '#888' }}>Outgoing ({nodeConnections.outgoing.length})</h4>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {nodeConnections.outgoing
                  .filter((c: any) => filterModuleIds.includes('ALL') || filterModuleIds.some(fid => c.targetId.startsWith(fid)))
                  .sort((a: any, b: any) => sortOrder === 'asc' ? a.weight - b.weight : b.weight - a.weight)
                  .map((c: any) => (
                    <li key={c.id} style={{ padding: '4px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                      <span>→ {c.targetId}</span>
                      <span style={{ color: c.weight > 0 ? '#4fd' : '#f55' }}>{c.weight.toFixed(3)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
