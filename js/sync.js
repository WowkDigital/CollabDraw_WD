import * as Y from 'yjs';
import * as awarenessProtocol from 'https://esm.sh/y-protocols/awareness';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getDatabase, ref, set, get, onValue, onDisconnect, push, remove, onChildAdded, onChildRemoved } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// --- DIAGNOSTICS MODE ---
// Set to true to enable console connection reports, write/read tests and payload logs.
const firebaseDebugMode = true;

// Firebase configuration. Replace with your own project config from Firebase Console.
// Make sure to enable "Realtime Database" in your Firebase project.
const firebaseConfig = {
  apiKey: "AIzaSyDUHntH_CS-Pz0r0Hb5awrpt4XPozD1mBQ",
  authDomain: "collabdraw-707ba.firebaseapp.com",
  databaseURL: "https://collabdraw-707ba-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "collabdraw-707ba",
  storageBucket: "collabdraw-707ba.firebasestorage.app",
  messagingSenderId: "422285006399",
  appId: "1:422285006399:web:8e77e277dd5751db080a8a",
  measurementId: "G-WKP5SZF017"
};

const isFirebaseConfigured = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

// Helper functions for safe Base64 conversion to avoid Call Stack Size limits
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

class FirebaseWebrtcProvider {
  constructor(roomName, ydoc, firebaseDb, options = {}) {
    this.roomName = roomName;
    this.doc = ydoc;
    this.db = firebaseDb;
    this.username = options.username || `Artist_${Math.floor(Math.random() * 1000)}`;
    this.color = options.color || '#6366f1';

    // Generate unique session ID for this browser tab
    this.peerId = 'peer_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now().toString(36);

    // Standard Yjs awareness instance
    this.awareness = options.awareness || new awarenessProtocol.Awareness(ydoc);

    // Peer connections map: peerId -> { pc, dc, open, iceQueue, remoteDescriptionSet, signalsListeners }
    this.peers = new Map();

    // Map of peerId -> Yjs clientID (set on handshake)
    this.peerIdToClientId = new Map();

    // Last presence state received
    this.lastPresenceObj = null;

    // Global Firebase listeners to clean up
    this.firebaseListeners = [];

    // WebRTC STUN servers
    this.rtcConfig = options.rtcConfig || {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };

    if (!this.db) {
      console.error("[WebRTC Provider] Firebase Realtime Database instance is required for signaling.");
      return;
    }

    // 1. Bind Yjs doc update listener to broadcast updates
    this._docUpdateHandler = (update, origin) => {
      // Avoid loops: do not broadcast updates that originated from our WebRTC peers
      if (origin !== this) {
        this.broadcastMessage(2, update);
      }
    };
    this.doc.on('update', this._docUpdateHandler);

    // 2. Bind Yjs awareness update listener to broadcast awareness changes
    this._awarenessUpdateHandler = ({ added, updated, removed }, origin) => {
      if (origin === 'local') {
        const changedClients = added.concat(updated).concat(removed);
        const updateBytes = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
        this.broadcastMessage(3, updateBytes);
      }
    };
    this.awareness.on('update', this._awarenessUpdateHandler);

    // 3. Register presence and start listening
    this.initPresenceAndSignaling();
  }

  async initPresenceAndSignaling() {
    try {
      const presenceRef = ref(this.db, `rooms/${this.roomName}/presence/${this.peerId}`);

      // Write presence info
      await set(presenceRef, {
        name: this.username,
        color: this.color,
        peerId: this.peerId,
        joinedAt: Date.now()
      });

      // Set onDisconnect
      onDisconnect(presenceRef).remove();

      // Listen for room presence changes to detect peers
      const roomPresenceRef = ref(this.db, `rooms/${this.roomName}/presence`);
      const presenceListener = onValue(roomPresenceRef, (snapshot) => {
        const presenceObj = snapshot.val() || {};
        this.lastPresenceObj = presenceObj;
        this.handlePresenceUpdate(presenceObj);
      });
      this.firebaseListeners.push(presenceListener);
    } catch (err) {
      console.error("[WebRTC Provider] Failed to initialize presence/signaling:", err);
    }
  }

