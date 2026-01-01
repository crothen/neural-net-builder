# Neural Network Builder

[![Live Demo](https://img.shields.io/badge/Live-Demo-brightgreen)](https://crothen.github.io/neural-net-builder/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A modular, interactive neural network visualization tool built with **React**, **TypeScript**, and **Vite**.

This application allows you to design, simulate, and inspect neural networks in real-time. You can create various types of modules (Brains, Layers, Inputs, Outputs), connect them, and watch the signals propagate through the network using a dynamic Leaky Integrate-and-Fire model.

**[🚀 Try the Live Demo Here](https://crothen.github.io/neural-net-builder/)**

---

## ✨ Features

*   **Modular Architecture**: Build your network using distinctive modules:
    *   **🧠 Brain**: A circular, biologically-inspired cluster of neurons with internal recurrent connections.
    *   **Input**: A controllable signal source (Pulse, Sine Wave, Noise).
    *   **Layer**: A structured vertical layer of neurons (like in Deep Learning).
    *   **Output**: Visualizes the final signal strength.
*   **Interactive Canvas**:
    *   **Drag & Drop**: Move modules freely around the infinite canvas.
    *   **Zoom & Pan**: Mouse-centered zooming and panning for navigating large networks.
    *   **Real-time Connections**: Visual feedback for signal propagation. Teal lines indicate excitatory connections; red lines (if any) indicate inhibitory ones.
*   **Deep Inspection**:
    *   Click any module to see internal stats like node count, connectivity (In/Out), and potential decay.
    *   **Inspector Panel**: Manage connections, adjust weights, and disconnect modules with precision.
*   **Simulation Physics**:
    *   Uses a `Leaky Integrate-and-Fire` model for realistic neuron spiking behavior.
    *   Supports **Hebbian Learning** (optional) for dynamic weight adjustment based on activity.

## 🛠️ How to Use

1.  **Add Modules**: Use the **Right Sidebar** to drag and drop new modules onto the canvas.
    *   Start with an **Input** module to generate signals.
    *   Add a **Brain** or **Layer** to process them.
    *   Add an **Output** to see the result.
2.  **Connect Modules**:
    *   Select a module (Left Click).
    *   In the **Left Sidebar (Inspector)**, use the "Connect To" dropdown to link it to another module.
3.  **Simulate**:
    *   Use the **Play/Pause** controls at the top left.
    *   Adjust the **Simulation Speed** slider to slow down or speed up time.
4.  **Zoom & Pan**:
    *   Use the **Scroll Wheel** to zoom in/out (zooms to cursor).
    *   **Click & Drag** on the background to pan the view.

## 💻 Running Locally

To run this project on your local machine:

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/crothen/neural-net-builder.git
    cd neural-net-builder
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    # or
    npm ci
    ```

3.  **Start the development server**:
    ```bash
    npm run dev
    ```

4.  **Build for production**:
    ```bash
    npm run build
    ```

## 🏗️ Tech Stack

*   **Frontend**: React 18, TypeScript
*   **Build Tool**: Vite
*   **Visualization**: HTML5 Canvas API (Custom Renderer)
*   **Deployment**: GitHub Pages (Automated via GitHub Actions)

---
*Created by [crothen](https://github.com/crothen)*
