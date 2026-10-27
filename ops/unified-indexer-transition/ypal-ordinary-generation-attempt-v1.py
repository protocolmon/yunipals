#!/usr/bin/env python3
"""New one-shot attempt adopting genuine retained V5c drain/capsule evidence.

Default/import is inert. No drain, capsule creation, boot restoration, original
worker restart, retry, generation publication or source mutation is exposed.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
import types

FORMAT = 'yunipals-ypal-ordinary-generation-attempt-v1'
CANDIDATE_FORMAT = 'yunipals-ypal-ordinary-generation-attempt-candidate-v1'
OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS / 'ypal-ordinary-generation-attempt-v1.py'
BASE = Path('/var/backups/yunipals-ypal-ordinary-generation-attempt-v1-20261025')
INPUT = Path('/var/backups/yunipals-ypal-ordinary-generation-attempt-input-v1-20261025/input.json')
UNIT = 'yunipals-ypal-ordinary-generation-attempt-v1.service'
WORK = Path('/run/yunipals-ypal-ordinary-generation-attempt-v1-20261025')
APP = 'yunipals_ypal_ordinary_generation_attempt_v1_20261025'
LEADER = 'yunipals-leaderboard.service'
BOOT = Path('/etc/systemd/system/multi-user.target.wants') / LEADER
MONITOR = OPS / 'ypal-ordinary-generation-attempt-watch-v1.py'
INSTALLER = OPS / 'ypal-generation-runtime-install-v3.py'
ARTIFACT = 'a39b937dbe2278478ccbecb16af362707e9b8160092488c15e513a28e5a2878a'
ARTIFACT_MANIFEST = '4ec5e6012b38bcad0a20816fd71c6eb54bd8137a4e477a396ce1149812109442'
RETAINED_BASE = Path('/var/backups/yunipals-ypal-ordinary-generation-v5c-20261025')
RETAINED_WORK = Path('/run/yunipals-ypal-ordinary-generation-prepare-v5c-20261025')
RETAINED_UNIT = 'yunipals-ypal-ordinary-generation-prepare-v5c.service'
RETAINED_APP = 'yunipals_ypal_ordinary_generation_v5c_prepare_20261025'
RETAINED_INVOCATION = '0ec51b22c502493aa9c81cbecde084a8'
RETAINED_OPERATION_SHA = '08c4510a38e48a835ba7097234f08a8b07e7f555c0dea6f08b4931f5c8778045'
RETAINED_CAPSULE_SHA = 'c5b485d7c28e650d70644effaa5b84c258d32cfc125bcd87876682c9010b9cdd'
RETAINED_REFERENCE = {
    'operation.json': '08c4510a38e48a835ba7097234f08a8b07e7f555c0dea6f08b4931f5c8778045',
    'drained.json': '1947fe45c0c756647f76bbff6dbef6a5cc00c1bc97498c1d2a75187d9132e894',
    'capsule-result.json': 'c5b485d7c28e650d70644effaa5b84c258d32cfc125bcd87876682c9010b9cdd',
    'yunipals-ypal-ordinary-generation-prepare-v5c.service-started.json': '475a0e66bc9473d3d36657a7e13b3a79a6161f1a26744fe342964fb670b00978'
}
FAILED_REFERENCE = {
    'intent.json': 'f79cd28ffe36a02bdf4076b640f3e80f2f0862eda52939428a4392cfb9e2e612',
    'result.json': 'e4b134e73a1ae2348a3996e85050541d3f6161d72173051a088ab7c39b3f09c4'
}
SOURCE_PINS = {'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-readview-v5-plan.mjs': '91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201', 'ypal-combined-readview-v5.preparation.json': 'd968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-combined-source-manifest-v1.json': 'a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-generation-runtime-install-v3.py': '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-ordinary-generation-attempt-watch-v1.py': '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41', 'ypal-ordinary-generation-candidates-v5.py': '869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-generation-v5c.py': 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da', 'ypal-ordinary-generation-watch-v5c.py': 'f1ebc76c182d4146de7c006fa2dad5567aa8fb6d0dfe16e807648a2792911885', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-publication-query-v2.py': 'deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34'}
KEYS = {'format', 'maximumSeconds', 'metadataInputSha256', 'selectorCandidateSha256',
        'originalInstallSha256', 'installSha256', 'readAdmissionSha256', 'metadataOperationSha256',
        'metadataSelectedSha256', 'metadataProvenanceFile', 'metadataProvenanceSha256'}
RESTORE_PREFIXES = ('original-start-intent.json', 'original-boot-publish-intent.json', 'activation-restored.json')


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(raw): return hashlib.sha256(raw).hexdigest()
def encoded(value): return (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
def pin(value): return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) and value != '0'*64


def protected(path, expected=None, maximum=4000000):
    path = Path(path)
    need(path.is_absolute(), 'absolute_protected_attempt_path_required')
    for part in [*path.parents, path]:
        st = part.lstat()
        need(st.st_uid == 0 and not stat.S_ISLNK(st.st_mode) and not st.st_mode & 0o022,
             'protected_root_owned_attempt_input_required')
    before = path.lstat(); raw = path.read_bytes(); after = path.lstat()
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and len(raw) == before.st_size <= maximum and
         all(getattr(before, key) == getattr(after, key) for key in fields) and
         (expected is None or pin(expected) and sha(raw) == expected), 'exact_bounded_attempt_file_required')
    return raw


def document(path, expected=None): return json.loads(protected(path, expected))


def load(name):
    raw = protected(OPS/name, SOURCE_PINS[name], 200000)
    value = types.ModuleType('attempt_'+name.replace('-', '_')); value.__file__ = str(OPS/name)
    exec(compile(raw, value.__file__, 'exec'), value.__dict__)
    return value


def config_checked(value):
    need(type(value) is dict and set(value) == KEYS and value['format'] == FORMAT+'-input' and
         type(value['maximumSeconds']) is int and 1470 <= value['maximumSeconds'] <= 2400 and
         all(pin(value[key]) for key in KEYS-{'format', 'maximumSeconds', 'metadataProvenanceFile'}) and
         isinstance(value['metadataProvenanceFile'], str) and
         re.fullmatch(r'provenance-(0|[1-9][0-9]*)-observed.json', value['metadataProvenanceFile']) and
         int(value['metadataProvenanceFile'].split('-')[1]) < 128,
         'actual_finite_attempt_input_duration_and_original_plus_new_install_refs_required')
    return value


def prepare_input(install_sha, maximum_seconds):
    """Read-only contract rendering from real retained and installation ACKs."""
    need(pin(install_sha), 'actual_new_V3_installation_ACK_required_before_input')
    old = document(RETAINED_BASE/'operation.json', RETAINED_OPERATION_SHA)
    installer = load(INSTALLER.name)
    installer.installed(installer.shared(), install_sha)
    return config_checked({'format': FORMAT+'-input', 'maximumSeconds': maximum_seconds,
        'metadataInputSha256': old['metadataInputSha256'], 'selectorCandidateSha256': old['candidateSha256'],
        'originalInstallSha256': old['installSha256'], 'installSha256': install_sha,
        'readAdmissionSha256': old['readAdmissionSha256'], 'metadataOperationSha256': old['metadataOperationSha256'],
        'metadataSelectedSha256': old['metadataSelectedSha256'], 'metadataProvenanceFile': old['metadataProvenanceFile'],
        'metadataProvenanceSha256': old['metadataProvenanceSha256']})


def save(path, value, mode=0o600):
    raw = value if isinstance(value, bytes) else encoded(value)
    fd = os.open(path, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode); stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    directory = os.open(Path(path).parent, os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(directory)
    finally: os.close(directory)
    return sha(raw)


def empty_application(h, application):
    need(application in {APP, RETAINED_APP}, 'fixed_actual_attempt_application_only_required')
    need(h.h.query("SELECT count(*)FROM pg_stat_activity WHERE datid=17584 AND usesysid=16388 AND application_name='"+
                   application+"'") == 0, 'actual_generation_application_backends_must_be_empty')


def child_epoch_gone(record):
    need(type(record['pid']) is int and record['pid'] > 1 and type(record['startTicks']) is int and
         record['startTicks'] > 0 and record['processGroup'] == record['pid'], 'exact_owned_child_epoch_required')
    try: raw = (Path('/proc')/str(record['pid'])/'stat').read_text()
    except (FileNotFoundError, ProcessLookupError): return
    need(int(raw[raw.rfind(')')+2:].split()[19]) != record['startTicks'], 'known_owned_child_epoch_still_alive')


def terminal_worker(h, unit, base, work, application, require_result=True):
    need((unit, base, work, application) in {
        (RETAINED_UNIT, RETAINED_BASE, RETAINED_WORK, RETAINED_APP), (UNIT, BASE, WORK, APP)},
        'exact_old_or_new_worker_domain_required')
    start = document(base/(unit+'-start-intent.json'))
    definition = Path('/etc/systemd/system')/unit
    need(h.meta.file_identity(definition) == document(base/(unit+'-file-created.json')) and
         sha(protected(definition)) == start['definitionSha256'], 'same_owned_attempt_unit_inode_and_bytes_required')
    state = h.legacy.state(unit)
    need(state['FragmentPath'] == str(definition) and state['DropInPaths'] == '' and
         state['User'] == state['Group'] == 'root' and state['Restart'] == 'no' and
         state['MainPID'] == state['ControlPID'] == '0' and state['Job'] == '' and
         state['ActiveState'] in {'inactive', 'failed'}, 'actual_owned_one_shot_must_be_terminal')
    group = Path('/sys/fs/cgroup/system.slice')/unit/'cgroup.procs'
    need(not group.exists() or not group.read_text().split(), 'owned_attempt_worker_cgroup_must_be_empty')
    runtime = document(work/'intent.json')
    started_path = base/(unit+'-started.json')
    started = document(started_path) if started_path.exists() else None
    need(runtime['unit'] == unit and runtime['applicationName'] == application and runtime['automaticRetry'] is False and
         state['InvocationID'] == runtime['invocation'] and
         (started is not None or not require_result) and
         (started is None or started['invocation'] == runtime['invocation'] and started['unitSha256'] == start['definitionSha256']) and
         start['publicationAllowed'] is False and
         type(start['monotonicUs']) is int and type(runtime['mainPid']) is int and
         int(state['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'],
         'same_real_worker_invocation_start_boundary_and_no_publication_required')
    if started is not None and 'main' in started:
        need(not h.meta.identity_alive(h.m, started['main']), 'acknowledged_worker_process_epoch_must_be_gone')
    empty_application(h, application)
    if unit == UNIT:
        child = document(work/'child-process.json')
        need(child['artifactDigest'] == ARTIFACT and child['commandSha256'] == sha(encoded(
            h.watch.node_args(APP)+[str(h.watch.ARTIFACT/'dist/generation-prepare.mjs')])),
            'same_actual_new_artifact_child_command_required')
        child_epoch_gone(child)
    result = document(work/'result.json') if require_result else None
    if result is not None: need(result['invocation'] == runtime['invocation'], 'same_worker_result_invocation_required')
    return state, runtime, result


def static_legacy_host(entry, retained, args):
    """Explicit immutable/query subset; never claim the old constructor passed.

    The retained CLI constructor refreshes the original whole READ/source graph.
    That predicate belongs only to forward execution. Reader-owned publication
    can legitimately change it, so these leaves construct authenticated static
    primitives and retain only the actual private/terminal/query method bodies.
    """
    common = entry.common(); execution = common.load_input(args.metadata_input_sha)
    metadata = common.metadata_namespace(execution['candidateReceiptSha256'])
    primitives = common.metadata_primitives(execution['candidateInputSha256'])
    need(primitives.get('sourceAuthorityQualified') is False, 'static_generation_primitives_have_no_current_source_authority')
    host = object.__new__(metadata.Host)
    for key in ['meta', 's', 'h', 'm', 'installer', 'reader', 'source_op', 'source', 'created']:
        setattr(host, key, primitives[key])
    host.read_config = common.read_config(execution['readConfig']); host.admission_pin = args.read_ack
    need(host.admission_pin == host.read_config['admissionSha256'] and
         host.created['readSchema'] == host.meta.READ == common.READ_SCHEMA and
         host.created['readIdentity'] == host.meta.IDENTITY == common.READ_IDENTITY and
         host.created['sourceRelease'] == host.meta.RELEASE,
         'same_real_static_V5_metadata_candidate_identity_and_READ_refs_required')
    host.admission_ref = common.authenticate_admission(host, common.admission_reference(host.read_config))
    host.candidate = common.acknowledge_candidates(execution['candidateInputSha256'], execution['candidateReceiptSha256'])
    def forbidden_refresh(): raise RuntimeError('static_generation_leaf_has_no_current_source_or_whole_READ_authority')
    host.refresh_callback = forbidden_refresh; host.inverse_mode = False
    host.execution_context = {'inputSha256': args.metadata_input_sha, 'sourcesSha256': execution['sourcesSha256']}
    common.execution_context(host, host.execution_context)
    legacy = object.__new__(retained.Host)
    legacy.meta, legacy.h, legacy.s, legacy.m, legacy.args = metadata, host, host.s, host.m, args
    legacy.installer = load('ypal-generation-runtime-install-v2.py')
    legacy.install = legacy.installer.installed(legacy.m, args.install_ack)
    selectors = retained.module(entry.CANDIDATES, entry.CANDIDATES_SHA)
    intent = host.s.document(entry.CANDIDATE_BASE/'intent.json')
    legacy.candidates = host.s.document(entry.CANDIDATE_BASE/'result.json', retained.CANDIDATE_SHA)
    need(legacy.candidates == {**intent, 'staged': True, 'selected': False, 'generationStarted': False, 'cacheStarted': False,
         'guardTransitionExecuted': False, 'databaseWrites': 0, 'servicesChanged': False, 'providerRequests': 0,
         'permissionAdmissionAcknowledged': False} and intent['format'] == selectors.FORMAT and
         intent['operatorSha256'] == entry.CANDIDATES_SHA and intent['candidateInputSha256'] == execution['candidateInputSha256'] and
         intent['readConfig'] == execution['readConfig'] and intent['readIdentity'] == common.READ_IDENTITY and
         intent['readSchema'] == common.READ_SCHEMA and set(intent['files']) == set(selectors.FILES),
         'actual_immutable_unselected_generation_selector_chain_for_static_leaf_required')
    for name, digest in intent['files'].items():
        need(sha(host.s.protected(entry.CANDIDATE_BASE/name)) == digest, 'static_generation_selector_bytes_changed')
    return legacy


class Host:
    def __init__(self, input_sha, current=True):
        need(pin(input_sha), 'actual_attempt_input_SHA_required')
        # The finite historical closure includes one reviewed source over200KB.
        # The larger cap applies only to these exact names+pins, before eval.
        for name, digest in SOURCE_PINS.items(): protected(OPS/name, digest, 4000000)
        self.input_sha = input_sha; self.config = config_checked(document(INPUT, input_sha)); c = self.config
        self.entry = load('ypal-ordinary-generation-v5c.py')
        self.retained = self.entry.namespace(c['metadataInputSha256'], c['selectorCandidateSha256'])
        args = types.SimpleNamespace(metadata_input_sha=c['metadataInputSha256'], install_ack=c['originalInstallSha256'],
            read_ack=c['readAdmissionSha256'], metadata_operation=c['metadataOperationSha256'],
            metadata_selected=c['metadataSelectedSha256'], metadata_provenance=c['metadataProvenanceFile'],
            metadata_provenance_sha=c['metadataProvenanceSha256'], phase=None)
        need(type(current) is bool, 'explicit_generation_current_or_static_constructor_required')
        self.current_authority = current
        self.legacy = self.retained.Host(args) if current else static_legacy_host(self.entry, self.retained, args)
        self.h, self.s, self.m, self.meta = self.legacy.h, self.legacy.s, self.legacy.m, self.legacy.meta
        self.installer = load(INSTALLER.name); self.install = self.installer.installed(self.m, c['installSha256'])
        need(self.installer.DIGEST == self.install['artifactDigest'] == ARTIFACT and
             self.install['manifestSha256'] == ARTIFACT_MANIFEST, 'actual_new_artifact_and_separate_install_ACK_required')
        self.watch = load(MONITOR.name)
        need((self.watch.UNIT, self.watch.WORK, self.watch.APP, self.watch.ARTIFACT.name) == (UNIT, WORK, APP, ARTIFACT),
             'same_actual_attempt_monitor_and_artifact_identity_required')

    def qualify(self):
        need(self.current_authority is True, 'static_generation_leaf_cannot_qualify_current_source_or_dispatch')
        self.legacy.qualify(); self.installer.installed(self.m, self.config['installSha256'])
        need(config_checked(document(INPUT, self.input_sha)) == self.config, 'attempt_input_changed_during_current_source_qualification')

    def manager(self, action):
        need(action in {'daemon-reload', 'start'}, 'only_new_attempt_publication_and_single_start_actions_required')
        result = subprocess.run(['/usr/bin/systemctl', action, *([UNIT] if action == 'start' else [])],
                                capture_output=True, timeout=90, env=self.m.CLEAN, cwd='/')
        need(result.returncode == 0 and not result.stdout and not result.stderr,
             'new_attempt_manager_ACK_unknown_reconcile_without_retry')


def unpublished(h, allowed=None):
    rows = h.h.query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'state',state,'published',published_at IS NOT NULL)ORDER BY id),'[]'::jsonb)FROM metadata_projection.generation WHERE id NOT IN(102,103)AND (state='building'OR(state='ready'AND published_at IS NULL))")
    need(type(rows) is list and (rows == [] if allowed is None else rows == [{'id': allowed, 'state': 'ready', 'published': False}]),
         'no_surviving_other_building_or_unpublished_candidate_required')
    return rows


def retained_current(h, allowed=None, global_checks=True, current_fence=True):
    for name, digest in RETAINED_REFERENCE.items(): document(RETAINED_BASE/name, digest)
    for name, digest in FAILED_REFERENCE.items(): document(RETAINED_WORK/name, digest)
    need(all(not os.path.lexists(RETAINED_BASE/name) for name in RESTORE_PREFIXES),
         'no_retained_generation_restore_or_start_prefix_allowed')
    op = h.retained.operation(h.legacy, RETAINED_OPERATION_SHA)
    h.retained.drained(h.legacy, op)
    drain = document(RETAINED_BASE/'drained.json'); sessions = document(RETAINED_BASE/'drain-sessions.json')
    stop = document(RETAINED_BASE/'stop-old-intent.json')
    need(drain == {'operationSha256': RETAINED_OPERATION_SHA, 'stopped': True} and
         stop['actor'] == sessions['actor'] and stop['actor']['main'] == op['oldActor']['main'] and
         document(RETAINED_BASE/'boot-remove-intent.json') == op['oldBoot'] and
         document(RETAINED_BASE/'boot-remove-result.json') == {'removed': True}, 'same_real_retained_drain_stop_and_boot_records_required')
    # A terminal leaf remains valid after the separately owned reader handover.
    # Its source authority is the original private/drain/boot/capsule chain;
    # prepublication alone requires the original live consumer/global fence.
    current_fence = current_fence and global_checks
    external = h.legacy.external(op) if current_fence else sha(encoded({
        'consumers': op['consumerFence'], 'private': op['oldActor']['writer']['environmentFileHashes']}))
    capsule = document(RETAINED_BASE/'capsule-result.json', RETAINED_CAPSULE_SHA)
    need(capsule == document(RETAINED_BASE/'capsule-prepared.json') and
         document(RETAINED_BASE/'capsule-intent.json') == {'phase': 'capsule',
             'payloadSha256': sha(encoded({'external': external})), 'automaticRetry': False} and
         capsule['externalBinding'] == external and capsule['currentGeneration'] == '103' and
         capsule['previousGeneration'] == '102' and capsule['preservedGenerations'] == ['103', '102'],
         'same_acknowledged_retained_capsule_XID_context_and_preserved_103_102_required')
    h.retained.read_bridge(h.legacy, 'verify-capsule', {'receipt': capsule})
    observation = h.retained.read_only_capsule(h.legacy, capsule) if global_checks else None
    state, runtime, result = terminal_worker(h, RETAINED_UNIT, RETAINED_BASE, RETAINED_WORK, RETAINED_APP)
    old_watch = load('ypal-ordinary-generation-watch-v5c.py')
    need(runtime['invocation'] == RETAINED_INVOCATION and runtime['maximumSeconds'] == 1470 and
         runtime['inputSha256'] == old_watch.protected_inputs() and result['failure'] == 'bounded_generation_duration_reached' and
         result['childExit'] != 0 and result['automaticRetry'] is False and 1470 <= result['elapsedSeconds'] < 1500 and
         result['ownedTermination']['remainingBackends'] == 0 and
         result['ownedTermination']['terminatedBackends'] == [{'pid': 531217, 'terminated': True}],
         'actual_failed_V5c_worker_rollback_and_owned_backend_termination_required')
    if global_checks:
        if current_fence:
            context = h.legacy.context()
            need(context == {**op['context'], 'capsuleSchemaPresent': True} and
                 context['generation']['id'] == '103' and context['generation']['state'] == 'ready' and
                 context['previous'] == '102' and context['ready'] is True,
                 'same_original_103_102_archive_stamps_guard35_and_ready_context_required')
        unpublished(h, allowed)
    return op, capsule, observation


def capacity_preflight(h):
    sizes = h.h.query("SELECT jsonb_build_object('capsule',(pg_total_relation_size('leaderboard.wallet_stats')+pg_total_relation_size('metadata.derived_snapshot')+pg_total_relation_size('metadata_projection.active'))::text,'snapshot',(pg_table_size('metadata.token_metadata')+2*pg_table_size('unified_ypal_20261023_v1.token'))::text,'generation',(pg_total_relation_size('metadata.token_search')+pg_total_relation_size('metadata.token_trait')+pg_total_relation_size('metadata.projection_revision'))::text)")
    need(type(sizes) is dict and set(sizes) == {'capsule', 'snapshot', 'generation'} and
         all(isinstance(value, str) and re.fullmatch('[0-9]+', value) for value in sizes.values()),
         'actual_bounded_generation_capacity_estimates_required')
    estimate = lambda value: (int(value)*3+1)//2
    peak = estimate(sizes['capsule'])+estimate(sizes['snapshot'])+max(8000000000, estimate(sizes['generation']))
    free = h.watch.available()
    need(free >= 30000000000+peak, 'measured_peak_and_unchanged_abort_reserve_required')
    next_backup = h.watch.no_overlap_window(h.config['maximumSeconds'])
    return {'availableBytes': free, 'estimatedPeakBytes': peak, 'minimumReserveBytes': 25000000000,
            'abortFreeBytes': 30000000000, 'maximumSeconds': h.config['maximumSeconds'], 'nextBackupUnix': next_backup}


def capacity_policy(h):
    return {'minimumReserveBytes': 25000000000, 'abortFreeBytes': 30000000000,
            'maximumSeconds': h.config['maximumSeconds'], 'estimateNumerator': 3,
            'estimateDenominator': 2, 'minimumGenerationEstimateBytes': 8000000000,
            'currentMeasurementAndFullBackupWindowRequired': True}


def adoption_review(h):
    need(not os.path.lexists(BASE) and not os.path.lexists(WORK) and
         h.legacy.state(UNIT)['LoadState'] == 'not-found' and
         not os.path.lexists(Path('/etc/systemd/system')/UNIT), 'fresh_new_attempt_journal_worker_and_runtime_required')
    h.qualify(); op, capsule, observation = retained_current(h); capacity = capacity_preflight(h)
    binding = {**op, 'format': FORMAT, 'operatorSha256': sha(protected(Path(__file__).absolute())),
        'inputSha256': h.input_sha, 'installSha256': h.config['installSha256'], 'artifactDigest': ARTIFACT,
        'artifactManifestSha256': ARTIFACT_MANIFEST, 'originalInstallSha256': h.config['originalInstallSha256'],
        'adoptedRetainedLineage': True, 'retainedOperationSha256': RETAINED_OPERATION_SHA,
        'retainedOperationFile': str(RETAINED_BASE/'operation.json'), 'capsuleResultFile': str(RETAINED_BASE/'capsule-result.json'),
        'capsuleResultSha256': RETAINED_CAPSULE_SHA, 'originalBootArchive': str(RETAINED_BASE/'original-boot-link'),
        'maximumSeconds': h.config['maximumSeconds'], 'capacityPolicy': capacity_policy(h), 'originalGlobalObservation': observation,
        'newExecutionFiles': {name: digest for name, digest in SOURCE_PINS.items()},
        'generationStarted': False, 'publicationAllowed': False}
    h.qualify(); retained_current(h)
    return binding


def operation(h, operation_sha):
    op = document(BASE/'operation.json', operation_sha)
    need(op['format'] == FORMAT and op['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         op['inputSha256'] == h.input_sha and op['installSha256'] == h.config['installSha256'] and
         op['artifactDigest'] == ARTIFACT and op['retainedOperationSha256'] == RETAINED_OPERATION_SHA and
         op['capsuleResultFile'] == str(RETAINED_BASE/'capsule-result.json') and
         op['capsuleResultSha256'] == RETAINED_CAPSULE_SHA and op['adoptedRetainedLineage'] is True and
         op['newExecutionFiles'] == SOURCE_PINS, 'same_new_adopted_attempt_operation_and_source_closure_required')
    return op


def unit_bytes(h):
    raw = h.retained.unit_bytes(h.legacy).decode()
    old_monitor = str(h.entry.MONITOR)
    need(raw.count(old_monitor) == 1 and raw.count(h.entry.WORK.name) == 1 and raw.count('RuntimeMaxSec=1500\n') == 1,
         'exact_three_owned_unit_identity_and_duration_seams_required')
    return raw.replace(old_monitor, str(MONITOR)+' --run --input-sha '+h.input_sha).replace(
        h.entry.WORK.name, WORK.name).replace('RuntimeMaxSec=1500\n',
        'RuntimeMaxSec='+str(h.config['maximumSeconds']+30)+'\n').encode()


def build_review(h, op):
    need(not os.path.lexists(BASE/'build-intent.json') and not os.path.lexists(WORK) and
         not os.path.lexists(Path('/etc/systemd/system')/UNIT) and h.legacy.state(UNIT)['LoadState'] == 'not-found',
         'new_attempt_build_unknown_prefix_never_repeated')
    h.qualify(); retained_current(h); capacity = capacity_preflight(h)
    return {'operationSha256': sha(protected(BASE/'operation.json')), 'inputSha256': h.input_sha,
            'definitionSha256': sha(unit_bytes(h)), 'capacityPolicy': capacity_policy(h),
            'retainedOperationSha256': RETAINED_OPERATION_SHA, 'capsuleSha256': RETAINED_CAPSULE_SHA}


def build(h, op, expected):
    review = build_review(h, op)
    need(sha(encoded(review)) == expected, 'fresh_current_attempt_build_review_required')
    save(BASE/'build-intent.json', {**review, 'reviewHash': expected, 'automaticRetry': False})
    capsule = document(RETAINED_BASE/'capsule-result.json', RETAINED_CAPSULE_SHA)
    public = {'PROJECTION_PRESERVE_GENERATION_IDS': ','.join(capsule['preservedGenerations']), 'OFFCHAIN_DB_POOL_MAX': '4',
              'PROJECTION_BACKUP_PEAK_BYTES': '0', 'PROJECTION_MIN_FREE_BYTES': '25000000000', 'PROJECTION_STORAGE_PATH': '/'}
    save(BASE/'generation.public.env', h.m.env_bytes(public))
    path = Path('/etc/systemd/system')/UNIT; definition = unit_bytes(h)
    save(BASE/(UNIT+'-file-intent.json'), {'sha256': sha(definition)})
    save(path, definition, 0o644); save(BASE/(UNIT+'-file-created.json'), h.meta.file_identity(path)); h.manager('daemon-reload')
    h.qualify(); retained_current(h); capacity_preflight(h)
    save(BASE/(UNIT+'-start-intent.json'), {'definitionSha256': sha(definition), 'monotonicUs': time.monotonic_ns()//1000,
         'automaticRetry': False, 'publicationAllowed': False, 'inputSha256': h.input_sha})
    need(h.legacy.state(UNIT)['MainPID'] == '0' and sha(protected(path)) == sha(definition), 'new_worker_changed_after_start_intent')
    h.manager('start'); state = h.legacy.state(UNIT)
    need(state['ActiveState'] == 'active' and re.fullmatch('[a-f0-9]{32}', state['InvocationID']), 'real_new_attempt_invocation_required')
    return save(BASE/(UNIT+'-started.json'), {'invocation': state['InvocationID'], 'main': h.m.process(state['MainPID']),
                                           'unitSha256': sha(definition)})


def successful_worker_evidence(h):
    state, runtime, result = terminal_worker(h, UNIT, BASE, WORK, APP)
    need(result['childExit'] == 0 and result['failure'] is None and result['minimumAvailableBytes'] >= 30000000000 and
         result['inputSha256'] == runtime['inputSha256Ref'] == h.input_sha and result['artifactDigest'] == runtime['artifactDigest'] == ARTIFACT and
         runtime['maximumSeconds'] == h.config['maximumSeconds'] and runtime['inputSha256'] == h.watch.protected_inputs(),
         'actual_successful_new_worker_and_unchanged_inputs_artifact_required')
    rows = [json.loads(line) for line in protected(WORK/'child.stdout.private', maximum=1000000).splitlines() if line.startswith(b'{')]
    need(len(rows) == 1 and rows[0].get('event') == 'native_generation_prepared' and
         rows[0].get('built') is rows[0].get('validated') is rows[0].get('prepared') is True and rows[0].get('published') is False,
         'actual_new_official_successful_unpublished_candidate_output_required')
    candidate = rows[0]; generation_id = candidate['generationId']
    need(isinstance(generation_id, str) and re.fullmatch('[1-9][0-9]{0,18}', generation_id) and generation_id not in {'102', '103'},
         'new_real_generation_identity_required')
    return candidate, runtime, result


def successful_worker(h):
    candidate, runtime, result = successful_worker_evidence(h)
    generation_id = candidate['generationId']
    generation = h.h.query("SELECT to_jsonb(g)||jsonb_build_object('id',g.id::text)FROM metadata_projection.generation g WHERE id="+generation_id)
    need(generation and generation['state'] == 'ready' and generation['published_at'] is None and
         generation['ownership_release_id'] == h.h.meta.RELEASE and generation['ownership_read_identity'] == h.h.meta.IDENTITY and
         generation['validation'] == candidate['validation'] and candidate['predecessor'] == '103' and
         h.h.query("SELECT count(*)FROM metadata_projection.generation WHERE id="+generation_id+
             'AND extract(epoch FROM started_at)>='+str(runtime['startedUnix']-1)) == 1,
         'actual_new_ready_unpublished_row_GEN_validation_and_worker_start_boundary_required')
    snapshot = generation['validation']['sourceSnapshot']
    captured = datetime.datetime.fromisoformat(snapshot['capturedAt'].replace('Z', '+00:00')).timestamp()
    need(snapshot['version'] == 1 and snapshot['releaseId'] == generation['ownership_release_id'] and
         snapshot['readIdentity'] == generation['ownership_read_identity'] and snapshot['physicalSchema'] == 'unified_ypal_20261023_v1' and
         snapshot['metadataReleaseId'] == generation['metadata_release_id'] and snapshot['predecessor'] == '103' and
         runtime['startedUnix']-1 <= captured <= time.time() and isinstance(snapshot['anchors'], list) and snapshot['anchors'] and
         isinstance(snapshot['baseMetadataFrontier'], str) and snapshot['baseMetadataFrontier'],
         'genuine_fresh_worker_source_snapshot_and_GEN_validation_required')
    return candidate, generation, runtime, result


def acceptance_review(h, op):
    h.qualify(); candidate, generation, runtime, result = successful_worker(h)
    _, capsule, observation = retained_current(h, candidate['generationId'])
    return {'operationSha256': sha(protected(BASE/'operation.json')), 'generationId': candidate['generationId'],
            'generationValidationSha256': sha(encoded(generation['validation'])),
            'workerIntentSha256': sha(protected(WORK/'intent.json')), 'workerResultSha256': sha(protected(WORK/'result.json')),
            'stdoutSha256': sha(protected(WORK/'child.stdout.private', maximum=1000000)),
            'capsuleResultSha256': RETAINED_CAPSULE_SHA, 'originalGlobalObservation': observation}


def accept(h, op, expected):
    review = acceptance_review(h, op)
    need(sha(encoded(review)) == expected, 'fresh_exact_new_candidate_acceptance_review_required')
    candidate, generation, runtime, result = successful_worker(h)
    receipt = {key: op[key] for key in ['readAdmissionSha256', 'readConfig', 'metadataInputSha256', 'metadataOperatorSha256',
        'historicalGenerationProducerSha256', 'metadataOperationSha256', 'metadataSelectedSha256', 'metadataProvenanceSha256']}
    receipt.update(format=CANDIDATE_FORMAT, completed=True, built=True, validated=True, published=False,
        operatorSha256=op['operatorSha256'], operationSha256=review['operationSha256'], candidateSelectorsSha256=h.config['selectorCandidateSha256'],
        artifactDigest=ARTIFACT, artifactManifestSha256=ARTIFACT_MANIFEST, installSha256=h.config['installSha256'],
        originalInstallSha256=h.config['originalInstallSha256'], generationId=candidate['generationId'],
        sourceRelease=generation['ownership_release_id'], readIdentity=generation['ownership_read_identity'],
        metadataReleaseId=generation['metadata_release_id'], predecessorGenerationId='103',
        generationValidationSha256=review['generationValidationSha256'], sourceSnapshot=generation['validation']['sourceSnapshot'],
        capsuleResultSha256=RETAINED_CAPSULE_SHA, capsuleResultFile=str(RETAINED_BASE/'capsule-result.json'),
        retainedOperationSha256=RETAINED_OPERATION_SHA, originalGlobalObservation=review['originalGlobalObservation'],
        workerIntentSha256=review['workerIntentSha256'], workerResultSha256=review['workerResultSha256'],
        stdoutSha256=review['stdoutSha256'], sourceReadinessQualified=False, publicationAllowed=False, separateCoordinatedCutoverRequired=True)
    save(BASE/'accept-intent.json', {'reviewHash': expected, 'binding': review, 'automaticRetry': False})
    return save(BASE/'candidate-result.json', receipt)


def reconcile(h, op):
    # Observe only. A failed Node can never be converted into a ready candidate.
    unit = h.legacy.state(UNIT)
    definition = Path('/etc/systemd/system')/UNIT
    start = document(BASE/(UNIT+'-start-intent.json'))
    need(h.meta.file_identity(definition) == document(BASE/(UNIT+'-file-created.json')) and
         sha(protected(definition)) == start['definitionSha256'] and unit['DropInPaths'] == '' and
         unit['FragmentPath'] == str(definition) and unit['User'] == unit['Group'] == 'root' and
         unit['Restart'] == 'no', 'exact_new_unit_definition_before_readonly_reconciliation_required')
    if not (WORK/'intent.json').exists():
        return {'phase': 'unknown-start-prefix', 'automaticRetryAllowed': False, 'candidateAccepted': False,
                'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}
    if unit['MainPID'] != '0':
        intent = document(WORK/'intent.json')
        need(unit['MainPID'] == str(intent['mainPid']) and unit['InvocationID'] == intent['invocation'] and
             int(unit['ExecMainStartTimestampMonotonic']) >= start['monotonicUs'], 'same_live_attempt_only_may_be_reconciled')
        return {'phase': 'running', 'automaticRetryAllowed': False, 'candidateAccepted': False}
    _, runtime, result = terminal_worker(h, UNIT, BASE, WORK, APP, require_result=False)
    result = document(WORK/'result.json') if (WORK/'result.json').exists() else None
    rows = h.h.query("SELECT coalesce(jsonb_agg(jsonb_build_object('id',id::text,'state',state,'published',published_at IS NOT NULL)ORDER BY id),'[]'::jsonb)FROM metadata_projection.generation WHERE id NOT IN(102,103)AND extract(epoch FROM started_at)>="+str(runtime['startedUnix']-1))
    phase = 'unknown-terminal-worker' if result is None else ('failed-worker' if result['failure'] is not None or result['childExit'] != 0 else 'successful-worker-unaccepted')
    return {'phase': phase, 'candidateAccepted': False, 'observedGenerationRowsSha256': sha(encoded(rows)),
            'observedGenerationRows': len(rows), 'automaticRetryAllowed': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def candidate_context(candidate_sha, current=True):
    value = document(BASE/'candidate-result.json', candidate_sha)
    need(value['format'] == CANDIDATE_FORMAT and value['operatorSha256'] == sha(protected(Path(__file__).absolute())) and
         value['completed'] is value['built'] is value['validated'] is True and value['published'] is value['publicationAllowed'] is False and
         value['capsuleResultFile'] == str(RETAINED_BASE/'capsule-result.json') and value['capsuleResultSha256'] == RETAINED_CAPSULE_SHA and
         value['retainedOperationSha256'] == RETAINED_OPERATION_SHA, 'actual_new_attempt_candidate_not_relabelled_old_receipt_required')
    op = document(BASE/'operation.json', value['operationSha256']); h = Host(op['inputSha256'], current=False); operation(h, value['operationSha256'])
    need(value['artifactDigest'] == ARTIFACT and value['installSha256'] == h.config['installSha256'] and
         value['metadataInputSha256'] == h.config['metadataInputSha256'] and value['candidateSelectorsSha256'] == h.config['selectorCandidateSha256'],
         'same_actual_attempt_candidate_source_install_and_input_chain_required')
    for key in ['readAdmissionSha256', 'readConfig', 'metadataInputSha256', 'metadataOperatorSha256',
                'historicalGenerationProducerSha256', 'metadataOperationSha256', 'metadataSelectedSha256', 'metadataProvenanceSha256']:
        need(value[key] == op[key], 'same_candidate_and_new_operation_metadata_read_ancestry_required')
    accepted = document(BASE/'accept-intent.json')
    need(accepted['reviewHash'] == sha(encoded(accepted['binding'])) and
         accepted['binding']['operationSha256'] == value['operationSha256'] and
         all(accepted['binding'][key] == value[key] for key in ['generationId', 'generationValidationSha256',
             'workerIntentSha256', 'workerResultSha256', 'stdoutSha256', 'capsuleResultSha256', 'originalGlobalObservation']) and
         accepted['automaticRetry'] is False, 'actual_owned_candidate_acceptance_review_intent_required')
    if current:
        candidate, generation, runtime, result = successful_worker(h)
    else:
        candidate, runtime, result = successful_worker_evidence(h)
    need(candidate['generationId'] == value['generationId'] and sha(encoded(candidate['validation'])) == value['generationValidationSha256'] and
         candidate['validation']['sourceSnapshot'] == value['sourceSnapshot'] and
         sha(protected(WORK/'intent.json')) == value['workerIntentSha256'] and sha(protected(WORK/'result.json')) == value['workerResultSha256'] and
         sha(protected(WORK/'child.stdout.private', maximum=1000000)) == value['stdoutSha256'], 'actual_candidate_database_validation_and_worker_records_unchanged_required')
    return value, h


def validate_retained_current(candidate_sha):
    value, h = candidate_context(candidate_sha, current=False)
    retained_current(h, value['generationId'], global_checks=False)
    terminal_worker(h, UNIT, BASE, WORK, APP)
    return {'validated': True, 'readOnly': True, 'candidateSha256': candidate_sha, 'operatorSha256': value['operatorSha256'],
        'operationSha256': value['operationSha256'], 'retainedOperationSha256': RETAINED_OPERATION_SHA,
        'capsuleSha256': RETAINED_CAPSULE_SHA, 'capsuleFile': str(RETAINED_BASE/'capsule-result.json'),
        'originalBootArchive': str(RETAINED_BASE/'original-boot-link'), 'legacyTerminal': True,
        'failedWorkerTerminal': True, 'attemptWorkerTerminal': True, 'actualFailedApplicationEmpty': True,
        'actualAttemptApplicationEmpty': True, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def validate_candidate_database_current(candidate_sha):
    value, h = candidate_context(candidate_sha)
    retained_current(h, value['generationId'], current_fence=False)
    return {'format': CANDIDATE_FORMAT, 'validated': True, 'receiptSha256': candidate_sha, 'operatorSha256': value['operatorSha256'],
        'generationId': value['generationId'], 'sourceRelease': value['sourceRelease'], 'readIdentity': value['readIdentity'],
        'predecessorGenerationId': value['predecessorGenerationId'], 'published': False, 'globalContextUnchanged': True,
        'sourceReadinessQualified': False, 'metadataCurrentReadinessQualified': False, 'readAdmissionGraphQualified': False,
        'cacheActorQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def namespace(metadata_input_sha, selector_candidate_sha):
    need(pin(metadata_input_sha) and pin(selector_candidate_sha), 'actual_attempt_metadata_and_selector_refs_required')
    return types.SimpleNamespace(FORMAT=FORMAT, BASE=BASE, UNIT=UNIT, WORK=WORK, APP=APP, LEADER=LEADER, BOOT=BOOT,
        CANDIDATE_FORMAT=CANDIDATE_FORMAT, Host=Host, validate_candidate_database_current=validate_candidate_database_current,
        validate_retained_current=validate_retained_current)


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--input-sha'); parser.add_argument('--operation-sha'); parser.add_argument('--ack')
    parser.add_argument('--prepare-input', action='store_true'); parser.add_argument('--install-sha'); parser.add_argument('--maximum-seconds', type=int)
    parser.add_argument('--phase', choices=['adopt', 'build-review', 'build', 'accept-review', 'accept', 'reconcile'])
    args = parser.parse_args()
    if not any(vars(args).values()):
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'generationStarted': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and __import__('socket').gethostname() == 'yunipals-main', 'fixed_root_attempt_owner_host_required')
    os.umask(0o077)
    if args.prepare_input:
        need(not any([args.input_sha, args.operation_sha, args.ack, args.phase]), 'separate_readonly_actual_input_render_required')
        print(json.dumps(prepare_input(args.install_sha, args.maximum_seconds), sort_keys=True)); return
    need(args.install_sha is None and args.maximum_seconds is None, 'duration_and_installation_belong_in_exact_private_input')
    h = Host(args.input_sha)
    with h.retained.lock():
        if args.phase in {None, 'adopt'}:
            binding = adoption_review(h); review_hash = sha(encoded(binding))
            result = None
            if args.phase == 'adopt':
                need(args.ack == review_hash, 'actual_exact_attempt_adoption_review_required')
                BASE.mkdir(mode=0o700); result = save(BASE/'operation.json', binding)
            output = {'reviewHash': review_hash, 'operationSha256': result, 'generationStarted': False}
        else:
            op = operation(h, args.operation_sha)
            if args.phase == 'build-review': output = {'reviewHash': sha(encoded(build_review(h, op)))}
            elif args.phase == 'build': output = {'resultSha256': build(h, op, args.ack), 'generationStarted': True}
            elif args.phase == 'accept-review': output = {'reviewHash': sha(encoded(acceptance_review(h, op)))}
            elif args.phase == 'accept': output = {'candidateSha256': accept(h, op, args.ack), 'published': False}
            else: output = reconcile(h, op)
        print(json.dumps({'format': FORMAT, **output, 'automaticRetryAllowed': False}, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_attempt_owner_phase_expired_reconcile_only')); signal.alarm(600)
    try: main()
    except Exception as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'private_attempt_diagnostics_withheld', 'automaticRetryAllowed': False})); raise SystemExit(1)
    finally: signal.alarm(0)
