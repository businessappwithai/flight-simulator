# Host verification

The artifact environment contains Node.js and `tsc`, but not Bun.

A direct `tsc --noEmit` attempt was made. It stopped before project type checking because the declared Bun type package is not installed in the artifact environment:

`TS2688: Cannot find type definition file for 'bun'.`

This is an environment/dependency condition, not recorded as a passing or failing project typecheck. The repository CI installs dependencies with Bun and then executes typecheck/tests/audits.
