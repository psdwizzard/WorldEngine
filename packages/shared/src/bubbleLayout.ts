export interface ConnectorGeometryInput {
  childCx: number;
  childCy: number;
  parentCx: number;
  parentCy: number;
  strokeWidth?: number;
  canvasWidth: number;
  canvasHeight: number;
  exportScale?: number;
  curveFlip?: boolean;
}

export interface ConnectorGeometry {
  strokeW: number;
  path: string;
  points: {
    p1x: number;
    p1y: number;
    p2x: number;
    p2y: number;
    p3x: number;
    p3y: number;
    p4x: number;
    p4y: number;
    ctrlX: number;
    ctrlY: number;
  };
}

/**
 * Build a tapered, curved connector between two bubble centers.
 * Geometry matches the PNG/canvas overlay logic so all exports stay consistent.
 */
export function buildConnectorGeometry(input: ConnectorGeometryInput): ConnectorGeometry {
  const {
    childCx,
    childCy,
    parentCx,
    parentCy,
    strokeWidth = 2,
    canvasWidth,
    canvasHeight,
    exportScale = 1,
    curveFlip = false,
  } = input;

  const dx = parentCx - childCx;
  const dy = parentCy - childCy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const nx = -dirY;
  const ny = dirX;

  // Connector width scaled to canvas size (matches overlay)
  const connectorScale = Math.min(canvasWidth, canvasHeight) * 0.012;
  const tipWide = connectorScale;
  const tipNarrow = connectorScale * 0.5;

  // Stroke width scaled like PNG export
  const strokeW = strokeWidth * exportScale;

  const curviness = dist * 0.15 * (curveFlip ? -1 : 1);
  const ctrlX = (childCx + parentCx) * 0.5 + nx * curviness;
  const ctrlY = (childCy + parentCy) * 0.5 + ny * curviness;

  const p1x = childCx + nx * tipWide * 0.5;
  const p1y = childCy + ny * tipWide * 0.5;
  const p2x = parentCx + nx * tipNarrow * 0.5;
  const p2y = parentCy + ny * tipNarrow * 0.5;
  const p3x = parentCx - nx * tipNarrow * 0.5;
  const p3y = parentCy - ny * tipNarrow * 0.5;
  const p4x = childCx - nx * tipWide * 0.5;
  const p4y = childCy - ny * tipWide * 0.5;

  const path = [
    `M ${p1x} ${p1y}`,
    `Q ${ctrlX} ${ctrlY} ${p2x} ${p2y}`,
    `L ${p3x} ${p3y}`,
    `Q ${ctrlX} ${ctrlY} ${p4x} ${p4y}`,
    `Z`,
  ].join(" ");

  return {
    strokeW,
    path,
    points: { p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y, ctrlX, ctrlY },
  };
}

export function computeBubbleFontSize(fontSizeRem: number | undefined, exportScale: number): number {
  const base = (fontSizeRem ?? 0.85) * 16;
  return base * exportScale;
}

