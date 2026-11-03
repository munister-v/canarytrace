'use strict';
// Seeded pseudo-random numbers, so that every run of a fuzz campaign can be
// repeated exactly from its seed. mulberry32: small, fast, good enough for
// test-case generation (not for cryptography).

function createRng(seed = 1) {
  let s = seed >>> 0;
  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const rng = {
    seed,
    next,
    /** Integer in [a, b], both ends included. */
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    chance: (p) => next() < p,
    hex: (n) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join(''),
    uuid: () => `${rng.hex(8)}-${rng.hex(4)}-4${rng.hex(3)}-8${rng.hex(3)}-${rng.hex(12)}`,
    /** Exponentially distributed value with the given mean. */
    exp: (mean) => -mean * Math.log(1 - next()),
  };
  return rng;
}

module.exports = { createRng };
