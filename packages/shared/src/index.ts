export type UUID = string;

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
}

export interface StoryboardPanel extends PanelPrompt {
  geometry: PanelGeometry;
}

export interface StoryboardPage {
  id: UUID;
  label: string;
  width: number;
  height: number;
  panels: StoryboardPanel[];
  createdAt: string;
  updatedAt: string;
}

export interface GeminiGenerationRequest {
  prompt: string;
  model?: string;
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
  createdAt: string;
  updatedAt: string;
  promptPresets?: PromptPresetSet;
}
