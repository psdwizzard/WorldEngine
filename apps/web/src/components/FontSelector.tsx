import { useState, useMemo } from "react";
import { useLocalFonts } from "../hooks/useLocalFonts";

interface FontSelectorProps {
  value: string;
  onChange: (font: string) => void;
  id?: string;
}

export function FontSelector({ value, onChange, id }: FontSelectorProps) {
  const { fonts, isLoading, hasPermission, isSupported, requestFonts } = useLocalFonts();
  const [customFont, setCustomFont] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);

  // Group fonts by category (only for fallback fonts)
  const groupedFonts = useMemo(() => {
    if (hasPermission) {
      // System fonts - just return as single list
      return { [`System Fonts (${fonts.length})`]: fonts };
    }

    // Group fallback fonts
    const serif = ["Georgia", "Times New Roman", "Palatino Linotype", "Book Antiqua", "Garamond", "Baskerville", "Cambria"];
    const sansSerif = ["Arial", "Helvetica", "Verdana", "Trebuchet MS", "Gill Sans", "Tahoma", "Calibri", "Segoe UI", "Optima", "Arial Black", "Impact", "Franklin Gothic Medium", "Century Gothic"];
    const monospace = ["Courier New", "Lucida Console", "Monaco", "Consolas", "Andale Mono", "Source Code Pro"];
    const display = ["Comic Sans MS", "Papyrus", "Brush Script MT", "Copperplate", "Rockwell", "Badaboom", "Bangers", "Comic Neue", "Komika", "Action Man", "SF Comic Script"];

    return {
      "Serif": fonts.filter(f => serif.includes(f)),
      "Sans-Serif": fonts.filter(f => sansSerif.includes(f)),
      "Monospace": fonts.filter(f => monospace.includes(f)),
      "Display": fonts.filter(f => display.includes(f)),
    };
  }, [fonts, hasPermission]);

  const handleCustomFontSubmit = () => {
    if (customFont.trim()) {
      onChange(customFont.trim());
      setShowCustomInput(false);
      setCustomFont("");
    }
  };

  return (
    <div className="font-selector">
      <div className="font-selector-row">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ fontFamily: value, flex: 1 }}
        >
          {Object.entries(groupedFonts).map(([group, groupFonts]) => (
            <optgroup key={group} label={group}>
              {groupFonts.map((font) => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        
        {isSupported && (
          <button
            type="button"
            className="ghost font-load-btn"
            onClick={requestFonts}
            disabled={isLoading}
            title={hasPermission ? "Refresh system fonts" : "Load system fonts"}
          >
            {isLoading ? "..." : "🔄"}
          </button>
        )}
        
        <button
          type="button"
          className="ghost font-custom-btn"
          onClick={() => setShowCustomInput(!showCustomInput)}
          title="Enter custom font name"
        >
          ✎
        </button>
      </div>
      
      {showCustomInput && (
        <div className="font-custom-input">
          <input
            type="text"
            value={customFont}
            onChange={(e) => setCustomFont(e.target.value)}
            placeholder="Enter font name..."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleCustomFontSubmit();
              }
            }}
          />
          <button type="button" className="ghost" onClick={handleCustomFontSubmit}>
            Apply
          </button>
        </div>
      )}
      
      <div className="font-preview" style={{ fontFamily: value }}>
        The quick brown fox...
      </div>
    </div>
  );
}

export default FontSelector;

