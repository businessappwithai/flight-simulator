import {expect,test} from "bun:test";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";import {tmpdir} from "node:os";import {join,dirname} from "node:path";
import {auditDependencies,importsOf} from "../scripts/dependency-audit.ts";
async function repo(files:Record<string,string>){const root=await mkdtemp(join(tmpdir(),"fw-deps-"));for(const [p,c] of Object.entries(files)){await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),c)}return root}
test("import scanner sees every import form and ignores comments",()=>{
 expect(importsOf(`import a from "react";\nimport "three";\nexport {x} from "@react-three/fiber";\nconst y=await import('three/examples/jsm/objects/Sky.js');\nconst z=require("react-dom");\n// import q from "nope";\n/* import w from "nope2" */`))
  .toEqual(["react","three","@react-three/fiber","three/examples/jsm/objects/Sky.js","react-dom"]);
});
test("core packages may not import or declare React, R3F or Three.js",async()=>{
 const root=await repo({"packages/simulation/src/a.ts":`import * as THREE from "three";`,"packages/world/src/b.tsx":`import {useFrame} from "@react-three/fiber";`,"packages/cognition/src/c.ts":`const r=await import("react");`,"packages/world-model/package.json":JSON.stringify({dependencies:{"react-dom":"19"}}),"packages/sensors/src/ok.ts":`import type {Observation} from "@flight/protocol";`});
 try{const v=await auditDependencies(root);expect(v.map(x=>`${x.rule}:${x.file}`).sort()).toEqual(["core-no-renderer:packages/cognition/src/c.ts","core-no-renderer:packages/simulation/src/a.ts","core-no-renderer:packages/world-model/package.json","core-no-renderer:packages/world/src/b.tsx"])}finally{await rm(root,{recursive:true})}
});
test("presentation code may only use @flight/protocol; workers may use the core but not the renderer",async()=>{
 const root=await repo({"apps/simulator/src/view.tsx":`import {Canvas} from "@react-three/fiber";import type {WorldSnapshot} from "@flight/protocol";import {DeterministicSimulation} from "@flight/simulation";`,
  "apps/simulator/src/sim.worker.ts":`import {DeterministicSimulation} from "@flight/simulation";import * as THREE from "three";`,
  "apps/control-room/src/why.tsx":`import {CognitivePilot} from "@flight/cognition";import x from "../../../packages/runtime/src/index.ts";`,
  "apps/benchmark/src/main.ts":`import {DeterministicSimulation} from "@flight/simulation";`});
 try{const v=await auditDependencies(root);expect(v.map(x=>`${x.rule}:${x.file}:${x.detail.split(" ")[1]}`).sort()).toEqual([
  "presentation-protocol-only:apps/control-room/src/why.tsx:../../../packages/runtime/src/index.ts","presentation-protocol-only:apps/control-room/src/why.tsx:@flight/cognition",
  "presentation-protocol-only:apps/simulator/src/view.tsx:@flight/simulation","worker-no-renderer:apps/simulator/src/sim.worker.ts:three"])}finally{await rm(root,{recursive:true})}
});
test("protected core still may not depend on decision providers or the world model",async()=>{const root=await repo({"packages/safety/src/a.ts":`import {X} from "@flight/world-model";`});try{expect((await auditDependencies(root))[0]?.rule).toBe("protected-core")}finally{await rm(root,{recursive:true})}});
