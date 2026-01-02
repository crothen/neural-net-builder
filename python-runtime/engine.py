import math
import random
from typing import Dict, List, Set, Tuple
from .model import NeuralNet, Node, Connection

class Engine:
    def __init__(self, net: NeuralNet):
        self.net = net

    def step(self):
        self.net.tickCount += 1
        input_sums: Dict[str, float] = {}

        # 1. Process INPUT Nodes
        for node in self.net.nodes.values():
            if node.type == 'INPUT':
                self._update_input_node(node)
                # Input nodes fire based on activation in update_input_node or existing logic
                node.isFiring = node.activation > 0.5
        
        # 2. Calculate Inputs for Non-Input Nodes
        # We iterate over all nodes to calculate what they RECEIVE.
        # Alternatively, iterate connections. But calculating per node is easier for normalization.
        
        for node in self.net.nodes.values():
            if node.type == 'INPUT':
                continue
            
            incoming = self.net.incoming.get(node.id, [])
            if not incoming:
                input_sums[node.id] = 0.0
                continue
                
            total_sum = 0.0
            
            # Normalization Logic (Group by Source Brain Module)
            # Map<SourceModuleId, List<{conn, rawSignal}>>
            brain_inputs: Dict[str, List[Tuple[Connection, float]]] = {}
            
            target_mod_id = self.net.nodeModuleMap.get(node.id)
            
            for conn in incoming:
                source_node = self.net.nodes.get(conn.sourceId)
                if not source_node:
                    continue
                
                # Calculate Raw Signal
                # Note: In TS, sourceNode.activation is used.
                raw_signal = source_node.activation * conn.weight
                
                source_mod_id = self.net.nodeModuleMap.get(source_node.id)
                
                is_external_brain = False
                if source_mod_id and source_mod_id != target_mod_id:
                    source_mod = self.net.modules.get(source_mod_id)
                    if source_mod and source_mod.type == 'BRAIN':
                        is_external_brain = True
                
                if is_external_brain and source_mod_id:
                    if source_mod_id not in brain_inputs:
                        brain_inputs[source_mod_id] = []
                    brain_inputs[source_mod_id].append((conn, raw_signal))
                else:
                    # Standard Processing
                    total_sum += raw_signal
                    conn.signalStrength = abs(raw_signal)
            
            # Process Brain Inputs (Normalized)
            for mod_id, entries in brain_inputs.items():
                count = len(entries)
                if count > 0:
                    norm_factor = 1.0 / count
                    for conn, raw_val in entries:
                        normalized = raw_val * norm_factor
                        total_sum += normalized
                        # Visual strength uses raw
                        conn.signalStrength = abs(raw_val)
            
            input_sums[node.id] = total_sum

        # 3. Update Nodes
        for node in self.net.nodes.values():
            if node.type == 'INPUT':
                continue # Already updated
            
            val = input_sums.get(node.id, 0.0)
            self._update_node(node, val)

        # 4. Hebbian Learning (Simplified Port)
        # Only if enabled.
        for mod in self.net.modules.values():
            if mod.type == 'BRAIN' and mod.hebbianLearning:
                self._process_hebbian(mod)

    def _update_input_node(self, node: Node):
        if node.inputType == 'SIN':
            sin_freq = (node.inputFrequency or 1.0) * 0.1
            node.activation = (math.sin(self.net.tickCount * sin_freq) + 1) / 2
            node.potential = node.activation
        
        elif node.inputType == 'NOISE':
            freq = node.inputFrequency or 1.0
            if freq >= 1:
                node.activation = random.random()
            else:
                period = round(1 / freq)
                if period == 0: period = 1
                if self.net.tickCount % period == 0:
                    node.activation = random.random()
            node.potential = node.activation
        
        elif node.inputType == 'PULSE':
            # Manual or predefined. 
            pass

    def _update_node(self, node: Node, input_sum: float):
        # Refractory Period
        if node.refractoryTimer > 0:
            node.refractoryTimer -= 1
            node.activation = 0.0
            node.isFiring = False
            # Potential usually resets or stays low?
            # Node.ts: if (refractoryTimer > 0) { ... return; }
            # But we must handle potential decay even if refractory?
            # TS Implementation: 
            # if (this.refractoryTimer > 0) {
            #   this.refractoryTimer--;
            #   this.activation = 0;
            #   this.isFiring = false;
            #   return; 
            # }
            return

        # Add Input
        node.potential += input_sum
        
        # Check Firing
        # Node.ts: if (this.potential >= this.threshold)
        if node.potential >= node.threshold:
            node.isFiring = True
            
            if node.activationType == 'SUSTAINED':
                node.activation = 1.0 # Or potential? TS says 1.0 usually for firing
                # TS Logic:
                # if SUSTAINED: activation = 1.0, potential = threshold (clamp?)
                # actually check TS Node.ts logic carefully? 
                # Assuming standard LIF:
                node.activation = 1.0
                node.potential = 0.0 # Reset after fire
            else:
                # PULSE
                node.activation = 1.0
                node.potential = 0.0
            
            node.refractoryTimer = node.refractoryPeriod
        else:
            node.isFiring = False
            node.activation = 0.0
            
            # Decay
            # TS: this.potential *= (1 - this.decay);
            node.potential *= (1.0 - node.decay)
            
            # Floor
            if node.potential < 0.01:
                node.potential = 0.0

    def _process_hebbian(self, module):
        # Simplified copy of TS logic
        # Filter connections internal to this module
        # In Python, iterating all connections is slow.
        # Ideally we should cache module-internal connections.
        
        rate = module.learningRate or 0.01
        pruning_thresh = module.pruningThreshold if module.pruningThreshold is not None else 0.05
        
        # Naive iteration for now (Optimization target)
        # To match TS exactly, we iterate connections.
        # But TS has `this.connections` which is global.
        
        conns_to_remove = []
        
        prefix = module.id
        
        for conn in self.net.connections:
            # Check if internal
            if not (conn.sourceId.startswith(prefix) and conn.targetId.startswith(prefix)):
                continue
                
            src = self.net.nodes.get(conn.sourceId)
            tgt = self.net.nodes.get(conn.targetId)
            
            if src and tgt:
                # Hebbian: delta = rate * src.act * tgt.act
                delta = src.activation * tgt.activation * rate
                
                conn.weight += delta
                if conn.weight > 2.0: conn.weight = 2.0
                
                if abs(conn.weight) < pruning_thresh:
                    conns_to_remove.append(conn)
        
        # Remove
        if conns_to_remove:
            for c in conns_to_remove:
                if c in self.net.connections:
                    self.net.connections.remove(c)
            # Rebuild incoming map? Or just remove from list
            self._rebuild_incoming()
            
    def _rebuild_incoming(self):
        self.net.incoming.clear()
        for conn in self.net.connections:
            if conn.targetId not in self.net.incoming:
                self.net.incoming[conn.targetId] = []
            self.net.incoming[conn.targetId].append(conn)
