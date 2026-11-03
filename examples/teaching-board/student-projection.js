"use strict";
// student-projection: the student never receives the teacher's
// board. The server builds a default-deny projection: only published
// revisions of visible cards in uncovered frames. Teacher-only data
// (answer keys, notes, assistant windows, dossier) is stripped or absent
// by construction — the projection type has no fields for it.
// A covered frame leaves exactly one trace in free navigation (self /
// follow): a generic placeholder with the fixed text COVERED_PLACEHOLDER_TEXT
// — no title, no type, no contents, no test hint (product decision,
// 25.10.2026). In Present mode covered frames are absent completely.
// Take as is. No external dependencies.
Object.defineProperty(exports, "__esModule", { value: true });
exports.leakCheck = exports.buildStudentProjection = exports.sanitisePayload = exports.FORBIDDEN_PAYLOAD_KEYS = exports.PLACEHOLDER_ALLOWED_KEYS = exports.COVERED_PLACEHOLDER_TEXT = void 0;
/** The one and only text a student ever sees instead of a covered frame. */
exports.COVERED_PLACEHOLDER_TEXT = "Your teacher is creating something special";
/** Keys a covered-placeholder is allowed to carry — nothing else. */
exports.PLACEHOLDER_ALLOWED_KEYS = new Set([
    "kind",
    "text",
    "rect",
]);
/** Keys that must never reach a student payload, at any nesting depth. */
exports.FORBIDDEN_PAYLOAD_KEYS = new Set([
    "answerKey",
    "answer_key",
    "correctAnswers",
    "teacherNotes",
    "teacher_notes",
    "dossier",
    "assistant",
    "assistantPrompt",
    "internalNotes",
]);
function deepClone(value) {
    if (value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map(deepClone);
    const out = {};
    for (const key of Object.keys(value)) {
        out[key] = deepClone(value[key]);
    }
    return out;
}
/** Deep-copies a payload and removes every forbidden key, recursively. */
function sanitisePayload(payload) {
    const out = {};
    for (const key of Object.keys(payload)) {
        if (exports.FORBIDDEN_PAYLOAD_KEYS.has(key))
            continue;
        out[key] = deepClone(payload[key]);
    }
    // Second pass: nested objects/arrays can hide forbidden keys deeper.
    const walk = (node) => {
        if (node === null || typeof node !== "object")
            return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        for (const key of Object.keys(node)) {
            if (exports.FORBIDDEN_PAYLOAD_KEYS.has(key)) {
                delete node[key];
            }
            else {
                walk(node[key]);
            }
        }
    };
    walk(out);
    return out;
}
exports.sanitisePayload = sanitisePayload;
function publishedRevision(obj) {
    if (!obj.publishedRevisionId)
        return null;
    const rev = obj.revisions.find((r) => r.id === obj.publishedRevisionId);
    if (!rev || rev.status !== "published")
        return null;
    return rev;
}
function isProjectable(board, obj) {
    if (obj.visibility === "teacher-only")
        return false;
    if (obj.kind === "assistant")
        return false;
    if (publishedRevision(obj) === null)
        return false; // default-deny
    if (obj.frameId !== null) {
        const frame = board.frames.find((f) => f.id === obj.frameId);
        if (!frame)
            return false;
        if (frame.covered)
            return false; // covered frame hides its whole contents
    }
    return true;
}
/**
 * Builds the only board representation a student client may receive.
 * - present: exactly one frame (the one the teacher presents), nothing else;
 * - follow:  every uncovered frame (the teacher's viewport decides focus);
 * - self:    every uncovered frame + frameless cards, for the student's
 *            own work in the cabinet.
 * Covered frames never contribute objects in any mode. In free navigation
 * (self / follow) each covered frame is represented ONLY by a generic
 * covered-placeholder {kind, text, rect} — never its title, type or
 * contents; in present mode covered frames are absent completely.
 * Covered frames in "teaser" mode additionally appear as {frameId, title}
 * teasers in self mode — that teaser lives in the Student Hub.
 */
function buildStudentProjection(board, mode, frameId) {
    const objects = [];
    for (const obj of board.objects) {
        if (!isProjectable(board, obj))
            continue;
        if (mode === "present" && obj.frameId !== frameId)
            continue;
        // follow shows frames only: a frameless card is the student's own space (self)
        if (mode === "follow" && obj.frameId === null)
            continue;
        const rev = publishedRevision(obj);
        if (!rev)
            continue;
        objects.push({
            id: obj.id,
            kind: obj.kind,
            rect: { ...obj.rect },
            z: obj.z,
            revisionId: rev.id,
            payload: sanitisePayload(rev.payload),
        });
    }
    objects.sort((a, b) => a.z - b.z);
    const teasers = [];
    if (mode === "self") {
        for (const frame of board.frames) {
            if (frame.covered && frame.coverMode === "teaser") {
                teasers.push({ frameId: frame.id, title: frame.title });
            }
        }
    }
    // Covered frames in free navigation: one generic placeholder each, in
    // board frame order (position in the sequence is fine; metadata is not).
    // Identical for test and non-test frames — the placeholder must not hint.
    const coveredPlaceholders = [];
    if (mode === "self" || mode === "follow") {
        for (const frame of board.frames) {
            if (frame.covered) {
                coveredPlaceholders.push({
                    kind: "covered-placeholder",
                    text: exports.COVERED_PLACEHOLDER_TEXT,
                    rect: { ...frame.rect },
                });
            }
        }
    }
    return {
        boardId: board.id,
        mode,
        frameId: mode === "present" ? frameId : null,
        objects,
        teasers,
        coveredPlaceholders,
    };
}
exports.buildStudentProjection = buildStudentProjection;
/**
 * Marker check used in tests and in a server-side guard before sending:
 * walks the whole projection and reports any forbidden key found at any
 * depth. A non-empty result is a release-blocking leak.
 * Additionally, every covered-placeholder is validated strictly: it may
 * carry ONLY {kind, text, rect} and its text must be exactly
 * COVERED_PLACEHOLDER_TEXT — a placeholder with a title, contents, type
 * or any other extra key is a leak.
 */
function leakCheck(projection) {
    const leaks = [];
    const walk = (node, path) => {
        if (node === null || typeof node !== "object")
            return;
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, path + "[" + i + "]"));
            return;
        }
        const record = node;
        if (record["kind"] === "covered-placeholder") {
            for (const key of Object.keys(record)) {
                if (!exports.PLACEHOLDER_ALLOWED_KEYS.has(key)) {
                    leaks.push(path + "." + key + " (placeholder metadata)");
                }
            }
            if (record["text"] !== exports.COVERED_PLACEHOLDER_TEXT) {
                leaks.push(path + ".text (placeholder text altered)");
            }
        }
        for (const key of Object.keys(record)) {
            if (exports.FORBIDDEN_PAYLOAD_KEYS.has(key))
                leaks.push(path + "." + key);
            walk(record[key], path + "." + key);
        }
    };
    walk(projection, "projection");
    return { ok: leaks.length === 0, leaks };
}
exports.leakCheck = leakCheck;
