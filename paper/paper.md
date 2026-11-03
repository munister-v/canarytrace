---
title: 'canarytrace: canary-oracle fuzzing for data-minimising projections and analytics sinks'
tags:
  - JavaScript
  - Node.js
  - privacy
  - data minimisation
  - learning analytics
  - fuzzing
  - mutation testing
authors:
  - name: Viacheslav Munister
    affiliation: 1
affiliations:
  - name: State Tax University, Irpin, Ukraine
    index: 1
date: 3 November 2026
bibliography: paper.bib
---

# Summary

Educational, clinical and other platforms routinely hand out *parts* of a
record: a student receives a view of the teacher's board without the answer
keys, a parent sees one child's grades, an analytics pipeline stores an event
without the text that triggered it. The code that cuts these parts, here
called a *projection* when it serves an audience and a *sink* when it writes
analytics, is privacy-critical, yet it is usually tested with hand-written
examples and protected at run time by a check that looks for forbidden field
names.

`canarytrace` is a Node.js library and command-line tool that tests such code
with a *canary oracle*. A campaign generates many random inputs from a seed
and plants a unique marker string, a canary, in every place a channel must
not carry, each tagged with the views where it may legitimately appear. The
real code runs on every input; its serialised output, or everything a sink
would write to storage, is scanned for canaries. A canary outside its allowed
views is a leak regardless of the field, nesting depth or string it rode on;
canaries marked as positive controls must appear where allowed, so an
over-strict projection is caught as well. The library adds source-level
mutation analysis that compares how many injected faults an existing runtime
guard and the canary oracle each detect, and a closed-loop load harness for
the write path of the same pipelines.

# Statement of need

Learning analytics depends on behaviour data collected on the same surfaces
that hold assessment material and personal information, often of minors, and
the field's ethics frameworks ask for data minimisation and purpose limitation
[@slade2013; @drachsler2016; @gdpr]. Interoperability standards such as xAPI
and Caliper define the shape of an event but not what must never be in it
[@xapi; @caliper]. Teams implementing privacy by design [@cavoukian2009]
therefore write their own filters, and need a way to show that those filters
hold: that no input, however unusual, makes them pass on what they should
not.

The test oracle is the hard part [@barr2015]. Example-based tests check the
cases their author thought of; a runtime guard that searches for forbidden
keys misses content that is copied under an allowed key, or a whole record
that is shown in the wrong view. In the study this tool comes from, the
built-in guard of a deployed teaching board detected 1 of 8 non-equivalent
injected faults in the learner projection, while the canary oracle detected
all 8, and canary fuzzing of the analytics channel showed that free text rode
allow-listed telemetry keys until values were allow-listed as well
[@munister2026]. `canarytrace` packages that method so that it can be applied
to other projections and sinks and run in continuous integration, where a
campaign that finds a leak fails the build.

The intended users are researchers who evaluate privacy properties of
learning-analytics and other data platforms, and developers of such
platforms who want a reproducible, quantitative check of their filters.

# State of the field

Property-based testing libraries in the QuickCheck tradition
[@claessen2000] generate random inputs but leave the oracle to the user.
Information-flow control and dynamic taint tracking [@sabelfeld2003;
@enck2014] follow data through a program and give stronger guarantees, but
require a typed language extension or an instrumented runtime, which most
web platforms cannot adopt for one module. Mutation-testing frameworks
[@jia2011] measure test suites in general, not the specific question of
whether an oracle notices a leak. `canarytrace` sits between these: it needs
only the module under test and a generator, treats the output as an opaque
string, and turns "is anything forbidden in here" into an exact search, with
the allowed views of each canary as the specification.

# Software design

The library has no runtime dependencies and consists of small, composable
parts:

* `createRng` — a seeded generator, so every campaign is repeatable from its
  seed and every reported leak can be replayed.
* `createCanaries` — canaries are lower-case letters and digits between fixed
  fences, so they survive trimming, lower-casing and slugging, and one
  regular expression finds them in any serialisation. Each carries its class
  and either a list of allowed views or a predicate over the view and its
  context, which expresses rules such as "only in this student's own view"
  or "only in the frame being presented".
* `fuzzProjection` — runs the projection for every view of every generated
  input and reports leaks and missing positive controls per canary class,
  together with how often an existing guard rejected the output.
* `createCaptureStore` and `fuzzSink` — a stand-in for a database client that
  records the parameters of matching statements, so a real telemetry
  pipeline, with its buffering and batching, runs unchanged and is checked at
  the storage boundary.
* `runMutationAnalysis` — applies one textual edit per mutant to the module's
  source, loads it in isolation, runs the same campaign, and counts a mutant
  as killed by an oracle only when that oracle reports more failures than on
  the original. Counting relative to the original keeps a known issue of the
  original from killing every mutant.
* `runLoad` — a closed-loop workload with per-client think time, latency
  percentiles and sampled gauges such as a connection pool's queue length.

The command-line tool runs any module that exports `run(args)`, prints the
report as JSON, and exits with status 1 when the report contains a leak.

Two examples are included. A course gradebook shows the method on a small
projection. The second is the sensing layer of a deployed online teaching
board, its learner projection and its telemetry filter with a coalescing
write pipeline, together with the campaign, the nine projection mutants and
the PostgreSQL load experiment of @munister2026; the test suite checks that
the shipped code still produces the published privacy results.

# Research impact statement

`canarytrace` grew out of the emulator used to evaluate the sensing layer of a
production teaching platform [@munister2026]. Campaigns run with it found two
defects that were then fixed in production: free text carried by
allow-listed telemetry keys, and cards outside any frame shown in a mode
where the specification excludes them. The same campaigns quantified the
gap between the platform's runtime guard and the canary oracle reported
above. The examples reproduce these results from the published code.

# AI usage disclosure

Claude Opus 5.5 [@claude], used through Claude Code, assisted in writing the
library code, tests, examples and documentation, in porting the original
emulator into this package, and in drafting this paper. The author directed
the design, reviewed and edited all code and text, checked every reported
number against runs of the code, and takes responsibility for the content.

# Conflict of interest

The author develops the teaching platform whose sensing layer is included as
an example.

# Acknowledgements

The author received no financial support for this work.

# References
