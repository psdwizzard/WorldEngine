import { useMemo } from "react";

interface SpeechBubbleProps {
  children?: React.ReactNode;
  className?: string;
  /** Type of bubble */
  type?: "speech" | "thought";
  /** Background fill color */
  fill?: string;
  /** Border stroke color */
  stroke?: string;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** Tail direction in degrees (0 = right, 90 = down, 180 = left, 270 = up) */
  tailAngle?: number;
  /** Tail length as fraction of bubble size (0-1) */
  tailLength?: number;
  /** Font family */
  fontFamily?: string;
  /** Font size in rem */
  fontSize?: number;
  /** Hide entire shape (for linked bubbles where shape is rendered in unified overlay) */
  hideShape?: boolean;
}

export function SpeechBubble({
  children,
  className = "",
  type = "speech",
  fill = "#ffffff",
  stroke = "#000000",
  strokeWidth = 2,
  tailAngle = 240,
  tailLength = 0.3,
  fontFamily = "Comic Sans MS, cursive",
  fontSize = 0.85,
  hideShape = false,
}: SpeechBubbleProps) {
  // Use a viewBox-based approach for responsive sizing
  const viewBoxWidth = 200;
  const viewBoxHeight = 150;
  const padding = 8;

  const bubbleData = useMemo(() => {
    const cx = viewBoxWidth / 2;
    const cy = viewBoxHeight / 2 - viewBoxHeight * tailLength * 0.3;
    const rx = viewBoxWidth / 2 - padding * 2;
    const ry = viewBoxHeight / 2 - padding * 2 - viewBoxHeight * tailLength * 0.3;

    if (type === "thought") {
      return generateThoughtBubble(cx, cy, rx, ry, tailAngle, tailLength * viewBoxHeight * 0.5);
    } else {
      return generateSpeechBubble(cx, cy, rx, ry, tailAngle, tailLength * viewBoxHeight * 0.6);
    }
  }, [type, tailAngle, tailLength]);

  return (
    <div
      className={`speech-bubble speech-bubble-${type} ${className}`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      {/* SVG shape - hidden when unified overlay handles the shape */}
      {!hideShape && (
        <svg
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
          viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
          preserveAspectRatio="none"
        >
          {/* Main bubble */}
          <path
            d={bubbleData.main}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeLinejoin="round"
            style={{ paintOrder: "stroke fill" }}
          />
          {/* Thought bubble circles (if thought type) */}
          {bubbleData.thoughtCircles?.map((circle, i) => (
            <circle
              key={i}
              cx={circle.x}
              cy={circle.y}
              r={circle.r}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              style={{ paintOrder: "stroke fill" }}
            />
          ))}
        </svg>
      )}

      {/* Content */}
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "10%",
          right: "10%",
          bottom: `${30 + tailLength * 20}%`,
          color: "#000000",
          fontFamily,
          fontSize: `${fontSize}rem`,
          lineHeight: 1.2,
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function generateSpeechBubble(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tailAngle: number,
  tailLength: number
): { main: string; thoughtCircles?: Array<{ x: number; y: number; r: number }> } {
  const angleRad = (tailAngle * Math.PI) / 180;
  const tailSpread = 12;
  const angle1 = angleRad - (tailSpread * Math.PI) / 180;
  const angle2 = angleRad + (tailSpread * Math.PI) / 180;

  const base1X = cx + rx * Math.cos(angle1);
  const base1Y = cy + ry * Math.sin(angle1);
  const base2X = cx + rx * Math.cos(angle2);
  const base2Y = cy + ry * Math.sin(angle2);

  const tipX = cx + (rx + tailLength) * Math.cos(angleRad);
  const tipY = cy + (ry + tailLength) * Math.sin(angleRad);

  // Create unified path: start at base2, arc the long way to base1, then tail back to base2
  // The arc goes the "long way" around (not through the tail gap)
  // large-arc-flag=1 means take the longer arc, sweep-flag=0 means counter-clockwise
  const path = `
    M ${base1X} ${base1Y}
    A ${rx} ${ry} 0 1 0 ${base2X} ${base2Y}
    L ${tipX} ${tipY}
    Z
  `;

  return { main: path };
}

function generateThoughtBubble(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  tailAngle: number,
  tailLength: number
): { main: string; thoughtCircles: Array<{ x: number; y: number; r: number }> } {
  // Create a cloud-like shape
  const cloudPath = generateCloudPath(cx, cy, rx, ry);

  // Generate trailing thought circles - extend well beyond the bubble
  const angleRad = (tailAngle * Math.PI) / 180;
  const thoughtCircles: Array<{ x: number; y: number; r: number }> = [];

  const numCircles = 3;
  // Start closer to the edge of the bubble
  const startDistance = Math.max(rx, ry) * 0.85; // Start near but not quite at edge
  const totalTailLength = tailLength * 2.2; // Good length for comics
  
  for (let i = 0; i < numCircles; i++) {
    const t = (i + 1) / numCircles;
    const distance = startDistance + totalTailLength * t;
    const circleX = cx + distance * Math.cos(angleRad);
    const circleY = cy + distance * Math.sin(angleRad);
    // Circles get smaller as they go further
    const circleR = Math.max(3, 12 - i * 3);
    thoughtCircles.push({ x: circleX, y: circleY, r: circleR });
  }

  return { main: cloudPath, thoughtCircles };
}

function generateCloudPath(cx: number, cy: number, rx: number, ry: number): string {
  // Create a bumpy cloud shape using bezier curves
  const numBumps = 10;
  const points: Array<{ x: number; y: number; bx: number; by: number }> = [];

  for (let i = 0; i < numBumps; i++) {
    const angle = (i / numBumps) * Math.PI * 2;
    const nextAngle = ((i + 1) / numBumps) * Math.PI * 2;
    const midAngle = (angle + nextAngle) / 2;
    
    // Main point on ellipse
    const bumpOut = 0.15 * Math.sin(i * 2.3 + 1);
    const x = cx + rx * (1 + bumpOut) * Math.cos(angle);
    const y = cy + ry * (1 + bumpOut) * Math.sin(angle);
    
    // Bump control point (outward)
    const bumpFactor = 0.2 + 0.1 * Math.sin(i * 3.7);
    const bx = cx + rx * (1 + bumpFactor) * Math.cos(midAngle);
    const by = cy + ry * (1 + bumpFactor) * Math.sin(midAngle);
    
    points.push({ x, y, bx, by });
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    path += ` Q ${points[i].bx} ${points[i].by} ${next.x} ${next.y}`;
  }
  
  path += " Z";
  return path;
}

export default SpeechBubble;