  handlePresenceUpdate(presenceObj) {
    // 1. Connect to new peers
    Object.keys(presenceObj).forEach(peerId => {
      if (peerId === this.peerId) return; // skip self

      if (!this.peers.has(peerId)) {
        const isInitiator = this.peerId < peerId;
        this.connectToPeer(peerId, isInitiator);
      }
    });

    // 2. Disconnect from peers that left
    this.peers.forEach((_, peerId) => {
      if (!presenceObj[peerId]) {
        console.log(`[WebRTC] Peer ${peerId} left the room. Closing connection.`);
        this.closeConnection(peerId);
      }
    });
  }

  async connectToPeer(peerId, isInitiator) {
    if (this.peers.has(peerId)) return;

    console.log(`[WebRTC] Connecting to peer: ${peerId} (isInitiator: ${isInitiator})`);

    const pc = new RTCPeerConnection(this.rtcConfig);
    const peerInfo = {
      pc,
      dc: null,
      open: false,
      iceQueue: [],
      remoteDescriptionSet: false,
      signalsListeners: []
    };
    this.peers.set(peerId, peerInfo);

    const channelKey = this.peerId < peerId ? `${this.peerId}_to_${peerId}` : `${peerId}_to_${this.peerId}`;
    const signalPath = `rooms/${this.roomName}/signals/${channelKey}`;

    // Setup ICE candidate collection
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        const candidateRolePath = isInitiator ? 'candidates_from_initiator' : 'candidates_from_receiver';
        const candidateRef = ref(this.db, `${signalPath}/${candidateRolePath}`);
        push(candidateRef, event.candidate.toJSON()).catch(err => {
          console.warn("[WebRTC] Error pushing candidate:", err);
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.closeConnection(peerId);
      }
    };

    if (isInitiator) {
      // Clear old signaling data first
      try {
        await remove(ref(this.db, signalPath));
      } catch (err) { }

      // 1. Create Data Channel
      const dc = pc.createDataChannel('yjs-sync');
      peerInfo.dc = dc;
      this.setupDataChannel(peerId, dc);

      // 2. Create offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await set(ref(this.db, `${signalPath}/offer`), {
          type: offer.type,
          sdp: offer.sdp,
          initiator: this.peerId
        });

        // Listen for answer
        const answerRef = ref(this.db, `${signalPath}/answer`);
        const answerListener = onValue(answerRef, async (snapshot) => {
          const answer = snapshot.val();
          if (answer && !peerInfo.remoteDescriptionSet) {
            try {
              console.log(`[WebRTC] Answer received from ${peerId}, setting remote desc...`);
              await pc.setRemoteDescription(new RTCSessionDescription(answer));
              peerInfo.remoteDescriptionSet = true;

              // Flush ICE queue
              while (peerInfo.iceQueue.length > 0) {
                const cand = peerInfo.iceQueue.shift();
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              }
            } catch (err) {
              console.error(`[WebRTC] Error setting remote description for peer ${peerId}:`, err);
            }
          }
        });
        peerInfo.signalsListeners.push(answerListener);

