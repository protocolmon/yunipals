"""Exact current global, claim reveal and birth/art contract over fixed GETs only."""
import hashlib,json,re
ENGINE = "0x455fabad0ac8ff1ea4df70ca07aa56a272cb2609"
COLLECTION = "0x105319be2182018c31fb10b1be198c3cf238a146"
REQUEST_ID = "95398210973416432093304839780870626144645280554838792215361305546672924156888"
REQUEST_KEY = "8453:" + ENGINE + ":" + REQUEST_ID
REQUEST_PATH = "/v1/boosters/requests/" + ENGINE + "/" + REQUEST_ID
METADATA_PATH = "/v1/boosters/metadata/" + COLLECTION + "/1.json"
SHARED_VARIANT_PATH = "/v1/boosters/art/base-mainnet-smoke-v1/73.json"
GLOBAL_PATH = "/v1/boosters/monsters?limit=24"

def need(value, code):
    if not value: raise RuntimeError(code)

def sha(raw): return hashlib.sha256(raw).hexdigest()

def encoded(value): return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()

def verify_global(value):
    need(isinstance(value, dict) and value.get("enabled") is True and value.get("chainId") == 8453 and
         value.get("collection") == COLLECTION and value.get("engine") == ENGINE,
         "actual_global_collection_identity_required")
    rows = value.get("items")
    need(isinstance(rows, list) and 1 <= len(rows) <= 24, "bounded_global_page_required")
    previous = 0
    for row in rows:
        token = row.get("tokenId") if isinstance(row, dict) else None
        need(isinstance(token, str) and re.fullmatch(r"[1-9][0-9]{0,77}", token) and
             previous < int(token) < 2 ** 256 and row.get("collection") == COLLECTION and
             row.get("id") == "8453:" + COLLECTION + ":" + token,
             "canonical_ascending_global_rows_required")
        previous = int(token)
    known = [row for row in rows if row["tokenId"] == "1"]
    expected_key = "8453:" + COLLECTION + ":1"
    need(len(known) == 1 and known[0].get("originalKey") == expected_key and
         known[0].get("requestKey") == REQUEST_KEY and known[0].get("isOriginal") is True and
         known[0].get("burned") is False, "actual_global_collection_monster_required")
    cursor = value.get("nextCursor")
    need("nextCursor" in value and (cursor is None or
         (len(rows) == 24 and isinstance(cursor, str) and cursor == rows[-1]["tokenId"])),
         "coherent_global_page_cursor_required")
    return {"pageRows": len(rows), "nextCursor": cursor, "knownTokenId": "1"}

