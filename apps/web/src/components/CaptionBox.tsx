import { useMemo, useCallback, useState, useEffect, useRef } from "react";

interface CaptionBoxProps {
  children?: React.ReactNode;
  className?: string;
  /** Background color of the box */
  fill?: string;
  /** Border/stroke color */
  stroke?: string;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Shadow offset in pixels */
  shadowOffset?: number;
  /** Shadow color */
  shadowColor?: string;
  /** How rough the edges should be (0-1, default 0.5) */
  roughness?: number;
  /** Number of points per edge (more = more detailed roughness) */
  edgeDetail?: number;
  /** Seed for randomization - change to regenerate */
  seed?: number;
  /** Min width */
  minWidth?: number;
  /** Min height */
  minHeight?: number;
  /** Font family for the caption text */
  fontFamily?: string;
  /** Font size in rem */
  fontSize?: number;
}

// Seeded random number generator for reproducible results
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateRoughEdge(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  segments: number,
  roughness: number,
  seed: number,
  isHorizontal: boolean
): string {
  const points: string[] = [];
  const dx = (endX - startX) / segments;
  const dy = (endY - startY) / segments;
  
  // Calculate perpendicular direction for roughness
  const perpX = isHorizontal ? 0 : 1;
  const perpY = isHorizontal ? 1 : 0;
  
  // Smaller, finer details - like ripped paper
  const maxOffset = 2.5 * roughness;
  
  for (let i = 0; i <= segments; i++) {
    const baseX = startX + dx * i;
    const baseY = startY + dy * i;
    
    // Don't offset the very first and last points as much
    const edgeFactor = i === 0 || i === segments ? 0.2 : 1;
    
    // Generate consistent random offset based on seed and position
    const offsetSeed = seed + i * 137.5 + (isHorizontal ? 0 : 1000);
    const randomOffset = (seededRandom(offsetSeed) - 0.5) * 2 * maxOffset * edgeFactor;
    
    // Small tears - subtle but visible
    const tearSeed = seed + i * 73.1 + (isHorizontal ? 2000 : 3000);
    const hasTear = seededRandom(tearSeed) > 0.92;
    const tearAmount = hasTear ? (seededRandom(tearSeed + 1) - 0.5) * maxOffset * 2.5 : 0;
    
    const finalX = baseX + perpX * (randomOffset + tearAmount);
    const finalY = baseY + perpY * (randomOffset + tearAmount);
    
    points.push(`${finalX.toFixed(2)},${finalY.toFixed(2)}`);
  }
  
  return points.join(" L ");
}

function generateRoughRect(
  width: number,
  height: number,
  roughness: number,
  edgeDetail: number,
  seed: number,
  padding: number = 0
): string {
  const left = padding;
  const top = padding;
  const right = width - padding;
  const bottom = height - padding;
  
  // Generate each edge with roughness
  const topEdge = generateRoughEdge(left, top, right, top, edgeDetail, roughness, seed, true);
  const rightEdge = generateRoughEdge(right, top, right, bottom, edgeDetail, roughness, seed + 100, false);
  const bottomEdge = generateRoughEdge(right, bottom, left, bottom, edgeDetail, roughness, seed + 200, true);
  const leftEdge = generateRoughEdge(left, bottom, left, top, edgeDetail, roughness, seed + 300, false);
  
  return `M ${topEdge} L ${rightEdge} L ${bottomEdge} L ${leftEdge} Z`;
}

export function CaptionBox({
  children,
  className = "",
  fill = "#f5f5f0",
  stroke = "#1a1a1a",
  strokeWidth = 2,
  shadowOffset = 3,
  shadowColor = "#1a1a1a",
  roughness = 0.7,
  edgeDetail = 24,
  seed: propSeed,
  minWidth = 100,
  minHeight = 60,
  fontFamily = "Courier New",
  fontSize = 0.75,
}: CaptionBoxProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: minWidth, height: minHeight });
  const [internalSeed, setInternalSeed] = useState(() => propSeed ?? Math.random() * 10000);
  
  const seed = propSeed ?? internalSeed;
  
  // Observe size changes
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setDimensions({ 
            width: Math.max(width, minWidth), 
            height: Math.max(height, minHeight) 
          });
        }
      }
    });
    
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [minWidth, minHeight]);
  
  // Regenerate roughness when dimensions change significantly
  const regenerate = useCallback(() => {
    setInternalSeed(Math.random() * 10000);
  }, []);
  
  const svgWidth = dimensions.width + shadowOffset + strokeWidth * 2;
  const svgHeight = dimensions.height + shadowOffset + strokeWidth * 2;
  
  // Generate the rough paths
  const { mainPath, shadowPath } = useMemo(() => {
    const padding = strokeWidth + 2;
    const mainPath = generateRoughRect(
      dimensions.width + padding * 2,
      dimensions.height + padding * 2,
      roughness,
      edgeDetail,
      seed,
      padding
    );
    
    // Shadow uses a slightly different seed for variation
    const shadowPath = generateRoughRect(
      dimensions.width + padding * 2,
      dimensions.height + padding * 2,
      roughness * 0.8,
      edgeDetail,
      seed + 500,
      padding
    );
    
    return { mainPath, shadowPath };
  }, [dimensions.width, dimensions.height, roughness, edgeDetail, seed, strokeWidth]);
  
  return (
    <div 
      ref={containerRef}
      className={`caption-box ${className}`}
      style={{ 
        position: "relative",
        minWidth,
        minHeight,
        display: "inline-block",
      }}
      onDoubleClick={regenerate}
      title="Double-click to regenerate edges"
    >
      <svg
        style={{
          position: "absolute",
          top: -strokeWidth,
          left: -strokeWidth,
          width: svgWidth,
          height: svgHeight,
          pointerEvents: "none",
          overflow: "visible",
        }}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        {/* Shadow layer */}
        <path
          d={shadowPath}
          fill={shadowColor}
          stroke="none"
          transform={`translate(${shadowOffset}, ${shadowOffset})`}
          opacity={0.9}
        />
        
        {/* Main box */}
        <path
          d={mainPath}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      </svg>
      
      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          padding: "0.5rem 0.6rem",
          color: "#1a1a1a",
          fontFamily,
          fontSize: `${fontSize}rem`,
          lineHeight: 1.3,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default CaptionBox;

