from pathlib import Path
import re,sys,json
root=Path(__file__).resolve().parents[1]; errors=[]
pat=re.compile(r"""(?:from\s+|import\s*\()['"]([^'"]+)['"]""")
for p in root.rglob("*.ts"):
 text=p.read_text(errors="ignore")
 for spec in pat.findall(text):
  if spec.startswith("."):
   q=p.parent/spec
   candidates=[q,q.with_suffix(".ts"),q/"index.ts"]
   if not any(x.exists() for x in candidates): errors.append(f"{p.relative_to(root)}: missing relative import {spec}")
print(json.dumps({"typescriptFiles":len(list(root.rglob("*.ts"))),"errors":errors},indent=2));sys.exit(1 if errors else 0)
