import { Database } from "bun:sqlite";
export class ExperimentStore {
 readonly db:Database;
 constructor(file="experiments.sqlite"){
  this.db=new Database(file,{create:true});
  this.db.run(`CREATE TABLE IF NOT EXISTS experiment_run(
   id TEXT PRIMARY KEY,pilot_id TEXT NOT NULL,variant_id TEXT NOT NULL,
   scenario_seed TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL)`);
 }
 record(id:string,pilotId:string,variantId:string,seed:bigint,result:unknown){
  this.db.query(`INSERT INTO experiment_run VALUES($id,$p,$v,$s,$r,$t)`).run({
   $id:id,$p:pilotId,$v:variantId,$s:seed.toString(),$r:JSON.stringify(result),$t:new Date().toISOString()
  });
 }
}
