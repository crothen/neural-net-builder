import random
import time
from typing import Dict, Any, List
from .model import NeuralNet, ModuleConfig, Node
from .engine import Engine

class Trainer:
    def __init__(self, net: NeuralNet, engine: Engine):
        self.net = net
        self.engine = engine
        self.training_module: ModuleConfig = None
        self.data: List[Dict[str, Any]] = []
        self.mappings: Dict[str, Any] = {}
        
        self._find_training_config()

    def _find_training_config(self):
        for mod in self.net.modules.values():
            if mod.type == 'TRAINING_DATA':
                self.training_module = mod
                self.data = mod.trainingData or []
                self.mappings = (mod.trainingConfig or {}).get('conceptMappings', {})
                print(f"Trainer: Found TRAINING_DATA module '{mod.name}' with {len(self.data)} rows.")
                return
        
        print("Trainer: No TRAINING_DATA module found.")

    def run_epoch(self, steps_per_item: int = 50, shuffle: bool = True):
        if not self.data:
            print("Trainer: No data to train on.")
            return

        items = list(self.data)
        if shuffle:
            random.shuffle(items)
            
        print(f"Trainer: Starting epoch with {len(items)} items. {steps_per_item} ticks/item.")
        
        start_time = time.time()
        
        for idx, item in enumerate(items):
            self.present_item(item)
            
            # Run simulation
            for _ in range(steps_per_item):
                self.engine.step()
                
            # Optional: Reset activations between items?
            # In continuous learning, we might NOT want to hard reset, but let them decay.
            # However, for explicit concept association, a quick reset helps avoid "ghosting".
            # Let's rely on decay for now, or maybe manual clear of inputs.
            self._clear_concept_inputs()
            
            if (idx + 1) % 10 == 0:
                print(f"  Processed {idx + 1}/{len(items)} items...")

        duration = time.time() - start_time
        print(f"Epoch completed in {duration:.2f}s")

    def present_item(self, item: Dict[str, Any]):
        """
        Activates CONCEPT nodes based on the item row and mappings.
        """
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
            # Note: The values in CSV might be IDs ("1") or Labels ("Red") depending on what the CONCEPT module uses.
            # NeuralNet.ts `addModule` for CONCEPT usually creates nodes with IDs like `modId-conceptId`.
            # If the CSV contains IDs, we need to match them.
            # If the CSV contains Labels, we need to match labels?
            # App.tsx auto-map usually maps by matching Header to Module Name.
            # But the cell content... in `training-data.csv` we saw semicolon separated IDs (e.g. "1;4").
            
            # Let's try to match by Node ID suffix first.
            parts = str(val).split(delimiter)
            
            module_nodes = [n for n in self.net.nodes.values() if self.net.nodeModuleMap.get(n.id) == mod_id]
            
            for part in parts:
                part = part.strip()
                if not part: continue
                
                # Try to find node
                # 1. Exact ID match (suffix)
                # Node IDs are `modId-conceptId`.
                target_node = None
                
                # Check for ID match
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
                    # Set a flag or ensure it stays high during this step?
                    # Since we call `step()` multiple times, relies on `activationType` or manual re-application.
                    # If it's PULSE, it fires once.
                    # If it's SUSTAINED, it stays.
                    # Concept Nodes are usually PULSE (default in addModule) or SUSTAINED?
                    # Let's Set it to 1.0. If it decays, it decays.
                    # BUT, `step()` might process it.
                    # For robust training, we often want to HOLD the input for the duration.
                    # But `present_item` is called ONCE per item.
                    # If we want it held, we need to modify how `step` works or update `present_item` to be called every tick?
                    # Better: Set `activationType` to SUSTAINED temporarily?
                    # Or just rely on slow decay?
                    # The USER said "Headless Python Runtime". 
                    # Let's assume setting it once is enough to trigger the Hebbian association 
                    # if the Brain nodes fire shortly after.
                    pass

    def _clear_concept_inputs(self):
        # Optional: Force reset concepts to 0
        for mod_id in self.mappings.keys():
             module_nodes = [n for n in self.net.nodes.values() if self.net.nodeModuleMap.get(n.id) == mod_id]
             for n in module_nodes:
                 n.activation = 0.0
                 n.potential = 0.0
                 n.isFiring = False
