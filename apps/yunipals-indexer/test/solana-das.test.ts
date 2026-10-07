import { afterEach, describe, expect, it, vi } from "vitest";
import { isSolanaAddress, parseDasAsset, parseDasBatch, getAssetBatch, DasError } from "../lib/solana/das.js";
import { safeErrorMessage } from "../lib/safe-error.js";

const mint="9oDGqXsG2n3P4Bs6KsA1a6QCvjELi3bU2XMEwEiqcAus";
const second="F9Lw3ki3hJ7PF9HQXsBzoY8GyE6sPoEZZdXJBsTTD2rk";
const owner="4zdNGgAtFsW1cQgHqkiWyRsxaAgxrSRRynnuunxzjxue";
const asset=(id:string)=>({id,burnt:false,ownership:{owner,delegated:false,delegate:null},
  content:{json_uri:"https://example.com/meta.json",last_indexed_slot:365750752}});

afterEach(()=>vi.unstubAllGlobals());

describe("Solana DAS identity and response handling",()=>{
  it("preserves exact base58 address case and rejects wrong-length addresses",()=>{
    expect(isSolanaAddress(mint)).toBe(true);
    expect(isSolanaAddress(owner)).toBe(true);
    expect(()=>parseDasAsset(asset(mint.toLowerCase()),mint)).toThrow("das_asset_identity_mismatch");
    expect(isSolanaAddress("11111111111111111111111111111111")).toBe(true);
    expect(isSolanaAddress("1111111111111111111111111111111")).toBe(false);
    expect(isSolanaAddress("0x85f0e02cb992aa1f9f47112f815f519ef1a59e2d")).toBe(false);
  });
  it("matches reordered assets by mint and keeps omissions explicit",()=>{
    expect(parseDasBatch([asset(second),asset(mint)],[mint,second]).map(row=>row?.mint)).toEqual([mint,second]);
    expect(parseDasBatch([asset(mint)],[mint,second])).toEqual([parseDasAsset(asset(mint),mint),null]);
    expect(()=>parseDasBatch([asset(mint),asset(mint)],[mint,second])).toThrow("das_unexpected_or_duplicate_id");
    expect(()=>parseDasBatch([asset(second)],[mint])).toThrow("das_unexpected_or_duplicate_id");
    expect(()=>parseDasAsset({...asset(mint),ownership:{owner:null}},mint)).toThrow("das_owner_invalid");
    expect(parseDasBatch([{...asset(mint),ownership:{owner:""}}],[mint])).toEqual([null]);
  });
  it("sends one batch request and never exposes Helius credentials in an error",async()=>{
    const request=vi.fn(async (input: URL|string|Request, init?: RequestInit)=>{
      expect(String(input)).toContain("api-key=secret-value");
      expect(JSON.parse(String(init?.body))).toMatchObject({method:"getAssetBatch",params:{ids:[mint]}});
      return new Response(JSON.stringify({jsonrpc:"2.0",result:[asset(mint)]}),{status:200});
    });
    vi.stubGlobal("fetch",request);
    expect((await getAssetBatch("secret-value",[mint])).length).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch",vi.fn(async()=>{throw new Error("https://mainnet.helius-rpc.com/?api-key=secret-value");}));
    await expect(getAssetBatch("secret-value",[mint])).rejects.toEqual(new DasError("das_transport_error",true));
    expect(safeErrorMessage(new Error("https://mainnet.helius-rpc.com/?api-key=secret-value"))).not.toContain("secret-value");
  });
  it("classifies missing assets and rate limits without treating them as valid ownership",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({jsonrpc:"2.0",error:{code:-32004}}),{status:200})));
    await expect(getAssetBatch("secret-value",[mint])).rejects.toEqual(new DasError("das_asset_missing"));
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("rate limited",{status:429})));
    await expect(getAssetBatch("secret-value",[mint])).rejects.toEqual(new DasError("das_rate_limited",true));
  });
});
