// The canvas tracks every finger on it by pointer id (CanvasSurface's
// pointersRef) and reads the count to tell a pan from a pinch: two tracked
// pointers ARE a pinch. That makes a pointer whose up/cancel never arrived
// poisonous — it stays tracked, so every later single finger pairs with it
// and a plain drag zooms the camera "as if you were touching with two
// fingers" (the Adrift bug, where a page zoomed in and out a hundred times
// while hunting words is where one missed release eventually lands). The
// browser does drop releases: a touch cut off by a system gesture, an app
// switch mid-pinch, a WebKit pointercancel that never comes.
//
// The registry can't ask the browser which pointers are still down, but
// the next pointer that arrives TELLS it: a pointerdown with `isPrimary`
// set is, by definition, a touch that began with no other touch active
// (the first of a new multi-touch sequence; a mouse or pen is always
// primary). So a primary pointer landing while anything is still tracked
// proves everything tracked is stale — and since the stale entry only ever
// bites on the NEXT touch, healing there heals the bug completely,
// whichever release was missed.

/** Whether the arrival of a pointer (`isPrimary` from its pointerdown)
 *  proves the `tracked` pointers already in the registry are stale. */
export function tracksStalePointers(isPrimary: boolean, tracked: number): boolean {
  return isPrimary && tracked > 0;
}
