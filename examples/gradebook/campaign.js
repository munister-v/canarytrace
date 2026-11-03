'use strict';
// Fuzz the gradebook's student view with the canary oracle, then measure how
// many injected faults the oracle and the runtime guard each notice.
//
//   npx canarytrace run examples/gradebook/campaign.js [cases] [seed]

const path = require('path');
const { createRng, createCanaries, fuzzProjection, runMutationAnalysis } = require('../../src');

const FILE = path.join(__dirname, 'gradebook.js');

function generate({ rng, canaries }) {
  const students = Array.from({ length: rng.int(2, 8) }, (_, i) => ({
    id: 's' + i,
    // a student's own name may appear only in that student's own view
    name: canaries.plant('studentName', { allowedIn: (view) => view === 's' + i }),
    email: canaries.plant('email'),
  }));
  const assignments = Array.from({ length: rng.int(1, 6) }, (_, j) => {
    const published = rng.chance(0.7);
    const grades = students.filter(() => rng.chance(0.9)).map((s) => ({
      studentId: s.id,
      score: rng.int(0, 100),
      feedback: canaries.plant('feedback', { allowedIn: published ? [s.id] : [] }),
      privateComment: canaries.plant('privateComment'),
    }));
    return {
      title: canaries.plant('title', { allowedIn: published ? students.map((s) => s.id) : [] }),
      published,
      answerNotes: canaries.plant('answerNotes'),
      grades,
    };
  });
  const book = { title: 'Course ' + rng.int(1, 99), students, assignments };
  return { input: book, views: students.map((s) => ({ name: s.id })) };
}

function campaign({ cases = 2000, seed = 7, mod }) {
  return fuzzProjection({
    cases,
    generate,
    project: (book, view) => mod.studentView(book, view.name),
    guard: mod.guard,
    positive: ['title', 'feedback'],
    rng: createRng(seed),
    canaries: createCanaries,
  });
}

const MUTANTS = {
  unpublished_shown: ['    if (!a.published) continue;\n', '\n'],
  other_student_grade: ['a.grades.find((g) => g.studentId === studentId)', 'a.grades[0]'],
  private_comment_copied: ['feedback: grade ? grade.feedback : null,', 'feedback: grade ? grade.feedback : null, privateComment: grade ? grade.privateComment : null,'],
  whole_grade_row: ['score: grade ? grade.score : null,', 'score: grade ? grade.score : null, row: grade,'],
  roster_attached: ['return { course: book.title, student: me.name, assignments };', 'return { course: book.title, student: me.name, assignments, roster: book.students.map((s) => s.name) };'],
};

function evaluate(mod, opts) {
  const r = campaign({ ...opts, mod });
  return { guard: r.guardRejected, canary: r.leaks };
}

function run(args = []) {
  const cases = Number(args[0] || 2000);
  const seed = Number(args[1] || 7);
  const fuzz = campaign({ cases, seed, mod: require(FILE) });
  const mutation = runMutationAnalysis({ file: FILE, mutants: MUTANTS, evaluate: (m) => evaluate(m, { cases: Math.min(cases, 500), seed }) });
  return { fuzz, mutation };
}

module.exports = { generate, campaign, MUTANTS, evaluate, FILE, run };

if (require.main === module) console.log(JSON.stringify(run(process.argv.slice(2)), null, 2));
