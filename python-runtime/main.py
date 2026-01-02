import argparse
import json
import time
import os
from .model import NeuralNet
from .engine import Engine

def main():
    parser = argparse.ArgumentParser(description='Headless Neural Network Runtime')
    parser.add_argument('input_file', help='Path to input JSON network file')
    parser.add_argument('output_file', help='Path to save output JSON network file')
    parser.add_argument('--steps', type=int, default=100, help='Number of simulation steps to run')
    parser.add_argument('--benchmark', action='store_true', help='Print benchmark timing')

    args = parser.parse_args()

    # 1. Load
    if not os.path.exists(args.input_file):
        print(f"Error: Input file '{args.input_file}' not found.")
        return

    print(f"Loading network from {args.input_file}...")
    start_load = time.time()
    
    with open(args.input_file, 'r') as f:
        data = json.load(f)
    
    net = NeuralNet()
    net.from_json(data)
    
    print(f"Network loaded. {len(net.nodes)} nodes, {len(net.connections)} connections, {len(net.modules)} modules.")
    print(f"Load time: {time.time() - start_load:.4f}s")
    
    # 2. Run
    engine = Engine(net)
    print(f"Running simulation for {args.steps} steps...")
    
    start_sim = time.time()
    for i in range(args.steps):
        engine.step()
        if (i+1) % 100 == 0:
            print(f"Step {i+1}/{args.steps}")
            
    end_sim = time.time()
    duration = end_sim - start_sim
    print(f"Simulation completed in {duration:.4f}s")
    if duration > 0:
        print(f"Speed: {args.steps / duration:.2f} ticks/s")

    # 3. Save
    print(f"Saving state to {args.output_file}...")
    output_data = net.to_json()
    
    with open(args.output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
        
    print("Done.")

if __name__ == "__main__":
    main()
