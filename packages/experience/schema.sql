CREATE TABLE IF NOT EXISTS episode(id TEXT PRIMARY KEY,scenario_id TEXT NOT NULL,seed TEXT NOT NULL,pilot_version TEXT NOT NULL,final_checksum TEXT NOT NULL,outcome TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decision(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL,start_tick TEXT NOT NULL,end_tick TEXT,requested_intent TEXT NOT NULL,executed_intent TEXT NOT NULL,provider TEXT NOT NULL,probability REAL NOT NULL,situation_fingerprint TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provider_response(decision_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,model_version TEXT NOT NULL,candidate TEXT NOT NULL,probability REAL NOT NULL,latency_ms REAL NOT NULL,PRIMARY KEY(decision_id,provider,candidate));
CREATE TABLE IF NOT EXISTS counterfactual(id TEXT PRIMARY KEY,source_decision_id TEXT NOT NULL,action TEXT NOT NULL,final_checksum TEXT NOT NULL,reward_json TEXT NOT NULL,collision INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_decision_fingerprint ON decision(situation_fingerprint);
