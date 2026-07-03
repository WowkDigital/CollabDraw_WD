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
    this.startX = 0;
    this.startY = 0;
    
    // Local event callbacks to notify UI/Sync
    this.onLocalStrokeStart = null; // (layerId, shapeId, tool, color, width, type, text)
    this.onLocalStrokeMove = null; // (shapeMap, points, isShape)
    this.onLocalStrokeEnd = null; // ()
    this.onCursorMove = null; // (x, y)
    this.onColorPicked = null; // (color)
    this.onTextToolClick = null; // (x, y)

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

      // 1. Eyedropper Tool click
      if (this.currentTool === 'eyedropper') {
        const color = this.pickColorAtPosition();
        if (this.onColorPicked) {
          this.onColorPicked(color);
        }
        return;
      }

      // 2. Text Tool click
      if (this.currentTool === 'text') {
        const pos = this.getRelativePointerPosition();
        if (pos && this.onTextToolClick) {
          this.onTextToolClick(pos.x, pos.y);
        }
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
      this.startX = pos.x;
      this.startY = pos.y;
      this.activeShapePoints = [pos.x, pos.y];

      const shapeType = (this.currentTool === 'brush' || this.currentTool === 'eraser') ? 'line' : this.currentTool;

      // Render temporary shape locally for responsive drawing
      if (shapeType === 'line') {
        this.tempLine = new Konva.Line({
          stroke: this.currentColor,
          strokeWidth: this.currentWidth,
          globalCompositeOperation: this.currentTool === 'eraser' ? 'destination-out' : 'source-over',
          lineCap: 'round',
          lineJoin: 'round',
          points: [...this.activeShapePoints],
          listening: false
        });
      } else if (shapeType === 'straight-line') {
        this.tempLine = new Konva.Line({
          stroke: this.currentColor,
          strokeWidth: this.currentWidth,
          lineCap: 'round',
          points: [pos.x, pos.y, pos.x, pos.y],
          listening: false
        });
      } else if (shapeType === 'rect') {
        this.tempLine = new Konva.Rect({
          x: pos.x,
          y: pos.y,
          width: 0,
          height: 0,
          stroke: this.currentColor,
          strokeWidth: this.currentWidth,
          listening: false
        });
      } else if (shapeType === 'circle') {
        this.tempLine = new Konva.Circle({
          x: pos.x,
          y: pos.y,
          radius: 0,
          stroke: this.currentColor,
          strokeWidth: this.currentWidth,
          listening: false
        });
      } else if (shapeType === 'arrow') {
        this.tempLine = new Konva.Arrow({
          stroke: this.currentColor,
          strokeWidth: this.currentWidth,
          fill: this.currentColor,
          pointerLength: 10,
          pointerWidth: 10,
          points: [pos.x, pos.y, pos.x, pos.y],
          listening: false
        });
      }

      if (this.tempLine) {
        layer.add(this.tempLine);
        layer.batchDraw();
      }

      // Trigger callback to start Yjs synchronization
      if (this.onLocalStrokeStart) {
        this.activeYShape = this.onLocalStrokeStart(
          this.activeLayerId,
          this.activeShapeId,
          this.currentTool,
          this.currentColor,
          this.currentWidth,
          shapeType
        );
        // Sync initial coordinates
        if (this.activeYShape && this.onLocalStrokeMove) {
          const initCoords = shapeType === 'line' ? [pos.x, pos.y] : [pos.x, pos.y, pos.x, pos.y];
          this.onLocalStrokeMove(this.activeYShape, initCoords, shapeType !== 'line');
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

      const shapeType = (this.currentTool === 'brush' || this.currentTool === 'eraser') ? 'line' : this.currentTool;

      if (shapeType === 'line') {
        this.activeShapePoints.push(normPos.x, normPos.y);
        this.tempLine.points([...this.activeShapePoints]);
      } else if (shapeType === 'straight-line' || shapeType === 'arrow') {
        this.activeShapePoints = [this.startX, this.startY, normPos.x, normPos.y];
        this.tempLine.points([...this.activeShapePoints]);
      } else if (shapeType === 'rect') {
        this.activeShapePoints = [this.startX, this.startY, normPos.x, normPos.y];
        this.tempLine.x(Math.min(this.startX, normPos.x));
        this.tempLine.y(Math.min(this.startY, normPos.y));
        this.tempLine.width(Math.abs(normPos.x - this.startX));
        this.tempLine.height(Math.abs(normPos.y - this.startY));
      } else if (shapeType === 'circle') {
        this.activeShapePoints = [this.startX, this.startY, normPos.x, normPos.y];
        const radius = Math.sqrt(Math.pow(normPos.x - this.startX, 2) + Math.pow(normPos.y - this.startY, 2));
        this.tempLine.radius(radius);
      }
      
      const layer = this.layers.get(this.activeLayerId);
      if (layer) {
        layer.batchDraw();
      }

      // Sync incremental coordinates with Yjs
      if (this.activeYShape && this.onLocalStrokeMove) {
        this.onLocalStrokeMove(this.activeYShape, this.activeShapePoints, shapeType !== 'line');
      }
    });

    this.stage.on('mouseup touchend', () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.tempLine) {
        const layer = this.layers.get(this.activeLayerId);
        
        // Destroy the temporary rendering shape
        this.tempLine.destroy();
        this.tempLine = null;

        const shapeType = (this.currentTool === 'brush' || this.currentTool === 'eraser') ? 'line' : this.currentTool;

        // Create the final permanent shape object
        const permanentShape = this.createKonvaShape(this.activeShapeId, {
          type: shapeType,
          color: this.currentColor,
          strokeWidth: this.currentWidth,
          globalCompositeOperation: this.currentTool === 'eraser' ? 'destination-out' : 'source-over',
          points: [...this.activeShapePoints]
        });

        if (layer && permanentShape) {
          layer.add(permanentShape);
          layer.batchDraw();
          
          // Cache the local shape reference
          this.shapes.set(this.activeShapeId, permanentShape);
        }
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

    const remoteShape = this.createKonvaShape(shapeId, shapeData);
    if (!remoteShape) return;

    layer.add(remoteShape);
    layer.batchDraw();
    this.updateWidgetPreview();
    
    this.shapes.set(shapeId, remoteShape);
  }

  updateRemoteShapePoints(layerId, shapeId, pointsArray) {
    const shape = this.shapes.get(shapeId);
    if (shape) {
      this.updateKonvaShapeProperties(shape, pointsArray);
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
      let shape = this.shapes.get(shapeId);
      
      if (!shape) {
        // Create if missing
        shape = this.createKonvaShape(shapeId, shapeData);
        if (shape) {
          layer.add(shape);
          this.shapes.set(shapeId, shape);
        }
      } else {
        // Update properties and points
        this.updateKonvaShapeProperties(shape, shapeData.points || [], shapeData);
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
  createKonvaShape(shapeId, shapeData) {
    const type = shapeData.type || 'line';
    const color = shapeData.color || '#6366f1';
    const strokeWidth = shapeData.strokeWidth || 2;
    const gco = shapeData.globalCompositeOperation || 'source-over';
    const pts = shapeData.points || [];

    const baseProps = {
      id: shapeId,
      listening: false
    };

    if (type === 'line') {
      return new Konva.Line({
        ...baseProps,
        stroke: color,
        strokeWidth: strokeWidth,
        globalCompositeOperation: gco,
        lineCap: 'round',
        lineJoin: 'round',
        points: pts
      });
    } else if (type === 'straight-line') {
      return new Konva.Line({
        ...baseProps,
        stroke: color,
        strokeWidth: strokeWidth,
        globalCompositeOperation: gco,
        lineCap: 'round',
        points: pts
      });
    } else if (type === 'rect') {
      const x1 = pts[0] || 0;
      const y1 = pts[1] || 0;
      const x2 = pts[2] || 0;
      const y2 = pts[3] || 0;
      return new Konva.Rect({
        ...baseProps,
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
        stroke: color,
        strokeWidth: strokeWidth,
        globalCompositeOperation: gco
      });
    } else if (type === 'circle') {
      const x1 = pts[0] || 0;
      const y1 = pts[1] || 0;
      const x2 = pts[2] || 0;
      const y2 = pts[3] || 0;
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      return new Konva.Circle({
        ...baseProps,
        x: x1,
        y: y1,
        radius: radius,
        stroke: color,
        strokeWidth: strokeWidth,
        globalCompositeOperation: gco
      });
    } else if (type === 'arrow') {
      return new Konva.Arrow({
        ...baseProps,
        points: pts,
        stroke: color,
        strokeWidth: strokeWidth,
        fill: color,
        pointerLength: 10,
        pointerWidth: 10,
        globalCompositeOperation: gco
      });
    } else if (type === 'text') {
      const x = pts[0] || 0;
      const y = pts[1] || 0;
      return new Konva.Text({
        ...baseProps,
        x: x,
        y: y,
        text: shapeData.text || '',
        fontSize: Math.max(12, strokeWidth * 2.5),
        fill: color,
        globalCompositeOperation: gco
      });
    }

    return null;
  }

  updateKonvaShapeProperties(shape, pointsArray, shapeData = {}) {
    if (!shape || !pointsArray || pointsArray.length === 0) return;

    const className = shape.className;
    if (className === 'Line') {
      shape.points(pointsArray);
    } else if (className === 'Rect') {
      const x1 = pointsArray[0] || 0;
      const y1 = pointsArray[1] || 0;
      const x2 = pointsArray[2] || 0;
      const y2 = pointsArray[3] || 0;
      shape.x(Math.min(x1, x2));
      shape.y(Math.min(y1, y2));
      shape.width(Math.abs(x2 - x1));
      shape.height(Math.abs(y2 - y1));
    } else if (className === 'Circle') {
      const x1 = pointsArray[0] || 0;
      const y1 = pointsArray[1] || 0;
      const x2 = pointsArray[2] || 0;
      const y2 = pointsArray[3] || 0;
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      shape.x(x1);
      shape.y(y1);
      shape.radius(radius);
    } else if (className === 'Arrow') {
      shape.points(pointsArray);
    } else if (className === 'Text') {
      shape.x(pointsArray[0] || 0);
      shape.y(pointsArray[1] || 0);
      if (shapeData.text) {
        shape.text(shapeData.text);
      }
    }
  }

  addTextShape(x, y, text) {
    if (!this.activeLayerId) return;
    const layer = this.layers.get(this.activeLayerId);
    if (!layer || !layer.visible()) return;

    const shapeId = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const pts = [x, y];

    const permanentText = this.createKonvaShape(shapeId, {
      type: 'text',
      color: this.currentColor,
      strokeWidth: this.currentWidth,
      points: pts,
      text: text
    });

    if (layer && permanentText) {
      layer.add(permanentText);
      layer.batchDraw();
      this.shapes.set(shapeId, permanentText);
    }

    if (this.onLocalStrokeStart) {
      const activeYShape = this.onLocalStrokeStart(
        this.activeLayerId,
        shapeId,
        'text',
        this.currentColor,
        this.currentWidth,
        'text',
        text
      );
      if (activeYShape && this.onLocalStrokeMove) {
        this.onLocalStrokeMove(activeYShape, pts, true);
      }
    }
    this.updateWidgetPreview();
  }

  pickColorAtPosition() {
    const stagePos = this.stage.getPointerPosition();
    const pos = this.getRelativePointerPosition();
    if (!pos || !stagePos) return this.currentColor;

    let closestShape = null;
    let minDistance = 25; // 25 pixels tolerance is perfect for touch and thin lines

    this.shapes.forEach((shape) => {
      const layer = shape.getLayer();
      if (!layer || !layer.visible()) return;

      const className = shape.className;
      if (className === 'Line' || className === 'Arrow') {
        const pts = shape.points();
        for (let i = 0; i < pts.length - 2; i += 2) {
          const dist = this.getDistanceToSegment(pos.x, pos.y, pts[i], pts[i+1], pts[i+2], pts[i+3]);
          if (dist < minDistance) {
            minDistance = dist;
            closestShape = shape;
          }
        }
      } else if (className === 'Rect') {
        const rx = shape.x();
        const ry = shape.y();
        const rw = shape.width();
        const rh = shape.height();
        
        if (pos.x >= rx && pos.x <= rx + rw && pos.y >= ry && pos.y <= ry + rh) {
          closestShape = shape;
          minDistance = 0;
        } else {
          const d1 = this.getDistanceToSegment(pos.x, pos.y, rx, ry, rx + rw, ry);
          const d2 = this.getDistanceToSegment(pos.x, pos.y, rx + rw, ry, rx + rw, ry + rh);
          const d3 = this.getDistanceToSegment(pos.x, pos.y, rx, ry + rh, rx + rw, ry + rh);
          const d4 = this.getDistanceToSegment(pos.x, pos.y, rx, ry, rx, ry + rh);
          const dist = Math.min(d1, d2, d3, d4);
          if (dist < minDistance) {
            minDistance = dist;
            closestShape = shape;
          }
        }
      } else if (className === 'Circle') {
        const cx = shape.x();
        const cy = shape.y();
        const r = shape.radius();
        const distToCenter = Math.sqrt(Math.pow(pos.x - cx, 2) + Math.pow(pos.y - cy, 2));
        const distToEdge = Math.abs(distToCenter - r);
        if (distToEdge < minDistance) {
          minDistance = distToEdge;
          closestShape = shape;
        }
      } else if (className === 'Text') {
        const tx = shape.x();
        const ty = shape.y();
        const tw = shape.width();
        const th = shape.height();
        if (pos.x >= tx && pos.x <= tx + tw && pos.y >= ty && pos.y <= ty + th) {
          closestShape = shape;
          minDistance = 0;
        }
      }
    });

    if (closestShape) {
      if (closestShape.stroke) {
        const c = closestShape.stroke();
        if (c && c !== 'transparent') return c;
      }
      if (closestShape.fill) {
        const c = closestShape.fill();
        if (c && c !== 'transparent') return c;
      }
    }
    
    return this.currentColor;
  }

  getDistanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt(Math.pow(px - x1, 2) + Math.pow(py - y1, 2));
    
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    
    return Math.sqrt(Math.pow(px - projX, 2) + Math.pow(py - projY, 2));
  }
  destroy() {
    this.stage.destroy();
    this.layers.clear();
    this.shapes.clear();
  }
}
