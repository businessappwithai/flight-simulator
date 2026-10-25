import {REVEAL,revealState} from "@flight/protocol";
/*
 * The reveal's sound, synthesised with Web Audio from the same timeline as the picture (no samples, no words,
 * no borrowed melody). Every hit lands one frame after its picture event and never before it:
 * start = event + 1 frame − min(peak offset, 1 frame). A 12 ms broadband click marks the flood and the reveal.
 *
 * Sound design: key clicks while the prompt types, a thock and sub drop on enter, a whoosh as the panels slide;
 * tectonic rumble with granular grinding and a heartbeat pulse while the land heaves; a water rush with a boom for
 * the flood; glitter for the rivers; thousands of tiny pops following the forest front's growth; ratcheting metal
 * ticks rising for the city; strings Bb(add9), F/A, Gm, A through the forest with a rising melody, a 1/16 arp
 * over the city; a Shepard riser, noise riser, reverse cymbal and snare roll on the climb, 70 ms of silence, then
 * the reveal in D major (sub boom, timpani, crash, brass stab, strings, a formant "ah"); two wet blips for the blink
 * with the pad ducked 6 dB; a reverse whoosh back into the editor; accelerating UI ticks and a chime at 17.85 s.
 * Master: compressor −21 dB 2.4:1 with 6.5 dB make-up, then a limiter keeping the true peak under −2 dBTP.
 */
const FRAME=1/REVEAL.fps,BPM=100,BEAT=60/BPM;
const hz=(midi:number)=>440*Math.pow(2,(midi-69)/12);
export interface SoundStats{quarters:number[];loudestQuarter:number;revealQuarter:number;peakDb:number}

