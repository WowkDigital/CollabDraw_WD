export class UIManager {
  constructor(canvasManager, syncManager) {
    this.canvas = canvasManager;
    this.sync = syncManager;
    
    // UI Elements cache
    this.brushBtn = document.getElementById('tool-brush');
    this.eraserBtn = document.getElementById('tool-eraser');
    this.clearBtn = document.getElementById('tool-clear');
    this.sizeSlider = document.getElementById('brush-size');
    this.sizeDisplay = document.getElementById('brush-size-display');
    this.customColorInput = document.getElementById('color-custom');
    this.layerToggleBtn = document.getElementById('layer-manager-toggle');
    this.layerPanel = document.getElementById('layer-panel');
    this.layerPanelClose = document.getElementById('layer-panel-close');
    this.layerAddBtn = document.getElementById('layer-add');
    this.layersListContainer = document.getElementById('layers-list-container');
    
    // Status Elements
    this.connIndicator = document.getElementById('connection-indicator');
    this.connStatus = document.getElementById('connection-status');
    this.avatarsContainer = document.getElementById('collaborator-avatars');
    this.collaboratorCount = document.getElementById('collaborator-count');
    this.cursorsOverlay = document.getElementById('cursors-overlay');
    
    // Room Modal Elements
    this.roomModal = document.getElementById('room-modal');
    this.roomInput = document.getElementById('room-input');
    this.usernameInput = document.getElementById('username-input');
    this.joinBtn = document.getElementById('room-join');

    this.init();
  }

  init() {
    this.setupModal();
    this.setupToolbar();
    this.setupLayerPanel();
    this.setupOfflineHandlers();
  }

  // 1. Initial Room Join Modal setup
  setupModal() {
    // Suggest standard values if inputs are empty
    const savedRoom = localStorage.getItem('codraw_room') || 'creative-studio';
    const savedName = localStorage.getItem('codraw_name') || '';

    this.roomInput.value = savedRoom;
    this.usernameInput.value = savedName;

    const joinRoom = () => {
      const room = this.roomInput.value.trim().toLowerCase();
      const username = this.usernameInput.value.trim();

      if (!room) {
        alert('Please enter a room name');
        return;
      }
      if (!username) {
        alert('Please enter your name');
        return;
      }

      // Save user configuration for return visits
      localStorage.setItem('codraw_room', room);
      localStorage.setItem('codraw_name', username);

      // Hide modal
      this.roomModal.classList.add('opacity-0');
      setTimeout(() => this.roomModal.classList.add('hidden'), 300);

      // Start Sync connection
      this.sync.init(room, username);

      // Setup connections between canvas mutations and Yjs
      this.bindSyncAndCanvas();

      // Check if there are pre-existing layers in Yjs, if not, create a default layer
      setTimeout(() => {
        this.sync.observeInitialLayers();
        
        if (this.sync.yLayers.size === 0) {
          const defaultLayerId = `layer_${Date.now()}`;
          this.sync.addLayer(defaultLayerId, 'Base Canvas Layer', true);
          this.canvas.setActiveLayer(defaultLayerId);
        } else {
          // Add existing remote layers locally
          const order = this.sync.yLayerOrder.toArray();
          order.forEach((layerId) => {
            const yLayer = this.sync.yLayers.get(layerId);
            if (yLayer) {
              const data = yLayer.toJSON();
              this.canvas.addLayer(layerId, data.name, data.visible);
              this.canvas.reconcileRemoteLayerShapes(layerId, data.shapes);
            }
          });
          this.canvas.reorderLayers(order);
          if (order.length > 0) {
            this.canvas.setActiveLayer(order[order.length - 1]); // Set top layer active
          }
        }
        
        // Update connection status
        this.updateConnectionStatus(true);
        this.renderLayersList();
      }, 800); // Small delay to sync document state
    };

    this.joinBtn.addEventListener('click', joinRoom);
    this.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
    this.usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  }

  // 2. Toolbar logic (brush, size, colors)
  setupToolbar() {
    // Select tool
    this.brushBtn.addEventListener('click', () => this.setTool('brush'));
    this.eraserBtn.addEventListener('click', () => this.setTool('eraser'));
    
    // Clear Active Layer
    this.clearBtn.addEventListener('click', () => {
      if (this.canvas.activeLayerId) {
        if (confirm('Are you sure you want to clear the active layer?')) {
          this.canvas.clearLayer(this.canvas.activeLayerId);
          this.sync.clearLayerShapes(this.canvas.activeLayerId);
        }
      }
    });

    // Brush Size
    this.sizeSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      this.sizeDisplay.textContent = val;
      this.canvas.currentWidth = parseInt(val, 10);
    });

    // Preset Colors picker
    const colorPickers = document.querySelectorAll('.color-picker-btn');
    colorPickers.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        // Clear active outline rings
        colorPickers.forEach(b => b.classList.replace('border-white', 'border-transparent'));
        this.customColorInput.parentElement.classList.remove('border-white');

        e.target.classList.replace('border-transparent', 'border-white');
        const color = e.target.getAttribute('data-color');
        
        this.setColor(color);
      });
    });

    // Custom Color picker
    this.customColorInput.addEventListener('input', (e) => {
      colorPickers.forEach(b => b.classList.replace('border-white', 'border-transparent'));
      this.customColorInput.parentElement.classList.add('border-white');
      
      this.setColor(e.target.value);
    });
  }

  setTool(tool) {
    this.currentTool = tool;
    this.canvas.currentTool = tool;
    
    // Toggle active classes on tools UI
    if (tool === 'brush') {
      this.brushBtn.classList.add('bg-brand-600', 'text-white');
      this.brushBtn.classList.remove('text-slate-400', 'hover:bg-slate-800');
      this.eraserBtn.classList.remove('bg-brand-600', 'text-white');
      this.eraserBtn.classList.add('text-slate-400', 'hover:bg-slate-800');
    } else {
      this.eraserBtn.classList.add('bg-brand-600', 'text-white');
      this.eraserBtn.classList.remove('text-slate-400', 'hover:bg-slate-800');
      this.brushBtn.classList.remove('bg-brand-600', 'text-white');
      this.brushBtn.classList.add('text-slate-400', 'hover:bg-slate-800');
    }
  }

  setColor(color) {
    this.canvas.currentColor = color;
    this.customColorInput.value = color;
  }

  // 3. Layer manager Drawer UI toggle
  setupLayerPanel() {
    this.layerToggleBtn.addEventListener('click', () => {
      this.layerPanel.classList.toggle('translate-x-full');
    });

    this.layerPanelClose.addEventListener('click', () => {
      this.layerPanel.classList.add('translate-x-full');
    });

    // Add Layer
    this.layerAddBtn.addEventListener('click', () => {
      const name = prompt('Enter name for the new layer:');
      if (name) {
        const id = `layer_${Date.now()}`;
        this.canvas.addLayer(id, name, true);
        this.sync.addLayer(id, name, true);
        this.canvas.setActiveLayer(id);
        this.renderLayersList();
      }
    });
  }

  // 4. Bind events between Sync and Canvas modules (Wiring the logic)
  bindSyncAndCanvas() {
    // LOCAL CANVAS -> SYNC WRITES
    this.canvas.onLocalStrokeStart = (layerId, shapeId, tool, color, width) => {
      return this.sync.startShape(layerId, shapeId, tool, color, width);
    };

    this.canvas.onLocalStrokeMove = (activeYShapeMap, coordinates) => {
      this.sync.addPointsToShape(activeYShapeMap, coordinates);
    };

    this.canvas.onCursorMove = (x, y) => {
      this.sync.updateCursor(x, y);
    };

    // REMOTE SYNC -> CANVAS RENDERS
    this.sync.onRemoteLayerChange = (type, layerId, layerData) => {
      if (type === 'add') {
        this.canvas.addLayer(layerId, layerData.name, layerData.visible);
      } else if (type === 'update') {
        this.canvas.setLayerVisibility(layerId, layerData.visible);
        this.canvas.setLayerName(layerId, layerData.name);
      } else if (type === 'delete') {
        this.canvas.deleteLayer(layerId);
      }
      this.renderLayersList();
    };

    this.sync.onRemoteLayerOrderChange = (layerOrderArray) => {
      this.canvas.reorderLayers(layerOrderArray);
      this.renderLayersList();
    };

    this.sync.onRemoteShapeChange = (layerId, shapeId, shapeData, isDeleted) => {
      if (isDeleted) {
        // Reconcile whole layer shape structure
        const yLayer = this.sync.yLayers.get(layerId);
        if (yLayer) {
          const shapes = yLayer.get('shapes').toJSON();
          this.canvas.reconcileRemoteLayerShapes(layerId, shapes);
        }
      } else {
        this.canvas.addRemoteShape(layerId, shapeId, shapeData);
      }
    };

    this.sync.onRemotePointsChange = (layerId, shapeId, pointsArray) => {
      this.canvas.updateRemoteShapePoints(layerId, shapeId, pointsArray);
    };

    this.sync.onPeerCursorsChange = (peers) => {
      this.updatePeerCursorsAndAvatars(peers);
    };
  }

  // 5. Redraw remote mouse/touch cursors and avatars list
  updatePeerCursorsAndAvatars(peers) {
    // 1. Update status avatar bubbles
    this.avatarsContainer.innerHTML = '';
    this.collaboratorCount.textContent = `${peers.length + 1} active`; // Count + self

    peers.forEach((peer) => {
      const bubble = document.createElement('div');
      bubble.className = 'w-6 h-6 rounded-full border border-slate-900 flex items-center justify-center text-[10px] font-bold text-white shadow';
      bubble.style.backgroundColor = peer.color;
      bubble.textContent = peer.name.charAt(0).toUpperCase();
      bubble.title = peer.name;
      this.avatarsContainer.appendChild(bubble);
    });

    // 2. Render collaborative cursors overlay
    this.cursorsOverlay.innerHTML = '';
    peers.forEach((peer) => {
      if (!peer.cursor) return;

      const cursorDiv = document.createElement('div');
      cursorDiv.className = 'absolute flex flex-col items-start transition-all duration-75 pointer-events-none';
      cursorDiv.style.left = '0px';
      cursorDiv.style.top = '0px';
      cursorDiv.style.transform = `translate3d(${peer.cursor.x}px, ${peer.cursor.y}px, 0)`;

      // Cursor arrow SVG
      const cursorSvg = document.createElement('div');
      cursorSvg.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="${peer.color}" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="3 3 7.5 21 12 12 21 7.5 3 3"/>
        </svg>
      `;

      // Name bubble tooltip
      const nameTag = document.createElement('div');
      nameTag.className = 'ml-3 mt-1 py-0.5 px-2 rounded-md text-[10px] font-medium text-white shadow-md select-none whitespace-nowrap';
      nameTag.style.backgroundColor = peer.color;
      nameTag.textContent = peer.name;

      cursorDiv.appendChild(cursorSvg);
      cursorDiv.appendChild(nameTag);
      this.cursorsOverlay.appendChild(cursorDiv);
    });
  }

  // 6. Draw Layer list items dynamically
  renderLayersList() {
    this.layersListContainer.innerHTML = '';
    
    // Z-index list in Yjs goes bottom to top, so reverse for natural look
    const layerIds = this.sync.yLayerOrder.toArray().slice().reverse();

    layerIds.forEach((layerId, idx) => {
      const yLayer = this.sync.yLayers.get(layerId);
      if (!yLayer) return;

      const layerData = yLayer.toJSON();
      const isActive = this.canvas.activeLayerId === layerId;

      const item = document.createElement('div');
      item.className = `flex items-center justify-between p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
        isActive 
          ? 'bg-brand-600/10 border-brand-500/50 shadow-md shadow-brand-500/5' 
          : 'bg-slate-900 border-slate-800/80 hover:border-slate-700/80'
      }`;

      // Click to select active layer
      item.addEventListener('click', (e) => {
        // Prevent click when user interacts with action buttons
        if (e.target.closest('button') || e.target.closest('input')) return;
        this.canvas.setActiveLayer(layerId);
        this.renderLayersList();
      });

      // Left panel: active check dot and renameable layer title
      const infoContainer = document.createElement('div');
      infoContainer.className = 'flex items-center gap-2.5 flex-grow pr-2 min-w-0';

      const activeDot = document.createElement('div');
      activeDot.className = `w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-brand-500 shadow shadow-brand-500/50 animate-pulse' : 'bg-slate-700'}`;

      const nameLabel = document.createElement('span');
      nameLabel.className = `text-xs truncate font-medium ${isActive ? 'text-slate-100' : 'text-slate-300'}`;
      nameLabel.textContent = layerData.name;

      // Handle Double Click to Rename
      nameLabel.addEventListener('dblclick', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = layerData.name;
        input.className = 'bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-brand-500 w-full';
        
        const saveRename = () => {
          const newName = input.value.trim();
          if (newName && newName !== layerData.name) {
            this.canvas.setLayerName(layerId, newName);
            this.sync.updateLayerProperty(layerId, 'name', newName);
            this.renderLayersList();
          } else {
            this.renderLayersList();
          }
        };

        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') saveRename();
          if (e.key === 'Escape') this.renderLayersList();
        });
        input.addEventListener('blur', saveRename);

        infoContainer.replaceChild(input, nameLabel);
        input.focus();
        input.select();
      });

      infoContainer.appendChild(activeDot);
      infoContainer.appendChild(nameLabel);

      // Right panel: Up, Down, Visibility Eye, and Delete Garbage Can
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'flex items-center gap-1.5 shrink-0';

      // Move Up (higher index, overlaying on top)
      const upBtn = document.createElement('button');
      upBtn.className = 'p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded';
      upBtn.disabled = idx === 0;
      upBtn.style.opacity = idx === 0 ? '0.3' : '1';
      upBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>
      `;
      upBtn.addEventListener('click', () => {
        const order = this.sync.yLayerOrder.toArray();
        // Index mapping: order list matches 0 -> bottom to len-1 -> top
        // Reversing list renders items top index first, so "idx" in reversed map
        // means element is at order[len - 1 - idx]
        const orderIndex = order.length - 1 - idx;
        if (orderIndex < order.length - 1) {
          // Swap with element above (index + 1)
          const temp = order[orderIndex];
          order[orderIndex] = order[orderIndex + 1];
          order[orderIndex + 1] = temp;
          this.sync.reorderLayers(order);
          this.canvas.reorderLayers(order);
          this.renderLayersList();
        }
      });

      // Move Down (lower index, below underneath)
      const downBtn = document.createElement('button');
      downBtn.className = 'p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 rounded';
      downBtn.disabled = idx === layerIds.length - 1;
      downBtn.style.opacity = idx === layerIds.length - 1 ? '0.3' : '1';
      downBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      `;
      downBtn.addEventListener('click', () => {
        const order = this.sync.yLayerOrder.toArray();
        const orderIndex = order.length - 1 - idx;
        if (orderIndex > 0) {
          // Swap with element below (index - 1)
          const temp = order[orderIndex];
          order[orderIndex] = order[orderIndex - 1];
          order[orderIndex - 1] = temp;
          this.sync.reorderLayers(order);
          this.canvas.reorderLayers(order);
          this.renderLayersList();
        }
      });

      // Eye visibility toggle
      const visBtn = document.createElement('button');
      visBtn.className = `p-1 hover:bg-slate-800 rounded ${layerData.visible ? 'text-slate-300' : 'text-slate-500'}`;
      visBtn.innerHTML = layerData.visible
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;
      
      visBtn.addEventListener('click', () => {
        const nextVisible = !layerData.visible;
        this.canvas.setLayerVisibility(layerId, nextVisible);
        this.sync.updateLayerProperty(layerId, 'visible', nextVisible);
        this.renderLayersList();
      });

      // Trash delete
      const delBtn = document.createElement('button');
      delBtn.className = 'p-1 hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 rounded';
      delBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      `;
      delBtn.addEventListener('click', () => {
        if (this.sync.yLayerOrder.length <= 1) {
          alert('You cannot delete the last layer. At least one layer is required.');
          return;
        }
        if (confirm(`Are you sure you want to delete the layer "${layerData.name}"?`)) {
          this.canvas.deleteLayer(layerId);
          this.sync.deleteLayer(layerId);
          this.renderLayersList();
        }
      });

      actionsContainer.appendChild(upBtn);
      actionsContainer.appendChild(downBtn);
      actionsContainer.appendChild(visBtn);
      actionsContainer.appendChild(delBtn);

      item.appendChild(infoContainer);
      item.appendChild(actionsContainer);
      this.layersListContainer.appendChild(item);
    });
  }

  // 7. Connectivity display utilities
  updateConnectionStatus(isConnected) {
    if (isConnected) {
      this.connIndicator.className = 'w-2 h-2 rounded-full bg-emerald-500';
      this.connStatus.textContent = `Connected: ${this.sync.roomName}`;
    } else {
      this.connIndicator.className = 'w-2 h-2 rounded-full bg-rose-500';
      this.connStatus.textContent = 'Disconnected';
    }
  }

  setupOfflineHandlers() {
    window.addEventListener('online', () => {
      this.updateConnectionStatus(true);
    });
    window.addEventListener('offline', () => {
      this.updateConnectionStatus(false);
    });
  }
}
