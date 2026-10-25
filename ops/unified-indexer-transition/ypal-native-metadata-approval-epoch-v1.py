#!/usr/bin/env python3
"""Own a new metadata program epoch; preserve original metadata history."""
import ast
import contextlib
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import time
import types

FORMAT='yunipals-native-metadata-approval-epoch-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-native-metadata-approval-epoch-v1.py'
MANIFEST=OPS/'ypal-native-metadata-approval-epoch-v1.manifest.json'
INPUT=Path('/var/backups/yunipals-native-metadata-approval-epoch-input-v1-20261025/input.json')
BASE=Path('/var/backups/yunipals-native-metadata-approval-epoch-v1-20261025')
DROP=Path('/etc/systemd/system/yunipals-metadata.service.d/zzzzzzzzzzzzzzzzzzzzzzzzz-native-approval-v1.conf')
LOCK=Path('/run/lock/yunipals-ypal-combined-transition.lock')
INVERSE_INPUT=Path('/var/backups/yunipals-native-metadata-approval-epoch-inverse-input-v1-20261025/input.json')
INVERSE_READER='ypal-ordinary-reader-continue-v2.py'
PREFIX_SOURCE='ypal-ordinary-consumer-prefix-source-v1.py'
METADATA='ypal-ordinary-metadata-handover-v5.py'
INSTALLER='ypal-native-metadata-approval-install-v1.py'
GUARD='ypal-ordinary-source-authority-v6.py'
SELECTED_SHA='2829182fa96599513f07099118ab0c16b0ceff8d04330537a9c90bd5231e35ba'
INSTALL_SHA='aee652c4789a0a92f5889a0a4a746f73d9ac4e7507352252118c9c257a513e9b'
ARTIFACT='7489372f92886018d06718401fb46dca2f97e840f6ae56b7fa6b19e488de1887'
ARTIFACT_MANIFEST='fc579afc4169b658df1cd3f8faaaba1fa811b0a1db3999c5deba322870712c3b'
WORKER_SHA='dfabd70fb96e21ac5f9fa941308492fbbaf80aa08d7d9527fccf088815a4afb6'
OLD_ARTIFACT='cf333946766e6c858d143612827fc52fd2f860e22af746c56e571513729696cc'
OLD_ARTIFACT_MANIFEST='6f348bf121060215eb889364a233b48a35a8308f10c11b36a4c964a9869cb626'
OLD_WORKER_SHA='5c868742926fb5a56583bc25d87a814ce91c9509728c67df0ab507f8f40adc21'
DATA={'sourceRelease':'0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
    'manifestHash':'0x23d5ca6870ce9828d435b9bf5be2291c775c23703e9ab77047f2970198e9c112',
    'schema':'unified_ypal_20261023_v1','schemaOid':'75963410','buildId':'71e2a7f3b7'}
