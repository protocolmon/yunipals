#!/usr/bin/env python3
"""Read-only owned reader/cache/metadata actor prefixes, without source authority."""
import hashlib
import ast
import copy
import json
import os
from pathlib import Path
import re
import stat
import types

FORMAT='yunipals-ypal-ordinary-consumer-inverse-prefix-v1'
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-consumer-inverse-prefix-v1.py'
READER=OPS/'ypal-ordinary-reader-continue-v3.py'
READER_SHA='a476ee8b8f3e19b4b02ff71df596f2b998896adda1743e65ebc98551582bc89a'
MANIFEST=OPS/'ypal-ordinary-reader-continue-v3.manifest.json'
MANIFEST_SHA='518d91ec7341543d7a07ba62d92d0b2f583ac52eec240d234b9deeca5f39712d'
EPOCH_PREFIX='ypal-native-metadata-approval-epoch-prefix-v1.py'
EPOCH_PREFIX_MANIFEST='ypal-native-metadata-approval-epoch-prefix-v1.manifest.json'
SOURCE_MANIFEST=OPS/'ypal-ordinary-consumer-inverse-prefix-v1.manifest.json'
SOURCE_PINS={'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-ordinary-accept-v1.manifest.json': '8494ce4ba63ca8d0f7be8889ef90ea23395632ac1ca1d032a93d63567cc4f08b', 'arena-ypal-ordinary-accept-v1.py': 'b3dce2f8dbfa26dc219101dd29be866aad1d3944f0db6de9915a838555080295', 'arena-ypal-ordinary-bound-v1.manifest.json': 'bc38a18b86b181624305f0e1d754ee7e6cf3b333368afe1de3daa44a91757dd4', 'arena-ypal-ordinary-bound-v1.py': '1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'final-supervisor-inventory-v1.py': 'ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-readview-v5-plan.mjs': '91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201', 'ypal-combined-readview-v5.preparation.json': 'd968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-combined-source-manifest-v1.json': 'a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-generation-runtime-install-v3.py': '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b', 'ypal-latest-complete-main-api-install-v1.py': '43d98f0aa8993b408133f24a77bdab50663fa79fb77840c7478db369d7e7be9f', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-approval-epoch-prefix-v1.manifest.json': '4412879f5b71b61f17d16a6cf852c1516e2d9332389b14fe4d2c546b94d3763b', 'ypal-native-metadata-approval-epoch-prefix-v1.py': '744812132f794887e4025515045fbd74dc9b9ec298deb454e4b13ea7bb402923', 'ypal-native-metadata-approval-epoch-v1.manifest.json': 'd30975e78bad3bdb80a16c498bd7b069ce557dfdb4328c5628d0101088aa2575', 'ypal-native-metadata-approval-epoch-v1.py': '68759ef0f1d5909e50b06620e79ab41aa13faa350333cca1b9632bda6252cf25', 'ypal-native-metadata-approval-epoch-v2.manifest.json': '7d53fd78c48264f41b1c053468b61c806f57e135b90f70dbaa0828cca69fc90e', 'ypal-native-metadata-approval-epoch-v2.py': '5f395d9e4cc68edd88e7b0a7c0d3db2fff80901aa881c373186387285e5a92e3', 'ypal-native-metadata-approval-epoch-v3.manifest.json': '464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e', 'ypal-native-metadata-approval-epoch-v3.py': '62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1', 'ypal-native-metadata-approval-install-v1.py': '5fa35ac24e6747b06a648504967c1be6b7f52687ee5f9e3295bcd79c2fe3981a', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-old-runtime-inventory-v1.py': '7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.manifest.json': '1131a7c181917cef8521475b7181341a15fbc9c09019beb3dff91e7d0cc13c48', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-authority-v2.manifest.json': 'cd1f95a8db31650e2eb1283819a25ca9f528b5a950d35b19ae757625e3b4ffe6', 'ypal-ordinary-cache-continuation-authority-v2.py': '6ab6b0ae7e0bff7107cee6c50a709de631e505c1acef101a34ce9ec6290e303f', 'ypal-ordinary-cache-continuation-authority-v3.manifest.json': '3c2ae723c55faa505c834a604f13feb3b98f7f193202b017cf761f04bf002263', 'ypal-ordinary-cache-continuation-authority-v3.py': '0446dea37801f282c97d613ded19f75491925487fddbea5dc25441a1733b5ca7', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-finish-v6.py': 'ec9a88b93543a114138b1198b865ef5b31de2d79ef08a6d014b4e938ca51b4a0', 'ypal-ordinary-cache-peer-v6.py': '4ddd3b021c31e7a2f663df82bb7e3308c22b5b2f1cec5345979286efcff59e04', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-ordinary-downstream-refs-accept-v1.py': '2d2e8b1550332e215564cbeefb12a2fbea42f87ba1d978aab2aa337f212e3ce6', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f', 'ypal-ordinary-feature-context-accept-v1.py': '3ec482f59adafd674116d821abe3ab39db46b1ab21d3ffeeee5892fe390f6984', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-v5.py': 'da2fea0aa36277c1c464ca27ad280b03ba31bfec2730182779ac839638496656', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-accept-v1.manifest.json': '431d59f132898c8302854b78dc6cf4fd44a41504e48ce810b1e8d2f6ffaf3b65', 'ypal-ordinary-feature-handover-accept-v1.py': 'd5d1614372bcbd0008806f5378c6085c56f95d516608493ee9f318b5cc5856b1', 'ypal-ordinary-feature-handover-bound-v1.manifest.json': 'dda74ac69d400d22e6a6cace532a9022e4619cd23643cc9d00b4e9de4c11bb47', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-v5.py': 'cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-feature-inverse-actors-v1.py': '3c47d4f9f17d415d3039e939f297c63a29554480a467dc5603a5331da7e49ce2', 'ypal-ordinary-feature-inverse-call-v1.manifest.json': '44d728e05c4f7a6cd19e400790e102987917c7822b21097eb19f0649d75c6259', 'ypal-ordinary-feature-inverse-call-v1.py': 'dfe03159dc60015e175403da7caecb2c4a51212d2a2e620daeb207118e51ad4e', 'ypal-ordinary-feature-inverse-prefix-v1.py': '3741736fef01c793d8d749d34156cf0891efe380a0b402914a5b2614d1a7ceea', 'ypal-ordinary-feature-inverse-source-v1.manifest.json': 'ab82933b80168ab99862b443d7656efdf4dd2d8030d6f737b2599850ec3ddf81', 'ypal-ordinary-feature-inverse-source-v1.py': 'f19c67fcef83437c7db856a3b45e06ee416cab7268f79e34447c33d59a55febe', 'ypal-ordinary-generation-accept-binding-v1.py': '4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758', 'ypal-ordinary-generation-accept-binding-v2.manifest.json': '0f5bcd31ead0971f6d3fba26f238f8d7eefbc20f39d2db8a51ca9a356f6aac27', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-generation-accept-v1.py': '1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d', 'ypal-ordinary-generation-accept-v2.py': 'b6b6eb8c707290c29fbcd6eedf2e13c6c1d5dcc293a3806b0d6ab76bc9ab49fe', 'ypal-ordinary-generation-accept-v3.py': '29c44cdb1e3614eda39601c0e8bff29233f8a39369f01e5acb47530fc88138e3', 'ypal-ordinary-generation-attempt-v1.py': '6202db1e5124ce81823854ffa09e77410b6495c695b463028bc150bc57b564b3', 'ypal-ordinary-generation-attempt-v2.py': '4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753', 'ypal-ordinary-generation-attempt-watch-v1.py': '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41', 'ypal-ordinary-generation-attempt-watch-v2.py': '47005973bc9ec17cd65f8b3044ef9e4dda438821fd651c289608b0fd2f8a86ae', 'ypal-ordinary-generation-binding-v1.manifest.json': 'a6d4f0b8669eadcc44a1c880e76996f015e645ef9976b79e418e02e26bd1859b', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-generation-candidates-v5.py': '869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca', 'ypal-ordinary-generation-recovery-semantic-v1.mjs': 'ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-generation-terminal-v1.py': '5ac441e3c3b0d3494cd256682f987a60b1d4119d4be6c1db7cb446642bb79613', 'ypal-ordinary-generation-v5c.py': 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da', 'ypal-ordinary-generation-watch-v5c.py': 'f1ebc76c182d4146de7c006fa2dad5567aa8fb6d0dfe16e807648a2792911885', 'ypal-ordinary-managed-handover-accept-v1.manifest.json': '97104caa6f4b9e907e2b46a0f55b5e0eb3e087917f39643ad1e583b0ea2c1e14', 'ypal-ordinary-managed-handover-accept-v1.py': '83f9c88acd2c27b94cfc785595b30baaf2f26d858df772ff5ecc91c72cfcccdc', 'ypal-ordinary-managed-handover-bound-v1.manifest.json': '5a5e76e842aab87e76baaa540afd851961ff71cee0e7a54d2ac77b646f8a27be', 'ypal-ordinary-managed-handover-bound-v1.py': '415746545c901bedea9424e8e2330940d68a77cd303958b9551350de30e1717c', 'ypal-ordinary-managed-handover-v3.py': '8ca8c1c99c32e31c88c23136bc722c7d8d6c4756e9dd947eddb84ed1ded8ecf3', 'ypal-ordinary-managed-parent-phase-v1.py': '317779c460b99873f4408b0e1b4a9c9992a6c2270d33aa66fbec754affc6d16d', 'ypal-ordinary-managed-runtime-v2.py': '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199', 'ypal-ordinary-metadata-current-epoch-v1.manifest.json': 'ac005ac44651a31c954426cca6edde676a4e337ab2c926d001538fc784a7ab62', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-metadata-current-epoch-v2.manifest.json': 'acfc5b210f00688b17389c3c6d197398c4e865935ddf2c3e43f340d7c74dbb66', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-observer-retained-prefix-v1.py': '451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e', 'ypal-ordinary-publication-accept-v1.py': '06212b568ee5298679633e3dfc30f9e47007c5624ff1a1ff441891f8128c6fcb', 'ypal-ordinary-publication-accept-v2.py': '7c518d97f1c4f425dce8dee8a4ad3f6f06a37454b0346de177c4cd60b32e56d0', 'ypal-ordinary-publication-bound-v1.py': '667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130', 'ypal-ordinary-publication-caller-v6.py': 'c7828062bbc7446ea4b00b7e84394d3ef8ce0aa11efeb88b82fddc3cc7c4345a', 'ypal-ordinary-publication-input-render-accept-v1.py': 'f934344ffa62c336d5dd4a057d05f6a8568139b52452080af02c33849e092705', 'ypal-ordinary-publication-input-render-accept-v2.py': '31ae49e472c2dc03fc84e70fdd8f443094b0959b591542f46a92a74d3f74ba85', 'ypal-ordinary-publication-input-render-v1.py': 'edff30e35a7253e2487afb12938f0c93571897c6ec25eff96769a3d405614b31', 'ypal-ordinary-publication-kernel-v1.py': '6b261303f659ab2f8b9152733b5eeb6f3cb02be1c09f1ab38380dc41d3795e3a', 'ypal-ordinary-publication-kernel-v1.stage.json': 'd527d90edfebd43fae93e6200e58dad1a0f1cc965a31a0f7c39d21ddd3887e5e', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-publication-query-v2.py': 'deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-read-cache-accept-v1.py': 'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-ordinary-read-cache-bound-v1.py': '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f', 'ypal-ordinary-read-cache-continue-v1.py': 'e4b0a18fc1358a04da6a6a47c8363d193836d23493a28f6c09a1780e3dadc06e', 'ypal-ordinary-read-cache-continue-v2.py': '6155280da8f53e6e3448c024bc3e142a5f69a8d3e1a6a39ae3faa8c1d44d1a34', 'ypal-ordinary-read-cache-continue-v3.py': 'e64a7787a0991e196222998caebd9773da67b8cf9272dcc778758c8953e77e89', 'ypal-ordinary-read-cache-v5.py': '387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2', 'ypal-ordinary-read-cache-v6.py': '46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c', 'ypal-ordinary-read-catalog-v5.sql': '8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd', 'ypal-ordinary-reader-accept-v1.py': '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e', 'ypal-ordinary-reader-accept-v2.manifest.json': '688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666', 'ypal-ordinary-reader-accept-v2.py': '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5', 'ypal-ordinary-reader-bound-v1.manifest.json': 'bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095', 'ypal-ordinary-reader-bound-v1.py': '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17', 'ypal-ordinary-reader-continue-v1.manifest.json': '2f0834fda702e6bc2a2bbbb49a2502c7d50b7201aae6978f7aeed340a28426de', 'ypal-ordinary-reader-continue-v1.py': '5858b50e59ddc1d5ee04e0f8443143d0d6aee78fd927fee4f6d9fbe9b62a747d', 'ypal-ordinary-reader-continue-v2.manifest.json': '8c08dd3285dca10b36012e84807ea932ebfafc119c926989a048e66ff1fed743', 'ypal-ordinary-reader-continue-v2.py': '1d86989516bbcd4823c11f12761a073585437315e0d2e2c9b7f9e7253792f4a7', 'ypal-ordinary-reader-continue-v3.manifest.json': '518d91ec7341543d7a07ba62d92d0b2f583ac52eec240d234b9deeca5f39712d', 'ypal-ordinary-reader-continue-v3.py': 'a476ee8b8f3e19b4b02ff71df596f2b998896adda1743e65ebc98551582bc89a', 'ypal-ordinary-reader-cutover-v6.manifest.json': '870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200', 'ypal-ordinary-reader-cutover-v6.py': '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0', 'ypal-ordinary-reader-peer-bound-v1.py': '865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4', 'ypal-ordinary-reader-peer-v6.py': '91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6', 'ypal-ordinary-reader-probe-bound-v1.mjs': '4cf1ae4e07477a2183ec46ef0405d5763a6a81bbe28c953a6a813b7dc88a32fc', 'ypal-ordinary-reader-probe-v6.mjs': '5d9f013eaec45299a0b52418d309a9b35d4d1630618297df3595555b840d4e69', 'ypal-ordinary-reader-proof-v6.py': '0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5', 'ypal-ordinary-reader-sql-bound-v1.mjs': '05e8c0a728a90f6ab432d73f4fb1ce51f685495405591d225e82a083fa86c8d9', 'ypal-ordinary-reader-sql-v6.mjs': 'fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019', 'ypal-ordinary-reader-wire-bound-v1.manifest.json': 'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf', 'ypal-ordinary-reader-wire-v6.manifest.json': 'f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-ordinary-restored-source-prefix-v1.manifest.json': '7c3f276e8561ba5a7e22968ad312c47f7586ad6bc2d348f5a9522b4d7621ae77', 'ypal-ordinary-restored-source-prefix-v1.py': '644d69ea670abca2b19c410aaf5e7d7a22065637f50ea63dde4f79b24d052319', 'ypal-ordinary-source-authority-v5.py': '052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0', 'ypal-ordinary-source-authority-v6.manifest.json': '80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452', 'ypal-ordinary-source-authority-v6.py': '36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3'}

