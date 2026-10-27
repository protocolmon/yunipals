# Superseded generation preparation

The published and inactive-staged `ypal-ordinary-generation-v5.py` (`c9baba67…`)
is held. Review found that its inherited capsule bridge still imported the V4
guard identity. No generation input, capsule, build or publication was executed.
Its original files and seven passing source-test records remain unchanged.

The replacement is `ypal-ordinary-generation-v5b.py` (`1ae13089…`) with explicit
V5 guard `591fce03…` and recovery module `a1948229…`. Eight focused controls,
fourteen genuine PostgreSQL groups and independent integration review passed.
These checks qualify preparation; actual metadata selection, provenance,
capacity checks and generation execution remain required.