        // Listen for candidates from receiver
        const recvCandRef = ref(this.db, `${signalPath}/candidates_from_receiver`);
        const recvCandListener = onChildAdded(recvCandRef, async (snapshot) => {
          const cand = snapshot.val();
          if (cand) {
            if (peerInfo.remoteDescriptionSet) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch (err) {
                console.warn("[WebRTC] Error adding ICE candidate:", err);
              }
            } else {
              peerInfo.iceQueue.push(cand);
            }
          }
        });
        peerInfo.signalsListeners.push(recvCandListener);

      } catch (err) {
        console.error(`[WebRTC] Initiator error connecting to ${peerId}:`, err);
      }
    } else {
      // Receiver: Listen for offer
      const offerRef = ref(this.db, `${signalPath}/offer`);
      const offerListener = onValue(offerRef, async (snapshot) => {
        const offer = snapshot.val();
        if (offer && !peerInfo.remoteDescriptionSet) {
          try {
            console.log(`[WebRTC] Offer received from ${peerId}, setting remote desc and answering...`);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            peerInfo.remoteDescriptionSet = true;

            // Flush ICE queue
            while (peerInfo.iceQueue.length > 0) {
              const cand = peerInfo.iceQueue.shift();
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await set(ref(this.db, `${signalPath}/answer`), {
              type: answer.type,
              sdp: answer.sdp
            });
          } catch (err) {
            console.error(`[WebRTC] Receiver error responding to offer from ${peerId}:`, err);
          }
        }
      });
      peerInfo.signalsListeners.push(offerListener);

      // Listen for data channel
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        peerInfo.dc = dc;
        this.setupDataChannel(peerId, dc);
      };

      // Listen for candidates from initiator
      const initCandRef = ref(this.db, `${signalPath}/candidates_from_initiator`);
      const initCandListener = onChildAdded(initCandRef, async (snapshot) => {
        const cand = snapshot.val();
        if (cand) {
          if (peerInfo.remoteDescriptionSet) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (err) {
              console.warn("[WebRTC] Error adding ICE candidate:", err);
            }
          } else {
            peerInfo.iceQueue.push(cand);
          }
        }
      });
      peerInfo.signalsListeners.push(initCandListener);
    }
  }

  setupDataChannel(peerId, dc) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      console.log(`[WebRTC] Data channel opened with peer: ${peerId}`);
      const peerInfo = this.peers.get(peerId);
      if (peerInfo) {
        peerInfo.open = true;
      }

      // 1. Send Handshake containing Yjs clientID
      const handshake = new TextEncoder().encode(JSON.stringify({ clientID: this.doc.clientID }));
      this.sendToPeer(peerId, 4, handshake);

      // 2. Send local State Vector (Sync Step 1)
      const stateVector = Y.encodeStateVector(this.doc);
      this.sendToPeer(peerId, 0, stateVector);

      // 3. Send current local Awareness state
      const localAwareness = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
      this.sendToPeer(peerId, 3, localAwareness);
    };

    dc.onmessage = (event) => {
      const arrayBuffer = event.data;
      const data = new Uint8Array(arrayBuffer);
      if (data.length === 0) return;

      const messageType = data[0];
      const payload = data.subarray(1);

      this.handlePeerMessage(peerId, messageType, payload);
    };

    dc.onclose = () => {
      console.log(`[WebRTC] Data channel closed for peer: ${peerId}`);
      this.closeConnection(peerId);
    };

    dc.onerror = (err) => {
      console.error(`[WebRTC] Data channel error for peer ${peerId}:`, err);
    };
  }

  handlePeerMessage(peerId, messageType, payload) {
    switch (messageType) {
      case 0: { // Sync Step 1: State Vector received
        const update = Y.encodeStateAsUpdate(this.doc, payload);
        this.sendToPeer(peerId, 1, update);
        break;
      }
      case 1: // Sync Step 2: Update received
      case 2: { // Incremental document update
        Y.applyUpdate(this.doc, payload, this);
        break;
      }
      case 3: { // Awareness update
        awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, this);
        break;
      }
      case 4: { // Handshake (clientID mapping)
        try {
          const jsonStr = new TextDecoder().decode(payload);
          const data = JSON.parse(jsonStr);
          if (data && data.clientID) {
            console.log(`[WebRTC] Mapped peer ${peerId} to clientID ${data.clientID}`);
            this.peerIdToClientId.set(peerId, data.clientID);
          }
        } catch (err) {
          console.error(`[WebRTC] Failed to parse handshake message from peer ${peerId}:`, err);
        }
        break;
      }
      default:
        console.warn(`[WebRTC] Unknown message type: ${messageType}`);
    }
  }

  broadcastMessage(messageType, payload) {
    this.peers.forEach((peerInfo, peerId) => {
      if (peerInfo.open && peerInfo.dc && peerInfo.dc.readyState === 'open') {
        this.sendToPeer(peerId, messageType, payload);
      }
    });
  }

  sendToPeer(peerId, messageType, payload) {
    const peerInfo = this.peers.get(peerId);
    if (!peerInfo || !peerInfo.dc || peerInfo.dc.readyState !== 'open') return;

    try {
      const msg = new Uint8Array(payload.length + 1);
      msg[0] = messageType;
      msg.set(payload, 1);
      peerInfo.dc.send(msg);
    } catch (err) {
      console.error(`[WebRTC] Failed to send message to peer ${peerId}:`, err);
    }
  }

  closeConnection(peerId) {
    const peerInfo = this.peers.get(peerId);
    if (!peerInfo) return;

    console.log(`[WebRTC] Closing connection with peer: ${peerId}`);

    // 1. Remove awareness state immediately
    const clientID = this.peerIdToClientId.get(peerId);
    if (clientID) {
      awarenessProtocol.removeAwarenessStates(this.awareness, [clientID], this);
      this.peerIdToClientId.delete(peerId);
    }

    // 2. Unsubscribe signaling listeners
    peerInfo.signalsListeners.forEach(unsub => {
      try {
        unsub();
      } catch (err) { }
    });

    // 3. Close data channel
    if (peerInfo.dc) {
      try {
        peerInfo.dc.close();
      } catch (e) { }
    }

    // 4. Close peer connection
    try {
      peerInfo.pc.close();
    } catch (e) { }

    // 5. Remove from peers map
    this.peers.delete(peerId);

    // 6. Clean up Firebase signal node if we are initiator (or just attempt it safely)
    const channelKey = this.peerId < peerId ? `${this.peerId}_to_${peerId}` : `${peerId}_to_${this.peerId}`;
    const signalRef = ref(this.db, `rooms/${this.roomName}/signals/${channelKey}`);
    remove(signalRef).catch(() => { });

    // 7. Auto-reconnect if they are still listed in the presence table
    const wasInitiator = this.peerId < peerId;
    if (this.lastPresenceObj && this.lastPresenceObj[peerId]) {
      console.log(`[WebRTC] Peer ${peerId} is still in the room. Scheduling reconnect in 3s...`);
      setTimeout(() => {
        if (!this.peers.has(peerId) && this.lastPresenceObj && this.lastPresenceObj[peerId]) {
          this.connectToPeer(peerId, wasInitiator);
        }
      }, 3000);
    }
  }

  destroy() {
    console.log(`[WebRTC] Destroying provider...`);

    this.doc.off('update', this._docUpdateHandler);
    this.awareness.off('update', this._awarenessUpdateHandler);

    const peerIds = Array.from(this.peers.keys());
    peerIds.forEach(peerId => this.closeConnection(peerId));

    const presenceRef = ref(this.db, `rooms/${this.roomName}/presence/${this.peerId}`);
    remove(presenceRef).catch(() => { });

    this.firebaseListeners.forEach(unsub => {
      try {
        unsub();
      } catch (err) { }
    });
  }
}

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
      if (transaction.local) return; // Prevent loop: ignore local actions

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
      if (transaction.local) return;
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
      pointsYArray.unobserve(this.shapeObservers.get(shapeId));
    }

    const observer = (event, transaction) => {
      if (transaction.local) return;
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
  startShape(layerId, shapeId, tool, color, strokeWidth) {
    let activeShapeMap = null;

    this.doc.transact(() => {
      const layerMap = this.yLayers.get(layerId);
      if (!layerMap) return;

      const shapesArray = layerMap.get('shapes');
      const shapeMap = new Y.Map();

      shapeMap.set('id', shapeId);
      shapeMap.set('type', 'line');
      shapeMap.set('color', color);
      shapeMap.set('strokeWidth', strokeWidth);
      shapeMap.set('globalCompositeOperation', tool === 'eraser' ? 'destination-out' : 'source-over');

      const pointsArray = new Y.Array();
      shapeMap.set('points', pointsArray);

      shapesArray.push([shapeMap]);
      activeShapeMap = shapeMap;
    });

    return activeShapeMap;
  }

  // Push new points coordinates continuously to the live shape
  addPointsToShape(shapeMap, coordinates) {
    const pointsArray = shapeMap.get('points');
    if (pointsArray) {
      pointsArray.push(coordinates);
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
