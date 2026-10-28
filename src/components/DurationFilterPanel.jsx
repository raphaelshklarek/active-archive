import React, { useMemo } from 'react';
import { useAudioStore } from '../store/audioStore';
import { formatTime } from '../utils/format';

// Strip above the file table for narrowing the library by piece length.
// A dual-thumb range slider in minutes:seconds, where dragging the upper thumb
// to the far right means "no maximum" so longer pieces aren't excluded.
const DurationFilterPanel = () => {
  const audioFiles = useAudioStore(s => s.audioFiles);
  const durationFilter = useAudioStore(s => s.durationFilter);
  const setDurationFilter = useAudioStore(s => s.setDurationFilter);
  const clearDurationFilter = useAudioStore(s => s.clearDurationFilter);

  // Upper bound = the longest file actually in the library (so the far-right
  // edge always maps to a real piece, never a rounded-up placeholder).
  const sliderMax = useMemo(() => {
    const longest = audioFiles.reduce((m, f) => Math.max(m, f.duration || 0), 0);
    return Math.max(1, Math.ceil(longest));
  }, [audioFiles]);

  const STEP = 5; // seconds

  const minVal = Math.min(durationFilter.min, sliderMax);
  const maxVal = durationFilter.max == null
    ? sliderMax
    : Math.min(durationFilter.max, sliderMax);

  const handleMin = (e) => {
    let v = parseInt(e.target.value, 10);
    if (v > maxVal) v = maxVal;
    setDurationFilter({ min: v });
  };

  const handleMax = (e) => {
    let v = parseInt(e.target.value, 10);
    if (v < minVal) v = minVal;
    // Far right = no upper limit.
    setDurationFilter({ max: v >= sliderMax ? null : v });
  };

  const isFiltering = durationFilter.min > 0 || durationFilter.max != null;

  const pctMin = (minVal / sliderMax) * 100;
  const pctMax = (maxVal / sliderMax) * 100;

  return (
    <div className="color-filter-rail">
      <div className="tag-section">
        <span className="brightness-label">Duration</span>
        <div className="duration-range">
          <div className="duration-slider">
            <div className="duration-track" />
            <div
              className="duration-track-fill"
              style={{ left: `${pctMin}%`, right: `${100 - pctMax}%` }}
            />
            <input
              type="range"
              className="duration-thumb"
              min={0}
              max={sliderMax}
              step={STEP}
              value={minVal}
              onChange={handleMin}
              aria-label="Minimum duration"
            />
            <input
              type="range"
              className="duration-thumb"
              min={0}
              max={sliderMax}
              step={STEP}
              value={maxVal}
              onChange={handleMax}
              aria-label="Maximum duration"
            />
          </div>
          <span className="duration-readout">
            {formatTime(minVal)} – {formatTime(maxVal)}
          </span>
        </div>
      </div>

      {isFiltering && (
        <button className="filter-clear" onClick={clearDurationFilter} title="Clear duration filter">
          Clear
        </button>
      )}
    </div>
  );
};

export default DurationFilterPanel;