LOADED_SOURCE_SHA=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None


def protected(path,digest=None,maximum=4000000):
    path=Path(path)
    for item in [*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_consumer_prefix_input_required')
    before=path.lstat();raw=path.read_bytes();after=path.lstat()
    need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=maximum and
        all(getattr(before,key)==getattr(after,key)for key in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
        (digest is None or pin(digest)and sha(raw)==digest),'exact_consumer_prefix_file_required')
    return raw


def source_manifest():
    need(sha(protected(FILE))==LOADED_SOURCE_SHA,'same_consumer_prefix_program_since_module_evaluation_required')
    expected={'format':FORMAT+'-source','files':{FILE.name:LOADED_SOURCE_SHA,**SOURCE_PINS}}
    need(json.loads(protected(SOURCE_MANIFEST,sha(encoded(expected))))==expected,'exact_complete_owned_consumer_prefix_source_manifest_required')
    for name,digest in expected['files'].items():protected(OPS/name,digest)
    return expected


def entry():
    source_manifest()
    raw=protected(MANIFEST,MANIFEST_SHA);value=json.loads(raw)
    need(value['files'][READER.name]==READER_SHA,'actual_fixed_reader_prefix_manifest_required')
    for name,digest in {**value['dependencies'],**value['files']}.items():
        need(type(name)is str and name not in {'','.','..'}and '/'not in name and '\\'not in name and pin(digest),
            'finite_reader_prefix_source_closure_required');protected(OPS/name,digest)
    module=types.ModuleType('consumer_prefix_actual_reader');module.__file__=str(READER)
    exec(compile(protected(READER,READER_SHA),str(READER),'exec'),module.__dict__)
    return module


def record(root,path,required=True):
    path=Path(path)
    if not path.exists():
        need(not required,'required_owned_consumer_prefix_record_missing');return None
    return root.document(path)


def cache_catalog_phase(root,context,actual,enabled,requested):
    ack_path=root.BASE/'cache-inverse-catalog.json';acknowledged=ack_path.exists()
    before=context.sql_ack['postProof']['catalog'];after=context.host.read_rehearsal['after'];acl=context.host.read.acl_catalog
    before=context.proof.login_postcatalog(before)[0]if enabled else before
    observed_before=acl(actual)==acl(before)
    if requested is not False and not acknowledged and observed_before:
        return True,{'phase':'owned-cache-four-present','inverseCommitQualified':False}
    need(requested is not True and not enabled and acl(actual)==acl(after),
        'actual_cache_inverse_postcatalog_and_owned_LOGIN_reversal_required')
    op,_=root.inverse_operation(context.proof);intent=record(root,root.BASE/'cache-inverse-intent.json')
    packet=record(root,root.BASE/'cache-inverse-prepared.json')
    need(intent['format']==root.FORMAT and intent['bootId']==root.boot()and
        intent['operationSha256']==sha(root.public_input(root.BASE/'operation.json'))and
        intent['inverseIntentSha256']==sha(root.public_input(root.BASE/'inverse-intent.json'))and
        intent['cacheCommitSha256']==sha(root.public_input(context.cache.BASE/'sql-committed.json'))and
        packet['mode']=='inverse'and packet['planSha256']==sha(context.sql_ack['resultJson'].encode())and
        acl(packet['postProof']['catalog'])==acl(after),
        'actual_owned_cache_inverse_intent_plan_prepared_XID_and_full_postcatalog_required')
    need(root.xid_status(context,packet['xid'])=='committed','actual_owned_cache_inverse_XID_must_be_committed')
    context.cache.child_gone(context.host,'inverse-sql-child.json')
    if acknowledged:
        ack=record(root,ack_path)
        need(ack['format']=='yunipals-ypal-native-cutover-cache-inverse-v1'and ack['restored']is True and ack['bootId']==root.boot()and
            ack['operatorSha256']==op['binding']['operatorSha256']and ack['operationSha256']==intent['operationSha256']and
            ack['inverseIntentSha256']==intent['inverseIntentSha256']and
            ack['intentSha256']==sha(root.public_input(root.BASE/'cache-inverse-intent.json'))and
            ack['preparedSha256']==sha(root.public_input(root.BASE/'cache-inverse-prepared.json'))and
            ack['cachePreparedSha256']==context.inputs['cachePreparedSha256']and ack['cacheOriginalProducerSha256']==context.proof.CACHE_SHA and
            ack['readAdmissionSha256']==context.prepared['config']['readAdmissionSha256']and
            ack['generationCandidateSha256']==context.prepared['config']['generationSha256']and ack['fourOwnedReadsRemoved']is True,
            'same_actual_owned_cache_inverse_ACK_and_prepared_committed_chain_required')
    return False,{'phase':'owned-cache-inverse-acknowledged'if acknowledged else'owned-cache-inverse-committed-before-ACK',
        'inverseCommitQualified':True,'originalCacheInverseACKPresent':acknowledged,'xid':packet['xid'],
        'intentSha256':sha(root.public_input(root.BASE/'cache-inverse-intent.json')),
        'preparedSha256':sha(root.public_input(root.BASE/'cache-inverse-prepared.json'))}


def catalog_scope(root,context,cache_reads=None):
    """Real complete catalog/guard scope; deliberately no actor/source success."""
    enabled=context.logins_enabled();actual=context.catalog()
    cache_reads,cache_phase=cache_catalog_phase(root,context,actual,enabled,cache_reads)
    baseline=context.sql_ack['postProof']['catalog']if cache_reads else context.host.read_rehearsal['after']
    expected=context.proof.login_postcatalog(baseline)[0]if enabled else baseline
    need(context.host.read.acl_catalog(actual)==context.host.read.acl_catalog(expected),
        'exact_owned_consumer_prefix_READ143_V5_cache4_LOGIN_catalog_required')
    columns=context.host.read_host.catalog()['allColumnAcl']
    need(columns==context.sql_ack['postProof']['allColumnAcl'],'unchanged_all_grantee_column_ACLs_during_consumer_inverse_required')
    context.columns_current();guard=context.guard_scope(cache_reads)
    need(context.catalog()==actual,'consumer_catalog_changed_during_prefix_capture')
    ref=context.phase.admission_ref
    return {'format':FORMAT+'-catalog','validated':True,'readAdmissionSha256':ref['receiptSha256'],
        'readPlanSha256':ref['planSha256'],'readContextInputSha256':ref['contextInputSha256'],
        'catalogSha256':sha(encoded(context.host.read.acl_catalog(actual))),'allColumnAclSha256':sha(encoded(columns)),
        'cacheGuard':guard,'ownedCacheReadsPresent':cache_reads,'apiLoginsEnabled':enabled,'cacheInversePrefix':cache_phase,
        'sourceActorQualified':False,'sourceReadinessQualified':False,'financialAuthorityQualified':False,
        'originalWholeValidatorPassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def make_context(root,proof,operation):
    class ActorPrefixContext(proof.Context):
        def scope(self,*args,**kwargs):raise RuntimeError('consumer_actor_prefix_has_no_forward_source_scope')
        def inverse_scope(self,cache_reads=None):return catalog_scope(root,self,cache_reads)
    value=ActorPrefixContext(operation['binding']['inputs']);value.proof=proof
    return value


def epoch_module():
    source_manifest()
    raw=protected(OPS/EPOCH_PREFIX,SOURCE_PINS[EPOCH_PREFIX])
    module=types.ModuleType('consumer_prefix_owned_metadata_epoch');module.__file__=str(OPS/EPOCH_PREFIX)
    exec(compile(raw,str(OPS/EPOCH_PREFIX),'exec'),module.__dict__)
    return module


def metadata_direction(operation):
    """Recorded forward refs remain ancestry; a real inverse ACK selects restored mode."""
    recorded=operation['binding']['metadata']['metadataEpoch'];refs=copy.deepcopy(recorded['refs'])
    prefix=epoch_module();prefix.refs_checked(refs);owner=prefix.owner_module()
    forward=owner.acknowledgement(refs['resultSha256'],refs['inputSha256'])
    need(forward==recorded['acknowledgement'],'same_actual_forward_metadata_epoch_as_reader_operation_required')
    path=owner.BASE/'inverse-result.json'
    if path.exists():
        result_sha=sha(owner.protected(path));restored=owner.inverse_acknowledgement(result_sha,refs['inputSha256'])
        need(restored['upgradeResultSha256']==refs['resultSha256']and
            all(restored[key]==forward[key]for key in ['operationSha256','metadataInputSha256','metadataOperationSha256',
                'metadataSelectedSha256','historicalActor','historicalBoot','boot']),
            'actual_same_owned_program_inverse_and_historical_reader_ancestry_required')
        refs.update(mode='restored',resultSha256=result_sha)
    return prefix,refs


def bind_metadata_phase(proof,operation,refs):
    """Supply actual epoch refs to static provider construction, without invoking current."""
    original=proof.module_context
    def module_context(role):
        provider=original(role)
        if role!='phase':return provider
        namespace=types.SimpleNamespace(**provider.__dict__)
        def create_phase(inputs,manifest):
            phase=provider.create_phase(inputs,manifest,inverse=refs['mode']=='restored',metadata_refs=copy.deepcopy(refs))
            phase.cache.metadata_epoch.reader_operation(operation['binding']['metadata']['metadataEpoch'])
            return phase
        namespace.create_phase=create_phase
        return namespace
    proof.module_context=module_context


def preservation_methods(proof):
    """Retain full genuine frame bodies with explicit owned-missing records.

    Missing on-disk definitions are never represented as existing file bytes or
    inodes. A terminal unit can still have its previous loaded definition until
    the original owner's already-journaled daemon reload returns.
    """
    name='ypal-alchemy-source-switch-v1.py';raw=protected(OPS/name,proof.pins[name]);tree=ast.parse(raw)
    cls=next(row for row in tree.body if isinstance(row,ast.ClassDef)and row.name=='Context')
    method=copy.deepcopy(next(row for row in cls.body if isinstance(row,ast.FunctionDef)and row.name=='unit_preservation'))
    count=0
    for node in ast.walk(method):
        if isinstance(node,ast.Dict)and ast.unparse(node)=="{'sha256': sha(self.m.protected(path)), 'identity': self.leaf.file_identity(path)}":
            node.keys=[ast.Constant('__prefix_marker__')];node.values=[ast.Name(id='path',ctx=ast.Load())];count+=1
    class Replace(ast.NodeTransformer):
        def visit_Dict(self,node):
            if len(node.keys)==1 and isinstance(node.keys[0],ast.Constant)and node.keys[0].value=='__prefix_marker__':
                return ast.copy_location(ast.parse('prefix_file(self,path)',mode='eval').body,node)
            return self.generic_visit(node)
    method=Replace().visit(method)
    need(count==3,'exact_three_genuine_current_peer_file_record_seams_required')
    original=proof.module(name,proof.pins[name]);scope={**original.__dict__,'prefix_file':prefix_file}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method],type_ignores=[])),str(FILE),'exec'),scope)
    pure=proof.module('ypal-combined-read-admission-v2.py',proof.pins['ypal-combined-read-admission-v2.py'])
    fn=next(row for row in ast.parse(protected(OPS/'ypal-combined-read-admission-v2.py',proof.pins['ypal-combined-read-admission-v2.py'])).body
        if isinstance(row,ast.FunctionDef)and row.name=='consumer_frame')
    counts=dict.fromkeys(['definition','definition-hash','private'],0)
    class ConsumerFiles(ast.NodeTransformer):
        def visit_Call(self,node):
            text=ast.unparse(node)
            if text=='h.m.protected(name)':
                counts['definition']+=1;return ast.copy_location(ast.parse('consumer_definition(h,name)',mode='eval').body,node)
            if text=='sha(raw)':
                counts['definition-hash']+=1;return ast.copy_location(ast.parse('consumer_file(h,name)',mode='eval').body,node)
            if text=='sha(h.m.protected(path))':
                counts['private']+=1;return ast.copy_location(ast.parse('consumer_file(h,path)',mode='eval').body,node)
            return self.generic_visit(node)
    fn=ConsumerFiles().visit(copy.deepcopy(fn));need(set(counts.values())=={1},'exact_three_genuine_consumer_definition_and_file_hash_seams_required')
    second={**pure.__dict__,'consumer_file':consumer_file,'consumer_definition':consumer_definition}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),str(FILE),'exec'),second)
    return scope['unit_preservation'],second['consumer_frame']