def checks(get):
    new = True
    status, ready = get("/readyz")
    need(status == 200 and ready.get("ready") is True and ready.get("engine") == ENGINE and ready.get("collection") == COLLECTION,
         "actual_booster_readiness_required")
    status, types = get("/v1/boosters/types")
    need(status == 200 and {"1", "2"} <= {row["packTypeId"] for row in types.get("items", [])}, "existing_pack_types_required")
    status, request = get(REQUEST_PATH)
    row = (request or {}).get("item", {})
    need(status == 200 and row.get("id") == REQUEST_KEY and row.get("status") == "completed" and row.get("quantity") == 1,
         "genuine_completed_request_required")
    status, result = get(REQUEST_PATH + "/monsters")
    items = (result or {}).get("items", [])
    need(status == 200 and result.get("status") == "completed" and result.get("quantity") == 1 and len(items) == 1 and
         items[0].get("requestKey") == REQUEST_KEY and items[0].get("collection") == COLLECTION and items[0].get("tokenId") == "1",
         "actual_request_scoped_monster_required")
    need(items[0].get("burned") is False, "known_active_global_probe_required")
    status, shared = get(SHARED_VARIANT_PATH)
    traits = (shared or {}).get("attributes", [])
    shared_identity = (shared or {}).get("yunipals", {})
    need(status == 200 and isinstance(shared, dict) and isinstance(shared.get("image"), str) and
         shared["image"].startswith("https://") and isinstance(traits, list) and len(traits) == 4 and
         all(isinstance(item, dict) for item in traits) and
         {item.get("trait_type") for item in traits} == {"Type", "Color", "Horn", "Glitter"} and
         shared_identity.get("variantId") == 73 and shared_identity.get("status") == "ready" and
         isinstance(shared_identity.get("holo"), dict) and bool(shared_identity["holo"]),
         "approved_shared_variant_required")
    shared_digest = sha(encoded(shared))
    status, metadata = get(METADATA_PATH)
    identity = (metadata or {}).get("yunipals", {})
    attributes = (metadata or {}).get("attributes", [])
    born = identity.get("bornAt")
    need(status == 200 and isinstance(metadata, dict) and
         type(identity.get("birthMetadataVersion")) is int and identity["birthMetadataVersion"] == 1 and
         identity.get("chainId") == 8453 and identity.get("collection") == COLLECTION and
         identity.get("tokenId") == identity.get("originalTokenId") == "1" and identity.get("isOriginal") is True and
         type(identity.get("birthDay")) is int and identity["birthDay"] == 0 and
         isinstance(born, str) and re.fullmatch(r"[1-9][0-9]{0,15}", born) and
         identity.get("originalBornAt") == born and identity.get("mint") == identity.get("originalMint") and
         isinstance(identity.get("mint"), dict) and bool(identity["mint"]),
         "actual_original_birth_metadata_required")
    need(metadata.get("image") == shared["image"] and isinstance(attributes, list) and len(attributes) == 6 and
         attributes[:4] == traits and attributes[4] == {"trait_type": "Birth day", "display_type": "number", "value": 0} and
         attributes[5] == {"trait_type": "Born", "display_type": "date", "value": int(born)} and
         all(identity.get(key) == value for key, value in shared_identity.items()) and
         all(metadata.get(key) == value for key, value in shared.items() if key not in {"attributes", "yunipals"}),
         "approved_artwork_and_traits_must_be_unchanged")
    status, global_result = get(GLOBAL_PATH)
    page = None
    if new:
        need(status == 200, "actual_global_collection_status_required")
        page = verify_global(global_result)
    else: need(status == 404, "old_global_route_baseline_required")
    return {"ready": True, "indexedBlock": ready["indexedBlock"], "existingRequestId": REQUEST_ID,
            "requestMonstersStatus": 200, "requestMonstersVerified": True,
            "birthMetadataStatus": 200, "birthMetadataVerified": True,
            "globalBrowseStatus": status, "globalBrowseVerified": new, "page": page,
            "sharedMetadataSha256": shared_digest, "sharedVariantId": 73,
            "birthTokenId": "1", "birthDay": 0}

def availability(request,boundary,build):
    reports=[];proofs=[]
    for public in (False,True):
        def get(path):
            actual='/v1/boosters/types'if public and path=='/readyz'else path
            proof,value=request(actual,public)
            proofs.append(proof)
            if path=='/readyz'and(value.get('buildId')!=build or int(value.get('indexedBlock')or-1)<boundary):
                need(False,'current_native_API_prefix_required')
            return proof['status'],value
        report=checks(get)
        need(report['sharedMetadataSha256']=='2dc4fe8be2d14969780fbef59d62f85cf9ef90eebb95ee0668706c93bd3850cc','approved_shared_variant_bytes_changed')
        reports.append(report)
    _,document=request(SHARED_VARIANT_PATH,True)
    prefix='https://api.yunipals.com/yunipals-indexer'
    holo=document['yunipals']['holo']
    urls=[document['image'],*[holo[k]for k in ('foreground','background','stars')]]
    assets=[]
    for index,image in enumerate(urls):
        extension='.png'if index==0 else'.svg'
        need(re.fullmatch(re.escape(prefix)+r'/v1/boosters/art-assets/[0-9a-f]{64}'+re.escape(extension),image)is not None,'approved_content_addressed_image_required')
        asset,raw=request(image[len(prefix):],True,True)
        need(asset['sha256']==image.rsplit('/',1)[1][:-4]and'immutable'in(asset.get('cacheControl')or'')and asset.get('cors')=='*','approved_image_bytes_and_cache_required')
        assets.append(asset)
    for proof in proofs:
        if proof.get('public'):need(proof.get('cors')=='*','public_feature_CORS_must_be_preserved')
    return {'publicReady':True,'buildId':build,'minimumBoundary':boundary,'checks':proofs,
            'currentFeatures':reports,'cachedArtwork':assets,
            'globalBrowseVerified':True,'requestMonstersVerified':True,'birthMetadataVerified':True}
