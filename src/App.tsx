import React, { useRef, useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { NeuralCanvas } from './components/NeuralCanvas';
import type { NeuralCanvasHandle } from './components/NeuralCanvas';
import type { ModuleConfig, ConnectionSide, ModuleType } from './engine/types';
import type { BaseNode as NeuralNode } from './engine/nodes/BaseNode';
import './App.css';
import tooltipConfig from './config/tooltips.json';
// Import initial network directly (Vite/Bundler will handle JSON)
import initialNetwork from './initial-setup/initial-network.json';

const Tooltip = ({ text }: { text: string }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  // Check if 'text' is a key in our config, otherwise use it raw
  const content = (tooltipConfig as any)[text] || text;

  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        x: rect.right + 10, // Offset to the right
        y: rect.top // Align top
      });
      setIsVisible(true);
    }
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  return (
    <>
      <span
        ref={triggerRef}
        className="tooltip-container"
        style={{ marginLeft: '6px', cursor: 'help' }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        ?
      </span>
      {isVisible && ReactDOM.createPortal(
        <div
          className="tooltip-text"
          style={{
            top: position.y,
            left: position.x,
            // Styling overrides for Portal
            position: 'fixed',
            visibility: 'visible',
            opacity: 1,
            pointerEvents: 'none'
          }}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
};

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

const MemoizedFilterSelect = React.memo(({ filterModuleIds, onChange, connections }: { filterModuleIds: string[], onChange: (selected: string[]) => void, connections: { incoming: any[], outgoing: any[] } }) => {
  return (
    <select
      multiple
      value={filterModuleIds}
      onChange={(e) => {
        const selected = Array.from(e.target.selectedOptions, option => option.value);
        onChange(selected);
      }}
      style={{ width: '100%', height: '80px', padding: '5px', background: '#111', border: '1px solid #333', color: '#fff' }}
    >
      <option value="ALL">All Modules</option>
      {Array.from(new Set([
        ...connections.incoming.map((c: any) => c.sourceId.split('-')[0] + (c.sourceId.split('-').length > 2 ? '-' + c.sourceId.split('-')[1] : '')),
        ...connections.outgoing.map((c: any) => c.targetId.split('-')[0] + (c.targetId.split('-').length > 2 ? '-' + c.targetId.split('-')[1] : ''))
      ])).filter(id => !id.match(/^\d+$/)).map((modId) => (
        <option key={modId} value={modId}>{modId}</option>
      ))}
    </select>
  );
}, (prev, next) => {
  // Custom comparison to really avoid re-renders if IDs are same
  // But standard shallow compare of props works if 'filterModuleIds' array ref is stable (it is state)
  // And 'connections' is stable (state set on open).
  // AND 'onChange' is stable (useCallback).
  return prev.filterModuleIds === next.filterModuleIds &&
    prev.connections === next.connections &&
    prev.onChange === next.onChange;
});

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
    type: 'BRAIN' | 'LAYER' | 'INPUT' | 'OUTPUT' | 'SUSTAINED_OUTPUT' | 'CONCEPT' | 'LEARNED_OUTPUT' | 'TRAINING_DATA',
    nodes: number,
    depth: number,
    x: number,
    y: number,
    name: string,
    conceptColumn: string
  }>({ type: 'BRAIN', nodes: 50, depth: 1, x: 400, y: 400, name: '', conceptColumn: '' });

  const [conceptCSV, setConceptCSV] = useState<string>('1,Apple\n2,Banana\n3,Cherry');
  const [conceptDelimiter, setConceptDelimiter] = useState<string>(',');
  // CSV Column Mapping State
  const [csvHasHeaders, setCsvHasHeaders] = useState<boolean>(false);
  const [idColumnIndex, setIdColumnIndex] = useState<number>(0);
  const [labelColumnIndex, setLabelColumnIndex] = useState<number>(1);
  const [previewColumns, setPreviewColumns] = useState<string[]>([]);

  // Update preview columns when CSV or delimiter changes
  useEffect(() => {
    if (!conceptCSV) {
      setPreviewColumns([]);
      return;
    }
    const lines = conceptCSV.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      setPreviewColumns([]);
      return;
    }
    const firstLine = lines[0];
    const parts = firstLine.split(conceptDelimiter).map(p => p.trim());

    if (csvHasHeaders) {
      setPreviewColumns(parts);
    } else {
      // Just generate "Column 0", "Column 1", etc. based on detected columns
      setPreviewColumns(parts.map((_, i) => `Column ${i}`));
    }
  }, [conceptCSV, conceptDelimiter, csvHasHeaders]);

  // --- Module Management State ---
  const [modules, setModules] = useState<ModuleConfig[]>([]);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  // Separate state for nodes of selected module (for renaming)
  const [, setSelectedNodes] = useState<NeuralNode[]>([]);
  const [selectedModuleStats, setSelectedModuleStats] = useState<{ id: string, count: number, totalWeight?: number, direction: 'in' | 'out' | 'self' }[]>([]);

  // --- Connection State (Contextual) ---
  const [connectModal, setConnectModal] = useState<{ isOpen: boolean, sourceId: string, targetId: string, params: { coverage: number, localizer: number, sides: { src: ConnectionSide, tgt: ConnectionSide } } | null }>({
    isOpen: false, sourceId: '', targetId: '', params: null
  });
  const [connectionTargetId, setConnectionTargetId] = useState<string>('');
  const [connSides, setConnSides] = useState<{ src: ConnectionSide, tgt: ConnectionSide }>({ src: 'ALL', tgt: 'ALL' });
  const [connCoverage, setConnCoverage] = useState<number>(100);
  const [connLocalizer, setConnLocalizer] = useState<number>(0);
  const [isLabelEditorOpen, setIsLabelEditorOpen] = useState(false);

  // --- Initial Load ---
  useEffect(() => {
    // Small timeout to ensure Canvas is ready/mounted
    const timer = setTimeout(() => {
      if (canvasRef.current) {
        console.log("Loading Initial Network...", initialNetwork);
        // Cast to any to bypass strict JSON type checks vs internal Types
        canvasRef.current.loadData(initialNetwork as any);
        // FORCE REFRESH of React State to match Engine State
        refreshModules();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  // const [menuPos, setMenuPos] = useState({ x: 0, y: 0 }); // No longer needed
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [nodeConnections, setNodeConnections] = useState<{ incoming: any[], outgoing: any[] } | null>(null);
  const [filterModuleIds, setFilterModuleIds] = useState<string[]>(['ALL']);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Force update for live values in modal
  const [, setForceUpdate] = useState(0);
  useEffect(() => {
    let interval: any;
    if (isMenuOpen) {
      interval = setInterval(() => {
        setForceUpdate(prev => prev + 1);
      }, 200); // reduced to 5 FPS to improve UI responsiveness (filtering)
    }
    return () => clearInterval(interval);
  }, [isMenuOpen]);


  const refreshModules = () => {
    if (canvasRef.current) {
      setModules(canvasRef.current.getModules());
    }
  };

  const [conceptListModal, setConceptListModal] = useState<{ isOpen: boolean, moduleId: string, title: string, concepts: { id: string, label: string }[] }>({
    isOpen: false, moduleId: '', title: '', concepts: []
  });

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

  const handleFilterChange = useCallback((selected: string[]) => {
    // Toggle logic
    if (selected.includes('ALL') && !filterModuleIds.includes('ALL')) {
      setFilterModuleIds(['ALL']);
    } else if (selected.includes('ALL') && selected.length > 1) {
      setFilterModuleIds(selected.filter(x => x !== 'ALL'));
    } else if (selected.length === 0) {
      setFilterModuleIds(['ALL']);
    } else {
      setFilterModuleIds(selected);
    }
  }, [filterModuleIds]);

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
    const displayName = newModule.name.trim() || id;

    // Parse Concepts if needed
    let parsedConcepts: { id: string; label: string }[] | undefined = undefined;
    if (newModule.type === 'CONCEPT' && conceptCSV) {
      parsedConcepts = conceptCSV.split('\n').filter(l => l.trim()).map((l, idx) => {
        if (csvHasHeaders && idx === 0) return null;
        const parts = l.split(conceptDelimiter);
        if (parts.length <= Math.max(idColumnIndex, labelColumnIndex)) return null;
        const cid = parts[idColumnIndex]?.trim();
        const clog = parts[labelColumnIndex]?.trim();
        if (!cid || !clog) return null;
        return { id: cid, label: clog };
      }).filter(c => c !== null) as { id: string; label: string }[];
    }

    const config: ModuleConfig = {
      id,
      type: newModule.type,
      x: newModule.x,
      y: newModule.y,
      nodeCount: (newModule.type === 'CONCEPT' && parsedConcepts) ? parsedConcepts.length : newModule.nodes,
      // Constraint: Input always depth 1
      depth: newModule.type === 'INPUT' ? 1 : newModule.depth,
      label: displayName,
      name: displayName,
      activationType: newModule.type === 'BRAIN' ? 'SUSTAINED' : 'PULSE',
      threshold: (newModule.type === 'BRAIN' || newModule.type === 'SUSTAINED_OUTPUT') ? 1.0 : 0.5,
      maxPotential: (newModule.type === 'BRAIN' || newModule.type === 'SUSTAINED_OUTPUT') ? 3.0 : 4.0,
      gain: newModule.type === 'SUSTAINED_OUTPUT' ? 3.0 : undefined,
      decay: (newModule.type === 'BRAIN' || newModule.type === 'SUSTAINED_OUTPUT') ? 0.9 : 0.1,
      refractoryPeriod: newModule.type === 'BRAIN' ? 1 : 2,
      // Hebbian Default: Enable for Brains
      hebbianLearning: newModule.type === 'BRAIN' ? true : undefined,
      learningRate: newModule.type === 'BRAIN' ? 0.01 : undefined,
      radius: 200,
      height: 600,
      concepts: parsedConcepts,

      // Initialize Training Data with empty config
      trainingConfig: newModule.type === 'TRAINING_DATA' ? {
        idColumn: 'id',
        wordColumn: 'word',
        conceptMappings: {}
      } : undefined
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
            hebbianLearning: true, learningRate: 0.01, regrowthRate: 0.1,
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

                <label>
                  <div>Name <Tooltip text="moduleName" /></div>
                  <input
                    type="text"
                    value={selectedModule.name || selectedModule.label || ''}
                    onChange={(e) => handleRename(selectedModule.id, e.target.value)}
                  />
                </label>

                <div className="input-row">
                  <label>
                    <div>Color <Tooltip text="moduleColor" /></div>
                    {/* Uncontrolled input with key to reset on module change.
                            onChange updates Canvas directly (fast).
                            onBlur syncs React state (slow).
                        */}
                    <input
                      key={`${selectedModule.id}-color`}
                      type="color"
                      defaultValue={selectedModule.color || (selectedModule.type === 'INPUT' ? '#ff00ff' : selectedModule.type === 'OUTPUT' ? '#ffff00' : '#00ffff')}
                      onInput={(e) => {
                        const val = (e.target as HTMLInputElement).value;
                        // Fast preview
                        if (canvasRef.current) {
                          canvasRef.current.updateModule(selectedModule.id, { color: val });
                        }
                      }}
                      onBlur={(e) => {
                        // Commit to state
                        handleUpdateConfig(selectedModule.id, { color: e.target.value });
                      }}
                      style={{ width: '100%', padding: '2px', height: '30px' }}
                    />
                  </label>
                </div>

                {selectedModule.type !== 'TRAINING_DATA' && selectedModule.type !== 'CONCEPT' && (
                  <div className="input-row">
                    <label>
                      <div>Nodes <Tooltip text="nodeCount" /></div>
                      <input
                        type="number"
                        value={selectedModule.nodeCount}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { nodeCount: parseInt(e.target.value) })}
                      />
                    </label>
                  </div>
                )}

                {selectedModule.type === 'LAYER' && (
                  <div className="input-row">
                    <label>
                      <div>Depth <Tooltip text="layerDepth" /></div>
                      <input
                        type="number"
                        value={selectedModule.depth || 1}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { depth: parseInt(e.target.value) })}
                      />
                    </label>
                  </div>
                )}

                {selectedModule.type === 'CONCEPT' && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #333' }}>
                    {/* Concept Toggle */}
                    <div className="toggle-container" style={{ marginBottom: '10px' }}>
                      <span className="toggle-label">Show as Triangle <Tooltip text="conceptToggle" /></span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={!!selectedModule.collapsed}
                          onChange={(e) => handleUpdateConfig(selectedModule.id, { collapsed: e.target.checked })}
                        />
                        <span className="slider"></span>
                      </label>
                    </div>

                    <button
                      onClick={() => {
                        setConceptListModal({
                          isOpen: true,
                          moduleId: selectedModule.id,
                          title: selectedModule.name || 'Concepts',
                          concepts: selectedModule.concepts || []
                        });
                      }}
                      style={{ width: '100%', background: '#444', height: 'auto', padding: '6px' }}
                    >
                      View Word List ({selectedModule.concepts?.length || 0})
                    </button>
                  </div>
                )}

                {/* SCALING CONTROLS */}
                {selectedModule.type === 'BRAIN' && (
                  <div className="input-row">
                    <label>
                      <div>Size (Radius) <Tooltip text="brainRadius" /></div>
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
                    <label>
                      <div>V-Spacing (Height) <Tooltip text="vSpacing" /></div>
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
                    <label>
                      <div>H-Spacing (Width) <Tooltip text="hSpacing" /></div>
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
                    <label>
                      <div>Input Pattern <Tooltip text="inputPattern" /></div>
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
                {(selectedModule.type === 'INPUT') && (
                  <div className="input-row">
                    <label>
                      <div>Frequency: {selectedModule.inputFrequency || 1.0} <Tooltip text="inputFrequency" /></div>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="10.0"
                        value={selectedModule.inputFrequency || 1.0}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          handleUpdateConfig(selectedModule.id, { inputFrequency: val });
                          // Also update all nodes in module immediately
                          const nodes = canvasRef.current?.getModuleNodes(selectedModule.id) || [];
                          nodes.forEach(n => {
                            if (canvasRef.current) canvasRef.current.updateNode(n.id, { inputFrequency: val } as any);
                          });
                        }}
                        style={{ width: '60px', float: 'right' }}
                      />
                    </label>
                  </div>
                )}

                {(selectedModule.type === 'BRAIN' || selectedModule.type === 'SUSTAINED_OUTPUT') && (
                  <div className="input-row">
                    <label>
                      <div>Firing-Threshold: {selectedModule.threshold !== undefined ? selectedModule.threshold.toFixed(1) : '1.0'} <Tooltip text="firingThreshold" /></div>
                      <input
                        type="number"
                        min="0.1"
                        max="10.0"
                        step="0.1"
                        value={selectedModule.threshold !== undefined ? selectedModule.threshold : 1.0}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { threshold: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}

                {selectedModule.type === 'SUSTAINED_OUTPUT' && (
                  <div className="input-row">
                    <label>
                      <div>Input Gain: {selectedModule.gain || 3.0} <Tooltip text="inputGain" /></div>
                      <input
                        type="number"
                        min="0.1"
                        max="10.0"
                        step="0.1"
                        value={selectedModule.gain !== undefined ? selectedModule.gain : 3.0}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { gain: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}

                {/* REFRACTORY */}
                {selectedModule.type !== 'TRAINING_DATA' && selectedModule.type !== 'OUTPUT' && selectedModule.type !== 'SUSTAINED_OUTPUT' && (
                  <div className="input-row">
                    <label>
                      <div>Refractory: {selectedModule.refractoryPeriod || 0}ms <Tooltip text="refractoryPeriod" /></div>
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

                {/* LEAK (BRAIN ONLY) */}
                {selectedModule.type === 'BRAIN' && (
                  <div className="input-row">
                    <label>
                      <div>Leak Rate: {selectedModule.leak || 0} <Tooltip text="leakRate" /></div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={selectedModule.leak || 0}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { leak: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}

                {(selectedModule.type === 'BRAIN' || selectedModule.type === 'SUSTAINED_OUTPUT') && (
                  <div className="input-row">
                    <label>
                      <div>Max Potential: {selectedModule.maxPotential !== undefined ? selectedModule.maxPotential : '3.0'} <Tooltip text="maxPotential" /></div>
                      <input
                        type="number"
                        step="0.1"
                        min="1.0"
                        max="20.0"
                        value={selectedModule.maxPotential !== undefined ? selectedModule.maxPotential : 3.0}
                        onChange={(e) => handleUpdateConfig(selectedModule.id, { maxPotential: parseFloat(e.target.value) })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>
                )}



                {selectedModule.type === 'BRAIN' && (
                  <>
                    <div className="toggle-container" style={{ marginTop: '0' }}>
                      <span className="toggle-label">Hebbian Learning <Tooltip text="hebbianToggle" /></span>
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
                            <label>
                              <div>Learning Rate <Tooltip text="learningRate" /></div>
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
                            <label>
                              <div>Pruning Thresh <Tooltip text="pruningThresh" /></div>
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
                            <label>
                              <div>Regrowth Rate <Tooltip text="regrowthRate" /></div>
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

                    <InspectorSection title="Sustainability (Homeostasis)">
                      <div style={{ padding: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                          Manage energy, fatigue, and stability.
                        </div>

                        {/* Decay */}
                        <div className="input-row">
                          <label>
                            <div>Decay Factor <Tooltip text="Multiplier per Tick (0.9 = retain 90%)" /></div>
                            <input
                              type="number"
                              step="0.01"
                              min="0.0"
                              max="1.0"
                              value={selectedModule.decay !== undefined ? selectedModule.decay : 0.9}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, { decay: parseFloat(e.target.value) })}
                              style={{ width: '100%' }}
                            />
                          </label>
                        </div>

                        {/* Fatigue / Recovery */}
                        <div className="input-row">
                          <label>
                            <div>Fatigue Cost <Tooltip text="Threshold increase after firing" /></div>
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              max="5.0"
                              value={selectedModule.fatigue !== undefined ? selectedModule.fatigue : 0}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, { fatigue: parseFloat(e.target.value) })}
                              style={{ width: '100%' }}
                            />
                          </label>
                        </div>
                        <div className="input-row">
                          <label>
                            <div>Recovery Rate <Tooltip text="Threshold recovery per tick" /></div>
                            <input
                              type="number"
                              step="0.001"
                              min="0.0"
                              max="0.5"
                              value={selectedModule.recovery !== undefined ? selectedModule.recovery : 0}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, { recovery: parseFloat(e.target.value) })}
                              style={{ width: '100%' }}
                            />
                          </label>
                        </div>

                        {/* Target Activity (Initial Weight Mod) */}
                        <div className="input-row">
                          <label>
                            <div>Target Activity: {selectedModule.initialWeightModifier !== undefined ? selectedModule.initialWeightModifier : 0.2} <Tooltip text="initialWeightModifier" /></div>
                            <input
                              type="number"
                              step="0.05"
                              min="0.05"
                              max="1.0"
                              value={selectedModule.initialWeightModifier !== undefined ? selectedModule.initialWeightModifier : 0.2}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, { initialWeightModifier: parseFloat(e.target.value) })}
                              style={{ width: '100%' }}
                            />
                          </label>
                        </div>

                        <div style={{ borderTop: '1px solid #444', margin: '8px 0' }}></div>

                        {/* Synaptic Scaling */}
                        <div className="toggle-container" style={{ marginTop: '5px' }}>
                          <span className="toggle-label">Synaptic Scaling <Tooltip text="Normalize incoming weights (Epilepsy Fix)" /></span>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={!!selectedModule.sustainability?.synapticScaling}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                sustainability: {
                                  synapticScaling: e.target.checked,
                                  targetSum: selectedModule.sustainability?.targetSum ?? 3.0,
                                  adaptiveThreshold: selectedModule.sustainability?.adaptiveThreshold ?? false,
                                  targetRate: selectedModule.sustainability?.targetRate ?? 0.05,
                                  adaptationSpeed: selectedModule.sustainability?.adaptationSpeed ?? 0.001
                                }
                              })}
                            />
                            <span className="slider"></span>
                          </label>
                        </div>
                        {selectedModule.sustainability?.synapticScaling && (
                          <div className="input-row">
                            <label>Target Sum (Budget)
                              <input
                                type="number"
                                step="0.1"
                                value={selectedModule.sustainability?.targetSum ?? 3.0}
                                onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                  sustainability: {
                                    ...selectedModule.sustainability!,
                                    targetSum: parseFloat(e.target.value)
                                  }
                                })}
                                style={{ width: '100%' }}
                              />
                            </label>
                          </div>
                        )}

                        {/* Adaptive Thresholds */}
                        <div className="toggle-container" style={{ marginTop: '5px' }}>
                          <span className="toggle-label">Adaptive Threshold <Tooltip text="Dynamic thresholding (Coma Fix)" /></span>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={!!selectedModule.sustainability?.adaptiveThreshold}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                sustainability: {
                                  synapticScaling: selectedModule.sustainability?.synapticScaling ?? false,
                                  targetSum: selectedModule.sustainability?.targetSum ?? 3.0,
                                  adaptiveThreshold: e.target.checked,
                                  targetRate: selectedModule.sustainability?.targetRate ?? 0.05,
                                  adaptationSpeed: selectedModule.sustainability?.adaptationSpeed ?? 0.001
                                }
                              })}
                            />
                            <span className="slider"></span>
                          </label>
                        </div>

                        {selectedModule.sustainability?.adaptiveThreshold && (
                          <>
                            <div className="input-row">
                              <label>Target Rate (fires/tick)
                                <input
                                  type="number"
                                  step="0.01"
                                  value={selectedModule.sustainability?.targetRate ?? 0.05}
                                  onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                    sustainability: {
                                      ...selectedModule.sustainability!,
                                      targetRate: parseFloat(e.target.value)
                                    }
                                  })}
                                  style={{ width: '100%' }}
                                />
                              </label>
                            </div>
                            <div className="input-row">
                              <label>Adaptation Speed
                                <input
                                  type="number"
                                  step="0.001"
                                  value={selectedModule.sustainability?.adaptationSpeed ?? 0.001}
                                  onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                    sustainability: {
                                      ...selectedModule.sustainability!,
                                      adaptationSpeed: parseFloat(e.target.value)
                                    }
                                  })}
                                  style={{ width: '100%' }}
                                />
                              </label>
                            </div>
                          </>
                        )}
                      </div>
                    </InspectorSection>

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
                        <label>
                          <div>Leak: {selectedModule.localizationLeak !== undefined ? selectedModule.localizationLeak : 0}% <Tooltip text="0% = Strict Neighbors, 100% = Random" /></div>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            value={selectedModule.localizationLeak !== undefined ? selectedModule.localizationLeak : 0}
                            onChange={(e) => handleUpdateConfig(selectedModule.id, { localizationLeak: parseInt(e.target.value) })}
                            style={{ width: '100%' }}
                          />
                        </label>
                      </div>
                    )}
                    <div className="input-row">
                      <label>
                        <div>Synapses/Node <Tooltip text="Internal connections per neuron" /></div>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={selectedModule.synapsesPerNode !== undefined ? selectedModule.synapsesPerNode : 2}
                          onChange={(e) => {
                            const val = parseInt(e.target.value);
                            handleUpdateConfig(selectedModule.id, { synapsesPerNode: val });
                          }}
                          style={{ width: '100%' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: '0.8rem', color: '#888' }}>
                          <span>Suggested: {Math.round(Math.sqrt(selectedModule.nodeCount) * 1.5)}</span>
                        </div>
                      </label>
                    </div>
                  </>
                )}

              </InspectorSection>

              {/* --- TRAINING DATA INSPECTOR --- */}
              {selectedModule.type === 'TRAINING_DATA' && (
                <div className="inspector-section" style={{ marginTop: '10px', border: '1px solid #444', borderRadius: '4px' }}>
                  <div style={{ padding: '8px', background: '#333', fontWeight: 'bold' }}>Training Configuration</div>
                  <div style={{ padding: '10px' }}>
                    <div className="input-row">
                      <label className="button-upload" style={{
                        cursor: 'pointer', background: '#444', padding: '8px',
                        borderRadius: '4px', textAlign: 'center', width: '100%', display: 'block'
                      }}>
                        {selectedModule.trainingData ? `Data Loaded (${selectedModule.trainingData.length} rows)` : 'Upload Training CSV'}
                        <input
                          type="file"
                          accept=".csv,.txt"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              const file = e.target.files[0];
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                if (ev.target?.result) {
                                  // Simple CSV Parser
                                  const text = ev.target.result as string;
                                  const lines = text.split('\n').filter(l => l.trim());
                                  if (lines.length > 0) {
                                    // Detect delimiter from first line (comma or semicolon)
                                    const firstLine = lines[0];
                                    const delimiter = firstLine.includes(';') ? ';' : ',';
                                    const headers = firstLine.split(delimiter).map(h => h.trim());

                                    const data = lines.slice(1).map(line => {
                                      const values = line.split(delimiter);
                                      const row: any = {};
                                      headers.forEach((h, i) => {
                                        row[h] = values[i]?.trim();
                                      });
                                      return row;
                                    });

                                    // Update Module Config
                                    handleUpdateConfig(selectedModule.id, {
                                      trainingData: data,
                                      // Default config if not set
                                      trainingConfig: {
                                        idColumn: headers[0] || 'id',
                                        wordColumn: headers[1] || 'word',
                                        conceptMappings: selectedModule.trainingConfig?.conceptMappings || {}
                                      }
                                    });
                                  }
                                }
                              };
                              reader.readAsText(file);
                            }
                          }}
                        />
                      </label>
                    </div>

                    {selectedModule.trainingData && selectedModule.trainingConfig && (
                      <>
                        <div className="input-row">
                          <label>ID Column
                            <select
                              value={selectedModule.trainingConfig.idColumn}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                trainingConfig: {
                                  ...selectedModule.trainingConfig!,
                                  idColumn: e.target.value
                                }
                              })}
                              style={{ width: '100%' }}
                            >
                              {Object.keys(selectedModule.trainingData[0]).map(k => (
                                <option key={k} value={k}>{k}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="input-row">
                          <label>Word Column
                            <select
                              value={selectedModule.trainingConfig.wordColumn}
                              onChange={(e) => handleUpdateConfig(selectedModule.id, {
                                trainingConfig: {
                                  ...selectedModule.trainingConfig!,
                                  wordColumn: e.target.value
                                }
                              })}
                              style={{ width: '100%' }}
                            >
                              {Object.keys(selectedModule.trainingData[0]).map(k => (
                                <option key={k} value={k}>{k}</option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <div style={{ marginTop: '10px', borderTop: '1px solid #444', paddingTop: '5px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <strong>Concept Mappings</strong>
                            </div>
                            <button
                              className="secondary"
                              style={{ padding: '4px', fontSize: '11px', width: '100%', marginBottom: '5px' }}
                              onClick={() => {
                                // AUTO-MAP Logic
                                if (!selectedModule.trainingData || !selectedModule.trainingData.length) return;
                                const headers = Object.keys(selectedModule.trainingData[0]);
                                const newMappings = { ...selectedModule.trainingConfig!.conceptMappings };

                                modules.forEach(m => {
                                  if (m.type === 'CONCEPT') {
                                    // Try to find a header that matches the module name (case-insensitive)
                                    const match = headers.find(h => h.toLowerCase() === (m.name || m.label || '').toLowerCase());
                                    if (match) {
                                      newMappings[m.id] = {
                                        column: match,
                                        delimiter: newMappings[m.id]?.delimiter || ';'
                                      };
                                    }
                                  }
                                });

                                handleUpdateConfig(selectedModule.id, {
                                  trainingConfig: {
                                    ...selectedModule.trainingConfig!,
                                    conceptMappings: newMappings
                                  }
                                });
                              }}
                            >
                              Auto-Map
                            </button>
                          </div>

                          <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '5px' }}>
                            Map CSV columns to connected Concept modules.
                          </div>
                          {/** iterate over connected modules that are CONCEPT type **/}
                          {modules.filter(m => m.type === 'CONCEPT').map(conceptMod => {
                            return (
                              <div key={conceptMod.id} style={{
                                marginBottom: '2px', padding: '4px', background: '#222', borderRadius: '4px',
                                display: 'flex', alignItems: 'center', gap: '5px'
                              }}>
                                <div style={{ fontWeight: 'bold', fontSize: '11px', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {conceptMod.name || conceptMod.label}
                                </div>

                                {/* Column Selector */}
                                <select
                                  value={selectedModule.trainingConfig!.conceptMappings[conceptMod.id]?.column || ''}
                                  onChange={(e) => {
                                    const newMappings = { ...selectedModule.trainingConfig!.conceptMappings };
                                    if (e.target.value === '') {
                                      delete newMappings[conceptMod.id];
                                    } else {
                                      newMappings[conceptMod.id] = {
                                        column: e.target.value,
                                        delimiter: newMappings[conceptMod.id]?.delimiter || ';'
                                      };
                                    }
                                    handleUpdateConfig(selectedModule.id, {
                                      trainingConfig: {
                                        ...selectedModule.trainingConfig!,
                                        conceptMappings: newMappings
                                      }
                                    });
                                  }}
                                  style={{ flex: 1.5, fontSize: '10px', width: 0 }} // width 0 allows flex shrink
                                >
                                  <option value="">(None)</option>
                                  {Object.keys(selectedModule.trainingData![0]).map(k => (
                                    <option key={k} value={k}>{k}</option>
                                  ))}
                                </select>

                                {/* Delimiter */}
                                <div style={{ position: 'relative', width: '30px' }}>
                                  <input
                                    type="text"
                                    placeholder=";"
                                    value={selectedModule.trainingConfig!.conceptMappings[conceptMod.id]?.delimiter || ';'}
                                    onChange={(e) => {
                                      const mapping = selectedModule.trainingConfig!.conceptMappings[conceptMod.id];
                                      if (mapping) {
                                        const newMappings = { ...selectedModule.trainingConfig!.conceptMappings };
                                        newMappings[conceptMod.id] = { ...mapping, delimiter: e.target.value };
                                        handleUpdateConfig(selectedModule.id, {
                                          trainingConfig: {
                                            ...selectedModule.trainingConfig!,
                                            conceptMappings: newMappings
                                          }
                                        });
                                      }
                                    }}
                                    style={{
                                      width: '100%',
                                      textAlign: 'center',
                                      padding: '2px',
                                      fontSize: '10px'
                                    }}
                                    title="Delimiter"
                                  />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* SECTION: TRAINING (Learned Output) */}
              {selectedModule.type === 'LEARNED_OUTPUT' && selectedModule.nodeCount === 0 && (
                <InspectorSection title="Training">
                  <div style={{ padding: '10px', textAlign: 'center' }}>
                    <p style={{ fontSize: '0.8rem', color: '#aaa', marginBottom: '10px' }}>
                      Initialize this output module with concepts from an input module.
                    </p>
                    <select
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val && canvasRef.current && canvasRef.current.populateLearnedOutput) {
                          // Find name for confirmation
                          const srcMod = modules.find(m => m.id === val);
                          if (window.confirm(`Populate this module with ${srcMod?.concepts?.length || 0} concepts from "${srcMod?.name}"?`)) {
                            canvasRef.current.populateLearnedOutput(selectedModule.id, val);
                            refreshModules();
                            refreshInspector(selectedModule.id);
                          }
                        }
                      }}
                      value=""
                      style={{ width: '100%', marginBottom: '5px' }}
                    >
                      <option value="">-- Select Source Concepts --</option>
                      {modules.filter(m => m.type === 'CONCEPT').map(m => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.label} ({m.concepts?.length || 0} items)
                        </option>
                      ))}
                    </select>
                  </div>
                </InspectorSection>
              )}



              {/* SECTION: CONNECTIONS (Hidden for TRAINING_DATA & CONCEPT) */}
              {selectedModule.type !== 'TRAINING_DATA' && selectedModule.type !== 'CONCEPT' && (
                <InspectorSection title="Connections">
                  {/* Connection Totals Summary */}
                  {selectedModuleStats.length > 0 && (
                    <div style={{
                      fontSize: '0.8rem',
                      display: 'flex',
                      justifyContent: 'space-around',
                      marginBottom: '8px',
                      background: 'rgba(0,0,0,0.2)',
                      padding: '4px',
                      borderRadius: '4px'
                    }}>
                      <div style={{ color: '#00aaff' }}>
                        In: {selectedModuleStats.filter(s => s.direction === 'in').reduce((acc, s) => acc + (s.totalWeight || 0), 0).toFixed(1)}
                      </div>
                      <div style={{ color: '#00ffaa' }}>
                        Out: {selectedModuleStats.filter(s => s.direction === 'out').reduce((acc, s) => acc + (s.totalWeight || 0), 0).toFixed(1)}
                      </div>
                    </div>
                  )}

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
                            borderLeft: `3px solid ${color}`,
                            cursor: 'pointer'
                          }}
                            onClick={() => {
                              if (canvasRef.current && isOut) {
                                // For now, only editing outgoing connections is straightforward because they are "owned" by this module's config list physically?
                                // Actually we can edit either way if we identify the link.
                                // Let's simplify: Only valid if OUTGOING or INCOMING.
                                const source = isOut ? selectedModule.id : stat.id;
                                const target = isOut ? stat.id : selectedModule.id;

                                const config = canvasRef.current.getModuleConnectionConfig(source, target);

                                if (config) {
                                  setConnectModal({
                                    isOpen: true,
                                    sourceId: source,
                                    targetId: target,
                                    params: {
                                      coverage: config.coverage,
                                      localizer: config.localizer,
                                      sides: config.sides
                                    }
                                  });
                                }
                              }
                            }}
                            title="Click to Edit Connection"
                          >
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
                              <span style={{ color: '#666', fontSize: '0.7rem' }}>
                                ({stat.count} x, Σ {stat.totalWeight?.toFixed(1)})
                              </span>
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
              )}

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
      </aside >

      {/* 2. MAIN CANVAS */}
      < main className="canvas-wrapper" >
        <NeuralCanvas
          ref={canvasRef}
          speed={simulation.speed}
          paused={simulation.paused}
          showHidden={simulation.showHidden}
          onModuleSelect={handleModuleSelect}
          onNodeContextMenu={handleNodeContextMenu}
        />

        {/* Global HUD / Overlay Controls */}
        <div className="hud-overlay">
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
        </div >
      </main >

      {/* 3. BOTTOM PANEL */}
      < section className="bottom-panel" >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2>Active Entities ({modules.length})</h2>
        </div>
        <div className="module-list" style={{
          display: 'grid',
          gridTemplateRows: 'repeat(2, auto)',
          gridAutoFlow: 'column',
          overflowX: 'auto',
          gap: '10px',
          paddingBottom: '10px',
        }}>
          {modules.map(m => (
            <div
              key={m.id}
              className={`module-card ${selectedModuleId === m.id ? 'selected' : ''}`}
              onClick={() => handleModuleSelect(m.id)}
            >
              <span className="module-name">{m.name || m.label}</span>
              <span className="module-type">
                {m.type}
                {(m.type !== 'TRAINING_DATA' && m.type !== 'CONCEPT' && m.type !== 'LEARNED_OUTPUT') && ` • ${m.nodeCount} Nodes`}
              </span>

              {m.depth && m.depth > 1 && <span className="module-type">Depth: {m.depth}</span>}
            </div>
          ))}
          {modules.length === 0 && <div style={{ color: '#666', padding: '10px' }}>No modules created. Add one from the sidebar.</div>}
        </div>
      </section >

      {/* 4. RIGHT SIDEBAR (Creation & Global) */}
      < aside className="sidebar right-sidebar" >
        {/* Creation */}
        < div className="control-group" >
          {/* MODULE TYPE DROPDOWN */}
          < div className="input-row" >
            <label>Type
              <select
                value={newModule.type}
                onChange={(e) => {
                  const type = e.target.value as ModuleType;
                  const defaults: any = { type };

                  // Reset Defaults based on Type
                  if (type === 'BRAIN') {
                    defaults.nodes = 100;
                    defaults.width = undefined; // Radius used
                    defaults.height = undefined;
                    defaults.name = "New Brain";
                    defaults.regrowthRate = 0.1;
                  } else if (type === 'LAYER') {
                    defaults.nodes = 50;
                    defaults.width = 100;
                    defaults.height = 600;
                    defaults.depth = 1;
                    defaults.name = "New Layer";
                  } else if (type === 'INPUT') {
                    defaults.nodes = 10;
                    defaults.width = 50;
                    defaults.height = 300;
                    defaults.name = "Input";
                  } else if (type === 'OUTPUT') {
                    defaults.nodes = 5;
                    defaults.width = 50;
                    defaults.height = 300;
                    defaults.name = "Output";
                  } else if (type === 'SUSTAINED_OUTPUT') {
                    defaults.nodes = 10;
                    defaults.width = 50;
                    defaults.height = 300;
                    defaults.name = "Sustained Output";
                  } else if (type === 'CONCEPT') {
                    defaults.nodes = 0; // Auto-calculated
                    defaults.width = 100; // Visual width
                    defaults.height = undefined;
                    defaults.name = "Concept List";
                  } else if (type === 'LEARNED_OUTPUT') {
                    defaults.nodes = 0;
                    defaults.width = 200; // Small square
                    defaults.height = 200;
                    defaults.name = "Learned Output";
                  } else if (type === 'TRAINING_DATA') {
                    defaults.nodes = 0;
                    defaults.width = undefined; // Hexagon
                    defaults.height = undefined;
                    defaults.name = "Training";
                  }

                  setNewModule(prev => ({ ...prev, ...defaults }));
                }}
                style={{ width: '100%' }}
              >
                <option value="BRAIN">Brain (Self-Organizing)</option>
                <option value="LAYER">Layer (Feed-Forward)</option>
                <option value="INPUT">Input (Sensor)</option>
                <option value="OUTPUT">Output (Actuator)</option>
                <option value="SUSTAINED_OUTPUT">Output (Sustained)</option>
                <option value="CONCEPT">Concept Input (CSV)</option>
                <option value="LEARNED_OUTPUT">Learned Output (Dynamic)</option>
                <option value="TRAINING_DATA">Training Data (Ground Truth)</option>
              </select>
            </label>
          </div >

          {/* Common Name Input for all types */}
          < div className="input-row" >
            <label>
              <div>Name <Tooltip text="Unique display name" /></div>
              <input
                type="text"
                value={newModule.name}
                onChange={e => setNewModule({ ...newModule, name: e.target.value })}
                placeholder={newModule.type}
                style={{ width: '100%' }}
              />
            </label>
          </div >

          {
            newModule.type === 'CONCEPT' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '5px' }}>

                <div className="input-row">
                  <label>Data Column Name <Tooltip text="Column header in training data" />
                    <input
                      type="text"
                      value={newModule.conceptColumn}
                      onChange={e => setNewModule({ ...newModule, conceptColumn: e.target.value })}
                      placeholder="e.g. fruit_type"
                      style={{ width: '100%' }}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ flex: 1 }}>Delimiter
                    <input
                      type="text"
                      value={conceptDelimiter}
                      onChange={e => setConceptDelimiter(e.target.value)}
                      style={{ width: '30px', textAlign: 'center', marginLeft: '5px' }}
                      maxLength={1}
                    />
                  </label>
                  <label className="button-upload" style={{
                    cursor: 'pointer', background: '#444', padding: '4px 8px',
                    borderRadius: '4px', fontSize: '11px', marginLeft: '5px',
                    border: '1px solid #666', flex: 2, textAlign: 'center'
                  }}>
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv,.txt"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          const file = e.target.files[0];
                          const name = file.name.replace(/\.[^/.]+$/, ""); // Remove extension

                          // Auto-populate Name and Column
                          setNewModule(prev => ({ ...prev, name: name, conceptColumn: name }));

                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            if (ev.target?.result) {
                              setConceptCSV(ev.target.result as string);
                              setCsvHasHeaders(true); // Default to true on upload
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                </div>

                {/* CSV Columns Parsing */}
                <div className="input-row" style={{ alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={csvHasHeaders}
                      onChange={e => setCsvHasHeaders(e.target.checked)}
                      style={{ marginRight: '5px' }}
                    />
                    <span style={{ fontSize: '0.8rem' }}>Has Headers</span>
                  </label>
                </div>

                <div className="input-row" style={{ justifyContent: 'space-between' }}>
                  <label style={{ width: '48%' }}>ID Column
                    <select
                      value={idColumnIndex}
                      onChange={e => setIdColumnIndex(parseInt(e.target.value))}
                      style={{ width: '100%', fontSize: '0.8rem' }}
                    >
                      {previewColumns.map((col, idx) => (
                        <option key={`id-${idx}`} value={idx}>{col}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ width: '48%' }}>Label Column
                    <select
                      value={labelColumnIndex}
                      onChange={e => setLabelColumnIndex(parseInt(e.target.value))}
                      style={{ width: '100%', fontSize: '0.8rem' }}
                    >
                      {previewColumns.map((col, idx) => (
                        <option key={`lbl-${idx}`} value={idx}>{col}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label>CSV Content (ID{conceptDelimiter}Label) <Tooltip text="List of concepts" />
                  <textarea
                    value={conceptCSV}
                    onChange={e => setConceptCSV(e.target.value)}
                    style={{
                      width: '100%',
                      height: '100px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      padding: '5px',
                      color: '#ddd'
                    }}
                    placeholder={`1${conceptDelimiter}Apple\n2${conceptDelimiter}Banana`}
                  />
                </label>

                <div style={{ marginTop: '5px', borderTop: '1px dashed #444', paddingTop: '5px' }}>
                  <label className="button-upload" style={{
                    cursor: 'pointer', background: '#2a2a2a', padding: '6px',
                    borderRadius: '4px', textAlign: 'center', width: '100%', display: 'block',
                    border: '1px solid #444', fontSize: '0.8rem', color: '#888'
                  }}>
                    Or Mass Import CSVs (Multiple Files)
                    <input
                      type="file"
                      multiple
                      accept=".csv,.txt"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          Array.from(e.target.files).forEach((file, index) => {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              if (ev.target?.result) {
                                const text = ev.target.result as string;
                                let lines = text.split('\n').filter(l => l.trim().length > 0);
                                const name = file.name.replace(/\.[^/.]+$/, "");

                                // Auto-detect Header
                                if (lines.length > 0) {
                                  const first = lines[0].toLowerCase();
                                  if (first.includes('id') && (first.includes('label') || first.includes('word') || first.includes('concept'))) {
                                    lines = lines.slice(1);
                                  }
                                }

                                if (canvasRef.current && lines.length > 0) {
                                  const id = `concept-${Date.now()}-${index}`;
                                  const concepts = lines.map(line => {
                                    const parts = line.split(',');
                                    const clean = (s: string) => s ? s.trim() : '';
                                    if (parts.length >= 2) return { id: clean(parts[0]), label: clean(parts[1]) };
                                    return { id: clean(line), label: clean(line) };
                                  });

                                  // Grid Layout: 2 Columns
                                  const col = index % 2;
                                  const row = Math.floor(index / 2);
                                  const offsetX = -300 + (col * 100);
                                  const offsetY = -200 + (row * 100);

                                  // Random Vibrant Hex Color
                                  const colors = ['#FF5733', '#33FF57', '#3357FF', '#FF33A1', '#33FFF5', '#F5FF33', '#FF8C33', '#8C33FF', '#00DFD0', '#FF0055'];
                                  const color = colors[Math.floor(Math.random() * colors.length)];

                                  canvasRef.current.addModule({
                                    id: id,
                                    type: 'CONCEPT',
                                    name: name,
                                    x: offsetX,
                                    y: offsetY,
                                    color: color,
                                    nodeCount: concepts.length,
                                    concepts: concepts,
                                    collapsed: true
                                  });
                                }
                              }
                            };
                            reader.readAsText(file);
                          });
                          setTimeout(() => refreshModules(), 500);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            )
          }

          {
            newModule.type !== 'LEARNED_OUTPUT' && newModule.type !== 'CONCEPT' && newModule.type !== 'TRAINING_DATA' && (
              <div className="input-row">
                <label>
                  <div>Nodes <Tooltip text="Number of neurons in this module" /></div>
                  <input type="number" placeholder="Nodes" value={newModule.nodes} onChange={e => setNewModule({ ...newModule, nodes: parseInt(e.target.value) })} style={{ width: '100%' }} />
                </label>
              </div>
            )
          }
          {
            newModule.type === 'LAYER' && (
              <div className="input-row">
                <label>
                  <div>Depth <Tooltip text="Number of columns (Layers only)" /></div>
                  <input type="number" placeholder="Depth" value={newModule.depth} onChange={e => setNewModule({ ...newModule, depth: parseInt(e.target.value) })} style={{ width: '100%' }} />
                </label>
              </div>
            )
          }
          <button className="primary" onClick={addModule} style={{ marginTop: '10px', width: '100%' }}>+ Create Module</button>
        </div >

        {/* Global Controls */}
        < div className="control-group" style={{ marginTop: 'auto' }
        }>
          <h2>Global</h2>
          <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
            <button onClick={() => setSimulation({ ...simulation, paused: !simulation.paused })} style={{ flex: 2, padding: '8px' }}>
              {simulation.paused ? '▶ Play' : '⏸ Pause'}
            </button>
            <button onClick={() => {
              setSimulation(prev => ({ ...prev, paused: true }));
              canvasRef.current?.step(1);
            }} style={{ flex: 1 }} title="Step 1">
              &gt;
            </button>
            <button onClick={() => {
              setSimulation(prev => ({ ...prev, paused: true }));
              canvasRef.current?.step(10);
            }} style={{ flex: 1 }} title="Step 10">
              &gt;&gt;
            </button>
          </div>

          <label>
            <div>Speed: {simulation.speed}ms <Tooltip text="Ticks duration (ms)" /></div>
            <input type="range" min="1" max="1000" value={simulation.speed} onChange={handleSpeedChange} style={{ width: '100%' }} />
          </label>
          <label>
            <div>Decay: {simulation.decay ? simulation.decay.toFixed(2) : '0.10'} <Tooltip text="Global potential loss per tick" /></div>
            <input type="range" min="0.01" max="0.5" step="0.01" value={simulation.decay || 0.1} onChange={handleDecayChange} style={{ width: '100%' }} />
          </label>

          <div style={{ marginTop: '10px', display: 'flex', gap: '5px' }}>
            <button style={{ flex: 1, background: '#444' }} onClick={handleSave}>Save</button>
            <button style={{ flex: 1, background: '#444' }} onClick={() => fileInputRef.current?.click()}>Load</button>
          </div>

          <div className="toggle-container">
            <span className="toggle-label">Hide Details</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={!simulation.showHidden}
                onChange={(e) => setSimulation({ ...simulation, showHidden: !e.target.checked })}
              />
              <span className="slider"></span>
            </label>
          </div>
        </div >


      </aside >

      {/* MODAL OVERLAY */}
      {
        isLabelEditorOpen && selectedModule && (
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
        )
      }

      {/* NODE INSPECTOR MODAL */}
      {
        isMenuOpen && menuNodeId && nodeConnections && (
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
                margin: 0,
                borderRadius: '0px', // Removed round border
                padding: '20px', // Added padding
                background: '#1e1e24',
                border: '1px solid #444',
                boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
              }}
            >
              <div className="modal-header">
                <span className="modal-title" style={{ fontSize: '14px' }}>
                  Node: {menuNodeId}
                </span>
                <button className="modal-close" onClick={closeNodeMenu} style={{ width: '24px', height: '24px', lineHeight: '20px', padding: 0, textAlign: 'center' }}>×</button>
              </div>

              <div style={{ padding: '10px', background: '#222', borderBottom: '1px solid #444' }}>
                <MemoizedFilterSelect
                  filterModuleIds={filterModuleIds}
                  connections={nodeConnections}
                  onChange={handleFilterChange}
                />

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
                {(() => {
                  const filteredIncoming = nodeConnections.incoming
                    .filter((c: any) => filterModuleIds.includes('ALL') || filterModuleIds.some(fid => c.sourceId.startsWith(fid)));
                  const incomingSum = filteredIncoming.reduce((acc: number, c: any) => acc + c.weight, 0);

                  return (
                    <>
                      <h4 style={{ margin: '5px 0', color: '#888' }}>
                        Incoming ({filteredIncoming.length}) <span style={{ float: 'right' }}>Σ {incomingSum.toFixed(2)}</span>
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {filteredIncoming
                          .sort((a: any, b: any) => sortOrder === 'asc' ? a.weight - b.weight : b.weight - a.weight)
                          .map((c: any) => (
                            <li key={c.id} style={{ padding: '4px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>← {c.sourceId}</span>
                              <span style={{ color: c.weight > 0 ? '#4fd' : '#f55' }}>
                                W: {c.weight.toFixed(3)}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </>
                  );
                })()}

                {(() => {
                  const filteredOutgoing = nodeConnections.outgoing
                    .filter((c: any) => filterModuleIds.includes('ALL') || filterModuleIds.some(fid => c.targetId.startsWith(fid)));
                  const outgoingSum = filteredOutgoing.reduce((acc: number, c: any) => acc + c.weight, 0);

                  return (
                    <>
                      <h4 style={{ margin: '10px 0 5px', color: '#888' }}>
                        Outgoing ({filteredOutgoing.length}) <span style={{ float: 'right' }}>Σ {outgoingSum.toFixed(2)}</span>
                      </h4>
                      <ul style={{ listStyle: 'none', padding: 0 }}>
                        {filteredOutgoing
                          .sort((a: any, b: any) => sortOrder === 'asc' ? a.weight - b.weight : b.weight - a.weight)
                          .map((c: any) => (
                            <li key={c.id} style={{ padding: '4px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>→ {c.targetId}</span>
                              <span style={{ color: c.weight > 0 ? '#4fd' : '#f55' }}>
                                W: {c.weight.toFixed(3)}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        )
      }
      {/* Edit Connection Modal */}
      {
        connectModal.isOpen && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
          }}>
            <div style={{
              background: '#1e1e24', padding: '20px', borderRadius: '8px', border: '1px solid #44cb82',
              minWidth: '350px', boxShadow: '0 4px 15px rgba(0,0,0,0.5)'
            }}>
              <h3 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
                Edit Connection
              </h3>
              <div style={{ fontSize: '0.9rem', marginBottom: '15px', color: '#aaa' }}>
                {connectModal.sourceId} → {connectModal.targetId}
              </div>

              <div className="input-row">
                <label>Connectivity {connectModal.params?.coverage || 100}%
                  <input type="range" min="0" max="100" value={connectModal.params?.coverage || 100}
                    onChange={(e) => setConnectModal(prev => ({
                      ...prev, params: { ...prev.params!, coverage: parseInt(e.target.value) }
                    }))}
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <div className="input-row">
                <label>Leak {connectModal.params?.localizer || 0}%
                  <input type="range" min="0" max="100" value={connectModal.params?.localizer || 0}
                    onChange={(e) => setConnectModal(prev => ({
                      ...prev, params: { ...prev.params!, localizer: parseInt(e.target.value) }
                    }))}
                    style={{ width: '100%' }}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
                <button onClick={() => setConnectModal({ ...connectModal, isOpen: false })} style={{ padding: '8px 16px', background: '#333', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                <button onClick={() => {
                  if (canvasRef.current && connectModal.params) {
                    canvasRef.current.connectModules(
                      connectModal.sourceId,
                      connectModal.targetId,
                      connectModal.params.sides.src,
                      connectModal.params.sides.tgt,
                      connectModal.params.coverage,
                      connectModal.params.localizer
                    );
                    setConnectModal({ ...connectModal, isOpen: false });
                    // Refresh Inspector if looking at these modules
                    refreshInspector(selectedModuleId!);
                  }
                }} style={{ padding: '8px 16px', background: '#44cb82', border: 'none', color: '#000', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Update</button>
              </div>
            </div>
          </div>
        )
      }

      {/* CONCEPT LIST MODAL */}
      {
        conceptListModal.isOpen && (
          <div className="modal-overlay" onClick={() => setConceptListModal({ ...conceptListModal, isOpen: false })}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <span className="modal-title">{conceptListModal.title}</span>
                <button className="close-button" onClick={() => setConceptListModal({ ...conceptListModal, isOpen: false })}>×</button>
              </div>
              <div className="node-list-container">
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {conceptListModal.concepts.map((c, i) => (
                    <li key={i} style={{ borderBottom: '1px solid #333', padding: '4px', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#888', fontFamily: 'monospace' }}>{c.id}</span>
                      <span>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      }

    </div >
  );
}



export default App;