export class RevealSound{
 readonly ctx:BaseAudioContext;readonly out:GainNode;#noise:AudioBuffer;#pad:GainNode;#nodes:AudioScheduledSourceNode[]=[];
 constructor(ctx:BaseAudioContext){
  this.ctx=ctx;
  const comp=ctx.createDynamicsCompressor();comp.threshold.value=-21;comp.ratio.value=2.4;comp.knee.value=6;comp.attack.value=.008;comp.release.value=.18;
  const makeup=ctx.createGain();makeup.gain.value=Math.pow(10,6.5/20);
  const limit=ctx.createDynamicsCompressor();limit.threshold.value=-4;limit.ratio.value=20;limit.knee.value=0;limit.attack.value=.001;limit.release.value=.06;
  const trim=ctx.createGain();trim.gain.value=Math.pow(10,-2.4/20);
  this.out=ctx.createGain();this.out.gain.value=.5;
  this.out.connect(comp).connect(makeup).connect(limit).connect(trim).connect(ctx.destination);
  this.#pad=ctx.createGain();this.#pad.connect(this.out);
  const n=ctx.sampleRate*2,b=ctx.createBuffer(1,n,ctx.sampleRate),d=b.getChannelData(0);let s=12345;
  for(let i=0;i<n;i++){s=(s*1103515245+12345)>>>0;d[i]=s/2147483648-1}this.#noise=b;
 }
 #env(g:AudioParam,at:number,peak:number,attack:number,decay:number,curve:"exp"|"lin"="exp"){g.setValueAtTime(0,at);g.linearRampToValueAtTime(peak,at+attack);
  if(curve==="exp")g.exponentialRampToValueAtTime(1e-4,at+attack+decay);else g.linearRampToValueAtTime(0,at+attack+decay)}
 #osc(type:OscillatorType,f:number,at:number,dur:number,dest:AudioNode,gain:number,attack=.005,glideTo?:number){
  const o=this.ctx.createOscillator(),g=this.ctx.createGain();o.type=type;o.frequency.setValueAtTime(f,at);if(glideTo)o.frequency.exponentialRampToValueAtTime(glideTo,at+dur);
  this.#env(g.gain,at,gain,attack,dur);o.connect(g).connect(dest);o.start(at);o.stop(at+attack+dur+.05);this.#nodes.push(o);return o}
 #noiseBurst(at:number,dur:number,dest:AudioNode,gain:number,filter:BiquadFilterType,f:number,q=1,attack=.002,fTo?:number){
  const src=this.ctx.createBufferSource(),bq=this.ctx.createBiquadFilter(),g=this.ctx.createGain();src.buffer=this.#noise;src.loop=true;
  bq.type=filter;bq.frequency.setValueAtTime(f,at);if(fTo)bq.frequency.exponentialRampToValueAtTime(fTo,at+attack+dur);bq.Q.value=q;
  this.#env(g.gain,at,gain,attack,dur);src.connect(bq).connect(g).connect(dest);src.start(at,Math.random()*1.5);src.stop(at+attack+dur+.05);this.#nodes.push(src)}
 /** One frame after the picture event, the peak never before it. */
 #hit(event:number,peakOffset=0){return event+FRAME-Math.min(peakOffset,FRAME)}

 /** Schedules the whole sequence so that sequence time 0 is `at` (context seconds); `from` skips earlier events. */
 schedule(at:number,from=0){
  const T=(t:number)=>at+t-from,on=(t:number)=>t>=from,R=REVEAL,o=this.out;
  // Typing: one click per character; enter: thock + sub drop; panels: whoosh.
  for(let i=0;i<R.prompt.length;i++){const t=R.typeStart+(R.typeEnd-R.typeStart)*i/R.prompt.length;if(on(t))this.#noiseBurst(T(this.#hit(t)),.018,o,.32,"highpass",2400,.7)}
  if(on(R.enter)){this.#osc("sine",150,T(this.#hit(R.enter)),.45,o,.9,.004,38);this.#noiseBurst(T(this.#hit(R.enter)),.08,o,.5,"lowpass",900)}
  if(on(R.panelsStart))this.#noiseBurst(T(this.#hit(R.panelsStart)),R.panelsEnd-R.panelsStart,o,.35,"bandpass",350,1.4,.25,3200);
  // The land heaves: rumble, grinding grains, a heartbeat on the beat.
  if(on(R.terrainStart)){const d=R.terrainEnd-R.terrainStart+.4;this.#noiseBurst(T(this.#hit(R.terrainStart)),d,o,.55,"lowpass",90,.8,1.4);this.#osc("sine",34,T(this.#hit(R.terrainStart)),d,o,.5,1.2);
   for(let t=R.terrainStart;t<R.terrainEnd;t+=.045){const k=(t*7919)%1;if(on(t))this.#noiseBurst(T(t+FRAME),.03+.04*k,o,.08+.06*k,"bandpass",300+900*k,4)}
   for(let t=R.terrainStart;t<R.terrainEnd;t+=BEAT)if(on(t))for(const dt of [0,.16]){this.#osc("sine",55,T(this.#hit(t+dt)),.22,o,.55,.004,40)}}
  // The flood: a water rush with a boom on its first frame, and the 12 ms click.
  if(on(R.waterStart)){this.#osc("sine",48,T(this.#hit(R.waterStart)),1.4,o,.9,.003,30);this.#noiseBurst(T(this.#hit(R.waterStart)),.012,o,.6,"highpass",30,.5,.0005);
   this.#noiseBurst(T(this.#hit(R.waterStart)),R.waterEnd-R.waterStart,o,.42,"lowpass",400,.7,.5,2400)}
  // Rivers: glitter.
  for(let t=R.riversStart;t<R.riversEnd;t+=.03){const k=(t*104729)%1;if(on(t)&&k<.6)this.#osc("sine",2600+5200*k,T(t+FRAME),.07,o,.035,.002)}
  // Forest: pops at the rate the front grows.
  for(let t=R.forestStart;t<R.forestEnd;t+=FRAME){const r=(revealState(t+FRAME).forestR-revealState(t).forestR)/FRAME/90_000;const n=Math.min(6,Math.floor(r*3+((t*7907)%1)));
   for(let i=0;i<n;i++){const k=((t+i)*6271)%1;if(on(t))this.#osc("sine",500+1400*k,T(t+FRAME+k*FRAME),.025,o,.05,.001,300+600*k)}}
  // City: ratcheting metal ticks, rising.
  for(let t=R.cityStart;t<R.cityEnd;t+=.05){const u=(t-R.cityStart)/(R.cityEnd-R.cityStart);if(on(t))this.#noiseBurst(T(t+FRAME),.012,o,.16,"bandpass",2200+2600*u,9)}
  // Strings through the forest (pad bus, ducked for the blink), the melody and the city arp.
  const chords=[[46,53,58,60,62],[45,53,57,60,65],[43,50,55,58,62],[45,52,57,61,64]],span=(R.climbStart-R.forestStart)/4;
  chords.forEach((c,i)=>{const t=R.forestStart+i*span;if(!on(t))return;for(const m of c)for(const det of [-.06,.06]){const f=hz(m+det/1);
   const osc=this.#osc("sawtooth",f,T(t+FRAME),span+.3,this.#lp(1800),.035,.35);void osc}});
  [74,76,77,79,81,82,84,86].forEach((m,i)=>{const t=R.forestStart+.3+i*span/2;if(on(t))this.#osc("triangle",hz(m),T(t+FRAME),span/2,o,.08,.06)});
  for(let t=R.cityStart;t<R.climbStart;t+=BEAT/4){const i=Math.round((t-R.cityStart)/(BEAT/4)),m=[57,61,64,69,73,76][i%6]!;if(on(t))this.#osc("square",hz(m),T(t+FRAME),.11,this.#lp(2600),.05,.004)}
  // The climb: Shepard riser, noise riser, reverse cymbal, snare roll, then 70 ms of silence before the reveal.
  const cut=R.reveal-.07,climb=R.climbStart;
  if(on(climb)){for(let k=0;k<5;k++){const o2=this.ctx.createOscillator(),g=this.ctx.createGain();o2.type="sine";const f0=55*Math.pow(2,k);o2.frequency.setValueAtTime(f0,T(climb));o2.frequency.exponentialRampToValueAtTime(f0*2,T(cut));
    g.gain.setValueAtTime(0,T(climb));g.gain.linearRampToValueAtTime(.05+.03*Math.sin(Math.PI*k/4),T(climb+.8));g.gain.setValueAtTime(.05+.03*Math.sin(Math.PI*k/4),T(cut-.02));g.gain.linearRampToValueAtTime(0,T(cut));
    o2.connect(g).connect(o);o2.start(T(climb));o2.stop(T(cut)+.01);this.#nodes.push(o2)}
   this.#noiseBurst(T(climb),cut-climb,o,.3,"highpass",400,.7,cut-climb-.01,9000);
   for(let t=climb+1;t<cut;t+=Math.max(.03,.2*(1-(t-climb)/(cut-climb)))){if(on(t))this.#noiseBurst(T(t+FRAME),.04,o,.12+.1*(t-climb)/(cut-climb),"bandpass",1800,1.2)}}
  // The reveal: the loudest moment, in D major.
  const rv=this.#hit(R.reveal,.004);
  if(on(R.reveal)){this.#noiseBurst(T(R.reveal+FRAME),.012,o,.9,"highpass",30,.5,.0005);
   this.#osc("sine",44,T(rv),2.4,o,1.2,.004,30);this.#osc("sine",73.4,T(rv),1.6,o,.8,.004,62);this.#noiseBurst(T(rv),.25,o,.5,"lowpass",220);
   this.#noiseBurst(T(rv),2.6,o,.38,"highpass",4500,.5,.003);
   const hp=this.ctx.createBiquadFilter();hp.type="highpass";hp.frequency.value=45;hp.connect(this.#pad);
   for(const m of [50,54,57,62,66,69])this.#osc("sawtooth",hz(m),T(rv),1.1,this.#lp(2200),.08,.012);
   for(const m of [62,66,69,74])for(const det of [-.08,.08])this.#osc("sawtooth",hz(m+det),T(rv),3,hp,.03,.25);
   for(const [f,q] of [[800,6],[1150,7],[2900,9]] as const){const bq=this.ctx.createBiquadFilter();bq.type="bandpass";bq.frequency.value=f;bq.Q.value=q;bq.connect(this.#pad);
    for(const m of [57,62,66])this.#osc("sawtooth",hz(m),T(rv+.05),2.6,bq,.11,.3)}}
  // The blink: two soft wet blips, the pad ducked 6 dB.
  for(const t of [R.blinkStart,R.blinkStart+.1])if(on(t))this.#osc("sine",320,T(this.#hit(t)),.07,o,.4,.003,980);
  if(on(R.blinkStart)){const p=this.#pad.gain;p.setValueAtTime(1,T(R.blinkStart));p.linearRampToValueAtTime(.5,T(R.blinkStart+.04));p.setValueAtTime(.5,T(R.blinkEnd+.1));p.linearRampToValueAtTime(1,T(R.blinkEnd+.4))}
  // Back into the editor: a reverse whoosh; the Outliner floods with accelerating ticks; a chime.
  if(on(R.backStart))this.#noiseBurst(T(R.backStart),R.backEnd-R.backStart,o,.4,"bandpass",3000,1.2,R.backEnd-R.backStart-.01,300);
  for(let t=R.outlinerStart,dt=.12;t<R.outlinerEnd;t+=dt,dt=Math.max(.018,dt*.86))if(on(t))this.#osc("square",1800+600*((t-R.outlinerStart)/(R.outlinerEnd-R.outlinerStart)),T(t+FRAME),.01,o,.05,.001);
  if(on(R.chime))for(const m of [91,98])this.#osc("sine",hz(m),T(this.#hit(R.chime)),1.2,o,.16,.003);
 }
 #lp(f:number){const b=this.ctx.createBiquadFilter();b.type="lowpass";b.frequency.value=f;b.connect(this.#pad);return b}
 stop(){for(const n of this.#nodes){try{n.stop()}catch{/* already stopped */}}this.#nodes=[];this.out.disconnect()}
}

/** Renders the sequence offline (QA: "print loudness per quarter second: the reveal must be the loudest quarter"). */
export async function renderRevealSound():Promise<SoundStats>{
 const rate=48000,ctx=new OfflineAudioContext(2,rate*REVEAL.duration,rate);new RevealSound(ctx).schedule(0);
 const buf=await ctx.startRendering(),L=buf.getChannelData(0),R=buf.getChannelData(1),q=rate/4,quarters:number[]=[];let peak=0;
 for(let i=0;i<L.length;i+=q){let s=0;for(let k=i;k<Math.min(L.length,i+q);k++){const v=(L[k]!+R[k]!)/2;s+=v*v;peak=Math.max(peak,Math.abs(L[k]!),Math.abs(R[k]!))}quarters.push(10*Math.log10(s/q+1e-12))}
 const loudest=quarters.indexOf(Math.max(...quarters));
 return {quarters:quarters.map(v=>Math.round(v*10)/10),loudestQuarter:loudest,revealQuarter:Math.floor(REVEAL.reveal*4),peakDb:Math.round(20*Math.log10(peak)*10)/10};
}
