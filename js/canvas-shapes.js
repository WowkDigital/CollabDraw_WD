// Shape generation and manipulation helpers for Konva

export function createKonvaShape(shapeId, shapeData) {
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

export function updateKonvaShapeProperties(shape, pointsArray, shapeData = {}) {
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

export function getDistanceToSegment(px, py, x1, y1, x2, y2) {
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
