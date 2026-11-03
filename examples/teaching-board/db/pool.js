'use strict';
// The telemetry module requires '../db/pool' as in its home application. Here
// the pool delegates to whatever store the campaign installs: a capture store
// for the privacy campaign, a pg Pool for the load campaign.
const pool = {
  impl: null,
  query(text, params) {
    if (!pool.impl) throw new Error('no store installed: set pool.impl first');
    return pool.impl.query(text, params);
  },
};
module.exports = pool;
