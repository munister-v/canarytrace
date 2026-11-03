'use strict';
// The two channels of a teaching board's sensing layer, as studied in
// Munister (2026), doi:10.5281/zenodo.23897129.
//
//   learner channel    student-projection.js: the default-deny view of the
//                      teacher's board, in modes self / follow / present
//   analytics channel  lib/telemetry.js: key and value allow-list, then a
//                      coalescing write pipeline
//
//   npx canarytrace run examples/teaching-board/campaign.js [boards] [events] [seed]

const path = require('path');
const { createRng, createCanaries, createCaptureStore, fuzzProjection, fuzzSink, runMutationAnalysis } = require('../../src');
const pool = require('./db/pool');

const PROJECTION = path.join(__dirname, 'student-projection.js');

/* ─────────────── learner channel ─────────────── */

const FORBIDDEN = ['answerKey', 'answer_key', 'correctAnswers', 'teacherNotes', 'teacher_notes', 'dossier', 'assistant', 'assistantPrompt', 'internalNotes'];
const KINDS = ['text', 'sticky', 'quiz', 'vocabulary', 'reading', 'homework', 'image', 'grammar-formula'];

function nestUnder(rng, depth, leaf) {
  let node = leaf;
  for (let d = 0; d < depth; d++) node = rng.chance(0.5) ? { items: [node, { text: 'ok' }] } : { block: node, n: d };
  return node;
}

/** One random board. A card's content may appear in a view only if the card
 * is visible there: frameless cards in self, cards of uncovered frames in
 * self and follow, and in present only the presented frame's cards. */
function generateBoard({ rng, canaries }) {
  const frames = [];
  const nFrames = rng.int(1, 8);
  for (let f = 0; f < nFrames; f++) {
    const covered = rng.chance(0.3);
    const teaser = covered && rng.chance(0.5);
    frames.push({
      id: 'f' + f, z: f, rect: { x: f * 1000, y: 0, w: 900, h: 700 }, covered, coverMode: teaser ? 'teaser' : 'hidden', openAt: null,
      title: teaser ? canaries.plant('teaserTitle', { allowedIn: ['self'] }) : covered ? canaries.plant('coveredTitle') : 'Frame ' + f,
    });
  }
  const cardAllowed = (frameId, covered) => (view) => {
    if (frameId === null) return view === 'self';
    if (covered) return false;
    if (view === 'present') return false; // replaced per view below
    return view === 'self' || view === 'follow';
  };
  const objects = [];
  const nObjects = rng.int(5, 60);
  for (let i = 0; i < nObjects; i++) {
    const frame = rng.chance(0.8) ? rng.pick(frames) : null;
    const obj = { id: 'o' + i, kind: rng.pick(KINDS), rect: { x: 0, y: 0, w: 10, h: 10 }, z: i, frameId: frame ? frame.id : null, frameBinding: 'auto', framePinned: false, groupId: null, locked: false, visibility: 'all', publishedRevisionId: null, draftRevisionId: null, revisions: [] };
    const pub = { id: 'r' + i + 'p', cardId: obj.id, version: 2, status: 'published', payload: {}, createdAt: '2026-11-01' };
    const r = rng.next();
    let cls = 'visibleContent';
    let allowed = (view, ctx) => (view === 'present' ? ctx.view.frameId === obj.frameId && obj.frameId !== null && !frame.covered : cardAllowed(obj.frameId, frame && frame.covered)(view));
    if (r < 0.10) { obj.visibility = 'teacher-only'; cls = 'teacherOnly'; allowed = []; }
    else if (r < 0.18) { obj.kind = 'assistant'; cls = 'assistantCard'; allowed = []; }
    else if (r < 0.26) { obj.frameId = 'missing'; cls = 'orphanFrame'; allowed = []; }
    else if (frame && frame.covered) { cls = 'coveredContent'; allowed = []; }
    else if (!frame) cls = 'framelessCard';
    const stale = rng.chance(0.1);
    pub.payload.text = canaries.plant(cls, { allowedIn: stale ? [] : allowed });
    if (rng.chance(0.6)) {
      const leaf = {}; leaf[rng.pick(FORBIDDEN)] = canaries.plant('forbiddenKey');
      pub.payload[rng.pick(['body', 'questions', 'meta'])] = nestUnder(rng, rng.int(0, 6), leaf);
    }
    obj.revisions.push(pub);
    if (rng.chance(0.4)) {
      const d = { id: 'r' + i + 'd', cardId: obj.id, version: 3, status: 'draft', payload: { text: canaries.plant('draft') }, createdAt: '2026-11-02' };
      obj.revisions.push(d); obj.draftRevisionId = d.id;
    }
    if (stale) { // the published pointer names a superseded revision
      const s = { id: 'r' + i + 's', cardId: obj.id, version: 1, status: 'superseded', payload: { text: canaries.plant('stalePointer') }, createdAt: '2026-10-01' };
      obj.revisions.push(s); obj.publishedRevisionId = s.id;
    } else obj.publishedRevisionId = pub.id;
    objects.push(obj);
  }
  const board = { id: 'b', title: canaries.plant('boardTitle'), frames, objects, groups: [], assistantWindows: [{ prompt: canaries.plant('assistantWindow') }], dossierNotes: [{ note: canaries.plant('dossierNote') }] };
  const views = [{ name: 'self', frameId: null }, { name: 'follow', frameId: null }];
  const presentable = frames.filter((f) => !f.covered);
  if (presentable.length) views.push({ name: 'present', frameId: rng.pick(presentable).id });
  return { input: board, views };
}

