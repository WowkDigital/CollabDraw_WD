import { renderLayersList } from './ui-layers.js';
import { updatePeerCursorsAndAvatars } from './ui-cursors.js';

export class UIManager {
  constructor(canvasManager, syncManager) {
    this.canvas = canvasManager;
    this.sync = syncManager;
    
    // UI Elements cache
    this.brushBtn = document.getElementById('tool-brush');
    this.eraserBtn = document.getElementById('tool-eraser');
    this.shapesBtn = document.getElementById('tool-shapes');
    this.shapesMenu = document.getElementById('shapes-menu');
    this.textBtn = document.getElementById('tool-text');
    this.eyedropperBtn = document.getElementById('tool-eyedropper');
    
    this.undoBtn = document.getElementById('btn-undo');
    this.redoBtn = document.getElementById('btn-redo');
    this.exportBtn = document.getElementById('btn-export');
    
    // Export Modal Elements
    this.exportModal = document.getElementById('export-modal');
    this.exportPngBtn = document.getElementById('export-png');
    this.exportJpegBtn = document.getElementById('export-jpeg');
    this.exportCancelBtn = document.getElementById('export-cancel');

    this.panBtn = document.getElementById('tool-pan');
    this.clearBtn = document.getElementById('tool-clear');
    this.sizeSlider = document.getElementById('brush-size');
    this.sizeDisplay = document.getElementById('brush-size-display');
    
    // Brush Size Preview Elements
    this.previewBubble = document.getElementById('brush-size-preview-bubble');
    this.previewCircle = document.getElementById('brush-size-preview-circle');
    this.previewText = document.getElementById('brush-size-preview-text');

    this.customColorInput = document.getElementById('color-custom');
    this.layerToggleBtn = document.getElementById('layer-manager-toggle');
    this.layerPanel = document.getElementById('layer-panel');
    this.layerPanelClose = document.getElementById('layer-panel-close');
    this.layerAddBtn = document.getElementById('layer-add');
    this.layersListContainer = document.getElementById('layers-list-container');
    this.shareBtn = document.getElementById('btn-share');
    
    // Zoom Panel Elements
    this.zoomInBtn = document.getElementById('zoom-in');
    this.zoomOutBtn = document.getElementById('zoom-out');
    this.zoomResetBtn = document.getElementById('zoom-reset');
    
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
    this.setupShareButton();
    this.setupOfflineHandlers();
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  // 1. Initial Room Join Modal setup
  setupModal() {
    // Suggest standard values if inputs are empty, checking URL parameters first
    const savedName = localStorage.getItem('codraw_name') || '';

    this.roomInput.value = 'room 1';
    this.roomInput.disabled = true;
    this.roomInput.classList.add('opacity-60', 'cursor-not-allowed');
    this.usernameInput.value = savedName;

    const joinRoom = async () => {
      const room = 'room 1';
      const username = this.usernameInput.value.trim();

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

      // Start Sync connection and wait for initial snapshot
      await this.sync.init(room, username);

      // Setup connections between canvas mutations and Yjs
      this.bindSyncAndCanvas();

      // Check if there are pre-existing layers in Yjs, if not, create a default layer
      this.sync.observeInitialLayers();
      
      if (this.sync.yLayers.size === 0) {
        const defaultLayerId = `layer_${Date.now()}`;
        this.canvas.addLayer(defaultLayerId, 'Base Canvas Layer', true);
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
    };

    this.joinBtn.addEventListener('click', joinRoom);
    this.roomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
    this.usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  }

  // 1b. Share Room Link setup
  setupShareButton() {
    if (!this.shareBtn) return;

    this.shareBtn.addEventListener('click', async () => {
      if (!this.sync.roomName) {
        alert('Dołącz najpierw do pokoju, aby móc go udostępnić.');
        return;
      }

      // Generate the URL with room query parameter
      const shareUrl = new URL(window.location.href);
      shareUrl.searchParams.set('room', this.sync.roomName);
      const urlString = shareUrl.toString();

      try {
        await navigator.clipboard.writeText(urlString);
        
        // Micro-interaction: Change button icon to checkmark for success feedback
        const icon = this.shareBtn.querySelector('i');
        const originalTitle = this.shareBtn.getAttribute('title');
        
        if (icon) {
          icon.setAttribute('data-lucide', 'check');
          if (window.lucide) window.lucide.createIcons();
        }
        this.shareBtn.classList.replace('text-slate-400', 'text-emerald-400');
        this.shareBtn.setAttribute('title', 'Skopiowano link!');
        
        setTimeout(() => {
          if (icon) {
            icon.setAttribute('data-lucide', 'share-2');
            if (window.lucide) window.lucide.createIcons();
          }
          this.shareBtn.classList.replace('text-emerald-400', 'text-slate-400');
          this.shareBtn.setAttribute('title', originalTitle);
        }, 2000);
      } catch (err) {
        console.error('Błąd kopiowania do schowka:', err);
        // Fallback for older browsers
        try {
          const textArea = document.createElement("textarea");
          textArea.value = urlString;
          textArea.style.position = "fixed";
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          alert('Link skopiowano do schowka!');
        } catch (fallbackErr) {
          alert('Nie udało się skopiować linku. Skopiuj go ręcznie: ' + urlString);
        }
      }
    });
  }

  // 2. Toolbar logic (brush, size, colors)
  setupToolbar() {
    // Select tool
    this.brushBtn.addEventListener('click', () => this.setTool('brush'));
    this.eraserBtn.addEventListener('click', () => this.setTool('eraser'));
    this.panBtn.addEventListener('click', () => this.setTool('pan'));
    this.textBtn.addEventListener('click', () => this.setTool('text'));
    this.eyedropperBtn.addEventListener('click', () => this.setTool('eyedropper'));

    // Shapes Tool toggle
    if (this.shapesBtn) {
      this.shapesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.shapesMenu) {
          this.shapesMenu.classList.toggle('hidden');
        }
      });
    }

