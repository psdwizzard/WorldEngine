import { useState, useEffect, useCallback, useRef } from "react";

interface FontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

// Extend the Window interface for the Local Font Access API
declare global {
  interface Window {
    queryLocalFonts?: () => Promise<FontData[]>;
  }
}

// Common fallback fonts if Local Font Access API is not available
const FALLBACK_FONTS = [
  // Serif
  "Georgia",
  "Times New Roman",
  "Palatino Linotype",
  "Book Antiqua",
  "Garamond",
  "Baskerville",
  "Cambria",
  // Sans-serif
  "Arial",
  "Helvetica",
  "Verdana",
  "Trebuchet MS",
  "Gill Sans",
  "Tahoma",
  "Calibri",
  "Segoe UI",
  "Optima",
  "Arial Black",
  "Impact",
  "Franklin Gothic Medium",
  "Century Gothic",
  // Monospace
  "Courier New",
  "Lucida Console",
  "Monaco",
  "Consolas",
  "Andale Mono",
  "Source Code Pro",
  // Display/Decorative
  "Comic Sans MS",
  "Papyrus",
  "Brush Script MT",
  "Copperplate",
  "Rockwell",
  // Comic-specific fonts (if installed)
  "Badaboom",
  "Bangers",
  "Comic Neue",
  "Komika",
  "Action Man",
  "SF Comic Script",
];

export function useLocalFonts() {
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS);
  const [isLoading, setIsLoading] = useState(false);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isSupported] = useState(() => typeof window !== "undefined" && "queryLocalFonts" in window);
  const hasAutoRequested = useRef(false);

  const requestFonts = useCallback(async () => {
    if (!isSupported || !window.queryLocalFonts) {
      setHasPermission(false);
      return;
    }

    setIsLoading(true);
    try {
      const fontData = await window.queryLocalFonts();
      
      // Extract unique font families
      const familySet = new Set<string>();
      for (const font of fontData) {
        familySet.add(font.family);
      }
      
      // Sort alphabetically
      const sortedFonts = Array.from(familySet).sort((a, b) => 
        a.toLowerCase().localeCompare(b.toLowerCase())
      );
      
      setFonts(sortedFonts);
      setHasPermission(true);
    } catch (error) {
      console.warn("Failed to query local fonts:", error);
      setHasPermission(false);
      // Keep fallback fonts
    } finally {
      setIsLoading(false);
    }
  }, [isSupported]);

  // Auto-request fonts on first user interaction (required by the API)
  useEffect(() => {
    if (!isSupported || hasAutoRequested.current) return;

    const handleUserInteraction = () => {
      if (!hasAutoRequested.current) {
        hasAutoRequested.current = true;
        void requestFonts();
        // Clean up listeners after first interaction
        document.removeEventListener("click", handleUserInteraction);
        document.removeEventListener("keydown", handleUserInteraction);
      }
    };

    // The Local Font Access API requires a user gesture, so we listen for any interaction
    document.addEventListener("click", handleUserInteraction);
    document.addEventListener("keydown", handleUserInteraction);

    return () => {
      document.removeEventListener("click", handleUserInteraction);
      document.removeEventListener("keydown", handleUserInteraction);
    };
  }, [isSupported, requestFonts]);

  return {
    fonts,
    isLoading,
    hasPermission,
    isSupported,
    requestFonts, // Can be called manually to refresh
  };
}

export default useLocalFonts;

