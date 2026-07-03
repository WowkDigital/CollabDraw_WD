import * as awarenessProtocol from 'https://esm.sh/y-protocols/awareness';
import * as Y from 'yjs';
import { ref, set, onDisconnect, push, remove, onValue, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';

// --- DIAGNOSTICS MODE ---
// Set to true to enable console connection reports, write/read tests and payload logs.
export const firebaseDebugMode = true;

// Firebase configuration. Replace with your own project config from Firebase Console.
// Make sure to enable "Realtime Database" in your Firebase project.
export const firebaseConfig = {
  apiKey: "AIzaSyDUHntH_CS-Pz0r0Hb5awrpt4XPozD1mBQ",
  authDomain: "collabdraw-707ba.firebaseapp.com",
  databaseURL: "https://collabdraw-707ba-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "collabdraw-707ba",
  storageBucket: "collabdraw-707ba.firebasestorage.app",
  messagingSenderId: "422285006399",
  appId: "1:422285006399:web:8e77e277dd5751db080a8a",
  measurementId: "G-WKP5SZF017"
};

export const isFirebaseConfigured = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

// Helper functions for safe Base64 conversion to avoid Call Stack Size limits
export function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export class FirebaseWebrtcProvider {
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
