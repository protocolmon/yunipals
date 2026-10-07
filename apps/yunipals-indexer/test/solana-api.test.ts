import { describe,expect,it } from "vitest";
import { Hono } from "hono";
import type { Pool } from "pg";
import { mountSolanaApi } from "../lib/solana/api.js";

const mint="9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
const owner="4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue";

describe("Solana routes",()=>{
  it("reads text mint IDs and owner addresses without numeric casts or case folding",async()=>{
    const previous=process.env.SOLANA_API_ENABLED;
    process.env.SOLANA_API_ENABLED="true";
    const queries:string[]=[];
    const query=async(sql:string)=>{
      queries.push(sql);
      if(sql.includes("FROM solana_indexer.sync_state s JOIN"))return {rows:[{
        runId:"1",completedAt:new Date(),manifestCount:10000,missingCount:0
      }]};
      if(sql.includes("count(*)::text AS count"))return {rows:[{count:"1"}]};
      if(sql.includes("AS \"tokenId\""))return {rows:[{tokenId:mint,owner,chain:"solana"}]};
      return {rows:[]};
    };
    const pool={connect:async()=>({query,release(){}})} as unknown as Pool;
    const app=new Hono();mountSolanaApi(app,pool);
    try{
      const result=await app.request(`http://localhost/v1/tokens?chain=solana&owner=${owner}`);
      expect(result.status).toBe(200);
      expect((await result.json()).items[0].tokenId).toBe(mint);
      expect(queries.join("\n")).not.toMatch(/::numeric|lower\(/);
      expect(queries.join("\n")).toContain("t.owner=$1");
      const mixed=await app.request("http://localhost/v1/tokens?chain=ethereum&chain=solana");
      expect(mixed.status).toBe(400);
    }finally{
      if(previous===undefined)delete process.env.SOLANA_API_ENABLED;
      else process.env.SOLANA_API_ENABLED=previous;
    }
  });
});