def prefix_file(host,path):
    path=Path(path)
    if os.path.lexists(path):return {'sha256':sha(host.m.protected(str(path))),'identity':host.leaf.file_identity(path)}
    old=host.missing.get(str(path));need(old is not None,'unowned_missing_current_peer_file_refused')
    return {'sha256':None,'identity':None,'ownedRemovedFile':copy.deepcopy(old),'present':False}


def consumer_file(host,path):
    if os.path.lexists(path):return sha(host.m.protected(path))
    old=host.missing.get(str(path));need(old is not None,'unowned_missing_consumer_file_refused')
    return {'present':False,'ownedRemovedFile':copy.deepcopy(old)}


def consumer_definition(host,path):
    if os.path.lexists(path):return host.m.protected(path)
    old=host.missing.get(str(path));raw=host.missing_bytes.get(str(path))
    need(old is not None and type(raw)is bytes and sha(raw)==old['sha256'],
        'actual_owned_previous_loaded_definition_bytes_required_after_unlink')
    return raw


def preservation_frames(root,c,reader_rows,metadata_row):
    methods,consumer=preservation_methods(c.proof);sdk=c.host.read_host.primitives['sdk']
    leaf=c.proof.module('ypal-alchemy-primary-current-v1.py',c.proof.pins['ypal-alchemy-primary-current-v1.py'])
    missing={path:row['identity']for actor in reader_rows.values()for path,row in actor['files'].items()if not row['present']}
    operation=root.operation(c.proof);bodies={path:spec['text'].encode()for name in reader_rows for preview in [False,True]
        for _,path,spec in root.descriptor_files(operation,name,preview)if path in missing}
    if not metadata_row['nativeOverlayPresent']:
        path=metadata_row['nativeOverlayPath'];missing[path]=metadata_row['removedOverlayIdentity']
        bodies[path]=metadata_row['removedOverlayBody'].encode()
    for path,row in metadata_row.get('removedProgramFiles',{}).items():
        missing[path]={'identity':row['identity'],'sha256':row['sha256']};bodies[path]=row['body'].encode()
    value=types.SimpleNamespace(m=types.SimpleNamespace(command=sdk.command,protected=sdk.protected),leaf=leaf,
        h=types.SimpleNamespace(rpc_m=types.SimpleNamespace(run=sdk.command)),p=types.SimpleNamespace(SYSTEM=Path('/etc/systemd/system')),missing=missing)
    peer=types.SimpleNamespace(m=types.SimpleNamespace(run=sdk.command,protected=sdk.protected),missing=missing,missing_bytes=bodies)
    consumers=consumer(peer);expected={c.proof.PEERS[name]['unit']for name in reader_rows}|{'yunipals-metadata.service'}
    need(set(consumers)==expected,'exact_four_current_consumer_units_required')
    frames={name:methods(value,name)for name in consumers}
    for unit,frame in frames.items():
        row=metadata_row if unit=='yunipals-metadata.service'else next(row for name,row in reader_rows.items()if c.proof.PEERS[name]['unit']==unit)
        need(all(frame['state'][key]==row['state'][key]for key in ['Id','MainPID','InvocationID','ActiveState','SubState','FragmentPath','DropInPaths']),
            'same_exact_consumer_actor_and_full_preservation_frame_required')
        processes=[]if row['actor']is None else row['actor']['processes']
        need({(p['pid'],p['startTicks'])for p in frame['processes']}=={(p['pid'],p['startTicks'])for p in processes},
            'full_preservation_frame_must_name_exact_qualified_actor_cgroup')
    return {'consumers':consumers,'currentFrames':frames}


