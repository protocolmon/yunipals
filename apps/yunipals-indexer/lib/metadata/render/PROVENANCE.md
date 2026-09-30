# Legacy snapshot compatibility

`snapshot.ts` extracts the metadata-only behavior of the deployed Polkamon code:

- `/root/polkamon-express-meta/2024-11-29T09-16-41/node_modules/@polkamon/feature-nft-transformation/src/lib/utils/transformer/legacyMetadataFactory.js`
- `/root/polkamon-express-meta/2024-11-29T09-16-41/dist/utils/metadata.js`
- `/root/polkamon-express-meta/2024-11-29T09-16-41/node_modules/@polkamon/feature-nft-transformation/src/lib/assets/utils.js`

Traits, chain labels and rarity reuse the project's existing pinned Polkamon packages. No legacy server, Mongo, Redis, signer or gameplay module is imported. Rainbow enrichment requires explicitly supplied historical inputs; missing parents are not silently replaced by guessed scores.

The result is a historical response snapshot. An API must resolve current ownership separately before presenting owner-related fields as current. The volatile legacy “Last metadata update” trait is assigned an explicit publication timestamp to make rendering repeatable. Fields excluded by the old mandatory projection remain excluded from the rendered response, even though raw source records preserve them.
