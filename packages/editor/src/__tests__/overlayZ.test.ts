import {
  FINISHED_PAGE_Z, INSTRUCTIONS_Z, NOTICE_Z, PAGE_TITLE_MODAL_Z,
  REOPEN_MODAL_Z, RESET_MODAL_Z, SEND_MODAL_Z, STRIP_ZOOM_Z,
} from '../overlayZ';

// The one place the editor's full-screen layers are ordered. The bug this
// module exists for is in the first case: the notice lost to the send
// modal, so a refused send said nothing (stage 6.5a of
// docs/shared-editor.md).

describe('overlayZ — the editor’s full-screen layer order', () => {
  it('the notice is above every overlay, because any of them can refuse a press', () => {
    for (const z of [
      FINISHED_PAGE_Z, INSTRUCTIONS_Z, SEND_MODAL_Z, STRIP_ZOOM_Z,
      REOPEN_MODAL_Z, PAGE_TITLE_MODAL_Z, RESET_MODAL_Z,
    ]) expect(NOTICE_Z).toBeGreaterThan(z);
  });

  it('the info page covers the finished-page picture, and the send modal covers the info page', () => {
    expect(INSTRUCTIONS_Z).toBeGreaterThan(FINISHED_PAGE_Z);
    expect(SEND_MODAL_Z).toBeGreaterThan(INSTRUCTIONS_Z);
    // The zoomed strip is opened FROM the info page, so it sits over it.
    expect(STRIP_ZOOM_Z).toBeGreaterThan(INSTRUCTIONS_Z);
  });

  it('the three mid-screen cards share one layer: no two of them can be up together', () => {
    expect(new Set([REOPEN_MODAL_Z, PAGE_TITLE_MODAL_Z, RESET_MODAL_Z]).size).toBe(1);
    expect(REOPEN_MODAL_Z).toBeGreaterThan(INSTRUCTIONS_Z);
  });

  it('every layer clears the editor chrome, which tops out at the floating capsules', () => {
    // Toolbar 10, band 11, capsules 200–205 — chrome keeps its own values
    // and is under every layer here by construction.
    const CHROME_TOP = 205;
    for (const z of [
      FINISHED_PAGE_Z, INSTRUCTIONS_Z, SEND_MODAL_Z, STRIP_ZOOM_Z,
      REOPEN_MODAL_Z, PAGE_TITLE_MODAL_Z, RESET_MODAL_Z, NOTICE_Z,
    ]) expect(z).toBeGreaterThan(CHROME_TOP);
  });

  it('every layer is a plain integer, so a DOM zIndex needs no rounding', () => {
    for (const z of [
      FINISHED_PAGE_Z, INSTRUCTIONS_Z, SEND_MODAL_Z, STRIP_ZOOM_Z,
      REOPEN_MODAL_Z, PAGE_TITLE_MODAL_Z, RESET_MODAL_Z, NOTICE_Z,
    ]) expect(Number.isInteger(z)).toBe(true);
  });
});
