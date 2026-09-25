from pathlib import Path
import re,json,sys
root=Path(__file__).resolve().parents[1]
ts=[p for p in [*root.rglob("*.ts"),*root.rglob("*.tsx")] if not {"node_modules",".git"} & set(p.relative_to(root).parts)]
aliases=json.loads((root/"tsconfig.json").read_text())["compilerOptions"]["paths"]
errors=[]
for p in ts:
 t=p.read_text()
 for spec in re.findall(r'from\s+["\']([^"\']+)["\']',t):
  if spec.startswith("@flight/") and spec not in aliases:
   errors.append(f"{p.relative_to(root)}: unresolved alias {spec}")
 for spec in re.findall(r'import\s+["\']([^"\']+)["\']',t):
  if spec.startswith("@flight/") and spec not in aliases:
   errors.append(f"{p.relative_to(root)}: unresolved alias {spec}")
protected=("packages/simulation/","packages/aircraft/","packages/safety/")
for p in ts:
 rel=str(p.relative_to(root))
 if rel.startswith(protected):
  t=p.read_text()
  for forbidden in ("@flight/decision-jev","@flight/decision-open-jev","@flight/world-model"):
   if forbidden in t: errors.append(f"{rel}: protected dependency {forbidden}")
print(json.dumps({"typescriptFiles":len(ts),"errors":errors},indent=2))
sys.exit(1 if errors else 0)
