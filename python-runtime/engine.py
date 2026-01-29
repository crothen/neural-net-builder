import math
import random
from typing import Dict, List, Set, Tuple
from model import NeuralNet, Node, Connection

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
        if self.net.modules:
            for mod in self.net.modules.values():
                if mod.type == 'BRAIN' and hasattr(mod, 'hebbianLearning') and mod.hebbianLearning:
                    self._process_hebbian(mod)

        # 5. Cleanup Manual Pulses
        self._post_step_cleanup()
        
        # Debug Prints
        # Debug Prints
        pass

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
            # Manual Input
            pass

    def _post_step_cleanup(self):
        # Reset Manual PULSE inputs that fired
        for node in self.net.nodes.values():
            if node.type in ('INPUT', 'CONCEPT') and node.inputType == 'PULSE':
                if node.activationType == 'PULSE':
                    node.activation = 0.0
                    node.potential = 0.0
                    node.isFiring = False

    def _update_node(self, node: Node, input_sum: float):
        # 1. Check Refractory Period (Gate Execution)
        if node.refractoryTimer > 0:
            node.refractoryTimer -= 1
            node.isFiring = False
            node.activation = 0.0
            
            # Brain Nodes (Hidden) maintain potential during refractory (don't hard reset)
            return

        # 2. Integration
        node.potential += input_sum + node.bias

        # 3. Decay (Pre-Threshold)
        node.potential *= (1.0 - node.decay)
        if node.potential < 0: node.potential = 0.0
        
        # 4. Max Potential Clamp
        # Defaults to 3.0 or config.maxPotential
        # We can read maxPotential from node (we added it to Node class?)
        # Wait, Node class has no maxPotential field in my previous update?
        # Checking my previous tool call... I did NOT add maxPotential explicitly to the dataclass fields?
        # I added `currentThreshold`.
        # Params `threshold`, `decay` existed.
        # `model.py` had default params.
        # Let's check `model.py` content from previous view. 
        # `maxPotential` WAS NOT in the `Node` dataclass in `model.py`.
        # I should assume a default or read it if it's there (dynamic).
        # Safe default: node.threshold * 4.0 or 3.0.
        max_pot = node.threshold * 4.0
        if node.potential > max_pot: node.potential = max_pot

        # 5. Fatigue Recovery
        # Drift currentThreshold back to base threshold
        if node.currentThreshold > node.threshold:
            # Check if recovery exists.
            rec = getattr(node, 'recovery', 0.0)
            node.currentThreshold -= rec
            if node.currentThreshold < node.threshold:
                node.currentThreshold = node.threshold

        # 6. Threshold Check
        if node.potential >= node.currentThreshold:
            # FIRE
            node.isFiring = True
            node.activation = 1.0
            
            # Soft Reset: Subtract the CURRENT threshold
            node.potential -= node.currentThreshold
            
            # Fatigue Jump
            fatigue = getattr(node, 'fatigue', 0.0)
            node.currentThreshold += fatigue
            
            # Jitter
            jitter = 1 if random.random() < 0.5 else 0
            node.refractoryTimer = node.refractoryPeriod + jitter

            # Adaptive Threshold (Sustainability)
            if node.sustainability and node.sustainability.get('adaptiveThreshold'):
                speed = node.sustainability.get('adaptationSpeed', 0.01)
                node.threshold += speed
                
        else:
            node.isFiring = False
            node.activation = 0.0
            
            # Adaptive Threshold Relaxation
            if node.sustainability and node.sustainability.get('adaptiveThreshold'):
                speed = node.sustainability.get('adaptationSpeed', 0.01)
                target_rate = node.sustainability.get('targetRate', 0.1)
                
                # Lower shield
                node.threshold -= (speed * target_rate)
                if node.threshold < 0.1: node.threshold = 0.1

    def _process_hebbian(self, mod):
        # DEBUG LOG
        # print(f"Processing Hebbian for {mod.id}. Type={mod.type}, Enabled={getattr(mod, 'hebbianLearning', False)}")
        
        if not (mod.type == 'BRAIN' and hasattr(mod, 'hebbianLearning') and mod.hebbianLearning):
            return
            
        rate = getattr(mod, 'learningRate', 0.01)
        if rate is None: rate = 0.01
        
        pruning_thresh = getattr(mod, 'pruningThreshold', 0.05)
        if pruning_thresh is None: pruning_thresh = 0.05
        prefix = mod.id
        
        conns_to_remove = []
        updates = 0
        for conn in self.net.connections:
            # Check if internal
            if not (conn.sourceId.startswith(prefix) and conn.targetId.startswith(prefix)):
                continue
                
            src = self.net.nodes.get(conn.sourceId)
            tgt = self.net.nodes.get(conn.targetId)
            
            if src and tgt:
                # Calculate Boost
                boost = rate * src.activation * tgt.activation
                
                if getattr(src, 'neuronType', None) == 'EXCITATORY': # Assuming neuronType might exist
                    conn.weight += boost
                else: # Default Hebbian for other types or if neuronType not set
                    conn.weight += boost # Or adjust based on specific neuronType logic

                if conn.weight > 2.0: conn.weight = 2.0
                if conn.weight < -2.0: conn.weight = -2.0 # Added lower bound for weights

                if abs(conn.weight) < pruning_thresh:
                    conns_to_remove.append(conn)
        
        # if updates > 0:
        #    print(f"  {mod.id}: Updated {updates} connections.")
        
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
