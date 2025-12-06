import { GoogleGenerativeAI, type EnhancedGenerateContentResponse, type Part } from "@google/generative-ai";
import sharp from "sharp";
import type { EnvConfig } from "./env";
import type { GeminiGenerationRequest } from "@worldengine/shared";

let client: GoogleGenerativeAI | null = null;
export const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";

export function getGeminiClient(env: EnvConfig, apiKeyOverride?: string) {
  // If a per-request key is provided, use a non-cached client for that key.
  if (apiKeyOverride && apiKeyOverride.trim().length > 0) {
    return new GoogleGenerativeAI(apiKeyOverride.trim());
  }

  if (!env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY; set it in .env.local or pass x-gemini-key before generating renders.");
  }

  if (!client) {
    client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  return client;
}

export async function generateImage(
  env: EnvConfig,
  request: GeminiGenerationRequest,
  options?: { apiKeyOverride?: string }
): Promise<{ imageBuffer: Buffer; aiDescription?: string }> {
  const client = getGeminiClient(env, options?.apiKeyOverride);
  const modelName = request.model ?? DEFAULT_IMAGE_MODEL;
  const model = client.getGenerativeModel({ model: modelName });
  const width = request.outputDimensions?.width ?? 512;
  const height = request.outputDimensions?.height ?? 512;

  // Append resolution instruction to the prompt to override input image aspect ratio
  const promptWithDimensions = `${request.prompt} \n\nOutput resolution: ${width}x${height}.`;

  const promptParts: Part[] = [{ text: promptWithDimensions }];
  if (request.imageInput) {
    promptParts.push({
      inlineData: {
        data: request.imageInput.data,
        mimeType: request.imageInput.mimeType,
      },
    });
  }

  try {
    console.log(`gemini:generate_image model=${modelName} size=${width}x${height}`);
    const result = await model.generateContent({
      contents: [{ role: "user", parts: promptParts }],
    });
    const aiDescription = extractAiDescription(result.response);
    const inlineImage = extractInlineImage(result.response);

    if (inlineImage) {
      return { imageBuffer: inlineImage, aiDescription };
    }

    console.warn("gemini:image_missing", { prompt: request.prompt });
    const placeholder = await generateVariedPlaceholder(
      `${request.prompt}${aiDescription ? ` | ${aiDescription}` : ""}`,
      width,
      height,
    );

    return { imageBuffer: placeholder, aiDescription };
  } catch (error) {
    console.error("Gemini API error", error);
    const fallback = await generateVariedPlaceholder(
      request.prompt,
      width,
      height,
    );

    return { imageBuffer: fallback, aiDescription: undefined };
  }
}

function extractInlineImage(response: EnhancedGenerateContentResponse) {
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data;
      if (data && part.inlineData?.mimeType?.startsWith("image/")) {
        return Buffer.from(data, "base64");
      }
    }
  }
  return null;
}

function extractAiDescription(response: EnhancedGenerateContentResponse): string | undefined {
  try {
    const text = response.text();
    if (text && text.trim().length > 0) {
      return text.trim();
    }
  } catch {
    // ignore and fall back to manual extraction
  }

  const fragments: string[] = [];
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text && part.text.trim().length > 0) {
        fragments.push(part.text.trim());
      }
    }
  }

  return fragments.length > 0 ? fragments.join("\n") : undefined;
}

async function generateVariedPlaceholder(prompt: string, width: number, height: number): Promise<Buffer> {
  // Create a varied placeholder image using Sharp
  // This gives us different colors and patterns based on the prompt content

  const hash = simpleHash(prompt);
  const hue = hash % 360;
  const saturation = 60 + (hash % 40);
  const lightness = 50 + (hash % 30);

  // Convert HSL to RGB
  const rgb = hslToRgb(hue / 360, saturation / 100, lightness / 100);
  const [r, g, b] = rgb.map(c => Math.round(c * 255));

  // Create different patterns based on the hash
  const pattern = hash % 4;

  try {
    // Create an SVG with varied patterns
    const svg = createSVGPattern(width, height, r, g, b, pattern, prompt);

    // Convert SVG to PNG using Sharp
    const pngBuffer = await sharp(Buffer.from(svg))
      .png()
      .toBuffer();

    return pngBuffer;
  } catch (error) {
    console.error('Error generating placeholder image:', error);

    // Fallback: create a simple solid color image
    const solidColor = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r, g, b }
      }
    })
    .png()
    .toBuffer();

    return solidColor;
  }
}

