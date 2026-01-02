import json
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any, Union

@dataclass
class Connection:
    id: str
    sourceId: str
    targetId: str
    weight: float
    signalStrength: float = 0.0

@dataclass
class Node:
    id: str
    type: str # 'INPUT', 'OUTPUT', 'HIDDEN', etc.
    x: float
    y: float
    
    # State
    potential: float = 0.0
    activation: float = 0.0
    isFiring: bool = False
    refractoryTimer: int = 0
    
    # Configuration (Defaults based on typical Node.ts values)
    label: str = ""
    bias: float = 0.0
    decay: float = 0.1
    threshold: float = 0.5
    refractoryPeriod: int = 0
    activationType: str = "PULSE" # "PULSE" or "SUSTAINED"
    
    # Input Specific
    inputType: str = "PULSE"
    inputFrequency: float = 1.0

    def reset(self):
        self.potential = 0.0
        self.activation = 0.0
        self.isFiring = False
        self.refractoryTimer = 0

    def to_dict(self):
        return {
            "id": self.id,
            "type": self.type,
            "x": self.x,
            "y": self.y,
            "label": self.label,
            "activationType": self.activationType,
            "potential": self.potential,
            # We add these to ensure full state preservation if the consumer supports it
            "activation": self.activation,
            "isFiring": self.isFiring,
            "refractoryTimer": self.refractoryTimer,
            "bias": self.bias,
            "decay": self.decay,
            "threshold": self.threshold,
            "refractoryPeriod": self.refractoryPeriod,
            "inputType": self.inputType,
            "inputFrequency": self.inputFrequency
        }

@dataclass
class ModuleConfig:
    id: str
    type: str
    x: float
    y: float
    nodeCount: int
    
    # Optional / Module Specific
    label: Optional[str] = None
    name: Optional[str] = None
    depth: Optional[int] = 1
    color: Optional[str] = None
    radius: Optional[float] = None
    height: Optional[float] = None
    width: Optional[float] = None
    
    activationType: Optional[str] = None
    threshold: Optional[float] = None
    refractoryPeriod: Optional[int] = None
    
    hebbianLearning: Optional[bool] = None
    learningRate: Optional[float] = None
    pruningThreshold: Optional[float] = None
    regrowthRate: Optional[float] = None
    
    isLocalized: Optional[bool] = None
    localizationLeak: Optional[float] = None
    synapsesPerNode: Optional[int] = None
    
    # Data specific
    concepts: Optional[List[Dict[str, str]]] = None
    trainingData: Optional[List[Dict[str, Any]]] = None
    trainingConfig: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        # Filter out keys that might not exist in the class fields to avoid errors
        # (Though dataclasses usually ignore extras if not strict, but explicit is better)
        # Actually standard dataclass init doesn't support extra keys, so we filter.
        valid_keys = cls.__annotations__.keys()
        filtered = {k: v for k, v in data.items() if k in valid_keys}
        return cls(**filtered)

class NeuralNet:
    def __init__(self):
        self.nodes: Dict[str, Node] = {}
        self.connections: List[Connection] = []
        self.modules: Dict[str, ModuleConfig] = {}
        self.moduleConnections: Dict[str, Any] = {} # Storing generic dict for now
        self.incoming: Dict[str, List[Connection]] = {}
        self.nodeModuleMap: Dict[str, str] = {}
        self.tickCount: int = 0

    def add_node(self, node: Node):
        self.nodes[node.id] = node

    def add_connection(self, conn: Connection):
        self.connections.append(conn)
        if conn.targetId not in self.incoming:
            self.incoming[conn.targetId] = []
        self.incoming[conn.targetId].append(conn)

    def add_module(self, module: ModuleConfig):
        self.modules[module.id] = module

    def to_json(self):
        return {
            "modules": [m.__dict__ for m in self.modules.values()],
            "nodes": [n.to_dict() for n in self.nodes.values()],
            "connections": [c.__dict__ for c in self.connections],
            "moduleConnections": list(self.moduleConnections.items()),
            "tickCount": self.tickCount
        }

    def from_json(self, data: Dict[str, Any]):
        self.nodes.clear()
        self.connections = []
        self.modules.clear()
        self.moduleConnections.clear()
        self.incoming.clear()
        self.nodeModuleMap.clear()
        self.tickCount = data.get("tickCount", 0)

        # Load Modules
        for m_data in data.get("modules", []):
            module = ModuleConfig.from_dict(m_data)
            self.modules[module.id] = module

        # Load Nodes
        for n_data in data.get("nodes", []):
            # If node config is missing specific props (decay, etc.), 
            # we should technically look up the module config.
            # But the 'n_data' usually comes from our own export or TS export.
            # If TS export is minimal (id, x, y, type), we need defaults.
            # The Node dataclass has defaults. 
            
            # IMPROVEMENT: Try to find parent module to seed defaults if they are missing in JSON
            # This logic assumes we can infer module from ID or we just rely on defaults.
            # For now, we load what's there.
            
            # Simple kwargs based init, filtering extras
            valid_keys = Node.__annotations__.keys()
            filtered = {k: v for k, v in n_data.items() if k in valid_keys}
            node = Node(**filtered)
            
            # CRITICAL FIX: Enforce IO behavior to match TypeScript
            if node.type in ('OUTPUT', 'INTERPRETATION'):
                node.decay = 1.0
                
            self.nodes[node.id] = node

        # Rebuild Node->Module Map
        # TS iterates modules and calls getModuleNodes. Here we don't have that yet.
        # We can infer from ID prefix convention (moduleId + "-n" + index) used in TS.
        for mod in self.modules.values():
            prefix = mod.id + "-"
            for node in self.nodes.values():
                if node.id.startswith(prefix):
                    self.nodeModuleMap[node.id] = mod.id
                    # Also apply module-level defaults if node values are default/missing?
                    # The Node constructor already ran.
                    # For a robust import of "Partial" JSON from visualizer:
                    if mod.activationType and node.activationType == "PULSE": # "PULSE" is default
                         # Check if we should override. 
                         # Actually, let's trust the JSON for now. 
                         pass

        # Load Connections
        for c_data in data.get("connections", []):
            self.add_connection(Connection(
                id=c_data["id"],
                sourceId=c_data["sourceId"],
                targetId=c_data["targetId"],
                weight=c_data["weight"],
                signalStrength=c_data.get("signalStrength", 0.0)
            ))
            
        # Load Module Connections
        m_conns = data.get("moduleConnections", [])
        # TS exports Array.from(entries) -> [[key, val], [key, val]]
        if isinstance(m_conns, list):
            for item in m_conns:
                if isinstance(item, list) and len(item) == 2:
                    self.moduleConnections[item[0]] = item[1]
                elif isinstance(item, dict):
                    # In case it's a dict (some JSON conventions)
                     pass
