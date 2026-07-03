import * as Y from 'yjs';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, get } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import {
  FirebaseWebrtcProvider,
  firebaseConfig,
  isFirebaseConfigured,
  base64ToArrayBuffer,
  arrayBufferToBase64
} from './firebase-webrtc-provider.js';

export class SyncManager {
  constructor() {
    this.doc = new Y.Doc();
    this.provider = null;
    this.roomName = '';
    this.username = '';
    this.color = this.getRandomColor();

    // Shared state references
    this.yLayers = this.doc.getMap('layers');
    this.yLayerOrder = this.doc.getArray('layerOrder');

    // Undo/Redo manager tracking layers and ordering
    this.undoManager = new Y.UndoManager([this.yLayers, this.yLayerOrder]);

    // Callback hooks for the application UI/Canvas to respond to remote changes
    this.onRemoteLayerChange = null; // (type, layerId, layerData)
    this.onRemoteLayerOrderChange = null; // (layerOrderArray)
    this.onRemoteShapeChange = null; // (layerId, shapeId, shapeData, isDeleted)
    this.onRemotePointsChange = null; // (layerId, shapeId, pointsArray)
    this.onPeerCursorsChange = null; // (peers)

    // Keep track of shapes we are listening to for points changes
    // shapeId -> Y.Array observer function
    this.shapeObservers = new Map();

    // Firebase state
    this.firebaseDb = null;
    this.lastSavedState = null;
    this.saveTimeout = null;
  }