    // Hide shapes menu when clicking anywhere else
    document.addEventListener('click', () => {
      if (this.shapesMenu) {
        this.shapesMenu.classList.add('hidden');
      }
    });

    // Shapes options buttons
    const shapeOptions = [
      { id: 'shape-straight-line', tool: 'straight-line' },
      { id: 'shape-rect', tool: 'rect' },
      { id: 'shape-circle', tool: 'circle' },
      { id: 'shape-arrow', tool: 'arrow' }
    ];

    shapeOptions.forEach(opt => {
      const btn = document.getElementById(opt.id);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setTool(opt.tool);
          if (this.shapesMenu) {
            this.shapesMenu.classList.add('hidden');
          }
        });
      }
    });

    // Eyedropper color picked callback
    this.canvas.onColorPicked = (color) => {
      this.setColor(color);
      const colorPickers = document.querySelectorAll('.color-picker-btn');
      let matched = false;
      colorPickers.forEach(b => {
        if (b.getAttribute('data-color') === color) {
          b.classList.replace('border-transparent', 'border-white');
          matched = true;
        } else {
          b.classList.replace('border-white', 'border-transparent');
        }
      });
      if (!matched) {
        this.customColorInput.parentElement.classList.add('border-white');
      } else {
        this.customColorInput.parentElement.classList.remove('border-white');
      }
      this.setTool('brush');
    };

    // Text tool click handler (inline editor)
    this.canvas.onTextToolClick = (x, y) => {
      const pos = this.canvas.stage.getPointerPosition();
      if (!pos) return;

      const container = document.getElementById('canvas-container');
      const input = document.createElement('textarea');
      input.className = "absolute z-50 p-2 bg-slate-900 border border-slate-700 text-slate-100 rounded-lg text-sm focus:outline-none focus:border-brand-500 shadow-2xl resize-none";
      input.style.left = `${pos.x}px`;
      input.style.top = `${pos.y}px`;
      input.style.width = "180px";
      input.style.height = "60px";
      input.placeholder = "Wpisz tekst...";
      
      container.appendChild(input);
      input.focus();

      const submitText = () => {
        input.removeEventListener('blur', submitText);
        const text = input.value.trim();
        if (text) {
          this.canvas.addTextShape(x, y, text);
        }
        input.remove();
        this.setTool('brush');
      };

      input.addEventListener('blur', submitText);

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitText();
        }
        if (e.key === 'Escape') {
          input.removeEventListener('blur', submitText);
          input.remove();
          this.setTool('brush');
        }
      });
    };

    // Undo / Redo buttons
    if (this.undoBtn) {
      this.undoBtn.addEventListener('click', () => this.sync.undo());
    }
    if (this.redoBtn) {
      this.redoBtn.addEventListener('click', () => this.sync.redo());
    }

    // Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z)
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            this.sync.redo();
          } else {
            this.sync.undo();
          }
        } else if (e.key.toLowerCase() === 'y') {
          e.preventDefault();
          this.sync.redo();
        }
      }
    });

    // Export Dialog interactions
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => {
        if (this.exportModal) {
          this.exportModal.classList.remove('hidden');
          requestAnimationFrame(() => {
            this.exportModal.classList.remove('opacity-0');
            this.exportModal.classList.add('opacity-100');
          });
        }
      });
    }

    const closeExportModal = () => {
      if (this.exportModal) {
        this.exportModal.classList.remove('opacity-100');
        this.exportModal.classList.add('opacity-0');
        setTimeout(() => {
          if (this.exportModal.classList.contains('opacity-0')) {
            this.exportModal.classList.add('hidden');
          }
        }, 200);
      }
    };

    if (this.exportCancelBtn) {
      this.exportCancelBtn.addEventListener('click', closeExportModal);
    }

    if (this.exportPngBtn) {
      this.exportPngBtn.addEventListener('click', () => {
        closeExportModal();
        const dataUrl = this.canvas.stage.toDataURL({
          mimeType: 'image/png',
          pixelRatio: 2
        });
        this.triggerDownload(dataUrl, 'codraw-export.png');
      });
    }

    if (this.exportJpegBtn) {
      this.exportJpegBtn.addEventListener('click', () => {
        closeExportModal();
        const dataUrl = this.canvas.stage.toDataURL({
          mimeType: 'image/jpeg',
          quality: 0.95,
          pixelRatio: 2,
          backgroundColor: '#0f172a'
        });
        this.triggerDownload(dataUrl, 'codraw-export.jpg');
      });
    }

    // Zoom Buttons
    this.zoomInBtn.addEventListener('click', () => this.canvas.zoomStage(1.2));
    this.zoomOutBtn.addEventListener('click', () => this.canvas.zoomStage(1 / 1.2));
    this.zoomResetBtn.addEventListener('click', () => this.canvas.resetZoom());
    
    // Clear Active Layer
    this.clearBtn.addEventListener('click', () => {
      if (this.canvas.activeLayerId) {
        if (confirm('Are you sure you want to clear the active layer?')) {
          this.canvas.clearLayer(this.canvas.activeLayerId);
          this.sync.clearLayerShapes(this.canvas.activeLayerId);
        }
      }
    });

    // Brush Size & Preview Tooltip interactions
    let hideTimeout;
    const showBubble = () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      if (this.previewBubble) {
        this.previewBubble.classList.remove('hidden');
        requestAnimationFrame(() => {
          this.previewBubble.classList.remove('opacity-0');
          this.previewBubble.classList.add('opacity-100');
        });
        this.updateSizePreview(this.sizeSlider.value);
      }
    };

    const hideBubble = () => {
      if (hideTimeout) clearTimeout(hideTimeout);
      hideTimeout = setTimeout(() => {
        if (this.previewBubble) {
          this.previewBubble.classList.remove('opacity-100');
          this.previewBubble.classList.add('opacity-0');
          setTimeout(() => {
            if (this.previewBubble.classList.contains('opacity-0')) {
              this.previewBubble.classList.add('hidden');
            }
          }, 200);
        }
      }, 800);
    };

    this.sizeSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      this.sizeDisplay.textContent = val;
      this.canvas.currentWidth = parseInt(val, 10);
      showBubble();
    });

    this.sizeSlider.addEventListener('pointerdown', showBubble);
    this.sizeSlider.addEventListener('touchstart', showBubble);
    this.sizeSlider.addEventListener('pointerup', hideBubble);
    this.sizeSlider.addEventListener('pointercancel', hideBubble);
    this.sizeSlider.addEventListener('touchend', hideBubble);

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
    this.canvas.setTool(tool);
    
    // Reset all tool button styles
    [this.brushBtn, this.eraserBtn, this.panBtn, this.shapesBtn, this.textBtn, this.eyedropperBtn].forEach(btn => {
      if (btn) {
        btn.classList.remove('bg-brand-600', 'text-white');
        btn.classList.add('text-slate-400', 'hover:bg-slate-800');
      }
    });

    // Apply active styles to the selected tool button
    let activeBtn;
    if (tool === 'brush') activeBtn = this.brushBtn;
    else if (tool === 'eraser') activeBtn = this.eraserBtn;
    else if (tool === 'pan') activeBtn = this.panBtn;
    else if (tool === 'text') activeBtn = this.textBtn;
    else if (tool === 'eyedropper') activeBtn = this.eyedropperBtn;
    else if (['straight-line', 'rect', 'circle', 'arrow'].includes(tool)) activeBtn = this.shapesBtn;

    if (activeBtn) {
      activeBtn.classList.remove('text-slate-400', 'hover:bg-slate-800');
      activeBtn.classList.add('bg-brand-600', 'text-white');
    }
    this.updateSizePreview(this.sizeSlider.value);
  }

  setColor(color) {
    this.canvas.currentColor = color;
    this.customColorInput.value = color;
    this.updateSizePreview(this.sizeSlider.value);
  }

  triggerDownload(dataUrl, filename) {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  updateSizePreview(val) {
    if (!this.previewBubble || !this.previewCircle || !this.previewText) return;
    
    this.previewText.textContent = `${val}px`;
    this.previewCircle.style.width = `${val}px`;
    this.previewCircle.style.height = `${val}px`;
    
    if (this.currentTool === 'eraser') {
      this.previewCircle.style.backgroundColor = 'transparent';
      this.previewCircle.style.border = '2px dashed #94a3b8';
    } else {
      this.previewCircle.style.backgroundColor = this.canvas.currentColor || '#6366f1';
      this.previewCircle.style.border = 'none';
    }
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
      let name = prompt('Enter name for the new layer:');
      if (name !== null) {
        name = name.trim();
        if (name === '') {
          const existingNames = new Set();
          this.sync.yLayerOrder.toArray().forEach(layerId => {
            const yLayer = this.sync.yLayers.get(layerId);
            if (yLayer) {
              const data = yLayer.toJSON();
              if (data && data.name) {
                existingNames.add(data.name.trim().toLowerCase());
              }
            }
          });
          
          let num = 2;
          while (existingNames.has(`layer ${num}`)) {
            num++;
          }
          name = `layer ${num}`;
        }
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
    this.canvas.onLocalStrokeStart = (layerId, shapeId, tool, color, width, type, text) => {
      return this.sync.startShape(layerId, shapeId, tool, color, width, type, text);
    };

    this.canvas.onLocalStrokeMove = (activeYShapeMap, coordinates, isShape) => {
      if (isShape) {
        this.sync.updateShapePoints(activeYShapeMap, coordinates);
      } else {
        this.sync.addPointsToShape(activeYShapeMap, coordinates);
      }
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
    updatePeerCursorsAndAvatars(this, peers);
  }

  // 6. Draw Layer list items dynamically
  renderLayersList() {
    renderLayersList(this);
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
