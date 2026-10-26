import React from 'react';

// The photos tool's file picker: tapping empty canvas opens it (CanvasSurface
// calls onRequestPhoto → click). Hidden; no visible chrome. The explicit .svg
// keeps vector files reachable where image/* narrows the sheet to the photo
// library (iOS): it adds the Files route, and the import pipeline rasterizes
// what arrives.
//
// This is `usePhotoSource`'s RENDER half, and the two belong together: that
// hook owns `photoInputRef` and `.click()`s it under the tap's transient
// activation, and nothing happens unless this input is mounted for it to
// click. The refs are passed rather than taken from the hook here because the
// shell reads them on other paths too (the drag-to-place commit).
export function PhotoSourceInput({
  photoInputRef, replaceTargetRef, onAddPhoto, onReplacePhoto,
}: {
  photoInputRef: React.RefObject<HTMLInputElement | null>;
  replaceTargetRef: React.RefObject<string | null>;
  onAddPhoto: (file: File) => void | Promise<void>;
  onReplacePhoto: (file: File) => void | Promise<void>;
}) {
  return (
    <input
      ref={photoInputRef}
      type="file"
      accept="image/*,.svg"
      style={{ display: 'none' }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        // A pending replace target routes to the in-place swap; otherwise
        // this is the photos-tool "add" flow.
        if (file) {
          if (replaceTargetRef.current) void onReplacePhoto(file);
          else void onAddPhoto(file);
        }
        e.target.value = '';
      }}
    />
  );
}
