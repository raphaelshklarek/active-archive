import React, { useState } from 'react';
import { useAudioStore } from '../store/audioStore';

// Modal: edit the user's colour palette. Add, rename, recolour, delete.
// Deleting a colour clears it from any tagged files (handled in store).
const PaletteEditor = ({ onClose }) => {
  const colorPalette = useAudioStore(s => s.colorPalette);
  const audioFiles = useAudioStore(s => s.audioFiles);
  const addPaletteColor = useAudioStore(s => s.addPaletteColor);
  const updatePaletteColor = useAudioStore(s => s.updatePaletteColor);
  const removePaletteColor = useAudioStore(s => s.removePaletteColor);

  const [newName, setNewName] = useState('');
  const [newHex, setNewHex] = useState('#888888');

  const usageCount = (id) => audioFiles.reduce((n, f) => n + (f.color === id ? 1 : 0), 0);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addPaletteColor({ name: newName, hex: newHex });
    setNewName('');
    setNewHex('#888888');
  };

  const handleDelete = async (color) => {
    const used = usageCount(color.id);
    const msg = used > 0
      ? `Delete "${color.name}"? It will be cleared from ${used} file(s).`
      : `Delete "${color.name}"?`;
    if (confirm(msg)) await removePaletteColor(color.id);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal palette-editor" onClick={e => e.stopPropagation()}>
        <h3>Palette</h3>
        <div className="palette-list">
          {colorPalette.map(c => (
            <div key={c.id} className="palette-row">
              <input
                type="color"
                value={c.hex}
                onChange={e => updatePaletteColor(c.id, { hex: e.target.value })}
                title="Recolour"
              />
              <input
                type="text"
                value={c.name}
                onChange={e => updatePaletteColor(c.id, { name: e.target.value })}
              />
              <span className="palette-usage">{usageCount(c.id)}</span>
              <button onClick={() => handleDelete(c)} title="Delete">×</button>
            </div>
          ))}
        </div>
        <div className="palette-add">
          <input
            type="color"
            value={newHex}
            onChange={e => setNewHex(e.target.value)}
          />
          <input
            type="text"
            placeholder="New colour name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
          <div className="palette-add-trailing">
            <button
              className="palette-add-button"
              onClick={handleAdd}
              disabled={!newName.trim()}
            >
              Add
            </button>
          </div>
        </div>
        <div className="modal-buttons">
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default PaletteEditor;