function learnerCampaign({ boards, seed, mod }) {
  return fuzzProjection({
    cases: boards,
    generate: generateBoard,
    project: (board, view) => mod.buildStudentProjection(board, view.name, view.frameId),
    guard: (out) => mod.leakCheck(out).ok,
    positive: ['visibleContent', 'framelessCard'],
    rng: createRng(seed),
    canaries: createCanaries,
  });
}

const MUTANTS = {
  M1_shallow_sanitiser: ['    walk(out);\n', '\n'],
  M2_covered_frames_projected: ['        if (frame.covered)\n            return false;', ''],
  M3_teacher_only_ignored: ['    if (obj.visibility === "teacher-only")\n        return false;', ''],
  M4_stale_pointer_trusted: ['if (!rev || rev.status !== "published")', 'if (!rev)'],
  M5_present_scope_dropped: ['if (mode === "present" && obj.frameId !== frameId)', 'if (false)'],
  M6_assistant_cards_projected: ['    if (obj.kind === "assistant")\n        return false;', ''],
  M7_orphans_projected: ['        if (!frame)\n            return false;', '        if (!frame)\n            return true;'],
  M8_teasers_in_all_modes: ['    if (mode === "self") {', '    if (true) {'],
  M9_top_level_filter_removed: ['        if (exports.FORBIDDEN_PAYLOAD_KEYS.has(key))\n            continue;\n        out[key]', '        out[key]'],
};

/* ─────────────── analytics channel ─────────────── */

const UNSAFE_KEYS = ['email', 'name', 'text', 'title', 'notes', 'body', 'prompt', 'answer', 'boardData', 'ip', 'userAgent', 'password', 'phone', 'content'];
const SAFE_KEYS = ['feature', 'reason', 'source', 'status', 'surface', 'mode', 'kind', 'step', 'item', 'path'];

function generateEvent({ rng, canaries }) {
  const meta = {};
  for (let k = rng.int(1, 6); k > 0; k--) {
    const r = rng.next();
    if (r < 0.35) meta[rng.pick(UNSAFE_KEYS)] = canaries.plant('unsafeKey');
    else if (r < 0.45) meta[rng.pick(SAFE_KEYS)] = { inner: canaries.plant('nestedUnderSafe') };
    else if (r < 0.52) meta[rng.pick(SAFE_KEYS)] = [canaries.plant('arrayUnderSafe')];
    else if (r < 0.62) meta[rng.pick(SAFE_KEYS)] = 'x'.repeat(rng.int(121, 400)) + canaries.plant('tailOfLongString');
    else if (r < 0.66) meta[rng.pick(SAFE_KEYS)] = 'Vlad forgot ' + canaries.plant('sentenceUnderSafe') + ' again';
    else if (r < 0.70) meta[rng.pick(SAFE_KEYS)] = canaries.plant('mailUnderSafe') + '@example.com';
    // a bare code-like value under an allowed key is the residual channel the
    // design accepts: it may be stored
    else if (r < 0.73) meta[rng.pick(SAFE_KEYS)] = canaries.plant('codeUnderSafe', { allowedIn: ['store'] });
    else meta[rng.pick(SAFE_KEYS)] = rng.pick(['board', 'ok', 'teacher_tools', NaN, true, null, '  a \n b ']);
  }
  let eventType = rng.pick(['board.updated', 'board.created', 'share.viewed', 'onboarding.step']);
  if (rng.chance(0.05)) eventType += '.' + canaries.plant('eventTypeSuffix', { allowedIn: ['store'] });
  return { category: rng.pick(['product', 'request', 'evil', undefined]), eventType, outcome: rng.pick(['ok', 'fallback', 'nope']), actorId: rng.chance(0.1) ? canaries.plant('badActorId') : rng.uuid(), boardId: rng.uuid(), durationMs: rng.pick([12, -5, 1e9, 'abc', NaN, 4500.6]), metadata: meta };
}

async function analyticsCampaign({ events, seed }) {
  const store = createCaptureStore({ match: (text) => /INSERT INTO telemetry_events/.test(text) });
  pool.impl = store;
  const tel = require('./lib/telemetry');
  return fuzzSink({ events, generate: generateEvent, record: tel.recordTelemetry, flush: tel.flushTelemetry, flushEvery: 1500, store, canaries: createCanaries(), rng: createRng(seed) });
}

async function run(args = []) {
  const boards = Number(args[0] || 2000);
  const events = Number(args[1] || 20000);
  const seed = Number(args[2] || 20261102);
  const learner = learnerCampaign({ boards, seed, mod: require(PROJECTION) });
  const mutation = runMutationAnalysis({
    file: PROJECTION,
    mutants: MUTANTS,
    evaluate: (mod) => { const r = learnerCampaign({ boards: Math.min(boards, 1000), seed, mod }); return { leakCheck: r.guardRejected, canary: r.leaks }; },
  });
  const analytics = await analyticsCampaign({ events, seed });
  return { learner, mutation, analytics };
}

module.exports = { generateBoard, learnerCampaign, analyticsCampaign, generateEvent, MUTANTS, PROJECTION, run };

if (require.main === module) run(process.argv.slice(2)).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); });
