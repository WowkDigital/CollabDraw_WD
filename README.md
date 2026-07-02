# CoDraw — Real-Time Collaborative Drawing Progressive Web App (PWA)

CoDraw is a production-ready, highly interactive Progressive Web App (PWA) that allows multiple users to collaborate in real-time on a layered vector drawing canvas. It leverages a lightweight peer-to-peer WebRTC synchronization layer and a robust layer-management engine to deliver an incredibly smooth drawing experience on both desktop and mobile devices.

## 🚀 Key Features

* **Real-Time Collaboration**: Peer-to-peer state synchronization powered by **Yjs** CRDTs and WebRTC (`y-webrtc`). Coordinates stay perfectly in sync with zero merge conflicts.
* **Canvas Engine & Vector Layers**: Built on **Konva.js** for immediate-mode rendering. Supports adding, deleting, renaming (via double-click), toggling visibility, and rearranging the Z-order of canvas layers.
* **Responsive Navigation**: 
  * **Desktop**: Pinch-to-zoom using the mouse wheel, hand panning tool (drag to slide stage), and floating zoom buttons (+, -, reset).
  * **Mobile**: Full support for single-finger drawing and multi-touch gestures (pinch-to-zoom and two-finger panning).
* **Collaborative Indicators**: Live peer presence tracking, listing active user avatars in the header, and rendering other users' mouse/touch cursors overlayed in their exact positions.
* **Progressive Web App (PWA)**: Completely installable on iOS, Android, and desktop. Leverages a service worker (`sw.js`) to cache local assets and CDN libraries for complete offline functionality.
* **All-In-One Signaling Server**: Includes a native Node.js HTTP static server combined with a WebSocket WebRTC signaling broker on a single port.

---

## 🛠️ Technology Stack

* **Frontend**: Vanilla JavaScript (ES6+ Modules), HTML5, Canvas API.
* **Styling**: Tailwind CSS (via CDN with dynamic configurations) and Google Fonts.
* **Icons**: Lucide Icons.
* **Canvas framework**: Konva.js.
* **CRDT & Sync**: Yjs + y-webrtc (mapped via HTML importmap).
* **Backend**: Node.js standard modules (`http`, `fs`, `path`) + WebSockets (`ws`).

---

## 📂 Project Structure

```text
Drawing_WD/
├── public/
│   ├── js/
│   │   ├── app.js            # Registers Service Worker, boots managers, prevents touch-action defaults
│   │   ├── canvas.js         # Configures Konva Stage, normalizes coordinates, handles pinch/pan events
│   │   ├── sync.js           # Initializes Y.Doc, WebRTC connection, and awareness states
│   │   └── ui.js             # Manages toolbar picker buttons, layers list rendering, and cursor overlays
│   ├── icon-192.png          # App icon (192x192) for PWA installation
│   ├── icon-512.png          # App icon (512x512) for PWA installation
│   ├── index.html            # Core layout structure, imports importmaps and Lucide
│   ├── manifest.json         # PWA Manifest properties
│   └── sw.js                 # Service Worker caching scripts (static and dynamic CDN caching)
├── .gitignore                # Configures file paths ignored by Git
├── package.json              # App dependencies (ws) and dev runner scripts
├── README.md                 # Project documentation
└── server.js                 # Unified static file server and WebRTC WebSocket signaling broker
```

---

## ⚙️ Installation & Running Locally

Follow these quick steps to get the application running on your computer:

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org) installed (version 16 or newer recommended).

### 2. Install Dependencies
Navigate to the root directory of the project and install node packages:
```bash
npm install
```

### 3. Start the Server
Run the local server script:
```bash
npm start
```
By default, the server will launch on:
* Frontend & Assets: **`http://localhost:3000`**
* WebSocket Signaling Broker: **`ws://localhost:3000`**

Open [http://localhost:3000](http://localhost:3000) in multiple browser windows or share the URL on your local network to start collaborating!

---

## 🌐 Deploying to GitHub

To publish this repository to GitHub, follow standard git instructions:

1. **Initialize the local Git Repository**:
   ```bash
   git init
   ```
2. **Add Files**:
   ```bash
   git add .
   ```
   *(The `.gitignore` will automatically prevent adding `node_modules` and metadata files).*
3. **Commit your changes**:
   ```bash
   git commit -m "Initial commit of CoDraw collaborative canvas application"
   ```
4. **Create a remote repository** on GitHub.
5. **Link and push**:
   ```bash
   git remote add origin https://github.com/your-username/your-repo-name.git
   git branch -M main
   git push -u origin main
   ```

---

## 🔒 Security & Performance Details

* **Input Sanitization**: Room name strings and user names are sanitized using standard DOM trim methods to prevent cross-site scripting (XSS) in shared headers.
* **Coordinate Projection**: Pointers and cursors are transmitted as normalized decimals relative to the canvas coordinate matrix rather than absolute screen coordinates. When local users zoom or drag the stage, peer pointer coordinates are transformed dynamically via `stage.getAbsoluteTransform()`. This keeps cursor alignments consistent across displays of different sizes.
* **Memory Management**: All WebSocket room bindings are cleaned up when clients drop. Service workers and image icons are aggressively invalidation-controlled during activation cycles to prevent cached script conflicts.
