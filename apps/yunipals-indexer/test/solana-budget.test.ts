import { describe,expect,it } from "vitest";
import type { Pool } from "pg";
import { reserveRpcCredits, RpcBudgetExhausted } from "../lib/solana/budget.js";

describe("Solana RPC credit reservation",()=>{
  it("reserves under a database transaction and refuses a request past the daily cap",async()=>{
    const statements:string[]=[];
    let day=90,rolling=490;
    const client={
      async query(sql:string){
        statements.push(sql);
        if(sql.includes("AS day"))return {rows:[{day:String(day),rolling:String(rolling)}]};
        if(sql.includes("INSERT INTO solana_indexer.rpc_usage")){
          day+=10;rolling+=10;return {rows:[{id:"7"}]};
        }
        return {rows:[]};
      },
      release(){}
    };
    const pool={connect:async()=>client} as unknown as Pool;
    expect(await reserveRpcCredits(pool,"getAssetBatch",1,10,100,500)).toBe(7);
    await expect(reserveRpcCredits(pool,"getAssetBatch",1,10,100,500))
      .rejects.toEqual(new RpcBudgetExhausted("day"));
    expect(statements.filter(sql=>sql.includes("INSERT INTO solana_indexer.rpc_usage"))).toHaveLength(1);
    expect(statements.filter(sql=>sql==="COMMIT")).toHaveLength(1);
    expect(statements.filter(sql=>sql==="ROLLBACK")).toHaveLength(1);
  });
});