function createSVGPattern(width: number, height: number, r: number, g: number, b: number, pattern: number, prompt: string): string {
  const baseColor = `rgb(${r}, ${g}, ${b})`;
  const lightColor = `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`;
  const darkColor = `rgb(${Math.max(0, r - 40)}, ${Math.max(0, g - 40)}, ${Math.max(0, b - 40)})`;

  let patternDef = '';
  let backgroundFill = baseColor;

  switch (pattern) {
    case 0: // Gradient
      patternDef = `
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:${baseColor}" />
            <stop offset="100%" style="stop-color:${lightColor}" />
          </linearGradient>
        </defs>`;
      backgroundFill = 'url(#grad)';
      break;

    case 1: // Checkerboard
      patternDef = `
        <defs>
          <pattern id="checkerboard" patternUnits="userSpaceOnUse" width="40" height="40">
            <rect width="40" height="40" fill="${baseColor}"/>
            <rect width="20" height="20" fill="${darkColor}"/>
            <rect x="20" y="20" width="20" height="20" fill="${darkColor}"/>
          </pattern>
        </defs>`;
      backgroundFill = 'url(#checkerboard)';
      break;

    case 2: // Stripes
      patternDef = `
        <defs>
          <pattern id="stripes" patternUnits="userSpaceOnUse" width="30" height="30" patternTransform="rotate(45)">
            <rect width="30" height="30" fill="${baseColor}"/>
            <rect x="0" y="0" width="15" height="30" fill="${lightColor}"/>
          </pattern>
        </defs>`;
      backgroundFill = 'url(#stripes)';
      break;

    case 3: // Radial
      patternDef = `
        <defs>
          <radialGradient id="radial" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style="stop-color:${lightColor}" />
            <stop offset="70%" style="stop-color:${baseColor}" />
            <stop offset="100%" style="stop-color:${darkColor}" />
          </radialGradient>
        </defs>`;
      backgroundFill = 'url(#radial)';
      break;
  }

  const truncatedPrompt = prompt.length > 30 ? prompt.substring(0, 30) + '...' : prompt;
  const fontSize = Math.max(12, Math.min(width / 20, 24));

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${patternDef}
      <rect width="100%" height="100%" fill="${backgroundFill}"/>

      <!-- Add some decorative elements -->
      <circle cx="${width * 0.2}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.08}" fill="rgba(255,255,255,0.3)"/>
      <circle cx="${width * 0.8}" cy="${height * 0.7}" r="${Math.min(width, height) * 0.05}" fill="rgba(255,255,255,0.2)"/>

      <!-- Text overlay -->
      <text x="${width / 2}" y="${height / 2 - fontSize/2}"
            text-anchor="middle"
            fill="rgba(255,255,255,0.9)"
            font-family="Arial, sans-serif"
            font-size="${fontSize}"
            font-weight="bold">
        Generated Image
      </text>
      <text x="${width / 2}" y="${height / 2 + fontSize/2 + 10}"
            text-anchor="middle"
            fill="rgba(255,255,255,0.7)"
            font-family="Arial, sans-serif"
            font-size="${fontSize * 0.6}">
        ${width}×${height}
      </text>
      <text x="${width / 2}" y="${height / 2 + fontSize + 20}"
            text-anchor="middle"
            fill="rgba(255,255,255,0.6)"
            font-family="Arial, sans-serif"
            font-size="${fontSize * 0.5}">
        "${truncatedPrompt}"
      </text>
    </svg>
  `;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return [r, g, b];
}
