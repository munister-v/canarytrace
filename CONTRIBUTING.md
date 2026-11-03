# Contributing

Thank you for helping. canarytrace is maintained by one person, so small,
focused changes are reviewed fastest.

## Reporting a problem

Open an issue with the Node.js version, the campaign (or a minimal one) and
its seed: every campaign is repeatable from its seed, so the seed is usually
enough to reproduce a report.

## Proposing a change

1. Fork, create a branch, and run `npm test` before and after the change.
2. Add a test for new behaviour. A new example should come with a test that
   pins its headline numbers, as `test/examples.test.js` does.
3. Keep the library free of runtime dependencies; database drivers stay
   optional and are used only in examples.
4. Describe the change in `CHANGELOG.md` under an "Unreleased" heading.

## Support

Questions and feature requests go to the issue tracker. The maintainer aims
to answer within two weeks. Security issues in the examples' code can be
reported privately to viacheslav.munister@dpu.edu.ua.

## Code of conduct

Be respectful and constructive; harassment of any kind is not tolerated.
