# CoDraw — Real-Time Collaborative Drawing Progressive Web App (PWA)

CoDraw is a production-ready, highly interactive Progressive Web App (PWA) that allows multiple users to collaborate in real-time on a layered vector drawing canvas. It leverages a lightweight peer-to-peer WebRTC synchronization layer (signaled via Firebase Realtime Database) and a robust layer-management engine to deliver an incredibly smooth drawing experience on both desktop and mobile devices.

## 🚀 Key Features

* **Real-Time P2P Collaboration**: Peer-to-peer state synchronization powered by **Yjs** CRDTs and WebRTC. Coordinates stay perfectly in sync with zero merge conflicts.
* **Firebase Backend Signaling**: Uses Firebase Realtime Database for room presence, peer discovery, and WebRTC signaling.
* **Canvas Engine & Vector Layers**: Built on **Konva.js** for immediate-mode rendering. Supports adding, deleting, renaming (via double-click), toggling visibility, and rearranging the Z-order of canvas layers.
* **Responsive Navigation**: 
  * **Desktop**: Pinch-to-zoom using the mouse wheel, hand panning tool (drag to slide stage), and floating zoom buttons (+, -, reset).
  * **Mobile**: Full support for single-finger drawing and multi-touch gestures (pinch-to-zoom and two-finger panning).
* **Collaborative Indicators**: Live peer presence tracking, listing active user avatars in the header, and rendering other users' mouse/touch cursors overlayed in their exact positions.
* **Progressive Web App (PWA)**: Completely installable on iOS, Android, and desktop. Leverages a service worker (`sw.js`) to cache local assets and CDN libraries for complete offline functionality.

---

## 🛠️ Technology Stack

* **Frontend**: Vanilla JavaScript (ES6+ Modules), HTML5, Canvas API.
* **Styling**: Tailwind CSS (via CDN with dynamic configurations) and Google Fonts.
* **Icons**: Lucide Icons.
* **Canvas framework**: Konva.js.
* **CRDT & Sync**: Yjs + y-webrtc (via HTML importmap / custom signaling provider).
* **Backend**: PHP standard web server serving static files, Firebase Realtime Database for presence tracking and WebRTC signaling.

---

## 📂 Project Structure

```text
Drawing_WD/
├── js/
│   ├── app.js            # Registers Service Worker, boots managers, prevents touch-action defaults
│   ├── canvas.js         # Configures Konva Stage, normalizes coordinates, handles pinch/pan events
│   ├── sync.js           # Initializes Y.Doc, WebRTC connection, and awareness states
│   └── ui.js             # Manages toolbar picker buttons, layers list rendering, and cursor overlays
├── .gitignore            # Configures file paths ignored by Git
├── icon-192.png          # App icon (192x192) for PWA installation
├── icon-512.png          # App icon (512x512) for PWA installation
├── index.php             # Core layout structure and application entry point
├── manifest.json         # PWA Manifest properties
├── sw.js                 # Service Worker caching scripts (static and dynamic CDN caching)
└── README.md             # Project documentation
```

---

## ⚙️ Installation & Running Locally

Follow these quick steps to get the application running on your computer:

### 1. Prerequisites
Ensure you have [PHP](https://www.php.net) installed (version 7.4 or newer recommended).

### 2. Start the Server
Run the local PHP CLI development server from the workspace root:
```bash
php -S localhost:3000
```

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
