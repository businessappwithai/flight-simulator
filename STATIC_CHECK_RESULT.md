# Static check result

Executed `python3 scripts/static-check.py` in the artifact environment.

Exit code: `0`

```json
{
  "typescriptFiles": 107,
  "errors": []
}
```

This checker validates internal `@flight/*` alias coverage and protected-package dependency boundaries. It does not replace Bun/TypeScript compilation.
