import argparse
import json
import os
import time
from .model import NeuralNet
from .engine import Engine
from .trainer import Trainer

def main():
    parser = argparse.ArgumentParser(description='Headless Neural Network Trainer')
    parser.add_argument('input_file', help='Path to input JSON network file')
    parser.add_argument('output_file', help='Path to save output JSON network file')
    parser.add_argument('--epochs', type=int, default=1, help='Number of epochs (passes through data)')
    parser.add_argument('--steps_per_item', type=int, default=50, help='Simulation ticks per data item')
    parser.add_argument('--shuffle', action='store_true', default=True, help='Shuffle data order')

    args = parser.parse_args()

    if not os.path.exists(args.input_file):
        print(f"Error: Input file '{args.input_file}' not found.")
        return

    print(f"Loading network from {args.input_file}...")
    start_load = time.time()
    
    with open(args.input_file, 'r') as f:
        data = json.load(f)
    
    net = NeuralNet()
    net.from_json(data)
    
    print(f"Network loaded. {len(net.nodes)} nodes.")
    
    engine = Engine(net)
    trainer = Trainer(net, engine)
    
    if not trainer.training_module:
        print("Error: No TRAINING_DATA module found in network. Cannot train.")
        return

    print(f"Starting Training: {args.epochs} epochs, {args.steps_per_item} steps/item.")
    
    start_train = time.time()
    
    for e in range(args.epochs):
        print(f"--- Epoch {e+1}/{args.epochs} ---")
        trainer.run_epoch(steps_per_item=args.steps_per_item, shuffle=args.shuffle)
        
    duration = time.time() - start_train
    print(f"Training completed in {duration:.2f}s")
    
    print(f"Saving trained network to {args.output_file}...")
    output_data = net.to_json()
    
    with open(args.output_file, 'w') as f:
        json.dump(output_data, f, indent=2)
        
    print("Done.")

if __name__ == "__main__":
    main()
