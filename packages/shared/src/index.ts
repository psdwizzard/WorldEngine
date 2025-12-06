export type UUID = string;

export const PANEL_RENDER_MODEL_VALUES = ["nano-banana", "nano-banana-pro"] as const;
export type PanelRenderModel = (typeof PANEL_RENDER_MODEL_VALUES)[number];

export const PANEL_RENDER_MODEL_LABELS: Record<PanelRenderModel, string> = {
  "nano-banana": "Nano Banana",
  "nano-banana-pro": "Nano Banana Pro",
};

export type CharacterAngle = "front" | "left" | "right" | "back" | "side" | "three-quarter";

export interface AssetReference {
  id: UUID;
  url: string;
  mimeType: string;
  width: number;
  height: number;
  aiDescription?: string;
  generatedFromPrompt?: string;
}

export interface CharacterTurnaroundSlot {
  id: UUID;
  label: string;
  angle: CharacterAngle | null;
  asset: AssetReference | null;
  order: number;
}

export interface CharacterProfile {
  id: UUID;
  name: string;
  description?: string;
  angles: Record<CharacterAngle, AssetReference | null>;
  slots?: CharacterTurnaroundSlot[];
  defaultSlotId?: UUID;
  sourceAssetId?: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface LocationSpot {
  id: UUID;
  label: string;
  notes?: string;
  referenceAssetId?: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface LocationBlueprint {
  id: UUID;
  name: string;
  primaryAssetId?: UUID;
  spots: LocationSpot[];
  createdAt: string;
  updatedAt: string;
}

export type ItemAngle = "primary" | "alternate";

export interface ItemReference {
  id: UUID;
  label: string;
  description?: string;
  angleAssets: Record<ItemAngle, AssetReference | null>;
  createdAt: string;
  updatedAt: string;
}

export interface PanelPrompt {
  id: UUID;
  pageId: UUID;
  label: string;
  characterId?: UUID;
  locationId?: UUID;
  itemId?: UUID;
  prompt: string;
  notes?: string;
  /** Optional rendered image asset for this panel. */
  renderAssetId?: UUID;
  /** Previous render asset IDs that were replaced (for history/undo). */
  replacedAssetIds?: UUID[];
  /** Optional scale factor for the rendered image within the panel. */
  renderScale?: number;
  /** Optional horizontal offset for the rendered image within the panel (fraction of panel width). */
  renderOffsetX?: number;
  /** Optional vertical offset for the rendered image within the panel (fraction of panel height). */
  renderOffsetY?: number;
  /** Optional rotation applied to the rendered image, in degrees. */
  rotation?: number;
  /** Optional drop shadow blur radius in pixels. */
  shadowBlur?: number;
  /** Optional drop shadow color (CSS string). */
  shadowColor?: string;
  /** Optional border width in pixels. */
  strokeWidth?: number;
  /** Optional border color (CSS string). */
  strokeColor?: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface PanelGeometry {
  /** Position from the left edge as a percentage (0 - 1). */
  x: number;
  /** Position from the top edge as a percentage (0 - 1). */
  y: number;
  /** Width of the panel as a percentage of the canvas (0 - 1). */
  width: number;
  /** Height of the panel as a percentage of the canvas (0 - 1). */
  height: number;
  /** Optional offsets for each corner relative to the bounding box (0-1). */
  cornerOffsets?: {
    topLeft?: { x: number; y: number };
    topRight?: { x: number; y: number };
    bottomLeft?: { x: number; y: number };
    bottomRight?: { x: number; y: number };
  };
}

export interface StoryboardPanel extends PanelPrompt {
  geometry: PanelGeometry;
}

/** A caption/info box with rough comic-style edges. */
export interface StoryboardCaptionBox {
  id: UUID;
  /** Position and size on the canvas (0-1 fractions). */
  geometry: PanelGeometry;
  /** Text content of the caption. */
  text: string;
  /** Font family for the caption text. */
  fontFamily?: string;
  /** Font size in rem units. */
  fontSize?: number;
  /** Background fill color. */
  fill: string;
  /** Border stroke color. */
  stroke: string;
  /** Border stroke width in pixels. */
  strokeWidth: number;
  /** Shadow offset in pixels. */
  shadowOffset: number;
  /** Shadow color. */
  shadowColor: string;
  /** Roughness of edges (0-1). */
  roughness: number;
  /** Seed for edge randomization. */
  seed: number;
  /** Z-index order (higher = on top). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** Type of speech/thought bubble. */
export type BubbleType = "speech" | "thought";

/** A speech or thought bubble. */
export interface StoryboardBubble {
  id: UUID;
  /** Type of bubble - speech or thought. */
  type: BubbleType;
  /** Position and size on the canvas (0-1 fractions). */
  geometry: PanelGeometry;
  /** Text content of the bubble. */
  text: string;
  /** Font family for the text. */
  fontFamily?: string;
  /** Font size in rem units. */
  fontSize?: number;
  /** Background fill color. */
  fill: string;
  /** Border stroke color. */
  stroke: string;
  /** Border stroke width in pixels. */
  strokeWidth: number;
  /** Tail direction as angle in degrees (0 = right, 90 = down, 180 = left, 270 = up). */
  tailAngle: number;
  /** Tail length as fraction of bubble size (0-1). */
  tailLength: number;
  /** ID of another bubble this one links FROM (for chained dialogue). */
  linkedToId?: UUID;
  /** Flip connector arc (true inverts the bend direction). */
  linkedCurveFlip?: boolean;
  /** Z-index order (higher = on top). */
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoryboardPage {
  id: UUID;
  label: string;
  width: number;
  height: number;
  panels: StoryboardPanel[];
  /** Caption boxes on this page. */
  captionBoxes?: StoryboardCaptionBox[];
  /** Speech and thought bubbles on this page. */
  bubbles?: StoryboardBubble[];
  /** Optional background color for the page (CSS color string). */
  backgroundColor?: string;
  /** Issue label this page belongs to (for multi-issue projects). */
  issueLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeminiGenerationRequest {
  prompt: string;
  model?: PanelRenderModel;
  imageInput?: {
    mimeType: string;
    data: string;
  };
  outputDimensions?: {
    width: number;
    height: number;
  };
}

export interface CharacterPromptPresets {
  defaultPrompt: string;
  anglePrompts?: Partial<Record<CharacterAngle, string>>;
}

export interface LocationPromptPresets {
  defaultPrompt: string;
  spotPrompt?: string;
}

export interface ItemPromptPresets {
  defaultPrompt: string;
  alternatePrompt?: string;
}

export interface StoryboardPromptPresets {
  panelPrompt: string;
  layoutPrompt?: string;
}

export interface PromptPresetSet {
  character?: CharacterPromptPresets;
  location?: LocationPromptPresets;
  item?: ItemPromptPresets;
  storyboard?: StoryboardPromptPresets;
}

export interface ProjectIssue {
  id: UUID;
  projectId: UUID;
  label: string;
  slug: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: UUID;
  name: string;
  slug: string;
  description?: string;
  issueLabel?: string;
  /** System prompt that gets prepended to all panel generation requests. */
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
  promptPresets?: PromptPresetSet;
}

export { 
  buildConnectorGeometry, 
  computeBubbleFontSize,
  buildParentTipGeometry,
  generateConnectorSvg,
  generateBubbleEllipseSvg,
  generateSpeechBubbleSvg,
  CONNECTOR_TIP_WIDE_SCALE,
  CONNECTOR_TIP_NARROW_SCALE,
  CONNECTOR_CURVE_FACTOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_FONT_SIZE_REM,
  TAIL_SPREAD_DEG,
  SPEECH_TAIL_SCALE,
  MIN_TAIL_LENGTH,
  BUBBLE_VIEWBOX_WIDTH,
  BUBBLE_VIEWBOX_HEIGHT,
  BUBBLE_PADDING,
  BUBBLE_TAIL_LIFT,
} from "./bubbleLayout";
export type { ConnectorInput, ConnectorGeometry, BubbleEllipseInput, BubbleTailInput, ParentTipGeometry } from "./bubbleLayout";
