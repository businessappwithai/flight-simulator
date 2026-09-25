from pathlib import Path
import json,hashlib,datetime
root=Path(__file__).resolve().parents[1]
audit=json.loads((root/"STATIC_AUDIT.json").read_text())
files=sorted(p for p in root.rglob("*") if p.is_file() and ".git" not in p.parts)
h=hashlib.sha256()
for p in files:
 h.update(str(p.relative_to(root)).encode());h.update(b"\0");h.update(p.read_bytes())
print("# Flight World Release Snapshot")
print()
print(f"- Files: {audit.get('files')}")
print(f"- TypeScript files: {audit.get('typescriptFiles')}")
print(f"- Static checker exit code: {audit.get('pythonStaticCheckExitCode')}")
print(f"- Repository content hash: `{h.hexdigest()}`")
print("- Bun executable tests: not executed in artifact environment")
