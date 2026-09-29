import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {App,parseOptions} from "./App.tsx";
import {SimStore} from "./sim-store.ts";
window.addEventListener("error",e=>console.error(`Unexpected error: ${e.message}`));
window.addEventListener("unhandledrejection",e=>console.error(`Unexpected error: ${(e.reason as Error)?.message??e.reason}`));
const options=parseOptions(location.search),store=new SimStore(options);
window.addEventListener("pagehide",()=>store.dispose());
// Offline use: the app-shell service worker (sw.js next to the page) on HTTPS, or anywhere with ?sw=1.
if("serviceWorker" in navigator&&(location.protocol==="https:"||new URLSearchParams(location.search).has("sw")))
 navigator.serviceWorker.register(new URL("sw.js",document.baseURI),{scope:"./"}).catch(e=>console.warn(`Offline support unavailable: ${(e as Error).message}`));
createRoot(document.getElementById("root")!).render(<StrictMode><App options={options} store={store}/></StrictMode>);
