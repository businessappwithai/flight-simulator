import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App,parseOptions} from "./App.tsx";
import {SimStore} from "./sim-store.ts";
window.addEventListener("error",e=>console.error(`Unexpected error: ${e.message}`));
window.addEventListener("unhandledrejection",e=>console.error(`Unexpected error: ${(e.reason as Error)?.message??e.reason}`));
const options=parseOptions(location.search),store=new SimStore(options);
window.addEventListener("pagehide",()=>store.dispose());
createRoot(document.getElementById("root")!).render(<StrictMode><App options={options} store={store}/></StrictMode>);
