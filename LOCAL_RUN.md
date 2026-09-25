# Local run

Prerequisite: Bun 1.x.

```bash
bun install
bun run typecheck
bun test
bun run audit
bun run audit:deps
bun run research:manifest --id=baseline --seeds=100
```

The 3D simulator (Three.js, simulation in a Web Worker) starts with:

```bash
bun run simulator          # http://localhost:3200, or: bun apps/simulator/serve.ts --port 8080
bun run simulator:build    # static files in dist/simulator
```

The Control Room (decision replay/explanations) runs with `bun apps/control-room/index.html`.

The TypeSafe Jev and Open-Jev packages intentionally expose transport interfaces. Bind those transports to the exact API/runtime you deploy rather than embedding an assumed external API contract in the simulation core.

Dreamer remains behind the `WorldModel` contract and `HttpWorldModel` adapter. Its training process can therefore be Python/JAX while the simulator, orchestration, storage contracts, and application remain TypeScript.
