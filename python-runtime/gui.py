import tkinter as tk
from tkinter import filedialog, messagebox
import json
import time
import threading
from .model import NeuralNet
from .engine import Engine

class NeuralGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Neural Net Runtime Control")
        self.root.geometry("400x350")

        self.net = NeuralNet()
        self.engine = Engine(self.net)
        
        self.is_running = False
        self.sim_speed_ms = 50  # Delay between ticks
        self.tick_batch_size = 1 # Steps per GUI update

        self._init_ui()
        self._update_stats()

    def _init_ui(self):
        # File Controls
        frame_file = tk.LabelFrame(self.root, text="File Operations", padx=5, pady=5)
        frame_file.pack(fill="x", padx=10, pady=5)

        tk.Button(frame_file, text="Load JSON", command=self.load_net).pack(side="left", padx=5)
        tk.Button(frame_file, text="Save JSON", command=self.save_net).pack(side="left", padx=5)
        tk.Button(frame_file, text="Reset State", command=self.reset_state).pack(side="left", padx=5)

        # Simulation Controls
        frame_sim = tk.LabelFrame(self.root, text="Simulation", padx=5, pady=5)
        frame_sim.pack(fill="x", padx=10, pady=5)

        self.btn_play = tk.Button(frame_sim, text="▶ Play", command=self.toggle_play, bg="#ddffdd", width=10)
        self.btn_play.pack(side="left", padx=5)
        
        tk.Button(frame_sim, text="Step >", command=self.step_once).pack(side="left", padx=5)
        tk.Button(frame_sim, text="Step 10 >>", command=lambda: self.step_many(10)).pack(side="left", padx=5)

        # Settings
        frame_settings = tk.LabelFrame(self.root, text="Settings", padx=5, pady=5)
        frame_settings.pack(fill="x", padx=10, pady=5)

        tk.Label(frame_settings, text="Speed (ms delay):").pack(side="left")
        self.scale_speed = tk.Scale(frame_settings, from_=0, to=500, orient="horizontal")
        self.scale_speed.set(50)
        self.scale_speed.pack(side="left", fill="x", expand=True, padx=5)

        # Stats
        frame_stats = tk.LabelFrame(self.root, text="Statistics", padx=5, pady=5)
        frame_stats.pack(fill="both", expand=True, padx=10, pady=5)

        self.lbl_ticks = tk.Label(frame_stats, text="Ticks: 0", font=("Arial", 12, "bold"))
        self.lbl_ticks.pack(anchor="w")
        
        self.lbl_nodes = tk.Label(frame_stats, text="Nodes: 0")
        self.lbl_nodes.pack(anchor="w")

        self.lbl_modules = tk.Label(frame_stats, text="Modules: 0")
        self.lbl_modules.pack(anchor="w")
        
        self.lbl_status = tk.Label(frame_stats, text="Status: Idle", fg="gray")
        self.lbl_status.pack(anchor="w", pady=5)

    def load_net(self):
        filepath = filedialog.askopenfilename(filetypes=[("JSON Files", "*.json")])
        if not filepath: return
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            self.net.from_json(data)
            self.engine = Engine(self.net) # Re-bind engine
            self._update_stats()
            self.lbl_status.config(text=f"Loaded: {filepath.split('/')[-1]}", fg="green")
            print(f"Loaded network from {filepath}")
        except Exception as e:
            messagebox.showerror("Load Error", str(e))

    def save_net(self):
        filepath = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON Files", "*.json")])
        if not filepath: return
        
        try:
            data = self.net.to_json()
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
            self.lbl_status.config(text=f"Saved: {filepath.split('/')[-1]}", fg="blue")
            print(f"Saved network to {filepath}")
        except Exception as e:
            messagebox.showerror("Save Error", str(e))

    def reset_state(self):
        for node in self.net.nodes.values():
            node.reset()
        self.net.tickCount = 0
        self._update_stats()
        self.lbl_status.config(text="State Reset", fg="orange")

    def toggle_play(self):
        if self.is_running:
            self.is_running = False
            self.btn_play.config(text="▶ Play", bg="#ddffdd")
            self.lbl_status.config(text="Paused")
        else:
            self.is_running = True
            self.btn_play.config(text="⏸ Pause", bg="#ffdddd")
            self.lbl_status.config(text="Running...")
            self.root.after(10, self._run_loop)

    def _run_loop(self):
        if not self.is_running: return
        
        delay = self.scale_speed.get()
        
        # If speed is 0, we try to run as fast as possible (batch steps)
        # Otherwise respect delay
        
        steps = 1
        if delay == 0:
             steps = 10 # Batch for speed
        
        self.step_many(steps)
        
        if self.is_running:
            self.root.after(max(1, delay), self._run_loop)

    def step_once(self):
        self.engine.step()
        self._update_stats()

    def step_many(self, count):
        for _ in range(count):
            self.engine.step()
        self._update_stats()

    def _update_stats(self):
        self.lbl_ticks.config(text=f"Ticks: {self.net.tickCount}")
        self.lbl_nodes.config(text=f"Nodes: {len(self.net.nodes)}")
        self.lbl_modules.config(text=f"Modules: {len(self.net.modules)}")

if __name__ == "__main__":
    root = tk.Tk()
    app = NeuralGUI(root)
    root.mainloop()
