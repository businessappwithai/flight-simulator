import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App.tsx";
import {DashboardStore} from "./dashboard-store.ts";
import {LabStore} from "./lab/lab-store.ts";
const store=new DashboardStore(),lab=new LabStore();
window.addEventListener("pagehide",()=>lab.dispose());
// Read-only hook for automated QA and embedding (e.g. a runtime bridge calling showEvent).
(globalThis as any).flightControlRoom={showEvent:(e:unknown)=>store.ingest(e as never),get model(){return store.model},get lab(){return lab.getSnapshot()}};
createRoot(document.getElementById("root")!).render(<StrictMode><App store={store} lab={lab}/></StrictMode>);
