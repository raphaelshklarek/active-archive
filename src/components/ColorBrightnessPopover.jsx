import React, { useEffect, useRef } from 'react';

// Floating popover for assigning a colour swatch and a brightness rating (1-10)
// to a file or to a bulk selection. Anchored at an absolute (x, y).
// `mode`: 'color' renders only swatches, 'brightness' only the 1-10 row.
const ColorBrightnessPopover = ({
  position,
  palette,
  color,
  brightness,
  onColor,
  onBrightness,
  onClose,
  title,
  mode = 'color'
}) => {
  const ref = useRef(null);

  useEffect(() => {
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="color-popover"
      style={{ position: 'fixed', top: position.y, left: position.x, zIndex: 200 }}
    >
      <button
        className="color-popover-close"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }}
        title="Close"
        aria-label="Close"
      >
        ×
      </button>
      {title && <div className="color-popover-title">{title}</div>}
      {mode === 'color' && (
        <div className="color-popover-swatches">
          <button
            className={`color-swatch none ${!color ? 'active' : ''}`}
            onClick={() => onColor(null)}
            title="Clear colour"
          >
            ✕
          </button>
          {palette.map(c => (
            <button
              key={c.id}
              className={`color-swatch ${color === c.id ? 'active' : ''}`}
              style={{ background: c.hex }}
              onClick={() => onColor(c.id)}
              title={c.name}
            />
          ))}
        </div>
      )}
      {mode === 'brightness' && (
        <div className="color-popover-brightness">
          <button
            className={`brightness-cell none ${brightness == null ? 'active' : ''}`}
            onClick={() => onBrightness(null)}
            title="Clear brightness"
          >
            –
          </button>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button
              key={n}
              className={`brightness-cell ${brightness === n ? 'active' : ''}`}
              onClick={() => onBrightness(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ColorBrightnessPopover;