STEPS={'old-stop','overlay-publish','new-reload','new-start','inverse-stop','inverse-unlink','inverse-reload','inverse-start'}
SOURCE_PINS={'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-ordinary-accept-v1.manifest.json': '8494ce4ba63ca8d0f7be8889ef90ea23395632ac1ca1d032a93d63567cc4f08b', 'arena-ypal-ordinary-accept-v1.py': 'b3dce2f8dbfa26dc219101dd29be866aad1d3944f0db6de9915a838555080295', 'arena-ypal-ordinary-bound-v1.manifest.json': 'bc38a18b86b181624305f0e1d754ee7e6cf3b333368afe1de3daa44a91757dd4', 'arena-ypal-ordinary-bound-v1.py': '1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'final-supervisor-inventory-v1.py': 'ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-readview-v5-plan.mjs': '91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201', 'ypal-combined-readview-v5.preparation.json': 'd968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-combined-source-manifest-v1.json': 'a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-generation-runtime-install-v3.py': '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b', 'ypal-latest-complete-main-api-install-v1.py': '43d98f0aa8993b408133f24a77bdab50663fa79fb77840c7478db369d7e7be9f', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-approval-install-v1.py': '5fa35ac24e6747b06a648504967c1be6b7f52687ee5f9e3295bcd79c2fe3981a', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-old-runtime-inventory-v1.py': '7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-finish-v6.py': 'ec9a88b93543a114138b1198b865ef5b31de2d79ef08a6d014b4e938ca51b4a0', 'ypal-ordinary-cache-peer-v6.py': '4ddd3b021c31e7a2f663df82bb7e3308c22b5b2f1cec5345979286efcff59e04', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-ordinary-downstream-refs-accept-v1.py': '2d2e8b1550332e215564cbeefb12a2fbea42f87ba1d978aab2aa337f212e3ce6', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f', 'ypal-ordinary-feature-context-accept-v1.py': '3ec482f59adafd674116d821abe3ab39db46b1ab21d3ffeeee5892fe390f6984', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-v5.py': 'da2fea0aa36277c1c464ca27ad280b03ba31bfec2730182779ac839638496656', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-accept-v1.manifest.json': '431d59f132898c8302854b78dc6cf4fd44a41504e48ce810b1e8d2f6ffaf3b65', 'ypal-ordinary-feature-handover-accept-v1.py': 'd5d1614372bcbd0008806f5378c6085c56f95d516608493ee9f318b5cc5856b1', 'ypal-ordinary-feature-handover-bound-v1.manifest.json': 'dda74ac69d400d22e6a6cace532a9022e4619cd23643cc9d00b4e9de4c11bb47', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-v5.py': 'cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-feature-inverse-actors-v1.py': '3c47d4f9f17d415d3039e939f297c63a29554480a467dc5603a5331da7e49ce2', 'ypal-ordinary-feature-inverse-call-v1.manifest.json': '44d728e05c4f7a6cd19e400790e102987917c7822b21097eb19f0649d75c6259', 'ypal-ordinary-feature-inverse-call-v1.py': 'dfe03159dc60015e175403da7caecb2c4a51212d2a2e620daeb207118e51ad4e', 'ypal-ordinary-feature-inverse-prefix-v1.py': '3741736fef01c793d8d749d34156cf0891efe380a0b402914a5b2614d1a7ceea', 'ypal-ordinary-feature-inverse-source-v1.manifest.json': 'ab82933b80168ab99862b443d7656efdf4dd2d8030d6f737b2599850ec3ddf81', 'ypal-ordinary-feature-inverse-source-v1.py': 'f19c67fcef83437c7db856a3b45e06ee416cab7268f79e34447c33d59a55febe', 'ypal-ordinary-generation-accept-binding-v1.py': '4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758', 'ypal-ordinary-generation-accept-binding-v2.manifest.json': '0f5bcd31ead0971f6d3fba26f238f8d7eefbc20f39d2db8a51ca9a356f6aac27', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-generation-accept-v1.py': '1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d', 'ypal-ordinary-generation-accept-v2.py': 'b6b6eb8c707290c29fbcd6eedf2e13c6c1d5dcc293a3806b0d6ab76bc9ab49fe', 'ypal-ordinary-generation-accept-v3.py': '29c44cdb1e3614eda39601c0e8bff29233f8a39369f01e5acb47530fc88138e3', 'ypal-ordinary-generation-attempt-v1.py': '6202db1e5124ce81823854ffa09e77410b6495c695b463028bc150bc57b564b3', 'ypal-ordinary-generation-attempt-v2.py': '4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753', 'ypal-ordinary-generation-attempt-watch-v1.py': '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41', 'ypal-ordinary-generation-attempt-watch-v2.py': '47005973bc9ec17cd65f8b3044ef9e4dda438821fd651c289608b0fd2f8a86ae', 'ypal-ordinary-generation-binding-v1.manifest.json': 'a6d4f0b8669eadcc44a1c880e76996f015e645ef9976b79e418e02e26bd1859b', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-generation-candidates-v5.py': '869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca', 'ypal-ordinary-generation-recovery-semantic-v1.mjs': 'ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-generation-terminal-v1.py': '5ac441e3c3b0d3494cd256682f987a60b1d4119d4be6c1db7cb446642bb79613', 'ypal-ordinary-generation-v5c.py': 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da', 'ypal-ordinary-generation-watch-v5c.py': 'f1ebc76c182d4146de7c006fa2dad5567aa8fb6d0dfe16e807648a2792911885', 'ypal-ordinary-managed-handover-accept-v1.manifest.json': '97104caa6f4b9e907e2b46a0f55b5e0eb3e087917f39643ad1e583b0ea2c1e14', 'ypal-ordinary-managed-handover-accept-v1.py': '83f9c88acd2c27b94cfc785595b30baaf2f26d858df772ff5ecc91c72cfcccdc', 'ypal-ordinary-managed-handover-bound-v1.manifest.json': '5a5e76e842aab87e76baaa540afd851961ff71cee0e7a54d2ac77b646f8a27be', 'ypal-ordinary-managed-handover-bound-v1.py': '415746545c901bedea9424e8e2330940d68a77cd303958b9551350de30e1717c', 'ypal-ordinary-managed-handover-v3.py': '8ca8c1c99c32e31c88c23136bc722c7d8d6c4756e9dd947eddb84ed1ded8ecf3', 'ypal-ordinary-managed-parent-phase-v1.py': '317779c460b99873f4408b0e1b4a9c9992a6c2270d33aa66fbec754affc6d16d', 'ypal-ordinary-managed-runtime-v2.py': '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-observer-retained-prefix-v1.py': '451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e', 'ypal-ordinary-publication-accept-v1.py': '06212b568ee5298679633e3dfc30f9e47007c5624ff1a1ff441891f8128c6fcb', 'ypal-ordinary-publication-accept-v2.py': '7c518d97f1c4f425dce8dee8a4ad3f6f06a37454b0346de177c4cd60b32e56d0', 'ypal-ordinary-publication-bound-v1.py': '667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130', 'ypal-ordinary-publication-caller-v6.py': 'c7828062bbc7446ea4b00b7e84394d3ef8ce0aa11efeb88b82fddc3cc7c4345a', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-publication-query-v2.py': 'deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-read-cache-accept-v1.py': 'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-ordinary-read-cache-bound-v1.py': '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f', 'ypal-ordinary-read-cache-v5.py': '387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2', 'ypal-ordinary-read-cache-v6.py': '46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c', 'ypal-ordinary-read-catalog-v5.sql': '8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd', 'ypal-ordinary-reader-accept-v1.py': '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e', 'ypal-ordinary-reader-accept-v2.manifest.json': '688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666', 'ypal-ordinary-reader-accept-v2.py': '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5', 'ypal-ordinary-reader-bound-v1.manifest.json': 'bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095', 'ypal-ordinary-reader-bound-v1.py': '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17', 'ypal-ordinary-reader-cutover-v6.manifest.json': '870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200', 'ypal-ordinary-reader-cutover-v6.py': '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0', 'ypal-ordinary-reader-peer-bound-v1.py': '865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4', 'ypal-ordinary-reader-peer-v6.py': '91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6', 'ypal-ordinary-reader-probe-bound-v1.mjs': '4cf1ae4e07477a2183ec46ef0405d5763a6a81bbe28c953a6a813b7dc88a32fc', 'ypal-ordinary-reader-probe-v6.mjs': '5d9f013eaec45299a0b52418d309a9b35d4d1630618297df3595555b840d4e69', 'ypal-ordinary-reader-proof-v6.py': '0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5', 'ypal-ordinary-reader-sql-bound-v1.mjs': '05e8c0a728a90f6ab432d73f4fb1ce51f685495405591d225e82a083fa86c8d9', 'ypal-ordinary-reader-sql-v6.mjs': 'fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019', 'ypal-ordinary-reader-wire-bound-v1.manifest.json': 'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf', 'ypal-ordinary-reader-wire-v6.manifest.json': 'f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-ordinary-restored-source-prefix-v1.manifest.json': '7c3f276e8561ba5a7e22968ad312c47f7586ad6bc2d348f5a9522b4d7621ae77', 'ypal-ordinary-restored-source-prefix-v1.py': '644d69ea670abca2b19c410aaf5e7d7a22065637f50ea63dde4f79b24d052319', 'ypal-ordinary-source-authority-v5.py': '052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0', 'ypal-ordinary-source-authority-v6.manifest.json': '80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452', 'ypal-ordinary-source-authority-v6.py': '36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3'}


def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64
def own_sha():return sha(Path(__file__).read_bytes())


