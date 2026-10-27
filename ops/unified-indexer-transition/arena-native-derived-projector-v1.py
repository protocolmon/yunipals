#!/usr/bin/env python3
"""Owned native-derived public projection. Import/default are inert."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import signal
import socket
import stat
import subprocess
import time
import types

FORMAT = 'yunipals-arena-native-derived-projector-owner-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS/'arena-native-derived-projector-v1.py'
BASE = Path('/var/backups/yunipals-arena-native-derived-projector-v1-20261025')
INPUT = Path('/var/backups/yunipals-arena-native-derived-projector-input-v1-20261025/input.json')
PUBLIC = Path('/opt/yunipals-unified/arena-recovery-support/projector-v1-20261025')
MANIFEST = OPS/'arena-native-derived-support-v1.manifest.json'
SOURCE_MANIFEST = OPS/'arena-native-derived-projector-v1.manifest.json'
SOURCE_FORMAT = FORMAT+'-source'
UNIT = 'yunipals-arena-native-derived-projector-v1.service'
SOCKET_UNIT = 'yunipals-arena-native-derived-projector-v1.socket'
SOCKET = PUBLIC/'native-read.sock'
OLD_SCANNER = 'yunipals-arena-public-rollback-v1.service'
NODE = Path('/opt/node-v24.18.1/bin/node')
NODE_SHA = 'f3432a45b03b2da0d270095fdd8813dc34cbea73f5fc8b18c7a384b7cf9b333a'
DEPENDENCIES = Path('/opt/yunipals-unified/releases/264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24/apps/yunipals-market-api/node_modules')
BUILD_SHA = '54c1802082898283d7033ef61dd440cd98da20449162fcb414cbf6477794f4b1'
PROJECTOR_SHA = '8c598c9ae4c6b7b07c2a4ebaf6fc5d2d4ae64c84c5578a2919fee6c579f92a89'
TARGET_HELPER = Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py')
TARGET_HELPER_SHA = 'c0b36e15808e6ec60e0386f8d7535748b56b0964369841321840000eac44acec'
TARGET_RESULT = Path('/var/backups/yunipals-arena-public-rollback-target-v1-20261023/result.json')
TARGET_AUTH = Path('/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023/auth-result.json')
SOURCE_AUTH = Path('/var/backups/yunipals-arena-ypal-current-credentials-v1-20261024/auth-result.json')
SOURCE_ADMISSION = Path('/var/backups/yunipals-arena-ypal-source-completion-v1-20261024/result.json')
SOURCE_ADMISSION_SHA = '620bb80a35dda4852af32e1a8867812133da260c8ac328802bdbd025e7049d97'
SOURCE_PROPOSAL = OPS/'arena-ypal-current-admission-v1.proposal.json'
SOURCE_PROPOSAL_SHA = '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4'
NATIVE_ENV = Path('/etc/yunipals-arena/native-read.env')
WRITER_ENV = Path('/etc/yunipals-arena/public-rollback-writer.env')
READER_ENV = Path('/etc/yunipals-arena/public-rollback-reader.env')
PROGRAMS = {
    'arena-ypal-native-v1.py': 'c539c8d99a2e14eedaa0387dd25fdce044e51f3c68459b95768c60c081f2d22e',
    'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785',
    'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986'
}
SOURCE_PINS = {'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-public-rollback-v1.mjs': 'f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-native-derived-projector-v1.mjs': '8c598c9ae4c6b7b07c2a4ebaf6fc5d2d4ae64c84c5578a2919fee6c579f92a89', 'arena-native-derived-support-build-v1.mjs': '54c1802082898283d7033ef61dd440cd98da20449162fcb414cbf6477794f4b1', 'arena-native-derived-support-install-v1.py': '94ae80f4b5bacdb3ca8f3ef831cd6abbe71f40a77deaa344f4953c63e8826ddf', 'arena-native-derived-support-v1.manifest.json': '19a9a5737c153192c0723aa73c3d3f4e119f2492cb775ac617a63b0b57bbaf5e', 'arena-native-read-pool-v1.mjs': 'f04d85aff78b2baadb8cae93bc98588bd0ed3b69da62c2c7d0b8cca9967e2dfa', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ordinary-latest-complete-build-v1.mjs': '011ba9d3a3769024b8cee3c321aae263c8c0a023c417f286a2a5011693710e88', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.py': 'c539c8d99a2e14eedaa0387dd25fdce044e51f3c68459b95768c60c081f2d22e', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'}
EXTERNAL_PROGRAMS = {'/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py': 'c0b36e15808e6ec60e0386f8d7535748b56b0964369841321840000eac44acec', '/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/credentials.py': '35baf55b6057b8d18769454b12f1383dcbb86309d552fe9418378400e00d6080', '/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/manifest.json': 'a12c720cad1495ab7d45e6834b7fd2acdcfac3553139277ba1e24650c34fb752', '/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/proposal.json': '8c8a15d44cee4d333dd595a372d1bd3aab7bb465c5ff202c1b2f5382cd1a20e1', '/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/roles.sql': 'd6688cc1c06825a943e34219d834eb1c174c3259cc03e31b26d2e510178bcdbe', '/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/schema.sql': 'e816069e282575727e9ff1be28d7fe49323d6b8282e4843268375eec4873ee36'}
CLEAN = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC', 'TSX_DISABLE_CACHE': '1'}


def need(ok, code):
    if not ok: raise RuntimeError(code)
def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
def pin(value): return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None and value != '0'*64


def protected(path, expected=None, maximum=4000000):
    path = Path(path)
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode&0o022, 'protected_derived_projector_input_required')
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size <= maximum and
         all(getattr(before, key) == getattr(after, key) for key in ['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns']) and
         (expected is None or pin(expected) and sha(raw) == expected), 'exact_bounded_derived_projector_input_required')
    return raw


def document(path, expected=None): return json.loads(protected(path, expected))
def load(path, digest):
    raw = protected(path, digest); value = types.ModuleType('derived_'+Path(path).stem.replace('-', '_')); value.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), value.__dict__); return value
def command(args, data=None, timeout=15):
    result = subprocess.run(args, input=data, env=CLEAN, capture_output=True, timeout=timeout)
    need(result.returncode == 0 and not result.stderr and len(result.stdout) <= 8000000, 'bounded_derived_projector_command_required')
    return result.stdout
def sync(path):
    descriptor = os.open(path, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
def save(path, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    descriptor = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as stream:
        os.fchmod(stream.fileno(), mode); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    sync(path.parent); return sha(raw)


def new_directory(path,mode):
    path.mkdir(mode=mode);os.chmod(path,mode);sync(path.parent)


def support_manifest(digest):
    value = document(MANIFEST, digest)
    need(value['format'] == 'yunipals-arena-native-derived-support-artifact-v1' and value['builderSha256'] == BUILD_SHA and
         value['acceptedArenaSourceDigest'] == '264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24' and
         value['acceptedReadinessArtifact'] == 'e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234' and
         value['sourceOrigin'] == 'accepted_native_canonical_event_latest_complete' and value['historicalDepth3ScannerSuccessClaimed'] is False and
         value['officialReducerBodyChanged'] is False and value['privateStatementsSuppressed'] == 2 and value['nodeVersion'] == '24.18.1',
         'actual_accepted_native_derived_support_artifact_required')
    files = {row['path']: row for row in value['files']}
    need(len(files) == len(value['files']) == 3 and set(files) == {'dist/arena-inverse-support.mjs','dist/arena-inverse-support.mjs.map','dist/arena-native-derived-projector-v1.mjs'} and
         all(pin(row['sha256']) and type(row['bytes']) is int and 0 < row['bytes'] < 8000000 for row in files.values()) and
         files['dist/arena-native-derived-projector-v1.mjs']['sha256'] == PROJECTOR_SHA,
         'finite_exact_derived_support_outputs_required')
    target = Path('/opt/yunipals-unified/arena-recovery-support')/value['artifactDigest']
    return value, files, target


def installed(digest):
    manifest, files, target = support_manifest(digest)
    for path in [target, target/'dist']:
        row = path.lstat(); need(stat.S_ISDIR(row.st_mode) and row.st_uid == row.st_gid == 0 and stat.S_IMODE(row.st_mode) == 0o755, 'protected_installed_support_directory_required')
    need({path.name for path in target.iterdir()} == {'manifest.json','dist','node_modules'} and
         {path.name for path in (target/'dist').iterdir()} == {Path(name).name for name in files}, 'finite_installed_support_layout_required')
    protected(target/'manifest.json', digest)
    for name, row in files.items():
        need(len(protected(target/name, row['sha256'], 8000000)) == row['bytes'] and stat.S_IMODE((target/name).stat().st_mode) == 0o644,
             'exact_installed_support_output_required')
    link = target/'node_modules'; row = link.lstat()
    need(stat.S_ISLNK(row.st_mode) and row.st_uid == row.st_gid == 0 and os.readlink(link) == str(DEPENDENCIES) and DEPENDENCIES.is_dir(),
         'same_accepted_Arena_dependency_directory_required')
    protected(NODE, NODE_SHA, 256000000)
    return manifest, files, target


class Owner:
    def __init__(self, input_sha, support_manifest_sha):
        need(pin(input_sha) and pin(support_manifest_sha), 'actual_projector_input_and_support_manifest_refs_required')
        for name,digest in SOURCE_PINS.items():protected(OPS/name,digest)
        for name,digest in EXTERNAL_PROGRAMS.items():protected(Path(name),digest)
        need(SOURCE_PINS[MANIFEST.name]==support_manifest_sha,'actual_fixed_compiled_support_manifest_required')
        self.input_sha, self.manifest_sha = input_sha, support_manifest_sha
        self.config = document(INPUT, input_sha)
        need(type(self.config) is dict and set(self.config) == {'format','support','targetAdmissionSha256','targetAuthSha256','sourceAuthSha256','maximumBlocks','maximumEvents','pollMilliseconds'} and
             self.config['format'] == FORMAT+'-input' and all(pin(self.config[key]) for key in ['targetAdmissionSha256','targetAuthSha256','sourceAuthSha256']) and
             type(self.config['maximumBlocks']) is int and 1 <= self.config['maximumBlocks'] <= 10000000 and
             type(self.config['maximumEvents']) is int and 1 <= self.config['maximumEvents'] <= 10000 and
             type(self.config['pollMilliseconds']) is int and 1000 <= self.config['pollMilliseconds'] <= 30000,
             'finite_actual_native_projector_input_required')
        self.manifest, self.outputs, self.target = installed(support_manifest_sha)
        self.support = {'artifactDigest': self.manifest['artifactDigest'], 'manifestSha256': support_manifest_sha,
                        'facadeSha256': self.outputs['dist/arena-inverse-support.mjs']['sha256']}
        need(self.config['support'] == self.support, 'same_actual_input_and_support_bytes_required')
        self.provision = document(TARGET_RESULT, self.config['targetAdmissionSha256'])
        self.target_auth = document(TARGET_AUTH, self.config['targetAuthSha256'])
        self.source_auth = document(SOURCE_AUTH, self.config['sourceAuthSha256'])
        self.source_admission = document(SOURCE_ADMISSION, SOURCE_ADMISSION_SHA)
        need(self.provision['commitOutcome'] == 'commit_confirmed' and self.target_auth['tcpAuthenticationProven'] is self.target_auth['loginEnabled'] is True and
             self.source_auth['format']=='yunipals-arena-ypal-current-role-auth-v1'and
             self.source_auth['operatorSha256']=='0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f'and
             self.source_auth['tcpAuthenticationProven'] is self.source_auth['loginEnabled'] is True and
             self.source_auth['admissionResultSha256'] == SOURCE_ADMISSION_SHA and
             self.source_auth['sourceRole'] == self.source_admission['sourceRole'] and self.source_auth['sourceRole']['name'] == 'arena_native_reader',
             'actual_target_and_native_role_admission_and_TCP_ACKs_required')
        self.helper = load(TARGET_HELPER, TARGET_HELPER_SHA)
        self.modules = {name: load(OPS/name, digest) for name, digest in PROGRAMS.items()}
        self.catalog_owner = self.modules['arena-ypal-native-v1.py']; source = self.catalog_owner.SOURCE_CONTEXT_VALUE
        self.native = {'releaseId': source['releaseId'], 'schema': source['schema'], 'schemaOid': source['schemaOid'], 'buildId': source['buildId'],
                       'manifestHash': source['manifestHash'], 'sourceId': 'arena:'+source['deployment'], 'contract': source['deployment'].split(':')[1],
                       'startBlock': source['startBlock'], 'abiHash': source['abiHash']}

    def existing_credentials(self, reader=False):
        files = {NATIVE_ENV: self.source_auth['credentialFiles'][str(NATIVE_ENV)],
                 (READER_ENV if reader else WRITER_ENV): self.target_auth['credentialFiles'][str(READER_ENV if reader else WRITER_ENV)]}
        values = {}
        for path, digest in files.items():
            raw = protected(path, digest, 10000); key = 'ARENA_INDEXER_DATABASE_URL=' if path == NATIVE_ENV else 'ARENA_PUBLIC_ROLLBACK_DATABASE_URL='
            rows = raw.decode().strip().splitlines(); need(len(rows) == 1 and rows[0].startswith(key), 'one_exact_existing_projector_credential_required')
            values['sourceUrl' if path == NATIVE_ENV else 'targetUrl'] = rows[0][len(key):]
        return files, values

    def current_catalogs(self):
        quiet=self.quiet_old_projection()
        target = self.helper.validate_target(self.provision, auth_phase='login')
        need(target.get('validated') is True and target.get('databaseWrites') == 0, 'genuine_current_target_admission_required')
        proposal = document(SOURCE_PROPOSAL, SOURCE_PROPOSAL_SHA)['sourceReader']; inventory = self.modules['arena-operational-role-inventory-v1.py']
        edges = [{'role': proposal['role'], 'relation': row['name'], 'privilege': 'SELECT', 'attribute': None} for row in proposal['tables']]
        sql = inventory.catalog_sql([proposal['role']], edges, ['unified_ypal_20261023_v1','yunipals_indexer_control'])
        actual = inventory.connect(None, 5432, 'yunipals_backfill', sql)
        self.catalog_owner.validate_catalog(actual, [proposal['role']], {proposal['role']: self.source_auth['sourceRole']['oid']}, source=True,
            ambient_functions=len(proposal['existingAmbientAuthority']['publicNonDefinerFunctions']))
        identities = {row['name']: row for row in actual['relations']}
        need(all(identities.get(row['name']) == row for row in proposal['tables']), 'same_actual_thirteen_native_source_relations_required')
        data = self.modules['ypal-alchemy-ordinary-consumer-context-v1.py'].query_components()['dataIdentity']
        need(data['schemaOid'] == self.native['schemaOid'] and data['buildId'] == self.native['buildId'] and len(data['nativeTableIdentities']) == 44,
             'same_registered_native44_and_cache_data_required')
        return {'target': target, 'nativeData': data,'sharedPoolCapacity':self.capacity(),'oldProjectionUnit':quiet}

    def quiet_old_projection(self):
        keys=['Id','LoadState','ActiveState','SubState','FragmentPath','DropInPaths','Job']
        raw=command(['/usr/bin/systemctl','show','--all',OLD_SCANNER,*['--property='+key for key in keys]])
        rows=[line.split('=',1)for line in raw.decode().splitlines()]
        need(all(len(row)==2 for row in rows)and len(rows)==len(dict(rows)),'unique_old_projection_unit_frame_required')
        frame=dict(rows)
        need(set(frame)==set(keys)and frame['Id']==OLD_SCANNER and frame['Job']==''and frame['ActiveState']in{'inactive','failed'},
             'old_projection_unit_must_be_genuinely_quiescent')
        if frame['LoadState']=='not-found':
            need(frame['ActiveState']=='inactive'and frame['SubState']=='dead'and frame['FragmentPath']==frame['DropInPaths']=='',
                 'actual_absent_old_projection_unit_manager_frame_required')
            return {'unit':OLD_SCANNER,'managerUnitAbsent':True,'frame':frame,'processFieldsInvented':False}
        need(frame['LoadState']=='loaded','unknown_old_projection_unit_load_state_refused')
        raw=command(['/usr/bin/systemctl','show',OLD_SCANNER,'--property=MainPID','--property=ControlPID'])
        pids=dict(line.split('=',1)for line in raw.decode().splitlines())
        need(pids=={'MainPID':'0','ControlPID':'0'},'actual_old_projection_service_processes_must_be_terminal')
        return {'unit':OLD_SCANNER,'managerUnitAbsent':False,'frame':frame,'processes':pids,'processFieldsInvented':False}

    def capacity(self):
        inventory=self.modules['arena-operational-role-inventory-v1.py']
        names=[self.source_auth['sourceRole']['name'],self.provision['readerRole']['name'],self.provision['writerRole']['name']]
        roles=inventory.literal(json.dumps(names))
        sql="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;WITH activity AS MATERIALIZED(SELECT usename FROM pg_stat_activity)SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only')='on','isolation',current_setting('transaction_isolation'),'maximum',current_setting('max_connections')::int,'reserved',current_setting('superuser_reserved_connections')::int,'used',(SELECT count(*)::int FROM activity),'roles',(SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'oid',r.oid::int,'limit',r.rolconnlimit,'used',(SELECT count(*)::int FROM activity a WHERE a.usename=r.rolname))ORDER BY r.rolname)FROM pg_roles r WHERE r.rolname IN(SELECT jsonb_array_elements_text("+roles+"::jsonb))));ROLLBACK;"
        observed=inventory.connect(None,5432,'yunipals_backfill',sql)
        return capacity_checked(observed,self.source_auth['sourceRole'],self.provision['readerRole'],self.provision['writerRole'])

    def public_config(self):
        files, _ = self.existing_credentials()
        reader_files,_=self.existing_credentials(reader=True)
        return {'format': 'yunipals-arena-native-derived-projector-v1-config', 'native': self.native,
                'sourceRole': self.source_auth['sourceRole'], 'provision': {key:self.provision[key]for key in ['database','writerRole','readerRole','tables']}|
                    {'databaseOid':self.provision['database']['oid']},
                **{key: self.config[key] for key in ['maximumBlocks','maximumEvents','pollMilliseconds']},
                'credentialSha256': {'native.env': files[NATIVE_ENV], 'writer.env': files[WRITER_ENV],'reader.env':reader_files[READER_ENV]},
                'readPoolSocket':str(SOCKET),'readPoolIdentity':self.pool_identity()}

    def pool_identity(self,actor=None):
        result={'format':FORMAT+'-read-pools','producerSha256':sha(protected(FILE)),'inputSha256':self.input_sha,
            'support':self.support,'sourceRole':self.source_auth['sourceRole'],'nativeRelease':self.native,'nativeDatabaseOid':17584,
            'publicReaderRole':self.provision['readerRole'],'publicDatabaseOid':self.provision['database']['oid'],
            'targetAdmissionSha256':self.config['targetAdmissionSha256'],'targetAuthSha256':self.config['targetAuthSha256'],
            'nativePoolMaximum':1,'publicReadPoolMaximum':1,'nativeWorkerPoolMaximum':31,'publicWorkerPoolMaximum':31,
            'sourceRoleLimit':32,'publicRoleLimit':32}
        if actor is not None:result['runtimeEpoch']={key:actor[key]for key in ['pid','startTicks','invocation','bootId']}
        return result

    def socket_definition(self):
        return f'''[Unit]\nDescription=Root-delegated Arena shared read pools\n[Socket]\nListenStream={SOCKET}\nSocketMode=0600\nSocketUser=root\nSocketGroup=root\nRemoveOnStop=yes\nAccept=no\nService={UNIT}\n'''.encode()

    def socket_identity(self,actor=None):
        definition=Path('/etc/systemd/system')/SOCKET_UNIT
        protected(definition,sha(self.socket_definition()))
        row=SOCKET.lstat()
        need(stat.S_ISSOCK(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o600,
             'actual_root0600_shared_read_pool_socket_required')
        actor=self.actor()if actor is None else actor
        link=os.readlink(Path('/proc')/str(actor['pid'])/'fd/3');match=re.fullmatch(r'socket:\[([1-9][0-9]*)\]',link)
        rows=[line.split()for line in Path('/proc/net/unix').read_text().splitlines()[1:]]
        paths=[value for value in rows if len(value)>=8 and ' '.join(value[7:])==str(SOCKET)and value[3]=='00010000']
        need(match is not None and len(paths)==1 and paths[0][6]==match[1]and paths[0][4]=='0001',
             'same_actual_service_inherited_root_listener_kernel_inode_and_path_required')
        return {**{key:getattr(row,key)for key in ['st_dev','st_ino','st_uid','st_gid','st_mode']},'listenerKernelInode':match[1]}

    def connect_pool(self,kind):
        need(kind in {'native','target'},'explicit_shared_read_pool_kind_required')
        before=self.actor();listener=self.socket_identity(before)
        need(sha(protected(PUBLIC/'config.json'))==sha(encoded(self.public_config())),'actual_same_public_pool_configuration_required')
        channel=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        try:
            channel.settimeout(5);channel.connect(str(SOCKET));channel.settimeout(None)
            need(self.actor()==before and self.socket_identity(before)==listener,'shared_read_pool_actor_or_socket_changed_during_root_connection')
            return channel
        except Exception:channel.close();raise

    def definition(self):
        return f'''[Unit]\nDescription=Native canonical-event derived Arena public projection\nStartLimitIntervalSec=infinity\nStartLimitBurst=1\nAfter=network-online.target {SOCKET_UNIT}\nRequires={SOCKET_UNIT}\n[Service]\nType=simple\nDynamicUser=yes\nUser=yunipals-arena-native-derived\nWorkingDirectory=/\nExecStart={NODE} {self.target}/dist/arena-native-derived-projector-v1.mjs --run --public-config {PUBLIC}/config.json\nLoadCredential=native.env:{NATIVE_ENV}\nLoadCredential=writer.env:{WRITER_ENV}\nLoadCredential=reader.env:{READER_ENV}\nEnvironment=NODE_OPTIONS=--max-old-space-size=512\nNoNewPrivileges=yes\nCapabilityBoundingSet=\nAmbientCapabilities=\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nPrivateDevices=yes\nRestrictSUIDSGID=yes\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nIPAddressDeny=any\nIPAddressAllow=localhost\nUMask=0077\nMemoryMax=768M\nTasksMax=32\nRuntimeMaxSec=infinity\nRestart=no\nTimeoutStopSec=30s\nStandardOutput=append:{BASE}/worker.jsonl\nStandardError=append:{BASE}/worker.stderr.private\n[Install]\nWantedBy=multi-user.target\n'''.encode()

    def state(self, unit=UNIT):
        keys = ['Id','LoadState','ActiveState','SubState','MainPID','ControlPID','InvocationID','FragmentPath','DropInPaths','NRestarts','User','DynamicUser','Job',
                'NeedDaemonReload','StartLimitBurst','StartLimitIntervalUSec']
        raw = command(['/usr/bin/systemctl','show','--all',unit,*['--property='+key for key in keys]])
        rows = [line.split('=',1) for line in raw.decode().splitlines()]
        need(all(len(row) == 2 for row in rows) and len(rows) == len(dict(rows)), 'complete_unique_projector_manager_state_required')
        value = dict(rows); need(set(value) == set(keys) and value['Id'] == unit, 'complete_fixed_projector_unit_required'); return value

    def actor(self):
        state = self.state(); need(state['LoadState'] == 'loaded' and state['ActiveState'] == 'active' and state['SubState'] == 'running' and
            state['ControlPID'] == '0' and state['NRestarts'] == '0' and state['Job'] == '' and state['DropInPaths'] == '' and
            state['User'] == 'yunipals-arena-native-derived' and state['DynamicUser'] == 'yes' and re.fullmatch('[a-f0-9]{32}',state['InvocationID']),
            'same_once_started_restricted_projector_epoch_required')
        need(state['NeedDaemonReload']=='no'and state['StartLimitBurst']=='1'and state['StartLimitIntervalUSec']in{'infinity','18446744073709551615'},
             'actual_loaded_once_per_boot_start_limit_required_no_socket_activation_retry')
        protected(Path(state['FragmentPath']), sha(self.definition()))
        root = Path('/proc')/state['MainPID']; status = dict(line.split(':',1) for line in (root/'status').read_text().splitlines() if ':' in line)
        ids = [int(value) for value in status['Uid'].split()]; groups = [int(value) for value in status['Gid'].split()]
        need(len(set(ids)) == len(set(groups)) == 1 and ids[0] > 0 and set(map(int,status['Groups'].split())) <= {groups[0]} and
             status['NoNewPrivs'].strip() == '1' and all(int(status[key],16) == 0 for key in ['CapInh','CapPrm','CapEff','CapBnd','CapAmb']),
             'restricted_dynamic_projector_identity_and_zero_capabilities_required')
        need((root/'cmdline').read_bytes().split(b'\0') == [str(NODE).encode(),str(self.target/'dist/arena-native-derived-projector-v1.mjs').encode(),
             b'--run',b'--public-config',str(PUBLIC/'config.json').encode(),b''] and os.readlink(root/'exe') == str(NODE) and
             (root/'cgroup').read_text().strip() == '0::/system.slice/'+UNIT and
             (Path('/sys/fs/cgroup/system.slice')/UNIT/'cgroup.procs').read_text().split() == [state['MainPID']],
             'one_exact_projector_Node_program_and_cgroup_required')
        raw = (root/'stat').read_text(); ticks = int(raw[raw.rfind(')')+2:].split()[19])
        need(self.state() == state, 'projector_epoch_changed_during_kernel_capture')
        return {'pid': int(state['MainPID']), 'startTicks': ticks, 'invocation': state['InvocationID'], 'uid': ids[0], 'gid': groups[0],
                'unitSha256': sha(self.definition()), 'programSha256': PROJECTOR_SHA,'bootId':Path('/proc/sys/kernel/random/boot_id').read_text().strip()}

    def inspect(self):
        native=self.connect_pool('native');target=self.connect_pool('target')
        config={**self.public_config(),'nativeReadPoolFd':native.fileno(),'publicReadPoolFd':target.fileno(),
                'readPoolIdentity':self.pool_identity(self.actor())}
        descriptor = os.memfd_create('arena-native-derived-config', os.MFD_CLOEXEC|os.MFD_ALLOW_SEALING)
        try:
            os.fchmod(descriptor,0o600); os.write(descriptor,encoded(config)); os.lseek(descriptor,0,0)
            fcntl.fcntl(descriptor,fcntl.F_ADD_SEALS,fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL)
            user = pwd.getpwnam('postgres')
            args = ['/usr/bin/setpriv','--reuid='+str(user.pw_uid),'--regid='+str(user.pw_gid),'--clear-groups','--inh-caps=-all',
                '--ambient-caps=-all','--bounding-set=-all','--no-new-privs',str(NODE),str(self.target/'dist/arena-native-derived-projector-v1.mjs'),'--inspect','--config-fd',str(descriptor)]
            result = subprocess.run(args,env=CLEAN,pass_fds=(descriptor,native.fileno(),target.fileno()),capture_output=True,timeout=120)
            need(result.returncode == 0 and not result.stderr and len(result.stdout) < 8000000, 'actual_readonly_projection_inspection_required')
            rows = result.stdout.splitlines(); need(len(rows) == 1, 'one_actual_projection_inspection_required')
            value = json.loads(rows[0]); need(value['result']['validated'] is True and value['result']['databaseWrites'] == value['result']['providerCalls'] == 0,
                'genuine_zeroRPC_current_native_projection_proof_required'); return value['result']
        finally: os.close(descriptor);native.close();target.close()

    def binding(self, actor, catalogs):
        return {'inputSha256': self.input_sha, 'support': self.support, 'actor': actor,
            'targetAdmissionSha256': self.config['targetAdmissionSha256'], 'targetAuthSha256': self.config['targetAuthSha256'],
            'sourceAdmissionSha256': SOURCE_ADMISSION_SHA, 'sourceAuthSha256': self.config['sourceAuthSha256'],
            'sourceRole': self.source_auth['sourceRole'], 'nativeRelease': self.native, 'target': self.provision,
            'nativeTableIdentities': catalogs['nativeData']['nativeTableIdentities'], 'syncCacheIdentity': catalogs['nativeData']['syncCacheIdentity'],
            'registeredDataSha256': catalogs['nativeData']['registeredDataSha256'], 'targetHelperSha256': TARGET_HELPER_SHA,
            'readPoolIdentity':self.pool_identity(actor),'readPoolSocket':self.socket_identity(),
            'sourceOrigin': 'accepted_native_canonical_event_latest_complete', 'historicalDepth3ScannerSuccessClaimed': False,
            'publicConfigSha256': sha(encoded(self.public_config())), 'nodeSha256': NODE_SHA}


def capacity_checked(value,native,reader,writer):
    need(type(value)is dict and value.get('readOnly')is True and value.get('isolation')=='repeatable read'and
        all(type(value.get(key))is int and value[key]>=0 for key in ['maximum','reserved','used'])and
        type(value.get('roles'))is list and len(value['roles'])==3,'actual_bounded_shared_pool_capacity_observation_required')
    roles={row['name']:row for row in value['roles']}
    need(len(roles)==3 and set(roles)=={native['name'],reader['name'],writer['name']}and
        all(roles[ref['name']]['oid']==ref['oid']and type(roles[ref['name']]['used'])is int and roles[ref['name']]['used']>=0 for ref in [native,reader,writer])and
        roles[native['name']]['limit']==roles[reader['name']]['limit']==32 and roles[writer['name']]['limit']==2,
        'actual_unchanged_native32_public32_writer2_role_limits_required')
    # This is a hard-cap/configuration budget, not an ownership assertion.
    # Bound the ENTIRE observed role populations by their actual hard limits,
    # plus one additional admin probe. Live worker ownership is the Arena
    # parent's separate genuine actor/kernel predicate.
    maxima={native['name']:32,reader['name']:32,writer['name']:2}
    need(all(roles[name]['used']<=maximum for name,maximum in maxima.items()),'unknown_or_excess_shared_pool_role_connections_refused')
    available=value['maximum']-value['reserved']-value['used']+sum(row['used']for row in roles.values())
    need(available>=67,'full_native32_public32_writer2_additional_admin1_global_budget_required')
    return {'format':FORMAT+'-shared-pool-capacity','validated':True,'nativeWorkerMaximum':31,'publicWorkerMaximum':31,
        'nativeSharedOwnerMaximum':1,'publicSharedOwnerMaximum':1,'projectorWriterMaximum':1,'adminProbeMaximum':1,
        'requiredGlobalSlots':67,'globalBudgetForEntireCappedRoleSet':available,'nativeRoleLimit':32,'publicRoleLimit':32,
        'writerRoleHardLimit':2,'liveConnectionOwnershipQualified':False,'allConfiguredPoolsAvailabilityQualified':False,
        'originalNativeCapacityPredicatePassed':False,'observation':value,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def open_read_pool(result_sha,input_sha,support_manifest_sha,kind):
    """Protected immutable ACK/actor connector, with no catalog/current recursion.

    The caller holds the returned socket through its child's lifetime, passes
    its descriptor explicitly, and closes its copy in finally. The child owns
    its inherited duplicate and closes it through the facade pool.end().
    """
    owner=Owner(input_sha,support_manifest_sha);value=document(BASE/'result.json',result_sha);binding=value['binding']
    need(value['format']==FORMAT and value['operatorSha256']==sha(protected(FILE))and value['inputSha256']==input_sha and
        value['support']==owner.support and value['ready']is True and value['bindingSha256']==sha(encoded(binding))and
        binding['actor']==owner.actor()and binding['readPoolSocket']==owner.socket_identity()and
        binding['readPoolIdentity']==owner.pool_identity(binding['actor'])and binding['publicConfigSha256']==sha(encoded(owner.public_config()))and
        binding['inputSha256']==input_sha and binding['support']==owner.support and binding['sourceRole']==owner.source_auth['sourceRole']and
        binding['nativeRelease']==owner.native and binding['target']==owner.provision,
        'actual_immutable_projector_ACK_actor_socket_and_protected_read_pool_identity_required')
    channel=owner.connect_pool(kind)
    return {'socket':channel,'identity':owner.pool_identity(binding['actor']),'bindingSha256':value['bindingSha256']}


def validate_current(result_sha, input_sha, support_manifest_sha):
    owner = Owner(input_sha,support_manifest_sha); receipt = document(BASE/'result.json',result_sha)
    need(receipt['format'] == FORMAT and receipt['operatorSha256'] == sha(protected(FILE)) and receipt['inputSha256'] == input_sha and
         receipt['support'] == owner.support and receipt['ready'] is True, 'actual_own_derived_projector_ACK_required')
    installed(support_manifest_sha); catalogs = owner.current_catalogs(); actor = owner.actor(); observation = owner.inspect()
    need(owner.actor() == actor and receipt['binding'] == owner.binding(actor,catalogs) and receipt['bindingSha256'] == sha(encoded(receipt['binding'])),
         'same_actual_projector_actor_source_target_and_receipt_binding_required')
    need(sha(protected(PUBLIC/'config.json')) == receipt['binding']['publicConfigSha256'], 'same_public_derived_config_required')
    return {'format': FORMAT+'-current', 'validated': True, 'producerSha256': sha(protected(FILE)), 'receiptSha256': result_sha,
        'inputSha256': input_sha, 'support': owner.support, 'binding': receipt['binding'], 'bindingSha256': receipt['bindingSha256'],
        'observation': {**observation,'sharedPoolCapacity':catalogs['sharedPoolCapacity']}, 'sourceActorQualified': False, 'financialAuthorityQualified': False,
        'currentWriterQualified': False, 'historicalDepth3ScannerSuccessClaimed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def start(input_sha, support_manifest_sha, expected):
    owner = Owner(input_sha,support_manifest_sha); review = review_start(owner)
    need(sha(encoded(review)) == expected, 'exact_fresh_derived_projector_start_review_required')
    new_directory(BASE,0o700);new_directory(PUBLIC,0o755)
    save(BASE/'intent.json',review); save(PUBLIC/'config.json',encoded(owner.public_config()),0o644)
    save(BASE/'worker.jsonl',b''); save(BASE/'worker.stderr.private',b'')
    save(Path('/etc/systemd/system')/SOCKET_UNIT,owner.socket_definition(),0o644)
    save(Path('/etc/systemd/system')/UNIT,owner.definition(),0o644)
    command(['/usr/bin/systemctl','daemon-reload']); owner.current_catalogs()
    save(BASE/'start-intent.json',{'reviewHash':expected,'unitSha256':sha(owner.definition()),'monotonicNanoseconds':time.monotonic_ns(),'automaticRetryAllowed':False})
    command(['/usr/bin/systemctl','start',SOCKET_UNIT],timeout=45)
    command(['/usr/bin/systemctl','start',UNIT],timeout=45)
    actor = owner.actor(); save(BASE/'started.json',actor)
    return {'started':True,'currentProjectionStillRequiresActualCapture':True,'serviceActions':3}


def review_start(owner):
    need(not any(os.path.lexists(path) for path in [BASE,PUBLIC,Path('/etc/systemd/system')/UNIT,Path('/etc/systemd/system')/SOCKET_UNIT]), 'fresh_derived_projector_namespace_required')
    owner.quiet_old_projection()
    catalogs=owner.current_catalogs()
    writer=[row for row in catalogs['sharedPoolCapacity']['observation']['roles']if row['name']==owner.provision['writerRole']['name']]
    need(len(writer)==1 and writer[0]['used']==0,'no_preexisting_public_projection_writer_before_owned_start_required')
    return {'format':FORMAT,'operatorSha256':sha(protected(FILE)),'inputSha256':owner.input_sha,'support':owner.support,
        'catalogs':catalogs,'publicConfigSha256':sha(encoded(owner.public_config())),'unitSha256':sha(owner.definition()),'automaticRetryAllowed':False}


def capture(input_sha, support_manifest_sha):
    owner = Owner(input_sha,support_manifest_sha); need(not (BASE/'result.json').exists(), 'one_actual_projector_capture_required')
    actor = owner.actor(); need(document(BASE/'started.json') == actor, 'same_acknowledged_once_started_projector_required')
    catalogs = owner.current_catalogs(); observation = owner.inspect(); need(owner.actor() == actor,'same_projector_around_current_capture_required')
    binding = owner.binding(actor,catalogs)
    result = {'format':FORMAT,'operatorSha256':sha(protected(FILE)),'inputSha256':input_sha,'support':owner.support,'ready':True,
        'binding':binding,'bindingSha256':sha(encoded(binding)),'firstCurrentObservation':observation,'providerCalls':0,'databaseWrites':0}
    return {'receiptSha256':save(BASE/'result.json',result),'currentProjectionQualified':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--input-sha'); parser.add_argument('--support-manifest-sha')
    group=parser.add_mutually_exclusive_group(); group.add_argument('--review-start',action='store_true'); group.add_argument('--start'); group.add_argument('--capture',action='store_true'); group.add_argument('--current')
    args=parser.parse_args()
    if not any(vars(args).values()): print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'providerCalls':0,'serviceActions':0})); return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main','fixed_root_projector_owner_required')
    if args.review_start:
        value=review_start(Owner(args.input_sha,args.support_manifest_sha)); print(json.dumps({'reviewHash':sha(encoded(value)),'review':value},sort_keys=True))
    elif args.start: print(json.dumps(start(args.input_sha,args.support_manifest_sha,args.start),sort_keys=True))
    elif args.capture: print(json.dumps(capture(args.input_sha,args.support_manifest_sha),sort_keys=True))
    elif args.current: print(json.dumps(validate_current(args.current,args.input_sha,args.support_manifest_sha),sort_keys=True))
    else: raise RuntimeError('one_explicit_derived_projector_action_required')


if __name__=='__main__':
    try: main()
    except Exception as error:
        code=str(error); print(json.dumps({'format':FORMAT,'completed':False,'fixedCode':code if type(error)is RuntimeError and re.fullmatch('[A-Za-z0-9_]+',code)else'private_projector_diagnostics_withheld','automaticRetryAllowed':False})); raise SystemExit(1)