def stop_intent(root,op,prefix,unit):
    value=record(root,root.BASE/(prefix+'-stop-intent.json'),False)
    if value is None:return None
    need(value['format']==root.FORMAT and value['bootId']==root.boot()and value['operationSha256']==sha(root.public_input(root.BASE/'operation.json'))and
        value['unit']==unit and type(value['actor'])is dict and type(value['sessions'])is dict,
        'actual_same_operation_reader_stop_intent_required')
    name=prefix.split('-',1)[1]
    if prefix.startswith('original-'):expected=op['binding']['originalReaders'][name]
    else:
        started=record(root,root.BASE/(prefix+'-started.json'));descriptor=root.reader_descriptor(op,name,prefix.startswith('preview-'))
        need(started['format']==root.FORMAT and started['bootId']==root.boot()and
            started['operationSha256']==value['operationSha256']and started['descriptorSha256']==sha(root.encoded(descriptor)),
            'same_actual_acknowledged_native_reader_before_stop_required')
        expected=started['actor']
    need(value['actor']['main']==expected['main']and value['actor']['unit']['InvocationID']==expected['unit']['InvocationID'],
        'stop_intent_must_name_actual_original_or_owned_started_reader_epoch')
    ack=record(root,root.BASE/(prefix+'-stopped.json'),False)
    if ack is not None:need(ack['stopped']is True and all(ack[key]==value[key]for key in value),
        'actual_same_owned_reader_stop_ACK_required')
    return value