def protected(path,digest=None):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_native_metadata_epoch_file_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=4000000 and
        all(getattr(before,key)==getattr(after,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_mtime_ns','st_ctime_ns'])and
        (digest is None or pin(digest)and sha(raw)==digest),'same_actual_native_metadata_epoch_bytes_required')
    return raw


def authenticate():
    expected={'format':FORMAT+'-source','files':{FILE.name:own_sha(),**SOURCE_PINS}}
    need(json.loads(protected(MANIFEST,sha(encoded(expected))))==expected,'complete_actual_native_metadata_epoch_source_manifest_required')
    for name,digest in expected['files'].items():protected(OPS/name,digest)
    return expected


def module(name):
    raw=protected(OPS/name,SOURCE_PINS[name]);value=types.ModuleType('metadata_epoch_'+Path(name).stem);value.__file__=str(OPS/name)
    exec(compile(raw,str(OPS/name),'exec'),value.__dict__);return value


def external_module(name,refs,source_format,literal=False):
    need(name in{INVERSE_READER,PREFIX_SOURCE}and pin(refs['producerSha256'])and pin(refs['manifestSha256']),
        'fixed_finite_inverse_catalog_or_owned_source_route_required')
    manifest=json.loads(protected(OPS/(Path(name).stem+'.manifest.json'),refs['manifestSha256']))
    need(manifest['format']==source_format and type(manifest['files'])is dict and
        manifest['files'].get(name)==refs['producerSha256'],'actual_inverse_route_manifest_producer_required')
    files={**manifest.get('dependencies',{}),**manifest['files']}
    need(all(k not in manifest['files']or manifest['files'][k]==v for k,v in manifest.get('dependencies',{}).items())and
        1<=len(files)<=512 and all(type(k)is str and re.fullmatch('[A-Za-z0-9_.-]+',k)and pin(v)for k,v in files.items()),
        'bounded_protected_inverse_source_closure_required')
    if literal:
        raw=protected(OPS/name,refs['producerSha256']);tree=ast.parse(raw)
        values=[node.value for node in tree.body if isinstance(node,ast.Assign)and
            any(isinstance(t,ast.Name)and t.id=='SOURCE_PINS'for t in node.targets)]
        need(len(values)==1 and manifest=={'format':source_format,'files':{name:refs['producerSha256'],**ast.literal_eval(values[0])}},
            'exact_literal_owned_prefix_source_closure_required')
    else:
        need(manifest['acknowledgementRoute']=={'file':name,'method':'acknowledgement','sha256':refs['producerSha256']},
            'actual_new_reader_immutable_acknowledgement_route_required')
    for filename,digest in files.items():protected(OPS/filename,digest)
    raw=protected(OPS/name,refs['producerSha256']);value=types.ModuleType('epoch_inverse_'+Path(name).stem);value.__file__=str(OPS/name)
    exec(compile(raw,str(OPS/name),'exec'),value.__dict__);return value


def inverse_configuration(value):
    need(type(value)is dict and set(value)=={'format','source','catalog'}and value['format']==FORMAT+'-inverse-input',
        'explicit_protected_inverse_source_and_catalog_input_required')
    source=value['source'];catalog=value['catalog']
    need(type(source)is dict and set(source)=={'mode','inputSha256','producerSha256','manifestSha256'}and
        source['mode']in{'ordinary','owned-prefix'}and all(pin(source[k])for k in source if k!='mode')and
        type(catalog)is dict and set(catalog)=={'resultSha256','producerSha256','manifestSha256'}and all(pin(v)for v in catalog.values()),
        'actual_inverse_source_and_new_reader_immutable_refs_required')
    if source['mode']=='ordinary':need(source['producerSha256']==SOURCE_PINS[GUARD]and
        source['manifestSha256']==SOURCE_PINS['ypal-ordinary-source-authority-v6.manifest.json'],
        'ordinary_inverse_source_must_be_actual_guard6_not_old_standalone_alias')
    return copy.deepcopy(value)


def configuration(value):
    keys={'format','metadataInputSha256','metadataOperationSha256','metadataSelectedSha256','newInstallSha256'}
    need(type(value)is dict and set(value)==keys and value['format']==FORMAT+'-input'and
        all(pin(value[key])for key in keys-{'format'})and value['metadataSelectedSha256']==SELECTED_SHA and value['newInstallSha256']==INSTALL_SHA,
        'actual_metadata_input_operation_historical_selected_and_new_install_refs_required')
    return copy.deepcopy(value)


def history(config):
    common=module('ypal-ordinary-consumer-handover-v5.py')
    protected(common.META_INPUT,config['metadataInputSha256'])
    operation=json.loads(protected(common.META_BASE/'operation.json',config['metadataOperationSha256']))
    selected=json.loads(protected(common.META_BASE/'selected.json',config['metadataSelectedSha256']))
    need(selected['selected']is True and selected['boot']==operation['oldBoot'],
        'actual_immutable_original_metadata_selected_and_operation_required')
    return operation,selected


def render_input():
    authenticate();common=module('ypal-ordinary-consumer-handover-v5.py')
    return configuration({'format':FORMAT+'-input','metadataInputSha256':sha(protected(common.META_INPUT)),
        'metadataOperationSha256':sha(protected(common.META_BASE/'operation.json')),
        'metadataSelectedSha256':sha(protected(common.META_BASE/'selected.json')),
        'newInstallSha256':sha(protected(module(INSTALLER).BASE/'result.json'))})


def strip_refresh(fn,source,scope,name,owner=None):
    tree=ast.parse(source)
    candidates=[node for node in ast.walk(tree)if isinstance(node,ast.FunctionDef)and node.name==name]
    need(len(candidates)==1,'one_actual_metadata_actor_static_function_required');node=copy.deepcopy(candidates[0]);count=0
    for parent in ast.walk(node):
        for field,rows in ast.iter_fields(parent):
            if not isinstance(rows,list):continue
            kept=[]
            for row in rows:
                if isinstance(row,ast.Expr)and isinstance(row.value,ast.Call)and ast.unparse(row.value)in{'host.refresh()','h.refresh()'}:count+=1
                else:kept.append(row)
            setattr(parent,field,kept)
    need(count==1,'only_one_eager_actor_only_refresh_removed_per_function')
    values={**scope,**({'owner':owner}if owner is not None else{})}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),str(FILE),'exec'),values)
    return values[name]


