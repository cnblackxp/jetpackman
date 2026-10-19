// Written by the level editor (npm start, then open #/editor). Edits by hand are fine, but the
// editor rewrites this whole file when it saves. See src/custom-io.js for the format.
(function (root) {
  const CUSTOM_LEVELS = {
    "overrides": {},
    "levels": []
  };
  if (typeof module === 'object' && module.exports) module.exports = CUSTOM_LEVELS;
  else root.CUSTOM_LEVELS = CUSTOM_LEVELS;
})(typeof self !== 'undefined' ? self : this);
