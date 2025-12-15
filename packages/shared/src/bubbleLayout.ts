/**
 * Shared bubble/connector geometry and SVG generation.
 * Used by: Web overlay (SVG), PNG export (Canvas), PSD export (SVG→bitmap)
 * 
 * IMPORTANT: All rendering targets should use these functions so changes
 * propagate automatically. Do NOT duplicate this logic elsewhere.
 */

// ============================================================================
// CONSTANTS - Single source of truth for all rendering targets
// ============================================================================

/** Connector tip width at child bubble (wider end) as fraction of canvas min dimension */
export const CONNECTOR_TIP_WIDE_SCALE = 0.025;

/** Connector tip width at parent bubble (narrower end) as fraction of canvas min dimension */
export const CONNECTOR_TIP_NARROW_SCALE = 0.0125;

/** Connector curve amount as fraction of distance between bubbles */
export const CONNECTOR_CURVE_FACTOR = 0.15;

/** Default bubble stroke width in pixels */
export const DEFAULT_STROKE_WIDTH = 2;

/** Default bubble font size in rem */
export const DEFAULT_FONT_SIZE_REM = 0.85;

/** Tail spread angle in degrees for speech bubbles */
export const TAIL_SPREAD_DEG = 12;

/** Speech tail scale factor (matches PNG export) */
export const SPEECH_TAIL_SCALE = 0.6;

/** Minimum tail length factor */
export const MIN_TAIL_LENGTH = 0.05;

/** Bubble viewbox used by PNG export */
export const BUBBLE_VIEWBOX_WIDTH = 200;
export const BUBBLE_VIEWBOX_HEIGHT = 150;
/** Padding used in PNG bubble geometry */
export const BUBBLE_PADDING = 8;
/** Tail lift factor (raises ellipse as tail length grows) */
export const BUBBLE_TAIL_LIFT = 0.3;

// ============================================================================
// INTERFACES
// ============================================================================

export interface ConnectorInput {
  childCx: number;
  childCy: number;
  parentCx: number;
  parentCy: number;
  canvasWidth: number;
  canvasHeight: number;
  strokeWidth?: number;
  exportScale?: number;
  curveFlip?: boolean;
  fill?: string;
  stroke?: string;
}

export interface ConnectorGeometry {
  /** Scaled stroke width */
  strokeW: number;
  /** SVG path string for the connector shape */
  path: string;
  /** Tip widths */
  tipWide: number;
  tipNarrow: number;
  /** Control point for curve */
  ctrlX: number;
  ctrlY: number;
  /** Corner points */
  p1x: number; p1y: number;
  p2x: number; p2y: number;
  p3x: number; p3y: number;
  p4x: number; p4y: number;
  /** Direction vectors */
  nx: number;
  ny: number;
}