def actor_function(meta):
    source=protected(OPS/'ypal-restored-metadata-handover-v1.py',SOURCE_PINS['ypal-restored-metadata-handover-v1.py'])
    cls=next(node for node in ast.parse(source).body if isinstance(node,ast.ClassDef)and node.name=='Host')
    fn=copy.deepcopy(next(node for node in cls.body if isinstance(node,ast.FunctionDef)and node.name=='actor'));changed=0
    for node in ast.walk(fn):
        if isinstance(node,ast.Assign)and len(node.targets)==1 and ast.unparse(node.targets[0])=='expected_files':
            node.value=ast.Dict(keys=[None,ast.parse('str(epoch_drop)',mode='eval').body],values=[node.value,ast.Name(id='epoch_drop_sha',ctx=ast.Load())]);changed+=1
    need(changed==1,'one_exact_owned_ExecStart_overlay_actor_definition_seam_required')
    scope={**meta.Host.actor.__globals__,'epoch_drop':DROP,'epoch_drop_sha':sha(drop_bytes())}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FILE),'exec'),scope);return scope['actor']


def drop_bytes():
    return('[Service]\nExecStart=\nExecStart=/opt/node-v24.18.1/bin/node /opt/yunipals-unified/nonmarket-consumer-releases/'+ARTIFACT+'/dist/metadata-worker.mjs\n').encode()


