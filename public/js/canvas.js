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

  // 2. Local Touch and Mouse Interactions
  setupDrawingListeners() {
    // Stage events handle coordinate normalization automatically
    this.stage.on('mousedown touchstart', (e) => {
      if (!this.activeLayerId) return;

      const layer = this.layers.get(this.activeLayerId);
      // Don't draw if the active layer is invisible
      if (!layer || !layer.visible()) return;

      this.isDrawing = true;
      const pos = this.stage.getPointerPosition();
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
        listening: false // Optimization: do not trigger hover/click events on lines
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
      const pos = this.stage.getPointerPosition();
      if (!pos) return;

      // Sync local cursor state with awareness
      if (this.onCursorMove) {
        this.onCursorMove(pos.x, pos.y);
      }

      if (!this.isDrawing || !this.tempLine) return;

      // Prevent default gesture scrolling on mobile touchmoves
      if (e.evt) {
        e.evt.preventDefault();
      }

      this.activeShapePoints.push(pos.x, pos.y);
      
      // Update temporary visual line
      this.tempLine.points([...this.activeShapePoints]);
      
      const layer = this.layers.get(this.activeLayerId);
      if (layer) {
        layer.batchDraw();
      }

      // Sync incremental coordinates with Yjs
      if (this.activeYShape && this.onLocalStrokeMove) {
        this.onLocalStrokeMove(this.activeYShape, [pos.x, pos.y]);
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
    
    this.shapes.set(shapeId, remoteLine);
  }

  updateRemoteShapePoints(layerId, shapeId, pointsArray) {
    const line = this.shapes.get(shapeId);
    if (line) {
      line.points(pointsArray);
      const layer = this.layers.get(layerId);
      if (layer) {
        layer.batchDraw();
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
  }

  destroy() {
    this.stage.destroy();
    this.layers.clear();
    this.shapes.clear();
  }
}