export interface BubbleEllipseInput {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface BubbleTailInput extends BubbleEllipseInput {
  tailAngle: number;
  tailLength: number;
}

export interface ParentTipGeometry {
  base1X: number;
  base1Y: number;
  base2X: number;
  base2Y: number;
  tipX: number;
  tipY: number;
  path: string;
}

// ============================================================================
// GEOMETRY FUNCTIONS
// ============================================================================

/**
 * Build connector geometry between two bubble centers.
 * Returns geometry data that can be used for Canvas drawing or SVG path.
 */
export function buildConnectorGeometry(input: ConnectorInput): ConnectorGeometry {
  const {
    childCx,
    childCy,
    parentCx,
    parentCy,
    canvasWidth,
    canvasHeight,
    strokeWidth = DEFAULT_STROKE_WIDTH,
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

  // Connector tip widths scaled to canvas size
  const minDim = Math.min(canvasWidth, canvasHeight);
  const tipWide = minDim * CONNECTOR_TIP_WIDE_SCALE;
  const tipNarrow = minDim * CONNECTOR_TIP_NARROW_SCALE;

  // Stroke width scaled
  const strokeW = strokeWidth * exportScale;

  // Curve control point
  const curviness = dist * CONNECTOR_CURVE_FACTOR * (curveFlip ? -1 : 1);
  const ctrlX = (childCx + parentCx) * 0.5 + nx * curviness;
  const ctrlY = (childCy + parentCy) * 0.5 + ny * curviness;

  // Corner points (child end is wider)
  const p1x = childCx + nx * tipWide * 0.5;
  const p1y = childCy + ny * tipWide * 0.5;
  const p2x = parentCx + nx * tipNarrow * 0.5;
  const p2y = parentCy + ny * tipNarrow * 0.5;
  const p3x = parentCx - nx * tipNarrow * 0.5;
  const p3y = parentCy - ny * tipNarrow * 0.5;
  const p4x = childCx - nx * tipWide * 0.5;
  const p4y = childCy - ny * tipWide * 0.5;

  const path = `M ${p1x} ${p1y} Q ${ctrlX} ${ctrlY} ${p2x} ${p2y} L ${p3x} ${p3y} Q ${ctrlX} ${ctrlY} ${p4x} ${p4y} Z`;

  return {
    strokeW,
    path,
    tipWide,
    tipNarrow,
    ctrlX,
    ctrlY,
    p1x, p1y,
    p2x, p2y,
    p3x, p3y,
    p4x, p4y,
    nx, ny,
  };
}

/**
 * Compute font size in pixels from rem value and export scale.
 */
export function computeBubbleFontSize(fontSizeRem: number | undefined, exportScale: number): number {
  const base = (fontSizeRem ?? DEFAULT_FONT_SIZE_REM) * 16;
  return Math.max(12, base * exportScale);
}

/**
 * Compute parent tip geometry for linked bubble groups.
 * Matches PNG export exactly.
 */
export function buildParentTipGeometry(input: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  tailAngle: number;
  tailLength: number;
  strokeWidth: number;
}): ParentTipGeometry {
  const { cx, cy, rx, ry, tailAngle, tailLength, strokeWidth } = input;
  
  const angleRad = (tailAngle * Math.PI) / 180;
  const spreadRad = (TAIL_SPREAD_DEG * Math.PI) / 180;
  const angle1 = angleRad - spreadRad;
  const angle2 = angleRad + spreadRad;

  const base1X = cx + rx * Math.cos(angle1);
  const base1Y = cy + ry * Math.sin(angle1);
  const base2X = cx + rx * Math.cos(angle2);
  const base2Y = cy + ry * Math.sin(angle2);

  // Tail length matches PNG: rMin * max(0.05, tailLength) + strokeWidth * 0.5
  const rMin = Math.min(rx, ry);
  const tailLen = rMin * Math.max(MIN_TAIL_LENGTH, tailLength) + strokeWidth * 0.5;
  const tipX = cx + (rMin + tailLen) * Math.cos(angleRad);
  const tipY = cy + (rMin + tailLen) * Math.sin(angleRad);

  const path = `M ${base1X} ${base1Y} L ${tipX} ${tipY} L ${base2X} ${base2Y} Z`;

  return { base1X, base1Y, base2X, base2Y, tipX, tipY, path };
}

// ============================================================================
// SVG GENERATION - Used by PSD export and can be used by overlay
// ============================================================================

/**
 * Generate SVG string for a connector shape.
 */
export function generateConnectorSvg(input: ConnectorInput): { svg: string; bounds: { minX: number; minY: number; width: number; height: number } } {
  const geom = buildConnectorGeometry(input);
  const { fill = "#ffffff", stroke = "#000000" } = input;

  // Calculate bounding box
  const allX = [geom.p1x, geom.p2x, geom.p3x, geom.p4x, geom.ctrlX];
  const allY = [geom.p1y, geom.p2y, geom.p3y, geom.p4y, geom.ctrlY];
  const margin = geom.strokeW * 2;
  const minX = Math.min(...allX) - margin;
  const minY = Math.min(...allY) - margin;
  const maxX = Math.max(...allX) + margin;
  const maxY = Math.max(...allY) + margin;
  const width = Math.max(4, Math.ceil(maxX - minX));
  const height = Math.max(4, Math.ceil(maxY - minY));

  // Local coords (relative to bounding box)
  const lp1x = geom.p1x - minX, lp1y = geom.p1y - minY;
  const lp2x = geom.p2x - minX, lp2y = geom.p2y - minY;
  const lp3x = geom.p3x - minX, lp3y = geom.p3y - minY;
  const lp4x = geom.p4x - minX, lp4y = geom.p4y - minY;
  const lcx = geom.ctrlX - minX, lcy = geom.ctrlY - minY;

  const localPath = `M ${lp1x} ${lp1y} Q ${lcx} ${lcy} ${lp2x} ${lp2y} L ${lp3x} ${lp3y} Q ${lcx} ${lcy} ${lp4x} ${lp4y} Z`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <path d="${localPath}" fill="${fill}" stroke="${stroke}" stroke-width="${geom.strokeW}" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;

  return { svg, bounds: { minX, minY, width, height } };
}

/**
 * Generate SVG string for a bubble ellipse (without tail - for linked bubbles).
 */
export function generateBubbleEllipseSvg(input: BubbleEllipseInput & { width: number; height: number }): string {
  const { cx, cy, rx, ry, fill = "#ffffff", stroke = "#000000", strokeWidth = DEFAULT_STROKE_WIDTH, width, height } = input;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
  </svg>`;
}

/**
 * Generate SVG string for a speech bubble with tail.
 * Matches PNG export geometry (viewbox-based with padding and tail lift).
 */
export function generateSpeechBubbleSvg(input: BubbleTailInput & { width: number; height: number }): string {
  const { tailAngle, tailLength, fill = "#ffffff", stroke = "#000000", strokeWidth = DEFAULT_STROKE_WIDTH, width, height } = input;
  // Match PNG viewbox-based geometry
  const angleRad = (tailAngle * Math.PI) / 180;
  const spreadRad = (TAIL_SPREAD_DEG * Math.PI) / 180;

  // Viewbox scaling
  const scaleX = width / BUBBLE_VIEWBOX_WIDTH;
  const scaleY = height / BUBBLE_VIEWBOX_HEIGHT;

  const cxNorm = BUBBLE_VIEWBOX_WIDTH * 0.5;
  const cyNorm = BUBBLE_VIEWBOX_HEIGHT * (0.5 - tailLength * BUBBLE_TAIL_LIFT);
  const rxNorm = BUBBLE_VIEWBOX_WIDTH * 0.5 - BUBBLE_PADDING * 2;
  const ryNorm = BUBBLE_VIEWBOX_HEIGHT * 0.5 - BUBBLE_PADDING * 2 - BUBBLE_VIEWBOX_HEIGHT * tailLength * BUBBLE_TAIL_LIFT;

  const rxScaled = rxNorm * scaleX;
  const ryScaled = ryNorm * scaleY;

  const base1X = cxNorm + rxNorm * Math.cos(angleRad - spreadRad);
  const base1Y = cyNorm + ryNorm * Math.sin(angleRad - spreadRad);
  const base2X = cxNorm + rxNorm * Math.cos(angleRad + spreadRad);
  const base2Y = cyNorm + ryNorm * Math.sin(angleRad + spreadRad);

  // Tail length in viewbox units
  const tailLenNorm = BUBBLE_VIEWBOX_HEIGHT * Math.max(MIN_TAIL_LENGTH, tailLength) * SPEECH_TAIL_SCALE;
  const tipX = cxNorm + (rxNorm + tailLenNorm) * Math.cos(angleRad);
  const tipY = cyNorm + (ryNorm + tailLenNorm) * Math.sin(angleRad);

  // Convert to local coordinates (matching how PNG converts)
  const toX = (x: number) => (x) * scaleX;
  const toY = (y: number) => (y) * scaleY;

  const path = `M ${toX(base1X)} ${toY(base1Y)} A ${rxScaled} ${ryScaled} 0 1 0 ${toX(base2X)} ${toY(base2Y)} L ${toX(tipX)} ${toY(tipY)} Z`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
  </svg>`;
}