def reader_files(root,context,op,name,inverse):
    facts={}
    for preview in [False,True]:
        for label,path,spec in root.descriptor_files(op,name,preview):
            published=record(root,root.BASE/(label+'-published.json'))
            exists=os.path.lexists(path);intent=record(root,root.BASE/(label+'-unlink-intent.json'),False)
            if exists:need(root.inode(path)==published and sha(root.public_input(Path(path)))==sha(spec['text'].encode()),
                'same_owned_reader_file_inode_and_bytes_required')
            else:need(inverse and intent=={'path':str(path),'identity':published},'missing_reader_file_requires_owned_inverse_unlink_intent')
            removed=record(root,root.BASE/(label+'-unlinked.json'),False)
            if removed is not None:need(not exists and removed=={'removed':True,'identity':published},'owned_reader_unlink_ACK_and_absence_required')
            facts[str(path)]={'present':exists,'identity':published,'unlinkIntent':intent is not None,'unlinkAcknowledged':removed is not None}
    original=op['binding']['originalReaders'][name]['definitions']
    definitions={**original,**{path:row['identity']['sha256']for path,row in facts.items()if row['present']and path.endswith('.conf')}}
    root.pending_definitions(context.proof.PEERS[name]['unit'],definitions)
    previews={path:row['identity']['sha256']for path,row in facts.items()if row['present']and path.endswith('.service')}
    root.pending_definitions(context.proof.preview_unit(name),previews)
    return facts


def reader_boot(root,context,op,name,inverse):
    original=op['binding']['readerBootLinks'][name];live=Path(original['path']);parked=root.BASE/('original-'+name+'-boot')
    if original['identity']is None:
        need(not os.path.lexists(live)and not os.path.lexists(parked),'no_new_reader_boot_path_allowed');return {'location':'absent','record':original}
    at_live=os.path.lexists(live);at_parked=os.path.lexists(parked)
    need(at_live!=at_parked,'one_original_reader_boot_inode_location_required')
    need(root.inode(live if at_live else parked,True)==original['identity'],'same_original_reader_boot_inode_required')
    if at_parked:
        need(inverse and record(root,root.BASE/('inverse-'+name+'-boot-disable-intent.json'))==original,
            'only_owned_inverse_reader_boot_disable_may_change_activation')
    elif inverse and (root.BASE/('inverse-'+name+'-boot-disable-intent.json')).exists():
        need(record(root,root.BASE/('inverse-reader-'+name+'-boot-restore-intent.json'))==original,
            'only_owned_reader_boot_restore_intent_may_restore_activation')
    return {'location':'live'if at_live else'parked','record':original}


def terminal_loaded_reader(root,c,op,name,files):
    state=c.state(c.proof.PEERS[name]['unit']);original=op['binding']['originalReaders'][name]
    loaded=(root.BASE/'inverse-reader-load-result.json').exists()
    if loaded:root.original_loaded(c,op,name)
    elif state['DropInPaths']==original['unit']['DropInPaths']:root.original_loaded(c,op,name)
    else:
        descriptor=root.reader_descriptor(op,name);expected=descriptor['expected']
        need(state['FragmentPath']==original['unit']['FragmentPath']and state['DropInPaths'].split()==
            [*original['unit']['DropInPaths'].split(),*[path for path in descriptor['files']if path.endswith('.conf')]]and
            state['WorkingDirectory']==expected['cwd']and state['User']==state['Group']==c.proof.PEERS[name]['role']and
            state['Restart']=='no'and state['KillMode']=='control-group'and
            re.findall(r'argv\[\]=(.*?)\s+;',state['ExecStart'])==[' '.join(expected['argv'])]and
            not any(state[key]for key in ['ExecStartPre','ExecStartPost','ExecStop','ExecStopPost','ExecReload'])and
            c.host.m.ordered_files(state['EnvironmentFiles'])==[(row['path'],row['optional'])for row in expected['selectors']],
            'only_exact_owned_native_or_original_terminal_loaded_reader_prefix_allowed')
    need(state['Job']==''and state['ControlPID']=='0','no_pending_reader_manager_action_allowed')
    return state


