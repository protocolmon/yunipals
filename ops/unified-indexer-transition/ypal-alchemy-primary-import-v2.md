# Corrected inactive import classification

The actual first import of the public `10c34` queue artifact failed its
zero-operation counter assertion. Its private stderr has SHA
`072e82f09620e76757be6763a2e036838dba9673ec2161574bf416624240eed4`;
the failed attempt, source, artifact, intent and logs remain unchanged.
Network, listener, pool and child-process counts were zero. The original guard
counted one inspection of `pg.native` as a database operation.

Actual Node 24 and the installed PostgreSQL package reproduce the cause. Node's
CommonJS export analysis recognizes pg's lazy native export. Creating an ESM
namespace inspects that property and catches its getter's exception. This occurs
without a Client, Pool or connection. The corrected verifier counts this metadata
inspection separately. Its getter **still throws before loading a native addon**;
all constructor, connect/query/end, network, listener, child-process and dependency
integrity guards remain unchanged. Zero or one metadata inspection is accepted;
another explicit inspection refuses.

This successor creates a separate audit directory,
`/var/backups/yunipals-alchemy-primary-import-v2-20261024`. It authenticates the
actual original stage acknowledgement and exact failed import, then derives four
reversible changes from the frozen guard and two new producer bindings from the
original qualification body. It retains the original stage verifier in its
original namespace. Its own qualification result binds the actual new operator
hash and the real imported dependency subset. No old receipt becomes a pass.

The default command describes the source without host work. After this source is
published, reviewed and staged, its explicit root commands are:

```
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-primary-import-v2.py --stage-sha ACTUAL_STAGE_SHA
python3 -I -B /opt/yunipals-unified/operations/free-replay-20261020/ypal-alchemy-primary-import-v2.py --stage-sha ACTUAL_STAGE_SHA --qualify ACTUAL_NEW_REVIEW_SHA
```

Review is read-only. Qualification holds the existing transition lock, requires
an absent new audit path, and performs one bounded empty-environment import under
the existing RPC UID with no new privileges or capabilities. Raw logs stay
root-private; public output contains only hashes, counts and explicit false
runtime/financial flags. Unknown outcomes do not cause another import.

Nine local controls include the inherited cap-dropped import, before-evaluation
transitive mutation and unknown-file refusals, forbidden Pool/listener calls,
the actual pg lazy-export pattern reproducing the old assertion, the corrected
zero-database result, rejection of an extra native lookup, exact guard derivation,
original namespace preservation and default zero effects. Initial synthetic
getter-only fixtures did not reproduce Node's export analysis; those two failed
tests were corrected to use the actual pinned pg export pattern before passing.
These controls do not qualify production import or source startup.
