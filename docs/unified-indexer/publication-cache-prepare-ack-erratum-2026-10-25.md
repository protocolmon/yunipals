# Cache prepared acknowledgement recipe correction

The published acceptance publication recipes contain a redundant
`execute_cache(..., "prepare-ack", ...)` immediately after successful `commit`.
Remove that extra call from execution plans. The genuine unchanged c54 `commit`
already ends with `validate_reads(host); return prepare_ack(host)`, so success
creates and returns the exclusive `prepared.json` acknowledgement.

An explicit `prepare-ack` call is appropriate only after the genuine SQL
reconciliation path has proved the committed transaction and when the prepared
acknowledgement is still absent. Existing acknowledgements are never overwritten.
Unknown effects retain the original reconciliation requirements.

This erratum leaves all published source, manifests, recipes and audit records
unchanged. It performs no action and makes no production acceptance claim.
