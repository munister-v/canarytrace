'use strict';
// Canaries: unique marker strings planted in every place a channel must not
// carry. A canary is lower-case letters and digits between two fixed fences,
// so it survives the usual normalisation (trim, lower-casing, slugging) and
// can be found in any serialised output with one regular expression.
//
//   const canaries = createCanaries();
//   const c = canaries.plant('teacherNote', { allowedIn: [] });
//   ...
//   canaries.scan(JSON.stringify(output))   // Set of canaries present

const DEFAULT_PREFIX = 'zq';
const DEFAULT_SUFFIX = 'qz';

function createCanaries({ prefix = DEFAULT_PREFIX, suffix = DEFAULT_SUFFIX } = {}) {
  if (!/^[a-z]{2,8}$/.test(prefix) || !/^[a-z]{2,8}$/.test(suffix)) {
    throw new Error('canary prefix and suffix must be 2-8 lower-case letters');
  }
  let counter = 0;
  const planted = new Map(); // canary -> { cls, allowedIn, data }
  const pattern = new RegExp(`${prefix}[a-z][0-9a-z]*?${suffix}`, 'g');

  /**
   * Make a new canary of class `cls` (a short name, letters only) and record
   * where it may legitimately appear: `allowedIn` is a list of view names, or
   * a predicate (view, context) => boolean.
   */
  function plant(cls, { allowedIn = [], data } = {}) {
    if (!/^[a-zA-Z]+$/.test(cls)) throw new Error(`canary class must be letters only: ${cls}`);
    const tag = cls[0].toLowerCase();
    const c = `${prefix}${tag}${(counter++).toString(36)}${suffix}`;
    planted.set(c, { cls, allowedIn, data });
    return c;
  }

  /** Every whole canary in `text`. */
  function scan(text) {
    return new Set(String(text).match(pattern) || []);
  }

  function isAllowed(c, view, context) {
    const p = planted.get(c);
    if (!p) return false;
    return typeof p.allowedIn === 'function' ? Boolean(p.allowedIn(view, context)) : p.allowedIn.includes(view);
  }

  return { plant, scan, isAllowed, planted, get size() { return planted.size; } };
}

module.exports = { createCanaries };
