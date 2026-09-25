import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App.tsx";
import {DashboardStore} from "./dashboard-store.ts";
const store=new DashboardStore();
// Read-only hook for automated QA and embedding (e.g. a runtime bridge calling showEvent).
(globalThis as any).flightControlRoom={showEvent:(e:unknown)=>store.ingest(e as never),get model(){return store.model}};
createRoot(document.getElementById("root")!).render(<StrictMode><App store={store}/></StrictMode>);
