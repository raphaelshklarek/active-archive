import React from 'react';
import { useAudioStore } from '../store/audioStore';

// Strip above the file table: colour chips + brightness range live side by side,
// separated by a divider. When files are selected, a "Tag" action button
// appears in the matching section.
const ColorFilterRail = ({
  onOpenPalette,
  selectedCount = 0,
  onTagColor,
  onTagBrightness
}) => {
  const colorPalette = useAudioStore(s => s.colorPalette);
  const colorFilter = useAudioStore(s => s.colorFilter);
  const brightnessFilter = useAudioStore(s => s.brightnessFilter);
  const toggleColorFilter = useAudioStore(s => s.toggleColorFilter);
  const setBrightnessFilter = useAudioStore(s => s.setBrightnessFilter);
  const clearColorBrightnessFilter = useAudioStore(s => s.clearColorBrightnessFilter);

  const isFiltering =
    colorFilter.size > 0 ||
    brightnessFilter.min !== 1 ||
    brightnessFilter.max !== 10 ||
    !brightnessFilter.includeUnrated;

  return (
    <div className="color-filter-rail">
      <div className="tag-section">
        <div className="color-chips">
          {colorPalette.map(c => (
            <button
              key={c.id}
              className={`color-chip ${colorFilter.has(c.id) ? 'active' : ''}`}
              style={{ background: c.hex }}
              onClick={() => toggleColorFilter(c.id)}
              title={c.name}
            />
          ))}
          <button
            className="palette-edit-button"
            onClick={onOpenPalette}
            title="Edit palette"
          >
            …
          </button>
        </div>
        {selectedCount > 0 && (
          <button
            className="rail-tag-button"
            onClick={onTagColor}
            title={`Tag colour for ${selectedCount} file(s)`}
          >
            Tag color ({selectedCount})
          </button>
        )}
      </div>

      <div className="tag-section-divider" aria-hidden="true" />

      <div className="tag-section">
        <div className="brightness-range">
          <select
            value={brightnessFilter.min}
            onChange={e => setBrightnessFilter({ min: parseInt(e.target.value, 10) })}
            title="Minimum brightness"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span>–</span>
          <select
            value={brightnessFilter.max}
            onChange={e => setBrightnessFilter({ max: parseInt(e.target.value, 10) })}
            title="Maximum brightness"
          >
            {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <label className="include-unrated">
            <input
              type="checkbox"
              checked={brightnessFilter.includeUnrated}
              onChange={e => setBrightnessFilter({ includeUnrated: e.target.checked })}
            />
            unrated
          </label>
        </div>
        {selectedCount > 0 && (
          <button
            className="rail-tag-button"
            onClick={onTagBrightness}
            title={`Tag brightness for ${selectedCount} file(s)`}
          >
            Tag brightness ({selectedCount})
          </button>
        )}
      </div>

      {isFiltering && (
        <button className="filter-clear" onClick={clearColorBrightnessFilter} title="Clear filters">
          Clear
        </button>
      )}
    </div>
  );
};

export default ColorFilterRail;