def document(name,digest=None):return json.loads(protected(BASE/name,digest))
def write(name,value):
    raw=encoded(value);fd=os.open(BASE/name,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    sync(BASE);return sha(raw)
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)
def inode(path):
    row=path.lstat();return{key:getattr(row,key)for key in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink']}


class Context:
    def __init__(self,input_sha,refresh_callback=None,inverse_input_sha=None):
        authenticate();self.input_sha=input_sha;self.config=configuration(json.loads(protected(INPUT,input_sha)));self.lease=None;self.source=None;self.active_step=None
        self.inverse_input_sha=inverse_input_sha;self.inverse_config=inverse_configuration(json.loads(protected(INVERSE_INPUT,inverse_input_sha)))if inverse_input_sha is not None else None
        self.entry=module(METADATA);self.common=self.entry.common();self.execution=self.common.load_input(self.config['metadataInputSha256'])
        self.meta=self.entry.namespace(self.config['metadataInputSha256']);parts=self.common.metadata_primitives(self.execution['candidateInputSha256'])
        raw=protected(OPS/'ypal-ordinary-consumer-handover-v5.py',SOURCE_PINS['ypal-ordinary-consumer-handover-v5.py'])
        initialize=strip_refresh(self.common.initialize_metadata,raw,self.common.__dict__,'initialize_metadata')
        self.host=self.meta.Host.__new__(self.meta.Host)
        def unavailable():raise RuntimeError('actor_only_metadata_epoch_has_no_whole_READ_or_source_callback')
        initialize(self.meta,self.host,self.execution['readConfig'],refresh_callback or unavailable,True,parts,self.common.admission_reference(self.execution['readConfig']))
        self.host.execution_context={'inputSha256':self.config['metadataInputSha256'],'sourcesSha256':self.execution['sourcesSha256']}
        original=protected(OPS/'ypal-restored-metadata-handover-v1.py',SOURCE_PINS['ypal-restored-metadata-handover-v1.py'])
        get_operation=strip_refresh(self.meta.operation,original,self.meta.__dict__,'operation')
        self.operation=get_operation(self.host,self.config['metadataOperationSha256'])
        self.selected=self.host.s.document(self.meta.BASE/'selected.json',self.config['metadataSelectedSha256'])
        need(self.selected['selected']is True and self.meta.link(self.meta.BOOT)==self.selected['boot']==self.operation['oldBoot'],
            'same_real_historical_metadata_selected_and_live_original_boot_inode_required')
        self.installer=module(INSTALLER);self.install=self.installer.installed(self.host.m,self.config['newInstallSha256'])
        need(self.install['artifactDigest']==ARTIFACT and sha(protected(self.installer.TARGET/'dist/metadata-worker.mjs'))==WORKER_SHA,
            'actual_installed_native_approval_worker_program_required')
        self.terminal_actor=strip_refresh(self.host.terminal,raw,self.common.__dict__,'terminal',self.meta)

    def inputs(self):
        authenticate();need(configuration(json.loads(protected(INPUT,self.input_sha)))==self.config and
            self.host.s.document(self.meta.BASE/'selected.json',SELECTED_SHA)==self.selected and
            sha(protected(self.meta.BASE/'operation.json'))==self.config['metadataOperationSha256'] and
            self.common.load_input(self.config['metadataInputSha256'])==self.execution,
            'metadata_epoch_input_original_operation_or_selected_history_changed')
        self.installer.installed(self.host.m,self.config['newInstallSha256']);self.host.private(self.operation['oldWriter'])
        need(self.meta.link(self.meta.BOOT)==self.selected['boot'],'original_metadata_boot_inode_changed')

    def actor(self,new):
        h=self.host
        if new:
            need(inode(DROP)==document('overlay-created.json')['identity']and protected(DROP)==drop_bytes(),
                'same_actual_owned_new_metadata_ExecStart_overlay_inode_required')
            h=copy.copy(h);h.installer=self.installer;value=actor_function(self.meta)(h,self.operation,True,False)
        else:
            need(not os.path.lexists(DROP),'original_metadata_program_requires_owned_overlay_absence')
            value=h.actor(self.operation,True,pristine=False)
        if (BASE/'operation.json').exists():
            baseline=document('operation.json')['reviewBinding']['state']
            fields=['Id','User','Group','FragmentPath','EnvironmentFiles','WorkingDirectory','Restart','UnitFileState',
                'WantedBy','RequiredBy','TriggeredBy','Triggers','PartOf','UpheldBy','KillMode']
            need(all(value['unit'][key]==baseline[key]for key in fields),
                'metadata_epoch_preserves_exact_loaded_private_order_boot_and_service_policy')
        return value

    def current_old(self):
        actor=self.actor(False)
        if actor!=self.selected['nativeActor']:
            start=self.host.s.document(self.meta.BASE/'native-start-intent.json')
            need(int(actor['unit']['NRestarts'])>0 and start['bootId']==self.host.s.boot()and
                int(actor['unit']['ExecMainStartTimestampMonotonic'])>=start['monotonicUs']and
                not any(self.meta.identity_alive(self.host.m,p)for p in self.selected['nativeActor']['processes']),
                'only_actual_owned_historical_metadata_auto_restart_before_upgrade')
        return actor

    def read_operation(self):
        value=document('operation.json');need(value['format']==FORMAT and value['operatorSha256']==own_sha()and
            value['inputSha256']==self.input_sha and value['bootId']==self.host.s.boot()and value['config']==self.config and
            value['historicalActor']==self.selected['nativeActor']and value['historicalBoot']==self.selected['boot']and
            value['reviewHash']==sha(encoded(value['reviewBinding']))and value['reviewBinding']['config']==self.config and
            value['reviewBinding']['boot']==value['historicalBoot'], 'same_actual_owned_metadata_epoch_operation_required')
        self.inputs();return value

    def full_source(self):
        if self.inverse_config is not None:return self.inverse_source()
        if self.source is None:
            guard=module(GUARD);refs=self.execution['ordinaryRuntime'];self.source=guard.Authority(refs['resultSha256'],refs['inputSha256'],self.execution['readConfig']);self.source.preflight()
        return self.source.metadata_refresh()

    def inverse_source(self):
        need(inverse_configuration(json.loads(protected(INVERSE_INPUT,self.inverse_input_sha)))==self.inverse_config,
            'same_actual_inverse_source_catalog_input_required')
        config=self.inverse_config;reader=external_module(INVERSE_READER,config['catalog'],
            'yunipals-ypal-ordinary-reader-continue-v2-source')
        first=reader.lifecycle_inverse_catalog(config['catalog']);read=self.execution['readConfig']
        def check_catalog(value):
            need(value['validated']is True and value['catalogOnly']is True and value['sourceActorQualified']is False and
                value['originalWholeValidatorPassed']is False and
                all(value[key]==read[target]for key,target in [('readAdmissionSha256','admissionSha256'),
                    ('readPlanSha256','readPlanSha256'),('readContextInputSha256','readContextInputSha256')])and
                value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
                'genuine_actual_reader_full_current_catalog_only_proof_required')
        check_catalog(first);refs=config['source']
        if refs['mode']=='ordinary':
            need(refs['inputSha256']==self.execution['ordinaryRuntime']['inputSha256'],
                'same_immutable_original_ordinary_source_ancestry_required')
            if self.source is None:
                guard=module(GUARD);old=self.execution['ordinaryRuntime'];self.source=guard.Authority(old['resultSha256'],old['inputSha256']);self.source.preflight()
            source=self.source.current()
            need(source['sourceActorQualified']is source['currentWriterQualified']is True and source['originalWholeValidatorPassed']is False,
                'full_current_ready_original_source_guard6_required')
        else:
            route=external_module(PREFIX_SOURCE,refs,'yunipals-ordinary-consumer-prefix-source-v1-source',True)
            source=route.validate_current_source(refs['inputSha256'])
            need(source['validated']is source['sourceOnlyCurrent']is source['sourceActorQualified']is source['currentWriterQualified']is True and
                source['operatorSha256']==refs['producerSha256']and source['inputSha256']==refs['inputSha256']and
                source['ordinaryRuntimeAncestry']==self.execution['ordinaryRuntime']and source['frameworkReady']is True and
                source['financialAuthorityQualified']is source['originalWholeStablePassed']is source['oldStandaloneSuccessClaimed']is False and
                all(str(source[key])==value for key,value in DATA.items())and
                source['databaseWrites']==source['serviceActions']==source['providerCalls']==0,
                'actual_full_owned_prefix_ready_SOURCE_proof_without_old_whole_success_required')
        after=reader.lifecycle_inverse_catalog(config['catalog']);check_catalog(after)
        need(first==after and inverse_configuration(json.loads(protected(INVERSE_INPUT,self.inverse_input_sha)))==config,
            'full_inverse_catalog_or_source_input_changed_during_source_capture')
        external_module(INVERSE_READER,config['catalog'],'yunipals-ypal-ordinary-reader-continue-v2-source')
        return{'format':FORMAT+'-inverse-source','validated':True,'inverseInputSha256':self.inverse_input_sha,
            'sourceBinding':source,'catalogBinding':first,'oldWholeREADValidatorPassed':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}

    def fence(self):
        need(self.lease is not None,'metadata_epoch_effects_require_live_original_transition_lock')
        row=os.fstat(self.lease);now=LOCK.lstat();need((row.st_dev,row.st_ino)==(now.st_dev,now.st_ino)and
            stat.S_ISREG(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o600,'same_owned_metadata_epoch_transition_lock_required')
        fcntl.flock(self.lease,fcntl.LOCK_EX|fcntl.LOCK_NB);self.inputs();self.full_source()

    def step(self,name,action):
        self.fence();self.read_operation();need(name in STEPS and not(BASE/(name+'-intent.json')).exists()and not(BASE/(name+'-result.json')).exists(),
            'unknown_metadata_epoch_effect_requires_explicit_readonly_reconciliation')
        intent={'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':self.input_sha,'bootId':self.host.s.boot(),
            'operationSha256':sha(protected(BASE/'operation.json')),'name':name,'monotonicUs':time.monotonic_ns()//1000}
        digest=write(name+'-intent.json',intent);self.fence();self.active_step=(name,digest)
        try:value=action(intent)
        finally:self.active_step=None
        write(name+'-result.json',value);self.fence();return value

    def manager(self,action,expected_actor=None,expected_sessions=None):
        need(action in{'start','stop','daemon-reload'},'only_fixed_metadata_unit_actions_allowed');self.fence()
        expected={'start':{'new-start','inverse-start'},'stop':{'old-stop','inverse-stop'},'daemon-reload':{'new-reload','inverse-reload'}}
        need(self.active_step is not None and self.active_step[0]in expected[action],
            'metadata_manager_action_requires_current_owned_exact_phase_intent')
        name,digest=self.active_step;intent=document(name+'-intent.json',digest)
        need(intent['name']==name and intent['format']==FORMAT and intent['operatorSha256']==own_sha()and
            intent['inputSha256']==self.input_sha and intent['bootId']==self.host.s.boot()and
            intent['operationSha256']==sha(protected(BASE/'operation.json')),
            'metadata_manager_action_requires_same_actual_owned_operation_and_phase_intent')
        if action=='stop':
            need(expected_actor is not None and expected_sessions is not None,'stop_requires_exact_selected_metadata_actor_and_sessions')
            new=os.path.lexists(DROP);actor=self.actor(new);sessions=self.host.sessions(actor)
            need(actor==expected_actor and bool(sessions['owned'])and self.actor(new)==expected_actor,
                'same_selected_metadata_actor_and_backend_epochs_immediately_before_stop_required')
            capture='inverse-stop-capture.json'if new else'old-stop-capture.json'
            write(capture,{'actor':actor,'sessions':sessions,'priorSessions':expected_sessions,
                'operationSha256':sha(protected(BASE/'operation.json')),'bootId':self.host.s.boot()})
            need(self.actor(new)==expected_actor,'selected_metadata_epoch_changed_before_actual_stop')
        if action=='start':
            value=self.meta.state(self.host.m)
            need(value['MainPID']==value['ControlPID']=='0'and value['Job']==''and value['ActiveState']in{'inactive','failed'},
                'terminal_metadata_unit_immediately_before_owned_start_required')
        self.meta.manager(self.host.m,action)
        return sessions if action=='stop'else None

    def review(self):
        self.inputs();need(not os.path.lexists(BASE)and not os.path.lexists(DROP)and
            not(self.meta.BASE/'inverse-intent.json').exists(),'fresh_metadata_program_upgrade_before_original_inverse_required')
        source=self.full_source();actor=self.current_old();sessions=self.host.sessions(actor);db=self.host.database()
        need(bool(sessions['owned'])and db['scan']['ingestion_mode']=='native','actual_current_native_metadata_and_positive_kernel_sessions_required')
        need(self.current_old()==actor and self.full_source()==source,'metadata_or_source_changed_during_upgrade_review')
        return{'config':self.config,'actor':actor,'sessions':sessions,'state':self.meta.state(self.host.m),
            'boot':self.selected['boot'],'scan':self.meta.stable_scan(db['scan']),'source':source,'overlaySha256':sha(drop_bytes())}

    def stop(self,actor,sessions):
        current=self.manager('stop',actor,sessions)
        self.terminal_actor(self.host,self.operation,actor,current);self.terminal_actor(self.host,self.operation,actor,sessions)
        return{'terminal':True,'actor':actor,'sessions':current,'priorSessions':sessions}

    def start(self,intent,new,old_actor):
        before=self.meta.state(self.host.m);need(before['MainPID']=='0','metadata_must_be_terminal_before_owned_new_start')
        self.manager('start');actor=self.actor(new)
        self.check_start(intent,actor,new,old_actor)
        sessions=self.host.sessions(actor);need(bool(sessions['owned']),'positive_new_metadata_kernel_backend_ownership_required')
        return{'actor':actor,'boot':self.meta.link(self.meta.BOOT),'sessions':sessions,'newProgram':new}

    def check_start(self,intent,actor,new,old_actor):
        name='new-start'if new else'inverse-start'
        need(intent['format']==FORMAT and intent['operatorSha256']==own_sha()and intent['inputSha256']==self.input_sha and
            intent['bootId']==self.host.s.boot()and intent['name']==name and
            intent['operationSha256']==sha(protected(BASE/'operation.json'))and type(intent['monotonicUs'])is int and
            0<intent['monotonicUs']<=int(actor['unit']['ExecMainStartTimestampMonotonic'])and
            actor['unit']['NRestarts']=='0'and actor['unit']['InvocationID']!=old_actor['unit']['InvocationID']and
            not any(self.meta.identity_alive(self.host.m,p)for p in old_actor['processes'])and
            not any(self.meta.identity_alive(self.host.m,p)for p in self.selected['nativeActor']['processes']),
            'actual_owned_intent_new_epoch_and_prior_metadata_epochs_terminal_required')

    def inspect_start(self,inverse=False):
        op=self.read_operation();name='inverse-start'if inverse else'new-start';intent=document(name+'-intent.json')
        old=document('result.json')['actor']if inverse else op['reviewBinding']['actor']
        required=['old-stop','overlay-publish','new-reload']if not inverse else['inverse-stop','inverse-unlink','inverse-reload']
        for step in required:
            proof=document(step+'-intent.json');document(step+'-result.json')
            need(proof['format']==FORMAT and proof['operatorSha256']==own_sha()and proof['inputSha256']==self.input_sha and
                proof['operationSha256']==sha(protected(BASE/'operation.json'))and proof['bootId']==self.host.s.boot()and
                proof['name']==step and proof['monotonicUs']<=intent['monotonicUs'],
                'all_owned_metadata_start_predecessor_steps_required')
        if inverse:
            inv=document('inverse-intent.json');need(inv['upgradeResultSha256']==sha(protected(BASE/'result.json'))and
                inv['actor']==old,'actual_owned_upgrade_ACK_before_inverse_start_required')
        actor=self.actor(not inverse);self.check_start(intent,actor,not inverse,old)
        sessions=self.host.sessions(actor);need(bool(sessions['owned']),'positive_existing_owned_metadata_start_sessions_required')
        need(self.meta.stable_scan(self.host.database()['scan'])==op['reviewBinding']['scan']and
            self.actor(not inverse)==actor,'existing_owned_metadata_start_and_legacy_scan_changed_during_inspection')
        self.inputs();self.check_start(document(name+'-intent.json'),actor,not inverse,old)
        value={'actor':actor,'boot':self.meta.link(self.meta.BOOT),'sessions':sessions,'newProgram':not inverse}
        if (BASE/(name+'-result.json')).exists():
            saved=document(name+'-result.json');need(all(saved[key]==value[key]for key in ['actor','boot','newProgram'])and bool(saved['sessions']['owned']),
                'existing_metadata_start_result_cannot_be_replaced_or_relabelled')
        return value

    def upgrade(self,expected):
        review=self.review();need(sha(encoded(review))==expected,'same_fresh_actual_metadata_upgrade_review_required')
        BASE.mkdir(mode=0o700);sync(BASE.parent)
        operation={'format':FORMAT,'operatorSha256':own_sha(),'inputSha256':self.input_sha,'bootId':self.host.s.boot(),
            'config':self.config,'reviewBinding':review,'reviewHash':expected,'historicalActor':self.selected['nativeActor'],'historicalBoot':self.selected['boot']}
        write('operation.json',operation)
        self.step('old-stop',lambda _:self.stop(review['actor'],review['sessions']))
        def publish(_):
            need(not os.path.lexists(DROP),'new_metadata_overlay_must_not_replace_existing_file')
            fd=os.open(DROP,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o644)
            with os.fdopen(fd,'wb')as stream:os.fchmod(stream.fileno(),0o644);stream.write(drop_bytes());stream.flush();os.fsync(stream.fileno())
            sync(DROP.parent);value={'identity':inode(DROP),'sha256':sha(drop_bytes())};write('overlay-created.json',value);return value
        self.step('overlay-publish',publish);self.step('new-reload',lambda _:(self.manager('daemon-reload')or{'reloaded':True}))
        started=self.step('new-start',lambda intent:self.start(intent,True,review['actor']))
        return self.accept(started,False)

    def accept(self,started=None,inverse=False):
        op=self.read_operation();name='inverse-start'if inverse else'new-start'
        observed=self.inspect_start(inverse)
        if started is not None:need(all(started[key]==observed[key]for key in ['actor','boot','newProgram'])and bool(started['sessions']['owned']),
            'actual_observed_metadata_start_required')
        if not(BASE/(name+'-result.json')).exists():
            write(name+'-result.json',{**observed,'reconciledReadOnly':True,'serviceActions':0,'databaseWrites':0,'providerCalls':0})
        started=document(name+'-result.json');intent=document(name+'-intent.json');actor=self.actor(not inverse)
        need(actor==started['actor']and intent['operationSha256']==sha(protected(BASE/'operation.json'))and
            int(actor['unit']['ExecMainStartTimestampMonotonic'])>=intent['monotonicUs']and actor['unit']['NRestarts']=='0'and
            self.meta.stable_scan(self.host.database()['scan'])==op['reviewBinding']['scan'],
            'same_actual_new_owned_metadata_actor_and_preserved_legacy_scan_required')
        result={**envelope(self,actor,inverse),'completed':True,'restoredOriginalProgram':inverse,
            'startIntentSha256':sha(protected(BASE/(name+'-intent.json'))),'startResultSha256':sha(protected(BASE/(name+'-result.json'))),
            'runtimeCadenceQualified':False,'oldSelectedActorRelabelled':False}
        if inverse:result['upgradeResultSha256']=sha(protected(BASE/'result.json'))
        digest=write('inverse-result.json'if inverse else'result.json',result);return{'format':FORMAT,'completed':True,'receiptSha256':digest,'inputSha256':self.input_sha,'runtimeCadenceQualified':False}

    def inverse(self,expected):
        need(self.inverse_config is not None,'inverse_effects_closed_until_actual_qualified_source_and_catalog_input')
        op=self.read_operation();receipt=sha(protected(BASE/'result.json'));current=actor_current(receipt,self.input_sha)
        binding={'upgradeResultSha256':receipt,'actor':current['actor'],'boot':current['boot'],'source':self.full_source(),
            'inverseInputSha256':self.inverse_input_sha}
        need(sha(encoded(binding))==expected and not(BASE/'inverse-intent.json').exists(),'fresh_actual_owned_metadata_program_inverse_review_required')
        write('inverse-intent.json',binding);sessions=self.host.sessions(current['actor'])
        self.step('inverse-stop',lambda _:self.stop(current['actor'],sessions))
        def unlink(_):
            need(inode(DROP)==document('overlay-created.json')['identity']and protected(DROP)==drop_bytes(),'same_owned_epoch_overlay_before_removal_required')
            DROP.unlink();sync(DROP.parent);return{'removed':True}
        self.step('inverse-unlink',unlink);self.step('inverse-reload',lambda _:(self.manager('daemon-reload')or{'reloaded':True}))
        started=self.step('inverse-start',lambda intent:self.start(intent,False,current['actor']))
        return self.accept(started,True)


def envelope(context,actor,inverse=False):
    return{'format':FORMAT,'validated':True,'operatorSha256':own_sha(),'inputSha256':context.input_sha,
        'operationSha256':sha(protected(BASE/'operation.json')),'bootId':context.host.s.boot(),**{key:context.config[key]for key in['metadataInputSha256','metadataOperationSha256','metadataSelectedSha256']},
        'actor':copy.deepcopy(actor),'boot':context.meta.link(context.meta.BOOT),'historicalActor':copy.deepcopy(context.selected['nativeActor']),
        'historicalBoot':copy.deepcopy(context.selected['boot']),'artifactDigest':OLD_ARTIFACT if inverse else ARTIFACT,
        'artifactManifestSha256':OLD_ARTIFACT_MANIFEST if inverse else ARTIFACT_MANIFEST,'workerSha256':OLD_WORKER_SHA if inverse else WORKER_SHA}


def acknowledgement(result_sha,input_sha,inverse=False):
    authenticate();config=configuration(json.loads(protected(INPUT,input_sha)));name='inverse-result.json'if inverse else'result.json'
    result=json.loads(protected(BASE/name,result_sha));op=document('operation.json');start='inverse-start'if inverse else'new-start'
    intent=document(start+'-intent.json');started=document(start+'-result.json');_,selected=history(config)
    need(result['format']==op['format']==FORMAT and result['operatorSha256']==op['operatorSha256']==own_sha()and
        result['inputSha256']==op['inputSha256']==input_sha and op['config']==config and result['completed']is True and
        result['operationSha256']==sha(protected(BASE/'operation.json'))and result['oldSelectedActorRelabelled']is False and
        result['restoredOriginalProgram']is inverse and result['startIntentSha256']==sha(protected(BASE/(start+'-intent.json')))
        and result['startResultSha256']==sha(protected(BASE/(start+'-result.json')))and
        op['reviewHash']==sha(encoded(op['reviewBinding']))and op['reviewBinding']['config']==config and
        op['historicalActor']==result['historicalActor']==selected['nativeActor']and
        op['historicalBoot']==result['historicalBoot']==op['reviewBinding']['boot']==result['boot']==selected['boot']and
        result['bootId']==op['bootId']==intent['bootId']and result['actor']==started['actor']and result['boot']==started['boot']and
        started['newProgram']is(not inverse)and all(result[key]==config[key]for key in
            ['metadataInputSha256','metadataOperationSha256','metadataSelectedSha256'])and
        intent['format']==FORMAT and intent['operatorSha256']==own_sha()and intent['inputSha256']==input_sha and
        intent['operationSha256']==result['operationSha256']and intent['name']==start and
        type(intent['monotonicUs'])is int and 0<intent['monotonicUs']<=int(result['actor']['unit']['ExecMainStartTimestampMonotonic'])and
        result['actor']['unit']['NRestarts']=='0'and
        (result['artifactDigest'],result['artifactManifestSha256'],result['workerSha256'])==
            ((OLD_ARTIFACT,OLD_ARTIFACT_MANIFEST,OLD_WORKER_SHA)if inverse else(ARTIFACT,ARTIFACT_MANIFEST,WORKER_SHA)),
        'actual_immutable_owned_metadata_epoch_ACK_operation_and_start_chain_required')
    if inverse:
        upgrade=acknowledgement(result['upgradeResultSha256'],input_sha)
        inv=document('inverse-intent.json');need(inv['upgradeResultSha256']==upgrade['receiptSha256']and
            inv['actor']==upgrade['actor']and upgrade['operationSha256']==result['operationSha256'],
            'actual_upgrade_ACK_ancestry_required_for_restored_metadata_epoch')
    return{**result,'receiptSha256':result_sha,'immutableAcknowledgementOnly':True,'currentActorQualified':False,
        'sourceActorQualified':False,'READAuthorityQualified':False,'publicationAuthorityQualified':False,
        'financialAuthorityQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def actor_current(result_sha,input_sha,refresh_callback=None,inverse=False):
    first=acknowledgement(result_sha,input_sha,inverse);context=Context(input_sha,refresh_callback);context.read_operation()
    need(inverse or not(BASE/'inverse-intent.json').exists(),'current_upgrade_actor_cannot_alias_owned_inverse_prefix')
    actor=context.actor(not inverse);need(actor==first['actor']and context.meta.link(context.meta.BOOT)==first['boot']and
        not any(context.meta.identity_alive(context.host.m,p)for p in context.read_operation()['reviewBinding']['actor']['processes']),
        'actual_new_metadata_actor_boot_and_previous_epoch_terminal_required')
    sessions=context.host.sessions(actor);need(bool(sessions['owned'])and
        not any(context.meta.identity_alive(context.host.m,p)for p in first['historicalActor']['processes'])and
        context.actor(not inverse)==actor and acknowledgement(result_sha,input_sha,inverse)==first,
        'metadata_epoch_actor_private_or_immutable_ACK_changed_during_capture')
    return{**first,'immutableAcknowledgementOnly':False,'currentActorQualified':True,'actor':actor}


def inverse_acknowledgement(result_sha,input_sha):return acknowledgement(result_sha,input_sha,True)
def restored_actor_current(result_sha,input_sha,refresh_callback=None):return actor_current(result_sha,input_sha,refresh_callback,True)


@contextlib.contextmanager
def transition_lock(context):
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        row=os.fstat(fd);need(stat.S_ISREG(row.st_mode)and row.st_uid==row.st_gid==0 and row.st_nlink==1 and stat.S_IMODE(row.st_mode)==0o600,'protected_original_transition_lock_required')
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);context.lease=fd;yield
    finally:context.lease=None;os.close(fd)


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--input-sha');parser.add_argument('--inverse-source-input-sha');actions=parser.add_mutually_exclusive_group()
    actions.add_argument('--render-input',action='store_true');actions.add_argument('--inspect-start',action='store_true')
    actions.add_argument('--inspect-inverse-start',action='store_true');actions.add_argument('--accept-inverse',action='store_true')
    actions.add_argument('--review',action='store_true');actions.add_argument('--upgrade');actions.add_argument('--accept',action='store_true')
    actions.add_argument('--inverse-review',action='store_true');actions.add_argument('--inverse');args=parser.parse_args()
    if args.render_input:
        need(args.input_sha is args.inverse_source_input_sha is None,'render_input_reads_actual_fixed_metadata_and_install_refs_only');print(encoded(render_input()).decode(),end='');return
    if not any([args.review,args.upgrade,args.accept,args.inverse_review,args.inverse,args.inspect_start,args.inspect_inverse_start,args.accept_inverse]):
        need(args.input_sha is args.inverse_source_input_sha is None,'explicit_metadata_epoch_action_required');print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}));return
    need(os.geteuid()==os.getegid()==0 and socket.gethostname()=='yunipals-main'and pin(args.input_sha),'actual_root_metadata_epoch_action_and_input_required')
    inverse_action=any([args.inverse_review,args.inverse,args.accept_inverse,args.inspect_inverse_start])
    need(pin(args.inverse_source_input_sha)if inverse_action else args.inverse_source_input_sha is None,
        'inverse_requires_explicit_actual_qualified_source_and_catalog_input')
    os.umask(0o077);context=Context(args.input_sha,inverse_input_sha=args.inverse_source_input_sha)
    with transition_lock(context):
        if args.review:result={'format':FORMAT,'reviewHash':sha(encoded(context.review())),'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        elif args.upgrade:result=context.upgrade(args.upgrade)
        elif args.accept:context.fence();result=context.accept()
        elif args.accept_inverse:context.fence();result=context.accept(inverse=True)
        elif args.inspect_start or args.inspect_inverse_start:
            context.fence();value=context.inspect_start(args.inspect_inverse_start)
            result={'format':FORMAT,'validated':True,'existingOwnedStart':value,'readOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        elif args.inverse_review:
            receipt=sha(protected(BASE/'result.json'));value=actor_current(receipt,args.input_sha)
            result={'format':FORMAT,'reviewHash':sha(encoded({'upgradeResultSha256':receipt,'actor':value['actor'],'boot':value['boot'],'source':context.full_source(),
                'inverseInputSha256':context.inverse_input_sha})),
                'databaseWrites':0,'serviceActions':0,'providerCalls':0}
        else:result=context.inverse(args.inverse)
    print(json.dumps(result))


if __name__=='__main__':main()