def readers(root,c,op,inverse):
    root.original_inputs(c,op);result={}
    for name,peer in c.proof.PEERS.items():
        files=reader_files(root,c,op,name,inverse);boot=reader_boot(root,c,op,name,inverse)
        state=c.state(peer['unit']);start=record(root,root.BASE/('legacy-'+name+'-start-intent.json'),False)
        restored=record(root,root.BASE/('legacy-'+name+'-restored.json'),False)
        if state['MainPID']!='0':
            if restored is not None:
                need(inverse and restored['format']==root.FORMAT and restored['bootId']==root.boot(),
                    'actual_owned_legacy_reader_restore_ACK_required')
                actor=root.restored_reader(c,op,name);root.original_loaded(c,op,name)
                need(restored['actor']['main']==actor['main']and restored['actor']['unit']['InvocationID']==actor['unit']['InvocationID'],
                    'same_acknowledged_restored_reader_epoch_required')
                if start is not None:need(start['format']==root.FORMAT and start['bootId']==root.boot()and
                    start['operationSha256']==sha(root.public_input(root.BASE/'operation.json'))and
                    actor['main']['startTicks']>=start['minimumStartTicks']and actor['unit']['InvocationID']!=start['before']['InvocationID']and
                    actor['unit']['NRestarts']=='0','restored_reader_must_follow_exact_owned_start_intent')
                else:need(actor['main']==op['binding']['originalReaders'][name]['main'],'never_stopped_original_reader_only_without_start_intent')
                phase='owned-restored'
            else:
                need(start is None,'active_reader_start_without_ACK_requires_explicit_reconciliation')
                actor=root.owned_reader(c,op,name);phase='owned-native'
            sessions=c.sessions(actor,peer['oid'])
            for prefix in ['reader-'+name,'original-'+name]:
                value=stop_intent(root,op,prefix,peer['unit'])
                if value is not None and (root.BASE/(prefix+'-stopped.json')).exists():
                    need(actor['main']!=value['actor']['main'],
                        'stopped_reader_epoch_cannot_be_active_again')
            result[name]={'phase':phase,'actor':actor,'sessions':sessions,'state':state,'files':files,'boot':boot}
        else:
            need(inverse,'initial_forward_reader_must_be_actual_acknowledged_native_actor')
            value=stop_intent(root,op,'reader-'+name,peer['unit'])or stop_intent(root,op,'original-'+name,peer['unit'])
            if value is None:
                actor,sessions=root.terminal_owned_reader(c,op,name)
                value={'actor':actor,'sessions':sessions}
            c.drained(name,value['actor'],value['sessions']);c.terminal_sessions(value['actor'],peer['oid'])
            state=terminal_loaded_reader(root,c,op,name,files)
            result[name]={'phase':'owned-terminal','actor':None,'stoppedActor':value['actor'],'state':state,'files':files,'boot':boot}
        preview='preview-'+name;value=stop_intent(root,op,preview,c.proof.preview_unit(name))
        if (root.BASE/(preview+'-started.json')).exists():
            need(value is not None,'owned_preview_must_have_actual_stop_intent');c.drained(name,value['actor'],value['sessions'],True)
    return result


def metadata_loaded(root,owner,h,operation,state,drop):
    old=operation['oldUnit'];native=str(owner.DROP)in state['DropInPaths'].split()
    need(state['FragmentPath']==old['FragmentPath']and state['DropInPaths'].split()==
        [*old['DropInPaths'].split(),*([str(owner.DROP)]if native else[])]and
        all(state[key]==old[key]for key in ['User','Group','WorkingDirectory','Restart','KillMode'])and
        re.findall(r'argv\[\]=(.*?)\s+;',state['ExecStart'])==
        ([h.m.NODE+' '+str(h.installer.TARGET/'dist/metadata-worker.mjs')]if native else re.findall(r'argv\[\]=(.*?)\s+;',old['ExecStart'])),
        'exact_native_or_original_metadata_loaded_definition_prefix_required')
    expected_environment=[(p,False)for p in h.m.ENV_FILES[owner.UNIT]]+[(str(owner.CANDIDATES/'yunipals-metadata.selectors.env'),False)]if native else h.m.ordered_files(old['EnvironmentFiles'])
    need(h.m.ordered_files(state['EnvironmentFiles'])==expected_environment,
        'exact_owned_metadata_loaded_private_selector_order_required')
    expected={**operation['oldWriter']['definitions'],**({str(owner.DROP):operation['candidateDropSha256']}if drop else{})}
    root.pending_definitions(owner.UNIT,expected)
    if (owner.BASE/'inverse-drop-reload-observed.json').exists():need(not native and owner.loaded(h,operation,False,os.path.lexists(owner.BOOT)),
        'acknowledged_original_metadata_reload_must_be_actually_loaded')


