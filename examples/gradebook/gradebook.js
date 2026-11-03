'use strict';
// A small course gradebook and the view one student may see of it: their own
// published grades, the course title, and the class average of each published
// assignment. Never other students' grades, private teacher comments, the
// rubric's answer notes, or unpublished assignments.

const FORBIDDEN_KEYS = new Set(['privateComment', 'answerNotes', 'email']);

function studentView(book, studentId) {
  const me = book.students.find((s) => s.id === studentId);
  if (!me) return { course: book.title, assignments: [] };
  const assignments = [];
  for (const a of book.assignments) {
    if (!a.published) continue;
    const grade = a.grades.find((g) => g.studentId === studentId);
    const scores = a.grades.map((g) => g.score);
    assignments.push({
      title: a.title,
      score: grade ? grade.score : null,
      feedback: grade ? grade.feedback : null,
      average: scores.length ? +(scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1) : null,
    });
  }
  return { course: book.title, student: me.name, assignments };
}

/** Runtime guard: rejects a view that carries a forbidden key anywhere. */
function guard(view) {
  let ok = true;
  (function walk(v) {
    if (!ok || v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.has(k)) { ok = false; return; }
      walk(x);
    }
  })(view);
  return ok;
}

module.exports = { studentView, guard, FORBIDDEN_KEYS };
