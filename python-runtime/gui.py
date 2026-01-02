import tkinter as tk
from tkinter import filedialog, messagebox, ttk
import json
from .model import NeuralNet
from .engine import Engine

class NeuralGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Neural Net Runtime Control")
        self.root.geometry("1000x600")

        self.net = NeuralNet()
        self.engine = Engine(self.net)
        
        self.is_running = False
        self.io_widgets = {} # node_id -> widget
        self.selected_module_id = None

        self._setup_layout()
        self._update_stats()

    def _setup_layout(self):
        # Apply dark theme style tweaks
        style = ttk.Style()
        style.theme_use('clam')
        
        # Main Split: Left (Controls) vs Right (Tabs)
        self.paned = tk.PanedWindow(self.root, orient="horizontal")
        self.paned.pack(fill="both", expand=True)

        # LEFT: Controls
        self.frame_controls = tk.Frame(self.paned, width=300, padx=10, pady=10)
        self.paned.add(self.frame_controls)
        
        # RIGHT: Tabs
        self.notebook = ttk.Notebook(self.paned)
        self.paned.add(self.notebook)
        
        # Tab 1: I/O Visualization
        self.frame_viz_container = tk.Frame(self.notebook, bg="#222")
        self.notebook.add(self.frame_viz_container, text="I/O Visualization")

        self.canvas_viz = tk.Canvas(self.frame_viz_container, bg="#222")
        self.scrollbar = tk.Scrollbar(self.frame_viz_container, orient="vertical", command=self.canvas_viz.yview)
        self.frame_io = tk.Frame(self.canvas_viz, bg="#222")
        self.frame_io.bind("<Configure>", lambda e: self.canvas_viz.configure(scrollregion=self.canvas_viz.bbox("all")))
        self.canvas_viz.create_window((0, 0), window=self.frame_io, anchor="nw")
        self.canvas_viz.configure(yscrollcommand=self.scrollbar.set)
        self.canvas_viz.pack(side="left", fill="both", expand=True)
        self.scrollbar.pack(side="right", fill="y")
        
        # Tab 2: Module Inspector
        self.frame_modules = tk.Frame(self.notebook, padx=10, pady=10)
        self.notebook.add(self.frame_modules, text="Modules Inspector")
        self._setup_module_inspector()

        self._init_controls()

    def _setup_module_inspector(self):
        # Split: List vs Details
        frame_list = tk.Frame(self.frame_modules)
        frame_list.pack(side="left", fill="y", padx=5)
        
        tk.Label(frame_list, text="Modules List", font=("Arial", 10, "bold")).pack(anchor="w")
        self.list_modules = tk.Listbox(frame_list, width=30)
        self.list_modules.pack(fill="y", expand=True)
        self.list_modules.bind('<<ListboxSelect>>', self._on_module_select)
        
        # Details Panel
        self.frame_mod_details = tk.LabelFrame(self.frame_modules, text="Module Properties", padx=10, pady=10)
        self.frame_mod_details.pack(side="left", fill="both", expand=True, padx=5)
        
        # Simple Form
        self.mod_vars = {
            "id": tk.StringVar(),
            "type": tk.StringVar(),
            "label": tk.StringVar(),
            "decay": tk.DoubleVar(),
            "threshold": tk.DoubleVar(),
            "hebbian": tk.BooleanVar(),
            "learningRate": tk.DoubleVar()
        }
        
        row = 0
        for key in ["id", "type", "label"]:
            tk.Label(self.frame_mod_details, text=key.capitalize() + ":").grid(row=row, column=0, sticky="e", pady=2)
            tk.Entry(self.frame_mod_details, textvariable=self.mod_vars[key], state="readonly").grid(row=row, column=1, sticky="w", pady=2)
            row += 1
            
        tk.Label(self.frame_mod_details, text="Decay (0-1):").grid(row=row, column=0, sticky="e", pady=2)
        tk.Entry(self.frame_mod_details, textvariable=self.mod_vars["decay"]).grid(row=row, column=1, sticky="w", pady=2)
        row += 1

        tk.Label(self.frame_mod_details, text="Threshold:").grid(row=row, column=0, sticky="e", pady=2)
        tk.Entry(self.frame_mod_details, textvariable=self.mod_vars["threshold"]).grid(row=row, column=1, sticky="w", pady=2)
        row += 1
        
        tk.Label(self.frame_mod_details, text="Hebbian Learning:").grid(row=row, column=0, sticky="e", pady=2)
        tk.Checkbutton(self.frame_mod_details, variable=self.mod_vars["hebbian"]).grid(row=row, column=1, sticky="w", pady=2)
        row += 1
        
        tk.Label(self.frame_mod_details, text="Learning Rate:").grid(row=row, column=0, sticky="e", pady=2)
        tk.Entry(self.frame_mod_details, textvariable=self.mod_vars["learningRate"]).grid(row=row, column=1, sticky="w", pady=2)
        row += 1
        
        tk.Button(self.frame_mod_details, text="Apply Changes", command=self._apply_module_changes, bg="#ddddff").grid(row=row, column=1, sticky="e", pady=10)

    def _init_controls(self):
        # File Operations
        frame_file = tk.LabelFrame(self.frame_controls, text="File Operations", padx=5, pady=5)
        frame_file.pack(fill="x", pady=5)
        tk.Button(frame_file, text="Load JSON", command=self.load_net).pack(fill="x", pady=2)
        tk.Button(frame_file, text="Save JSON", command=self.save_net).pack(fill="x", pady=2)
        tk.Button(frame_file, text="Reset State", command=self.reset_state).pack(fill="x", pady=2)

        # Simulation Controls
        frame_sim = tk.LabelFrame(self.frame_controls, text="Simulation", padx=5, pady=5)
        frame_sim.pack(fill="x", pady=5)

        self.btn_play = tk.Button(frame_sim, text="▶ Play", command=self.toggle_play, bg="#ddffdd")
        self.btn_play.pack(fill="x", pady=2)
        
        tk.Button(frame_sim, text="Step >", command=self.step_once).pack(fill="x", pady=2)
        tk.Button(frame_sim, text="Step 10 >>", command=lambda: self.step_many(10)).pack(fill="x", pady=2)

        # Settings
        frame_settings = tk.LabelFrame(self.frame_controls, text="Speed (ms delay)", padx=5, pady=5)
        frame_settings.pack(fill="x", pady=5)
        self.scale_speed = tk.Scale(frame_settings, from_=0, to=500, orient="horizontal")
        self.scale_speed.set(50)
        self.scale_speed.pack(fill="x")

        # Stats
        frame_stats = tk.LabelFrame(self.frame_controls, text="Statistics", padx=5, pady=5)
        frame_stats.pack(fill="both", expand=True, pady=5)

        self.lbl_ticks = tk.Label(frame_stats, text="Ticks: 0", font=("Arial", 12, "bold"))
        self.lbl_ticks.pack(anchor="w")
        
        self.lbl_nodes = tk.Label(frame_stats, text="Nodes: 0")
        self.lbl_nodes.pack(anchor="w")

        self.lbl_modules = tk.Label(frame_stats, text="Modules: 0")
        self.lbl_modules.pack(anchor="w")
        
        self.lbl_status = tk.Label(frame_stats, text="Status: Idle", fg="gray", wraplength=280)
        self.lbl_status.pack(anchor="w", pady=5, side="bottom")

    def load_net(self):
        filepath = filedialog.askopenfilename(filetypes=[("JSON Files", "*.json")])
        if not filepath: return
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
            self.net.from_json(data)
            self.engine = Engine(self.net)
            self._rebuild_io_viz()
            self._refresh_module_list()
            self._update_stats()
            self.lbl_status.config(text=f"Loaded: {filepath.split('/')[-1]}", fg="green")
        except Exception as e:
            import traceback
            traceback.print_exc()
            messagebox.showerror("Load Error", str(e))

    def save_net(self):
        filepath = filedialog.asksaveasfilename(defaultextension=".json", filetypes=[("JSON Files", "*.json")])
        if not filepath: return
        
        try:
            data = self.net.to_json()
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
            self.lbl_status.config(text=f"Saved: {filepath.split('/')[-1]}", fg="blue")
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
        steps = 10 if delay == 0 else 1
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
        self._update_visuals()

    # --- I/O Visualization ---

    def _rebuild_io_viz(self):
        for widget in self.frame_io.winfo_children(): widget.destroy()
        self.io_widgets = {}

        io_modules = [m for m in self.net.modules.values() if m.type in ('INPUT', 'OUTPUT', 'LEARNED_OUTPUT', 'CONCEPT')]
        io_modules.sort(key=lambda m: (m.type, m.name or m.id))

        if not io_modules:
            tk.Label(self.frame_io, text="No Input/Output Modules found.", bg="#222", fg="#888").pack(pady=20)
            return

        for mod in io_modules:
            frame_mod = tk.LabelFrame(self.frame_io, text=f"{mod.name} ({mod.type})", bg="#333", fg="#ddd", padx=5, pady=5)
            frame_mod.pack(fill="x", padx=10, pady=5)
            frame_nodes = tk.Frame(frame_mod, bg="#333")
            frame_nodes.pack(fill="both", expand=True)

            mod_nodes = [n for n in self.net.nodes.values() if self.net.nodeModuleMap.get(n.id) == mod.id]
            try: mod_nodes.sort(key=lambda n: int(n.id.split('-')[-1]))
            except: mod_nodes.sort(key=lambda n: n.id)

            if not mod_nodes:
                tk.Label(frame_nodes, text="(No Nodes)", bg="#333", fg="#555").pack()
                continue
                
            cols = 8
            for i, node in enumerate(mod_nodes):
                row = i // cols
                col = i % cols
                if mod.type == 'INPUT' or mod.type == 'CONCEPT':
                    btn = tk.Button(frame_nodes, text="O", width=2, height=1, bg="#444", fg="#fff", borderwidth=1)
                    btn.bind("<Button-1>", lambda e, n=node: self.input_action(n, "pulse"))
                    btn.bind("<Button-3>", lambda e, n=node: self.input_action(n, "toggle"))
                    btn.grid(row=row, column=col, padx=2, pady=2)
                    self.io_widgets[node.id] = (btn, 'input')
                else:
                    lbl = tk.Label(frame_nodes, text="", width=4, height=2, bg="#000", relief="sunken", borderwidth=1)
                    lbl.grid(row=row, column=col, padx=2, pady=2)
                    self.io_widgets[node.id] = (lbl, 'output')

    def input_action(self, node, action):
        if action == "pulse":
            node.activation = 1.0
            node.potential = 1.0
            node.isFiring = True
            node.activationType = "PULSE"
        elif action == "toggle":
            if node.activation > 0.5:
                node.activation = 0.0
                node.potential = 0.0
                node.isFiring = False
            else:
                node.activation = 1.0
                node.potential = 1.0
                node.isFiring = True
                node.activationType = "SUSTAINED"
        self._update_visuals()

    def _update_visuals(self):
        for node_id, (widget, w_type) in self.io_widgets.items():
            if node_id not in self.net.nodes: continue
            node = self.net.nodes[node_id]
            if w_type == 'output':
                val = int(min(node.activation, 1.0) * 255)
                if node.isFiring: val = max(val, 100)
                color = f"#00{val:02x}00"
                if val < 20: color = "#111"
                widget.configure(bg=color)
            elif w_type == 'input':
                if node.activation > 0.5:
                    if node.activationType == 'SUSTAINED': widget.configure(bg="#ff5555", text="H")
                    else: widget.configure(bg="#ff8800", text="P")
                else: widget.configure(bg="#444", text="O")

    # --- Module Inspector ---
    
    def _refresh_module_list(self):
        self.list_modules.delete(0, tk.END)
        # Sort modules by ID
        mods = sorted(self.net.modules.values(), key=lambda m: m.id)
        for m in mods:
            self.list_modules.insert(tk.END, f"{m.id} ({m.type})")

    def _on_module_select(self, event):
        selection = self.list_modules.curselection()
        if not selection: return
        
        # Get ID from string "mod-id (TYPE)"
        text = self.list_modules.get(selection[0])
        mod_id = text.split(" (")[0]
        
        mod = self.net.modules.get(mod_id)
        if not mod: return
        
        self.selected_module_id = mod_id
        
        # Populate Form
        self.mod_vars["id"].set(mod.id)
        self.mod_vars["type"].set(mod.type)
        self.mod_vars["label"].set(mod.label or "")
        
        # Handle optionals
        self.mod_vars["decay"].set(mod.decay if hasattr(mod, 'decay') and mod.decay is not None else 0.1)
        self.mod_vars["threshold"].set(mod.threshold if hasattr(mod, 'threshold') and mod.threshold is not None else 0.5)
        self.mod_vars["hebbian"].set(bool(mod.hebbianLearning))
        self.mod_vars["learningRate"].set(mod.learningRate if mod.learningRate is not None else 0.01)

    def _apply_module_changes(self):
        if not self.selected_module_id: return
        mod = self.net.modules.get(self.selected_module_id)
        if not mod: return
        
        # Read values
        try:
            new_decay = self.mod_vars["decay"].get()
            new_thresh = self.mod_vars["threshold"].get()
            new_hebbian = self.mod_vars["hebbian"].get()
            new_lr = self.mod_vars["learningRate"].get()
            
            # Update Module Config
            mod.decay = new_decay
            mod.threshold = new_thresh
            mod.hebbianLearning = new_hebbian
            mod.learningRate = new_lr
            
            # Update Nodes
            # Propagate changes to all nodes in this module
            count = 0
            for node in self.net.nodes.values():
                if self.net.nodeModuleMap.get(node.id) == mod.id:
                    node.decay = new_decay
                    node.threshold = new_thresh
                    count += 1
            
            self.lbl_status.config(text=f"Updated {mod.id} and {count} nodes.", fg="blue")
            
        except Exception as e:
            messagebox.showerror("Update Error", str(e))

if __name__ == "__main__":
    root = tk.Tk()
    app = NeuralGUI(root)
    root.mainloop()