def metadata(root,c,op,inverse):
    recorded=op['binding'].get('metadata',{}).get('metadataEpoch')
    if recorded is not None:
        prefix,refs=metadata_direction(op);entry=prefix.owner_module()
        original_meta=entry.module(entry.METADATA).namespace(recorded['acknowledgement']['metadataInputSha256'])
        if not (original_meta.BASE/'inverse-intent.json').exists():
            actual=prefix.validate_current_prefix(recorded['refs'])
            need(actual['validated']is True and actual['binding']['refs']==recorded['refs']and
                actual['upgradeResultSha256']==recorded['refs']['resultSha256']and
                actual['bindingSha256']==prefix.sha(prefix.encoded(actual['binding']))and
                actual['sourceActorQualified']is actual['READAuthorityQualified']is actual['publicationAuthorityQualified']is
                actual['financialAuthorityQualified']is actual['wholeMetadataInverseQualified']is False and
                actual['databaseWrites']==actual['serviceActions']==actual['providerCalls']==0,
                'genuine_source_independent_owned_metadata_program_inverse_prefix_required')
            return {'phase':actual['phase'],'actor':actual['actor'],'state':actual['state'],
                'nativeOverlayPresent':True,'originalBootLive':True,'nativeOverlayPath':str(original_meta.DROP),
                'removedOverlayIdentity':None,'removedOverlayBody':None,'removedProgramFiles':actual['removedFiles'],
                'operationSha256':recorded['acknowledgement']['metadataOperationSha256'],
                'metadataProgramPrefix':copy.deepcopy(actual['binding'])}
        need(refs['mode']=='restored','original_metadata_inverse_requires_actual_owned_program_restore_ACK')
    # This explicit callback proves the current finite catalog, rather than
    # invoking SourceAuthority or pretending the later cache4 phase occurred.
    owner,h,operation=c.phase.metadata_inverse_context(lambda:catalog_scope(root,c))
    h.private(operation['oldWriter']);owner.no_live_cli(h);state=owner.state(h.m)
    selected=h.s.document(owner.BASE/'selected.json',c.prepared['config']['metadataSelectionSha256'])
    mi=record(root,owner.BASE/'inverse-intent.json',False)
    delegated=record(root,root.BASE/'metadata-inverse-intent.json',False)
    if delegated is not None:
        need(inverse and delegated['format']==root.FORMAT and delegated['bootId']==root.boot()and
            delegated['operationSha256']==sha(root.public_input(root.BASE/'operation.json'))and
            delegated['metadataOperationSha256']==c.generation()[1]['metadataOperationSha256']and
            delegated['metadataProducerSha256']==c.cache.META_OWNER_SHA and delegated['newExplicitInverseContext']is True and
            delegated['cacheInverseSha256']==sha(root.public_input(root.BASE/'cache-inverse-catalog.json'))and
            delegated['globalInverseSha256']==sha(root.public_input(root.BASE/'inverse-global-restored.json')),
            'same_actual_coordinator_metadata_inverse_delegation_required')
    if mi is not None:need(delegated is not None,'metadata_inverse_requires_actual_coordinator_delegation')
    live_boot=os.path.lexists(owner.BOOT);held=owner.BASE/'original-boot-link';drop=os.path.lexists(owner.DROP)
    need(live_boot!=os.path.lexists(held),'one_actual_metadata_original_boot_location_required')
    need(owner.link(owner.BOOT if live_boot else held)==operation['oldBoot'],'same_original_metadata_boot_inode_required')
    if not live_boot:need(inverse and mi is not None and
        h.s.document(owner.BASE/'inverse-boot-remove-intent.json')==operation['oldBoot'],
        'actual_owned_metadata_inverse_boot_remove_intent_required')
    if drop:need(owner.file_identity(owner.DROP)==h.s.document(owner.BASE/'native-drop-created.json')and
        sha(h.s.protected(owner.DROP))==operation['candidateDropSha256'],'same_owned_metadata_overlay_inode_and_bytes_required')
    else:need(inverse and mi is not None and h.s.document(owner.BASE/'inverse-drop-remove-intent.json')=={
        'sha256':operation['candidateDropSha256'],'identity':h.s.document(owner.BASE/'native-drop-created.json')},
        'missing_metadata_overlay_requires_owned_inverse_unlink_intent')
    metadata_loaded(root,owner,h,operation,state,drop)
    start=record(root,owner.BASE/'old-start-intent.json',False);done=record(root,owner.BASE/'inverse-result.json',False)
    if state['MainPID']!='0'and done is not None:
        need(inverse and mi is not None and start is not None,'actual_metadata_inverse_and_original_start_chain_required')
        actor=h.actor();need(done['restored']is True and done['oldWriter']==h.m.snapshot(owner.UNIT)[0]and
            start['bootId']==root.boot()and int(state['ExecMainStartTimestampMonotonic'])>=start['monotonicUs']and
            actor['unit']['NRestarts']=='0'and actor['main']!=selected['nativeActor']['main']and not drop and live_boot,
            'same_owned_acknowledged_original_metadata_resume_required')
        root.validate_metadata_restored(c);phase='owned-restored'
    elif state['MainPID']!='0':
        need(start is None,'active_original_metadata_without_inverse_ACK_requires_explicit_reconciliation')
        actor=h.actor(operation,True,pristine=False)
        expected=selected['nativeActor']if recorded is None else h.metadata_epoch.ack['actor']
        if actor!=expected:
            native_start=h.s.document(owner.BASE/'native-start-intent.json')
            need(int(actor['unit']['NRestarts'])>0 and native_start['bootId']==root.boot()and
                int(state['ExecMainStartTimestampMonotonic'])>=native_start['monotonicUs']and
                not any(owner.identity_alive(h.m,p)for p in selected['nativeActor']['processes']),
                'only_genuine_owned_metadata_auto_restart_may_replace_selected_native_actor')
        phase='owned-native'
    else:
        need(inverse,'terminal_metadata_requires_owned_inverse_prefix')
        if mi is None:actor=c.proof.metadata_inverse_actor(c,owner,h,operation,selected)
        else:
            need(mi['nativeActor']is not None and mi['oldStillRunning']is False,'terminal_metadata_requires_owned_inverse_native_actor_chain')
            actor=mi['nativeActor'];sessions=c.terminal_sessions(actor,'16388');h.terminal(operation,actor,sessions)
        phase='owned-terminal';actor=None
    need(state['Job']==''and state['ControlPID']=='0','no_pending_metadata_manager_action_allowed')
    return {'phase':phase,'actor':actor,'state':state,'nativeOverlayPresent':drop,'originalBootLive':live_boot,
        'nativeOverlayPath':str(owner.DROP),'removedOverlayIdentity':None if drop else{
            'identity':h.s.document(owner.BASE/'native-drop-created.json'),'sha256':operation['candidateDropSha256']},
        'removedOverlayBody':None if drop else h.s.protected(owner.CANDIDATES/'yunipals-metadata.service.drop-in.candidate').decode(),
        'operationSha256':c.generation()[1]['metadataOperationSha256']}


def cache_boot_archive(cache):
    path=getattr(cache,'retained_boot_archive',cache.BASE/'original-boot-link')
    need(path==cache.BASE/'original-boot-link'or path==Path('/var/backups/yunipals-ypal-ordinary-read-cache-accept-v2-20261025/original-boot-link'),
        'exact_owned_cache_or_actual_retained_continuation_boot_archive_required')
    return path


