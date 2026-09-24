"use strict";
const FB_ID_RE = /^\d{5,20}$/;
function isValidFbId(id) {
  return typeof id === "string" && FB_ID_RE.test(id.trim());
}
export { isValidFbId };

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-utils-validate',
  meta: { category: 'utils', path: 'src/utils/validate.js' },
  setup(_ctx) {
    // provides: isValidFbId
  },
};