  // Generate a premium random color for user cursors and avatars
  getRandomColor() {
    const colors = [
      '#6366f1', // Indigo
      '#ec4899', // Pink
      '#ef4444', // Red
      '#f59e0b', // Amber
      '#10b981', // Emerald
      '#06b6d4', // Cyan
      '#8b5cf6', // Violet
      '#a855f7'  // Purple
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // Initialize room connection
  async init(roomName, username) {
    this.roomName = roomName;
    this.username = username || `Artist_${Math.floor(Math.random() * 1000)}`;

    // 1. Initial snapshot load from Firebase (if configured)
    if (isFirebaseConfigured) {
      try {
        console.log(`[Firebase] Fetching snapshot for room: ${roomName}...`);
        const app = initializeApp(firebaseConfig);
        const db = getDatabase(app);
        this.firebaseDb = db;

        const snapshotRef = ref(db, `rooms/${roomName}/snapshot`);
        const snapshot = await get(snapshotRef);

        if (snapshot.exists()) {
          const base64 = snapshot.val();
          const bytes = base64ToArrayBuffer(base64);
          Y.applyUpdate(this.doc, bytes, 'firebase-initial');
          console.log(`[Firebase] Snapshot loaded and applied successfully.`);
        } else {
          console.log(`[Firebase] No snapshot found for room: ${roomName}. Starting fresh.`);
        }

        // Setup automatic throttled saving of local changes to Firebase
        this.setupFirebasePersistence();
      } catch (err) {
        console.error(`[Firebase] Failed to initialize or load snapshot:`, err);
      }
    } else {
      console.warn(`[Firebase] NOT CONFIGURED. Real-time collaboration will work via WebRTC, but canvas state won't be maintained when everyone leaves. Set your config in js/sync.js.`);
    }

    // 2. Establish WebRTC connection via Firebase signaling
    this.provider = new FirebaseWebrtcProvider(roomName, this.doc, this.firebaseDb, {
      username: this.username,
      color: this.color
    });

    // Setup observers
    this.setupObservers();

    // If Firebase isn't used or we started a fresh room, wait a short moment for WebRTC peers to sync
    if (this.yLayers.size === 0) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  // Setup periodic saving to Firebase Realtime Database
  setupFirebasePersistence() {
    this.doc.on('update', (update, origin) => {
      // Don't save back changes that came from the initial load
      if (origin === 'firebase-initial') return;

      // Throttle saving: save at most once every 10 seconds of active changes
      if (!this.saveTimeout) {
        this.saveTimeout = setTimeout(() => {
          this.saveSnapshotToFirebase();
          this.saveTimeout = null;
        }, 10000);
      }
    });
  }

  async saveSnapshotToFirebase() {
    if (!this.firebaseDb || !this.roomName) return;

    try {
      const state = Y.encodeStateAsUpdate(this.doc);
      const base64 = arrayBufferToBase64(state);

      if (base64 === this.lastSavedState) return;

      const snapshotRef = ref(this.firebaseDb, `rooms/${this.roomName}/snapshot`);
      await set(snapshotRef, base64);
      this.lastSavedState = base64;
      console.log(`[Firebase] Room snapshot saved successfully for: ${this.roomName}`);
    } catch (err) {
      console.error(`[Firebase] Failed to save snapshot:`, err);
    }
  }

  setupObservers() {
    // 1. Observe changes in the list of layers
    this.yLayers.observeDeep((events, transaction) => {
      if (transaction.local && transaction.origin !== this.undoManager) return; // Prevent loop: ignore local actions (except undo/redo)

      events.forEach((event) => {
        // Handle changes in individual layers properties or shapes
        if (event.target === this.yLayers) {
          // Layer added or removed
          event.changes.keys.forEach((change, key) => {
            if (change.action === 'add') {
              const layerMap = this.yLayers.get(key);
              if (this.onRemoteLayerChange) {
                this.onRemoteLayerChange('add', key, layerMap.toJSON());
              }
              // Set observer for shape array in this new layer
              this.observeShapesArray(key, layerMap.get('shapes'));
            } else if (change.action === 'delete') {
              if (this.onRemoteLayerChange) {
                this.onRemoteLayerChange('delete', key, null);
              }
            }
          });
        } else if (event.target instanceof Y.Map && event.path.length === 1) {
          // Layer properties updated (e.g., name, visible)
          const layerId = event.path[0];
          const layerMap = event.target;
          if (this.onRemoteLayerChange) {
            this.onRemoteLayerChange('update', layerId, layerMap.toJSON());
          }
        } else if (event.target instanceof Y.Array && event.path.length === 2 && event.path[1] === 'shapes') {
          // Shapes array inside a layer changed
          const layerId = event.path[0];
          event.changes.delta.forEach((delta) => {
            if (delta.insert) {
              delta.insert.forEach((shapeMap) => {
                const shapeId = shapeMap.get('id');
                if (this.onRemoteShapeChange) {
                  this.onRemoteShapeChange(layerId, shapeId, shapeMap.toJSON(), false);
                }
                this.observeShapePoints(layerId, shapeId, shapeMap.get('points'));
              });
            }
            // Delete detection
            // In Yjs arrays, delete contains number of elements deleted,
            // we will reconcile layer state dynamically in canvas.js by diffing.
            if (delta.delete) {
              if (this.onRemoteShapeChange) {
                // Trigger a full redraw sync for this layer to apply deletion
                this.onRemoteShapeChange(layerId, null, null, true);
              }
            }
          });
        }
      });
    });

    // 2. Observe changes in layers Z-index (ordering)
    this.yLayerOrder.observe((event, transaction) => {
      if (transaction.local && transaction.origin !== this.undoManager) return;
      if (this.onRemoteLayerOrderChange) {
        this.onRemoteLayerOrderChange(this.yLayerOrder.toArray());
      }
    });

    // 3. Observe active user changes (Awareness)
    this.provider.awareness.on('change', () => {
      const states = this.provider.awareness.getStates();
      const peers = [];

      states.forEach((state, clientID) => {
        if (clientID === this.doc.clientID) return; // Skip self

        if (state.user) {
          peers.push({
            id: clientID,
            name: state.user.name,
            color: state.user.color,
            cursor: state.cursor || null
          });
        }
      });

      if (this.onPeerCursorsChange) {
        this.onPeerCursorsChange(peers);
      }
    });
  }

  // Setup observers for shapes array inside pre-existing layers when doc finishes loading
  observeInitialLayers() {
    this.yLayers.forEach((layerMap, layerId) => {
      this.observeShapesArray(layerId, layerMap.get('shapes'));

      const shapesArray = layerMap.get('shapes');
      shapesArray.forEach((shapeMap) => {
        const shapeId = shapeMap.get('id');
        this.observeShapePoints(layerId, shapeId, shapeMap.get('points'));
      });
    });
  }

  observeShapesArray(layerId, shapesArray) {
    // Already observed by observeDeep above, but keeps structure consistent
  }

  // Observe real-time growth of drawing lines
  observeShapePoints(layerId, shapeId, pointsYArray) {
    if (this.shapeObservers.has(shapeId)) {
      // Remove old observer if already set
      try {
        pointsYArray.unobserve(this.shapeObservers.get(shapeId));
      } catch (err) {
        // Ignore if already unobserved
      }
    }

    const observer = (event, transaction) => {
      if (transaction.local && transaction.origin !== this.undoManager) return;
      if (this.onRemotePointsChange) {
        this.onRemotePointsChange(layerId, shapeId, pointsYArray.toArray());
      }
    };

    pointsYArray.observe(observer);
    this.shapeObservers.set(shapeId, observer);
  }

  cleanupShapeObserver(shapeId) {
    this.shapeObservers.delete(shapeId);
  }

  // --- Transactional API for Canvas Mutations ---

  addLayer(layerId, name, visible = true) {
    this.doc.transact(() => {
      const layerMap = new Y.Map();
      layerMap.set('id', layerId);
      layerMap.set('name', name);
      layerMap.set('visible', visible);
      layerMap.set('shapes', new Y.Array());

      this.yLayers.set(layerId, layerMap);
      this.yLayerOrder.push([layerId]);
    });
  }

  deleteLayer(layerId) {
    this.doc.transact(() => {
      // Clean up local listeners
      const layerMap = this.yLayers.get(layerId);
      if (layerMap) {
        const shapes = layerMap.get('shapes');
        shapes.forEach((shapeMap) => {
          this.cleanupShapeObserver(shapeMap.get('id'));
        });
      }

      this.yLayers.delete(layerId);

      // Remove from layer order list
      let index = -1;
      for (let i = 0; i < this.yLayerOrder.length; i++) {
        if (this.yLayerOrder.get(i) === layerId) {
          index = i;
          break;
        }
      }
      if (index !== -1) {
        this.yLayerOrder.delete(index, 1);
      }
    });
  }

  updateLayerProperty(layerId, key, value) {
    const layerMap = this.yLayers.get(layerId);
    if (layerMap) {
      layerMap.set(key, value);
    }
  }

  reorderLayers(newOrder) {
    this.doc.transact(() => {
      this.yLayerOrder.delete(0, this.yLayerOrder.length);
      this.yLayerOrder.push(newOrder);
    });
  }

  // Initialize a new drawing stroke in the Yjs document
  startShape(layerId, shapeId, tool, color, strokeWidth, type = 'line', text = '') {
    let activeShapeMap = null;

    this.doc.transact(() => {
      const layerMap = this.yLayers.get(layerId);
      if (!layerMap) return;

      const shapesArray = layerMap.get('shapes');
      const shapeMap = new Y.Map();

      shapeMap.set('id', shapeId);
      shapeMap.set('type', type);
      shapeMap.set('color', color);
      shapeMap.set('strokeWidth', strokeWidth);
      shapeMap.set('globalCompositeOperation', tool === 'eraser' ? 'destination-out' : 'source-over');
      if (type === 'text') {
        shapeMap.set('text', text);
      }

      const pointsArray = new Y.Array();
      shapeMap.set('points', pointsArray);

      shapesArray.push([shapeMap]);
      activeShapeMap = shapeMap;
    });

    return activeShapeMap;
  }

  undo() {
    if (this.undoManager) {
      this.undoManager.undo();
    }
  }

  redo() {
    if (this.undoManager) {
      this.undoManager.redo();
    }
  }

  // Push new points coordinates continuously to the live shape
  addPointsToShape(shapeMap, coordinates) {
    const pointsArray = shapeMap.get('points');
    if (pointsArray) {
      pointsArray.push(coordinates);
    }
  }

  // Replace all points coordinates at once (for shapes like rect/circle/arrow)
  updateShapePoints(shapeMap, coordinates) {
    const pointsArray = shapeMap.get('points');
    if (pointsArray) {
      this.doc.transact(() => {
        pointsArray.delete(0, pointsArray.length);
        pointsArray.push(coordinates);
      });
    }
  }

  clearLayerShapes(layerId) {
    const layerMap = this.yLayers.get(layerId);
    if (layerMap) {
      const shapesArray = layerMap.get('shapes');
      this.doc.transact(() => {
        shapesArray.forEach((shapeMap) => {
          this.cleanupShapeObserver(shapeMap.get('id'));
        });
        shapesArray.delete(0, shapesArray.length);
      });
    }
  }

  // Track user mouse cursor position
  updateCursor(x, y) {
    if (this.provider && this.provider.awareness) {
      this.provider.awareness.setLocalStateField('cursor', { x, y });
    }
  }

  destroy() {
    if (this.provider) {
      this.provider.destroy();
    }
    this.doc.destroy();
    this.shapeObservers.clear();
  }
}
