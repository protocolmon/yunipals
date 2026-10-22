#!/usr/bin/env python3
"""Main-API bundle view over the unchanged acknowledged 41e5 consumer facade."""
import copy
from pathlib import Path

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
MAIN = 'yunipals-api.service'
PREDECESSOR_SHA = '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81'
INSTALLER_SHA = '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b'
INSTALL_SHA = '87333b9a98b634722e6d6158a0fbf0049045c6edad51dacbb549754594d9fb98'
FORMAT = 'yunipals-topic-corrected-consumer-runtime-view-v1'


def fail(code):
    raise RuntimeError(code)


class Runtime:
    def __init__(self, a, old, file, pin):
        prior = a.load(OPS / 'consumer-final-runtime-v1.py', PREDECESSOR_SHA)
        self.previous = prior.Runtime(a, old, file, pin)
        self.installer = a.load(OPS / 'nonmarket-consumer-runtime-install-v1.py', INSTALLER_SHA)
        self.shared = self.installer.shared()
        self.correction = self.installer.installed(self.shared, INSTALL_SHA)
        self.entry = str(self.installer.TARGET / 'dist/main-api.mjs')
        self.entry_sha = self.correction['files']['dist/main-api.mjs']
        self.entry_bytes = len(a.protected(Path(self.entry), 4000000))
        self.ENTRYPOINTS = dict(self.previous.ENTRYPOINTS)
        self.ENTRYPOINTS[MAIN] = self.entry

    def __getattr__(self, name):
        return getattr(self.previous, name)

    def replace_entry(self, text):
        original = str(self.previous.ROOT / 'apps/yunipals-indexer/lib/api/server.ts')
        if text.count(original) != 1:
            fail('exact_original_main_entry_required')
        # Retaining the existing --import tsx hook keeps all original process
        # validators and dependency resolution intact; tsx also accepts .mjs.
        return text.replace(original, self.entry, 1)

    def matrix(self):
        value = copy.deepcopy(self.previous.matrix())
        row = next(row for row in value['services'] if row['unit'] == MAIN)
        proposed = row['proposed']
        proposed['dropInPreview'] = self.replace_entry(proposed['dropInPreview'])
        proposed.update(entrypoint=self.entry, entrypointManifestSha256=self.entry_sha,
                        entrypointManifestBytes=self.entry_bytes,
                        correctedConsumerArtifactDigest=self.installer.DIGEST,
                        correctedConsumerInstallSha256=INSTALL_SHA)
        return value

    def scope(self, original):
        value = self.previous.scope(original)
        row = next(row for row in value['units'] if row['unit'] == MAIN)
        row['dropInTemplate'] = self.replace_entry(row['dropInTemplate'])
        row.update(entrypoint=self.entry, entrypointSha256=self.entry_sha)
        return value

    def check_current(self):
        prior = self.previous.check_current()
        if self.installer.installed(self.shared, INSTALL_SHA) != self.correction:
            fail('acknowledged_topic_artifact_changed')
        return {**prior, 'format': FORMAT, 'topicCorrection': {
            'installReceiptSha256': INSTALL_SHA, 'artifactDigest': self.installer.DIGEST,
            'mainApiEntry': self.entry, 'mainApiEntrySha256': self.entry_sha,
            'otherConsumerEntrypointsUnchanged': True}}