def cache(root,c,op,inverse):
    finish=root.cache_finish_module(c);c.host.private();state=c.host.state();before=finish.before(c)
    native_start=record(root,finish.BASE/'started.json',False);stop=record(root,finish.BASE/'inverse-stop-intent.json',False)
    restored=record(root,root.BASE/'cache-old-started.json',False);start=record(root,root.BASE/'cache-old-start-intent.json',False)
    if state['MainPID']!='0'and restored is not None:
        need(inverse and start is not None and (root.BASE/'metadata-restored.json').exists()and
            root.document(root.BASE/'inverse-global-restored.json')['currentGeneration']=='103',
            'global103_and_metadata_recovery_must_precede_actual_old_cache_start')
        actor=c.host.actor(False,False);c.cache.loaded(c.host,False)
        need(start['bootId']==root.boot()and actor['main']['startTicks']>=start['minimumStartTicks']and
            actor['unit']['InvocationID']!=start['before']['InvocationID']and
            restored['intentSha256']==sha(root.public_input(root.BASE/'cache-old-start-intent.json'))and
            restored['actor']['main']==actor['main']and restored['actor']['unit']['InvocationID']==actor['unit']['InvocationID'],
            'same_acknowledged_owned_original_cache_restart_required');phase='owned-restored'
    elif state['MainPID']!='0':
        need(start is None and native_start is not None and (stop is None or not(finish.BASE/'inverse-stopped.json').exists()),
            'unacknowledged_or_stopped_cache_start_cannot_be_adopted')
        finish.operation(root);actor=finish.own_actor(c,native_start['actor']);phase='owned-native'
    else:
        if native_start is not None:
            need(inverse,'terminal_native_cache_requires_owned_inverse_prefix')
            if stop is None:
                actor=native_start['actor'];c.cache.loaded(c.host,True);c.proof.terminal(state,actor['processes'])
                need(state['InvocationID']==actor['unit']['InvocationID'],'same_acknowledged_terminal_native_cache_invocation_required')
                stop={'actor':actor,'sessions':c.terminal_sessions(actor,'10')}
            else:need(stop['bootId']==root.boot()and stop['operationSha256']==sha(root.public_input(finish.BASE/'operation.json')),
                'actual_owned_native_cache_inverse_stop_intent_required')
            c.host.terminal(stop['actor'],stop['sessions']);c.terminal_sessions(stop['actor'],'10')
        else:c.cache.stopped(c.host)
        phase='owned-terminal';actor=None
    drop=os.path.lexists(c.cache.DROP)
    if drop:need(c.cache.inode(c.cache.DROP)==c.cache.document(c.cache.BASE/'drop-published.json'),'same_owned_cache_overlay_inode_required')
    elif (c.cache.BASE/'drop-published.json').exists():need(inverse and root.document(root.BASE/'cache-drop-unlink-intent.json')==
        c.cache.document(c.cache.BASE/'drop-published.json'),'owned_cache_inverse_unlink_intent_required')
    original={path:digest for path,digest in c.host.candidate['originalCacheWriter']['inputHashes'].items()if path.endswith('.service')}
    root.pending_definitions(c.cache.UNIT,{**original,**({str(c.cache.DROP):c.cache.document(c.cache.BASE/'drop-published.json')['sha256']}if drop else{})})
    native_loaded=str(c.cache.DROP)in state['DropInPaths'].split();old=c.host.candidate['originalCacheWriter']['state']
    need(state['DropInPaths'].split()==([str(c.cache.DROP)]if native_loaded else[])and
        all(state[key]==old[key]for key in ['FragmentPath','User','Group','Restart','KillMode'])and
        state['WorkingDirectory']==(str(c.cache.PROJECT)if native_loaded else old['WorkingDirectory'])and
        (not native_loaded or re.findall(r'argv\[\]=(.*?)\s+;',state['ExecStart'])==
            [c.cache.NODE+' --import tsx '+str(c.cache.PROJECT/'lib/metadata/read-cache-worker.ts')]),
        'exact_owned_native_or_original_cache_loaded_prefix_required')
    expected_environment=[('/etc/yunipals-indexer/read-cache.env',False),
        (str(c.cache.CANDIDATES/'yunipals-read-cache.ownership.env'),False)]if native_loaded else c.host.m.ordered_files(old['EnvironmentFiles'])
    need(c.host.m.ordered_files(state['EnvironmentFiles'])==expected_environment and
        (native_loaded or state['ExecStart']==old['ExecStart']),
        'exact_owned_cache_loaded_private_selector_order_and_original_command_required')
    if (root.BASE/'cache-old-load-result.json').exists():c.cache.loaded(c.host,False)
    live=os.path.lexists(c.cache.BOOT);parked=cache_boot_archive(c.cache)
    need(live!=os.path.lexists(parked)and c.cache.inode(c.cache.BOOT if live else parked,True)==before['boot'],
        'one_exact_original_cache_boot_inode_location_required')
    if not live and native_start is not None:need(inverse and root.document(finish.BASE/'inverse-boot-disable-intent.json')==before['boot'],
        'owned_native_cache_inverse_boot_disable_intent_required')
    if live and inverse and (root.BASE/'cache-old-boot-restore-intent.json').exists():need(
        root.document(root.BASE/'cache-old-boot-restore-intent.json')==before['boot'],'same_owned_cache_boot_restore_intent_required')
    return {'phase':phase,'actor':actor,'state':state,'nativeOverlayPresent':drop,'originalBootLive':live}


def journal_frame(root,c):
    finish=root.cache_finish_module(c);folders={root.BASE,c.cache.BASE,c.cache.META,finish.BASE};result={};total=0
    if hasattr(c,'owned_metadata_epoch_prefix'):
        folders.add(c.owned_metadata_epoch_prefix.owner_module().BASE)
    for folder in folders:
        if not folder.exists():continue
        paths=list(folder.glob('*.json'));need(len(paths)<=512,'bounded_owned_consumer_journal_count_required')
        for path in paths:
            raw=root.public_input(path);total+=len(raw)
            need(total<=24000000,'bounded_owned_consumer_journal_bytes_required');result[str(path)]=sha(raw)
    return result


def capture(root,proof,context,operation,refs,forward):
    inverse=(root.BASE/'inverse-intent.json').exists()
    if inverse:need(root.inverse_operation(proof)[0]==operation,'same_actual_owned_reader_inverse_operation_required')
    journals=journal_frame(root,context);initial=catalog_scope(root,context)
    r=readers(root,context,operation,inverse);m=metadata(root,context,operation,inverse);k=cache(root,context,operation,inverse)
    frames=preservation_frames(root,context,r,m)
    if not inverse:
        need(all(row['phase']=='owned-native'and row['actor']==forward['readerActors'][name]for name,row in r.items())and
            (m['phase']=='owned-native'or 'metadataProgramPrefix'in m),
            'before_inverse_only_actual_completed_forward_readers_and_owned_metadata_program_prefix_allowed')
    need(readers(root,context,operation,inverse)==r and metadata(root,context,operation,inverse)==m and cache(root,context,operation,inverse)==k and
        preservation_frames(root,context,r,m)==frames and journal_frame(root,context)==journals,
        'owned_consumer_actor_private_file_boot_journal_or_full_frame_changed_during_capture')
    final=catalog_scope(root,context);need(initial==final,'consumer_catalog_or_guard_changed_during_actor_prefix_capture')
    binding={'refs':refs,'readerOperationSha256':sha(root.public_input(root.BASE/'operation.json')),
        'inverseIntentSha256':sha(root.public_input(root.BASE/'inverse-intent.json'))if inverse else None,
        'catalog':final,'readers':r,'metadata':m,'cache':k,'og4Frames':frames,'journalSha256':sha(encoded(journals))}
    return {'format':FORMAT,'validated':True,'producerSha256':sha(protected(FILE)),'binding':binding,'bindingSha256':sha(encoded(binding)),
        'currentPhase':'inverse-prefix'if inverse else'completed-forward-actors','og4Frames':frames,
        'sourceCurrentQualified':False,'sourceActorQualified':False,'financialAuthorityQualified':False,'wholeInverseQualified':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}


def validate_current_prefix(refs):
    need(type(refs)is dict and set(refs)=={'resultSha256','manifestSha256','producerSha256'}and
        all(pin(value)for value in refs.values())and refs['producerSha256']==READER_SHA and refs['manifestSha256']==MANIFEST_SHA,
        'actual_fixed_completed_forward_reader_three_refs_required')
    reader=entry();forward=reader.acknowledgement(refs['resultSha256'],MANIFEST_SHA)
    need(forward['validated']is forward['immutableReaderAcknowledgementOnly']is True and forward['operatorSha256']==READER_SHA,
        'actual_immutable_forward_reader_ancestry_required')
    root,proof=reader.core(MANIFEST_SHA);operation=root.operation(proof)
    need(forward['operationSha256']==sha(root.public_input(root.BASE/'operation.json')),'same_forward_reader_operation_required')
    epoch,metadata_refs=metadata_direction(operation);bind_metadata_phase(proof,operation,metadata_refs)
    context=make_context(root,proof,operation)
    context.owned_metadata_epoch_prefix=epoch
    value=capture(root,proof,context,operation,refs,forward)
    need(reader.acknowledgement(refs['resultSha256'],MANIFEST_SHA)==forward,
        'immutable_forward_reader_ACK_changed_during_owned_prefix_capture')
    source_manifest();return value


if __name__=='__main__':
    import sys
    if len(sys.argv)!=1:raise SystemExit('consumer_prefix_requires_explicit_actual_refs_API')
    print(json.dumps({'format':FORMAT,'staticOnly':True,'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
