import { replayBaseMetadata } from "../lib/metadata/base-replay.js";
import { argumentsOf, postgresFrom, safeFailure, writeReport } from "./metadata/support.js";
const args = argumentsOf({ range: {type:"string",default:"10000"}, advance:{type:"boolean",default:false} });
let stopping=false;
process.on("SIGTERM",()=>{stopping=true;}); process.on("SIGINT",()=>{stopping=true;});
const {pool,env}=await postgresFrom(String(args["env-file"]));
try {
  const report=await replayBaseMetadata(pool,env,{range:Number(args.range),advance:Boolean(args.advance),includeCounts:true,stopping:()=>stopping});
  await writeReport("docs/metadata-migration/base-events.json",report); console.log(JSON.stringify(report));
} catch(error) {console.error(safeFailure(error));process.exitCode=1;} finally {await pool.end();}
