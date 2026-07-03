export class CanvasManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.stage = null;
    
    // Map of layerId -> Konva.Layer
    this.layers = new Map();
    // Map of shapeId -> Konva.Line (both local and remote)
    this.shapes = new Map();
    
    this.activeLayerId = null;
    this.isDrawing = false;
    
    // Brush settings
    this.currentTool = 'brush'; // 'brush' or 'eraser'
    this.currentColor = '#6366f1';
    this.currentWidth = 8;
    
    // Temporary drawing state
    this.tempLine = null;
    this.activeShapeId = null;
    this.activeShapePoints = [];
    this.activeYShape = null; // Y.Map reference
    
    // Local event callbacks to notify UI/Sync
    this.onLocalStrokeStart = null; // (layerId, shapeId, tool, color, width)
    this.onLocalStrokeMove = null; // (shapeMap, points)
    this.onLocalStrokeEnd = null; // ()
    this.onCursorMove = null; // (x, y)

    this.initStage();
  }

  // 1. Initialize Stage & Responsive Resizing
  initStage() {
    const container = document.getElementById(this.containerId);
    
    this.stage = new Konva.Stage({
      container: this.containerId,
      width: container.offsetWidth,
      height: container.offsetHeight
    });

    // Resize handler
    window.addEventListener('resize', () => {
      this.resizeCanvas();
    });

    // Bind local drawing interactions
    this.setupDrawingListeners();
  }

  resizeCanvas() {
    const container = document.getElementById(this.containerId);
    if (this.stage && container) {
      this.stage.width(container.offsetWidth);
      this.stage.height(container.offsetHeight);
      this.stage.batchDraw();
    }
  }

  getRelativePointerPosition() {
    const pos = this.stage.getPointerPosition();
    if (!pos) return null;
    const transform = this.stage.getAbsoluteTransform().copy().invert();
    return transform.point(pos);
  }

  cancelLocalDrawing() {
    this.isDrawing = false;
    if (this.tempLine) {
      this.tempLine.destroy();
      this.tempLine = null;
    }
    this.activeShapeId = null;
    this.activeShapePoints = [];
    this.activeYShape = null;
  }

  setTool(tool) {
    this.currentTool = tool;
    if (tool === 'pan') {
      this.stage.draggable(true);
    } else {
      this.stage.draggable(false);
      if (this.stage.isDragging()) {
        this.stage.stopDrag();
      }
    }
  }

  zoomStage(scaleFactor, center = null) {
    const oldScale = this.stage.scaleX();
    
    // Zoom center: default to stage center if not provided
    const pointer = center || { x: this.stage.width() / 2, y: this.stage.height() / 2 };
    
    const mousePointTo = {
      x: (pointer.x - this.stage.x()) / oldScale,
      y: (pointer.y - this.stage.y()) / oldScale,
    };

    const newScale = Math.max(0.1, Math.min(10, oldScale * scaleFactor));
    this.stage.scale({ x: newScale, y: newScale });

    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    this.stage.position(newPos);
    this.stage.batchDraw();
    
    // Trigger cursor update so peers see the local cursor move on zoom
    if (this.onCursorMove) {
      const curPos = this.stage.getPointerPosition();
      if (curPos) {
        const normPos = this.getRelativePointerPosition();
        if (normPos) this.onCursorMove(normPos.x, normPos.y);
      }
    }
  }

  resetZoom() {
    this.stage.scale({ x: 1, y: 1 });
    this.stage.position({ x: 0, y: 0 });
    this.stage.batchDraw();
  }

  // 2. Local Touch and Mouse Interactions
  setupDrawingListeners() {
    this.stage.on('mousedown touchstart', (e) => {
      // If we are in panning mode, ignore drawing start
      if (this.currentTool === 'pan') return;

      // Cancel drawing if multi-touch gesture starts
      if (e.evt.touches && e.evt.touches.length > 1) {
        this.cancelLocalDrawing();
        return;
      }

      if (!this.activeLayerId) return;

      const layer = this.layers.get(this.activeLayerId);
      // Don't draw if the active layer is invisible
      if (!layer || !layer.visible()) return;

      this.isDrawing = true;
      const pos = this.getRelativePointerPosition();
      if (!pos) return;

      this.activeShapeId = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this.activeShapePoints = [pos.x, pos.y];

      // Render temporary line locally for responsive drawing
      this.tempLine = new Konva.Line({
        stroke: this.currentColor,
        strokeWidth: this.currentWidth,
        globalCompositeOperation: this.currentTool === 'eraser' ? 'destination-out' : 'source-over',
        lineCap: 'round',
        lineJoin: 'round',
        points: [...this.activeShapePoints],
        listening: false
      });

      layer.add(this.tempLine);
      layer.batchDraw();

      // Trigger callback to start Yjs synchronization
      if (this.onLocalStrokeStart) {
        this.activeYShape = this.onLocalStrokeStart(
          this.activeLayerId,
          this.activeShapeId,
          this.currentTool,
          this.currentColor,
          this.currentWidth
        );
        // Sync initial coordinates
        if (this.activeYShape && this.onLocalStrokeMove) {
          this.onLocalStrokeMove(this.activeYShape, [pos.x, pos.y]);
        }
      }
    });

    this.stage.on('mousemove touchmove', (e) => {
      const normPos = this.getRelativePointerPosition();
      if (!normPos) return;

      // Sync local cursor state with awareness using normalized coordinates
      if (this.onCursorMove) {
        this.onCursorMove(normPos.x, normPos.y);
      }

      if (!this.isDrawing || !this.tempLine) return;

      // Prevent default gesture scrolling on mobile touchmoves
      if (e.evt) {
        e.evt.preventDefault();
      }

      this.activeShapePoints.push(normPos.x, normPos.y);
      
      // Update temporary visual line
      this.tempLine.points([...this.activeShapePoints]);
      
      const layer = this.layers.get(this.activeLayerId);
      if (layer) {
        layer.batchDraw();
      }

      // Sync incremental coordinates with Yjs
      if (this.activeYShape && this.onLocalStrokeMove) {
        this.onLocalStrokeMove(this.activeYShape, [normPos.x, normPos.y]);
      }
    });

    this.stage.on('mouseup touchend', () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.tempLine) {
        const layer = this.layers.get(this.activeLayerId);
        
        // Destroy the temporary rendering line
        this.tempLine.destroy();
        this.tempLine = null;

        // Create the final permanent Konva.Line object
        const permanentLine = new Konva.Line({
          stroke: this.currentColor,
          strokeWidth: this.currentWidth,
          globalCompositeOperation: this.currentTool === 'eraser' ? 'destination-out' : 'source-over',
          lineCap: 'round',
          lineJoin: 'round',
          points: [...this.activeShapePoints],
          listening: false
        });

        if (layer) {
          layer.add(permanentLine);
          layer.batchDraw();
        }

        // Cache the local shape reference
        this.shapes.set(this.activeShapeId, permanentLine);
      }

      this.activeShapeId = null;
      this.activeShapePoints = [];
      this.activeYShape = null;

      if (this.onLocalStrokeEnd) {
        this.onLocalStrokeEnd();
      }
      this.updateWidgetPreview();
    });

    // 3. Desktop Mouse Wheel Zoom
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const scaleBy = 1.05;
      const factor = e.evt.deltaY < 0 ? scaleBy : 1 / scaleBy;
      const pointer = this.stage.getPointerPosition();
      this.zoomStage(factor, pointer);
    });

    // 4. Mobile Multi-Touch Pinch Zoom and Two-Finger Pan
    let lastDist = 0;
    let lastCenter = null;

    const getTouchDistance = (t1, t2) => {
      return Math.sqrt(Math.pow(t1.clientX - t2.clientX, 2) + Math.pow(t1.clientY - t2.clientY, 2));
    };

    const getTouchCenter = (t1, t2) => {
      const rect = this.stage.container().getBoundingClientRect();
      return {
        x: ((t1.clientX + t2.clientX) / 2) - rect.left,
        y: ((t1.clientY + t2.clientY) / 2) - rect.top
      };
    };

    this.stage.on('touchstart', (e) => {
      if (e.evt.touches && e.evt.touches.length === 2) {
        // Cancel single-finger drawing if active
        this.cancelLocalDrawing();

        if (this.stage.isDragging()) {
          this.stage.stopDrag();
        }

        const t1 = e.evt.touches[0];
        const t2 = e.evt.touches[1];
        lastDist = getTouchDistance(t1, t2);
        lastCenter = getTouchCenter(t1, t2);
      }
    });

    this.stage.on('touchmove', (e) => {
      if (e.evt.touches && e.evt.touches.length === 2) {
        e.evt.preventDefault();

        if (this.stage.isDragging()) {
          this.stage.stopDrag();
        }

        const t1 = e.evt.touches[0];
        const t2 = e.evt.touches[1];
        
        const dist = getTouchDistance(t1, t2);
        const center = getTouchCenter(t1, t2);
        
        if (lastDist > 0 && lastCenter) {
          const factor = dist / lastDist;
          
          // Apply pinch zoom relative to touch center
          this.zoomStage(factor, center);

          // Additionally pan based on touch center movement
          const dx = center.x - lastCenter.x;
          const dy = center.y - lastCenter.y;
          this.stage.position({
            x: this.stage.x() + dx,
            y: this.stage.y() + dy
          });
          this.stage.batchDraw();
        }

        lastDist = dist;
        lastCenter = center;
      }
    });

    this.stage.on('touchend', (e) => {
      if (e.evt.touches && e.evt.touches.length < 2) {
        lastDist = 0;
        lastCenter = null;
      }
    });
  }

  // --- Layer Management Methods ---

  addLayer(layerId, name, visible = true) {
    if (this.layers.has(layerId)) return;

    const layer = new Konva.Layer({
      id: layerId,
      name: name,
      visible: visible
    });

    this.stage.add(layer);
    this.layers.set(layerId, layer);
    
    // Automatically set the first layer as active
    if (!this.activeLayerId) {
      this.activeLayerId = layerId;
    }
    
    this.stage.batchDraw();
    this.updateWidgetPreview();
  }

  deleteLayer(layerId) {
    const layer = this.layers.get(layerId);
    if (layer) {
      // Clean up cached shape references inside this layer
      layer.getChildren().forEach((child) => {
        const shapeId = child.id();
        if (shapeId) {
          this.shapes.delete(shapeId);
        }
        child.destroy();
      });

      layer.destroy();
      this.layers.delete(layerId);

      // Re-assign active layer if we deleted the current active one
      if (this.activeLayerId === layerId) {
        const remainingKeys = Array.from(this.layers.keys());
        this.activeLayerId = remainingKeys.length > 0 ? remainingKeys[0] : null;
      }

      this.stage.batchDraw();
      this.updateWidgetPreview();
    }
  }

  setActiveLayer(layerId) {
    if (this.layers.has(layerId)) {
      this.activeLayerId = layerId;
    }
  }

  setLayerVisibility(layerId, visible) {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.visible(visible);
      this.stage.batchDraw();
      this.updateWidgetPreview();
    }
  }

  setLayerName(layerId, newName) {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.name(newName);
    }
  }

  reorderLayers(orderArray) {
    // Reorder Konva layers to match the index of the ordered array
    orderArray.forEach((layerId, index) => {
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.zIndex(index);
      }
    });
    this.stage.batchDraw();
    this.updateWidgetPreview();
  }

  clearLayer(layerId) {
    const layer = this.layers.get(layerId);
    if (layer) {
      // Clear shapes caches
      layer.getChildren().forEach((child) => {
        const shapeId = child.id();
        if (shapeId) {
          this.shapes.delete(shapeId);
        }
        child.destroy();
      });
      layer.batchDraw();
      this.updateWidgetPreview();
    }
  }

  // --- Remote Drawing Synchronization handlers ---

  addRemoteShape(layerId, shapeId, shapeData) {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    // Prevent duplicate lines
    if (this.shapes.has(shapeId)) return;

    const remoteLine = new Konva.Line({
      id: shapeId,
      stroke: shapeData.color,
      strokeWidth: shapeData.strokeWidth,
      globalCompositeOperation: shapeData.globalCompositeOperation || 'source-over',
      lineCap: 'round',
      lineJoin: 'round',
      points: shapeData.points || [],
      listening: false
    });

    layer.add(remoteLine);
    layer.batchDraw();
    this.updateWidgetPreview();
    
    this.shapes.set(shapeId, remoteLine);
  }

  updateRemoteShapePoints(layerId, shapeId, pointsArray) {
    const line = this.shapes.get(shapeId);
    if (line) {
      line.points(pointsArray);
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.batchDraw();
        this.updateWidgetPreview();
      }
    }
  }

  reconcileRemoteLayerShapes(layerId, shapesList) {
    const layer = this.layers.get(layerId);
    if (!layer) return;

    // 1. Gather all shape IDs currently present in Yjs
    const activeShapeIds = new Set(shapesList.map(s => s.id));

    // 2. Destroy and remove locally cached shapes that are no longer present in Yjs
    layer.getChildren().forEach((child) => {
      const shapeId = child.id();
      // Only delete permanent elements, keep tempLine safe
      if (shapeId && !activeShapeIds.has(shapeId)) {
        child.destroy();
        this.shapes.delete(shapeId);
      }
    });

    // 3. For existing or new shapes, update their properties
    shapesList.forEach((shapeData) => {
      const shapeId = shapeData.id;
      let line = this.shapes.get(shapeId);
      
      if (!line) {
        // Create if missing
        line = new Konva.Line({
          id: shapeId,
          stroke: shapeData.color,
          strokeWidth: shapeData.strokeWidth,
          globalCompositeOperation: shapeData.globalCompositeOperation || 'source-over',
          lineCap: 'round',
          lineJoin: 'round',
          points: shapeData.points || [],
          listening: false
        });
        layer.add(line);
        this.shapes.set(shapeId, line);
      } else {
        // Update points
        line.points(shapeData.points || []);
      }
    });

    layer.batchDraw();
    this.updateWidgetPreview();
  }

  updateWidgetPreview() {
    if (!this.stage) return;
    if (this._widgetUpdateTimeout) {
      clearTimeout(this._widgetUpdateTimeout);
    }
    this._widgetUpdateTimeout = setTimeout(() => {
      this._doUpdateWidgetPreview();
    }, 1500);
  }

  async _doUpdateWidgetPreview() {
    try {
      if (typeof caches === 'undefined') return;

      const dataUrl = this.stage.toDataURL({
        mimeType: 'image/png',
        quality: 0.75,
        pixelRatio: 0.5
      });

      const cache = await caches.open('codraw-widget-cache');
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      
      const cacheKey = new URL('widgets/current-board.png', window.location.href).pathname;

      await cache.put(cacheKey, new Response(blob, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': blob.size.toString(),
          'Cache-Control': 'no-store'
        }
      }));

      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'UPDATE_WIDGET_PREVIEW'
        });
      }
    } catch (e) {
      console.error('Failed to update widget preview:', e);
    }
  }

  destroy() {
    this.stage.destroy();
    this.layers.clear();
    this.shapes.clear();
  }
}
