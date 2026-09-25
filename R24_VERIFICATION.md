# R24 verification
## Static repository checker
Exit: 0
```
{
  "typescriptFiles": 139,
  "errors": []
}
```
## TypeScript compiler attempt
Command: `tsc --noEmit --types node`
Exit: 2
```
error TS2688: Cannot find type definition file for 'node'.
  The file is in the program because:
    Entry point of type library 'node' specified in compilerOptions
```
Bun tests were not executed because Bun is not installed in this artifact environment.
