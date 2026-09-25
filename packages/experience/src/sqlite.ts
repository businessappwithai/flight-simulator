import { Database } from "bun:sqlite";
export class SqliteExperienceStore {
 readonly db:Database;
 constructor(file="flight-world.sqlite"){
  this.db=new Database(file,{create:true});
  this.db.run("CREATE TABLE IF NOT EXISTS experience(id INTEGER PRIMARY KEY AUTOINCREMENT,fingerprint TEXT NOT NULL,action TEXT NOT NULL,reward_json TEXT,success INTEGER NOT NULL)");
  this.db.run("CREATE INDEX IF NOT EXISTS idx_exp_fp ON experience(fingerprint)");
 }
 add(fingerprint:string,action:string,reward:unknown,success:boolean){
  this.db.query("INSERT INTO experience(fingerprint,action,reward_json,success) VALUES ($f,$a,$r,$s)")
   .run({$f:fingerprint,$a:action,$r:JSON.stringify(reward),$s:success?1:0});
 }
 retrieve(fingerprint:string,limit=5){
  return this.db.query("SELECT action,COUNT(*) occurrences,SUM(success) successes FROM experience WHERE fingerprint=$f GROUP BY action ORDER BY occurrences DESC LIMIT $l").all({$f:fingerprint,$l:limit});
 }
}
