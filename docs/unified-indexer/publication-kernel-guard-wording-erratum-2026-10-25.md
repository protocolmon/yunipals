# Kernel source guard wording correction

The standalone source guard caller runbook compresses the backend-churn rule
too narrowly when it says the process must be absent and epoch changes refuse.
The actual guard can classify the initial backend's disappearance when its old
database epoch is gone and either its process is absent or a previously known
process epoch is proved replaced. A fresh whole capture must then prove complete
positive attribution before returning authority.

Changes to the source or route actor epochs, private/static fences, permission
failures, unrelated missing paths and surviving unclassified backend epochs
still refuse. The classified backend observation never retries an effect.

The reviewed SourceAuthorityV6 and caller6b runtime bytes remain unchanged.
This clarification adds no runtime qualification or effect claim.
