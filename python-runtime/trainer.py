import random
import time
from typing import Dict, Any, List
from model import NeuralNet, ModuleConfig, Node
from engine import Engine

class Trainer:
    def __init__(self, net: NeuralNet, engine: Engine):
        self.net = net
        self.engine = engine
        self.training_module: ModuleConfig = None
        self.data: List[Dict[str, Any]] = []
        self.mappings: Dict[str, Any] = {}
        
        self._find_training_config()

    def _find_training_config(self):
        # 1. Look for TRAINING_DATA (Legacy/CSV)
        for mod in self.net.modules.values():
            if mod.type == 'TRAINING_DATA':
                self.training_module = mod
                self.data = mod.trainingData or []
                self.mappings = (mod.trainingConfig or {}).get('conceptMappings', {})
                print(f"Trainer: Found TRAINING_DATA module '{mod.name}' with {len(self.data)} rows.")
                return

        # 2. Look for CONCEPT_TRAINER (New)
        for mod in self.net.modules.values():
            if mod.type == 'CONCEPT_TRAINER':
                self.training_module = mod
                config = mod.conceptTrainerConfig or {}
                selected_ids = config.get('selectedConceptIds', [])
                
                # Expand Concept Modules into individual Concept Nodes
                expanded_data = []
                for mod_id in selected_ids:
                    target_mod = self.net.modules.get(str(mod_id))
                    if target_mod and target_mod.type == 'CONCEPT':
                         # If module has explicit concept definitions
                        if target_mod.concepts:
                            for c in target_mod.concepts:
                                # Construct Node ID: "modId-conceptId"
                                # Note: Ensure strict string handling
                                node_id = f"{mod_id}-{c['id']}"
                                expanded_data.append({
                                    "nodeId": node_id,
                                    "label": c.get("label", "Unknown")
                                })
                        else:
                            # Fallback: Just add all nodes belonging to this module
                            # (If we can find them. model.py nodeModuleMap helps here)
                            pass # TODO: Fallback logic if needed
                            
                self.data = expanded_data
                print(f"Trainer: Found CONCEPT_TRAINER '{mod.name}' - Expanded {len(selected_ids)} modules into {len(self.data)} items.")
                return

        print("Trainer: No TRAINING_DATA or CONCEPT_TRAINER module found.")

    def prepare_epoch(self, steps_per_item: int = 50, shuffle: bool = True):
        """
        Prepares a list of items and configuration for an epoch.
        Returns: (items, imprint_ticks, settle_ticks)
        """
        # 1. Check for Concept Trainer Config override
        config = None
        if self.training_module and self.training_module.conceptTrainerConfig:
            config = self.training_module.conceptTrainerConfig
        
        # Determine Training Parameters
        imprint_ticks = config.get('ticksPerConcept', steps_per_item) if config else steps_per_item
        settle_ticks = config.get('settleTime', 20) if config else 20
        
        if not self.data:
            print("Trainer: No data to train on.")
            return [], imprint_ticks, settle_ticks

        items = list(self.data)
        if shuffle:
            random.shuffle(items)
            
        return items, imprint_ticks, settle_ticks

    def train_item(self, item, imprint_ticks, settle_ticks):
        """
        Runs the Imprint and Settle phases for a single item.
        """
        # 1. IMPRINT PHASE
        # Activate Inputs
        self.present_item(item)
        
        # Run Simulation (Imprint)
        for _ in range(imprint_ticks):
            self.engine.step()
            
        # 2. SETTLE PHASE
        # Clear Inputs
        self._clear_concept_inputs()
        
        # Run Simulation (Settle)
        for _ in range(settle_ticks):
            self.engine.step()

    def run_epoch(self, steps_per_item: int = 50, shuffle: bool = True):
        """
        Blocking run of a full epoch (CLI usage).
        """
        items, imprint, settle = self.prepare_epoch(steps_per_item, shuffle)
        print(f"Trainer: Starting epoch with {len(items)} items. Imprint={imprint}, Settle={settle}")
        
        start_time = time.time()
        
        for idx, item in enumerate(items):
            self.train_item(item, imprint, settle)
            
            if (idx + 1) % 10 == 0:
                print(f"  Processed {idx + 1}/{len(items)} items...")

        duration = time.time() - start_time
        print(f"Epoch completed in {duration:.2f}s")

    def present_item(self, item: Dict[str, Any]):
        """
        Activates CONCEPT nodes based on the item row and mappings.
        OR directly activates a node if 'nodeId' is present (Concept Trainer).
        """
        # 1. Direct Node Activation (Concept Trainer)
        if 'nodeId' in item:
            node_id = item['nodeId']
            if node_id in self.net.nodes:
                node = self.net.nodes[node_id]
                node.activation = 1.0
                node.potential = 1.0
                node.isFiring = True
                node.activationType = 'SUSTAINED' # Sustained for Imprint duration
            return

        # 2. Mapping-based Activation (Legacy/CSV)
        # Mapping: ModuleID -> { column: "ColName", delimiter: ";" }
        for mod_id, config in self.mappings.items():
            if mod_id not in self.net.modules:
                continue
                
            col_name = config.get('column')
            delimiter = config.get('delimiter', ';')
            
            val = item.get(col_name)
            if not val:
                continue
            
            # Split values (e.g. "1;2")
            parts = str(val).split(delimiter)
            
            module_nodes = [n for n in self.net.nodes.values() if self.net.nodeModuleMap.get(n.id) == mod_id]
            
            for part in parts:
                part = part.strip()
                if not part: continue
                
                # Try to find node
                target_node = None
                
                # Check for ID match (nodeId suffix)
                # Node IDs are `modId-conceptId`.
                candidate_id = f"{mod_id}-{part}"
                if candidate_id in self.net.nodes:
                    target_node = self.net.nodes[candidate_id]
                else:
                    # Check for Label match
                    for n in module_nodes:
                        if n.label == part:
                            target_node = n
                            break
                            
                if target_node:
                    # Force Activation
                    target_node.activation = 1.0
                    target_node.potential = 1.0
                    target_node.isFiring = True
                    # For PULSE inputs, they might reset after 1 tick if we don't sustain them.
                    # But if we call `present_item` ONLY ONCE per item loop, we rely on the node staying active?
                    # The `step()` logic for INPUT nodes:
                    # `_update_input_node` checks inputType.
                    # If `inputType` is 'PULSE', it does nothing (Manual).
                    # `_post_step_cleanup` resets manual PULSE inputs.
                    #
                    # PROBLEM: If we set it here, `step()` runs, then `post_step_cleanup()` runs and CLEARS it.
                    # So it only lasts 1 tick.
                    # For "Imprint", we usually want it sustained for the duration `imprint_ticks`.
                    # Determine strategy:
                    # Option A: We change inputType to 'SUSTAINED' temporarily?
                    # Option B: We override `post_step_cleanup` logic?
                    # Option C: We set a special flag or just manually sustain it in the loop?
                    #
                    # In TS `conceptTrainer`, it calls `setInput(1)` every tick? 
                    # No, `conceptTrainer` uses `setActivation` on the CONCEPT node.
                    # Concept Nodes are usually `activationType: 'PULSE'`.
                    # But if we want them to drive the brain for 50 ticks, they must fire repeatedly or sustain.
                    # If they are PULSE, they fire once.
                    # If the Brain relies on "Repeated Stimulation" (Hebbian), one pulse might be enough if it reverberates.
                    # BUT, usually "Imprint" means HOLDING the pattern.
                    # So we should force them to be SUSTAINED or keep setting them.
                    #
                    # Let's set `activation = 1.0` and ensure they act like SUSTAINED inputs for the duration.
                    # We can set `activationType = 'SUSTAINED'`. (Cleanest)
                    # And `_clear_concept_inputs` reverts them or sets to 0.
                    target_node.activationType = 'SUSTAINED'

    def _clear_concept_inputs(self):
        # Force reset concepts to 0 and restore PULSE if needed
        for mod_id in self.mappings.keys():
             module_nodes = [n for n in self.net.nodes.values() if self.net.nodeModuleMap.get(n.id) == mod_id]
             for n in module_nodes:
                 n.activation = 0.0
                 n.potential = 0.0
                 n.isFiring = False
                 # Revert to PULSE default if we changed it? 
                 # Or just leave it as SUSTAINED 0.
                 # Actually, keeping it SUSTAINED 0 is fine, it won't fire.
                 # But if the original config was PULSE, we might want to respect that for subsequent Manual clicks.
                 # Let's check original config? We don't have it easily. 
                 # We can just leave it 'SUSTAINED' for now as 0.0 potential effectively silences it.
                 # Optimization: Only reset those that were active? 
                 # Iterating all is safer.
                 pass
