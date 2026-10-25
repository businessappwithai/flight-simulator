import {Planet} from "@flight/landscape";
const t=performance.now();const p=new Planet({seed:7n,onProgress:(ph,f)=>{}});
console.log("planet ms",Math.round(performance.now()-t),"trees",p.eco.treeTotal,"buildings",p.eco.buildings.length,"clearance",p.info.clearance,"tiles",p.land.generatedTiles);
console.log(p.info.camera.map(k=>`${k.t}:${Math.round(k.x)},${Math.round(k.z)},${Math.round(k.alt)}`).join(" "));
let t1=performance.now();const s=p.stream(0,0,p.land.padElevation+100,20);console.log("stream add",s.add.length,"ms",Math.round(performance.now()-t1),"rings",JSON.stringify(p.rings));
const sizes=s.add.map(a=>a.positions.length/3);console.log("verts",sizes.reduce((a,b)=>a+b,0),"trees in patches",s.add.reduce((a,b)=>a+(b.trees?.length??0)/5,0));
t1=performance.now();for(let i=0;i<2000;i++)p.ground(-i*30,-i*20);console.log("ground 2000 ms",Math.round(performance.now()-t1));
console.log(JSON.stringify(p.status(0,1,0)));console.log(await p.computeManifest());
