"""Distinct inverse controller context; original Reader5 business journals are ancestry."""
import ast
import contextlib
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import types
import time

OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-ordinary-publication-inverse-v1.py'
FORMAT='yunipals-ypal-ordinary-publication-inverse-v1'
BASE=Path('/var/backups/yunipals-ypal-ordinary-publication-inverse-v1-20261026')
INPUTS={name:Path('/var/backups/yunipals-ypal-ordinary-publication-inverse-input-v1-20261026')/(name+'.json')
    for name in['stop-workloads','restore-original']}
MANIFEST=OPS/'ypal-ordinary-publication-inverse-v1.manifest.json'
AUTHORITY='ypal-ordinary-cache-inverse-authority-v1.py'
CORE='ypal-ordinary-consumer-prefix-source-v3.py'
MAPPER='ypal-ordinary-consumer-inverse-prefix-v3.py'
READER='ypal-ordinary-reader-continue-v5.py'
READER_MANIFEST='ypal-ordinary-reader-continue-v5.manifest.json'
BRIDGE='ypal-ordinary-metadata-restored-epoch-v1.py'
PROTOCOL='ypal-ordinary-publication-protocol-v6.py'
BUSINESS='ypal-native-cutover-v1.py'
SOURCE_PINS={'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-ordinary-accept-v1.manifest.json': '8494ce4ba63ca8d0f7be8889ef90ea23395632ac1ca1d032a93d63567cc4f08b', 'arena-ypal-ordinary-accept-v1.py': 'b3dce2f8dbfa26dc219101dd29be866aad1d3944f0db6de9915a838555080295', 'arena-ypal-ordinary-bound-v1.manifest.json': 'bc38a18b86b181624305f0e1d754ee7e6cf3b333368afe1de3daa44a91757dd4', 'arena-ypal-ordinary-bound-v1.py': '1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523', 'arena-ypal-ordinary-continue-v2.py': 'fb2436608293ded2d66f7bba2003e5359070e5a483676bda3b2b34e45569165e', 'arena-ypal-ordinary-continue-v3.manifest.json': '9f92fda27bf6773a71192f4cfd7c40e2a790d237c1a2b3f0c4d1a571dd0b139a', 'arena-ypal-ordinary-continue-v3.py': '9147b75b0e0e3a61594b5b39e087270ecbfed08a35b1dd760cfe1988727ab5c6', 'arena-ypal-ordinary-continue-v4.manifest.json': '0c8e3050733c5d8e1df0b6ca920591e9fac543f3e19cf25844f26aed41404e63', 'arena-ypal-ordinary-continue-v4.py': '8835b88af456ff314e66f91c1390ba117fed83c100dc96d5807285244eeceaca', 'arena-ypal-ordinary-continue-v5.manifest.json': '2c09e448ac45752835104010fd49a265ad31e77df87f6a43e4c249c0e192c8c2', 'arena-ypal-ordinary-continue-v5.py': '0f816d494f5020c2c397f25cb5499a64f1bd6ebffd7a9ac5e9fab034554c5ab6', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'final-supervisor-inventory-v1.py': 'ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-readview-v5-plan.mjs': '91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201', 'ypal-combined-readview-v5.preparation.json': 'd968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-combined-source-manifest-v1.json': 'a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-generation-runtime-install-v3.py': '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b', 'ypal-latest-complete-main-api-install-v1.py': '43d98f0aa8993b408133f24a77bdab50663fa79fb77840c7478db369d7e7be9f', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-approval-current-observer-v1.manifest.json': 'cbd018b3dd15b2874a6b6834e76b07538d2ac493831428d6701136de2a41d432', 'ypal-native-metadata-approval-current-observer-v1.py': '17a24566753c1903e1c4be3a0f9d66f24d44cd9aaee30b16ceedb21cceeb2498', 'ypal-native-metadata-approval-epoch-prefix-v1.manifest.json': '4412879f5b71b61f17d16a6cf852c1516e2d9332389b14fe4d2c546b94d3763b', 'ypal-native-metadata-approval-epoch-prefix-v1.py': '744812132f794887e4025515045fbd74dc9b9ec298deb454e4b13ea7bb402923', 'ypal-native-metadata-approval-epoch-v1.manifest.json': 'd30975e78bad3bdb80a16c498bd7b069ce557dfdb4328c5628d0101088aa2575', 'ypal-native-metadata-approval-epoch-v1.py': '68759ef0f1d5909e50b06620e79ab41aa13faa350333cca1b9632bda6252cf25', 'ypal-native-metadata-approval-epoch-v2.manifest.json': '7d53fd78c48264f41b1c053468b61c806f57e135b90f70dbaa0828cca69fc90e', 'ypal-native-metadata-approval-epoch-v2.py': '5f395d9e4cc68edd88e7b0a7c0d3db2fff80901aa881c373186387285e5a92e3', 'ypal-native-metadata-approval-epoch-v3.manifest.json': '464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e', 'ypal-native-metadata-approval-epoch-v3.py': '62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1', 'ypal-native-metadata-approval-install-v1.py': '5fa35ac24e6747b06a648504967c1be6b7f52687ee5f9e3295bcd79c2fe3981a', 'ypal-native-metadata-approval-inverse-v1.manifest.json': 'd2178d4232fb95bd98690098e49282ce124f6dcfbc695d18c92620ff78e576eb', 'ypal-native-metadata-approval-inverse-v1.py': '545a0b389c162af6fda15c64ab998621d796ec87409218738e2c5faaad6ebbd7', 'ypal-native-metadata-approval-inverse-v2.manifest.json': '759c0d1120dd1fc4aa597472fcc4a548eaf7c766c8023bc91ae8cf42e2f8f1bd', 'ypal-native-metadata-approval-inverse-v2.py': '2910f1376f96d4ced4107b67ca10dbed05b587012c01518b2955b7f2bf9a91ea', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-old-runtime-inventory-v1.py': '7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.manifest.json': '1131a7c181917cef8521475b7181341a15fbc9c09019beb3dff91e7d0cc13c48', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-authority-v2.manifest.json': 'cd1f95a8db31650e2eb1283819a25ca9f528b5a950d35b19ae757625e3b4ffe6', 'ypal-ordinary-cache-continuation-authority-v2.py': '6ab6b0ae7e0bff7107cee6c50a709de631e505c1acef101a34ce9ec6290e303f', 'ypal-ordinary-cache-continuation-authority-v3.manifest.json': '3c2ae723c55faa505c834a604f13feb3b98f7f193202b017cf761f04bf002263', 'ypal-ordinary-cache-continuation-authority-v3.py': '0446dea37801f282c97d613ded19f75491925487fddbea5dc25441a1733b5ca7', 'ypal-ordinary-cache-continuation-authority-v4.manifest.json': 'a6516798d717724fdce8086fe6afeb05888badcbc60199ebc346eb629890f60a', 'ypal-ordinary-cache-continuation-authority-v4.py': '938b15ee463f7c950828eadeac3e599305d01dbfd8b8ddccd8a974f88b31a240', 'ypal-ordinary-cache-continuation-authority-v5.manifest.json': '2b19fe520f291ef01bc2133b18e0fe9406c6a67a0eeae55067ee1dc5fa399d78', 'ypal-ordinary-cache-continuation-authority-v5.py': 'd95bbcceb812dd7d3acc9e828a78f6125870a021dbfeed952f6c477f48003bef', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-finish-retained-stop-v1.manifest.json': 'cba1bd53e0f949d48e18c9b696fd2748dfe27cc7c0bcaf295a9e56177299efbc', 'ypal-ordinary-cache-finish-retained-stop-v1.py': '1f84ba20dddbaa8d44a7d248f4b44ec165574d8fb1b7205ef7ab1d3c108c2343', 'ypal-ordinary-cache-finish-v6.py': 'ec9a88b93543a114138b1198b865ef5b31de2d79ef08a6d014b4e938ca51b4a0', 'ypal-ordinary-cache-inverse-authority-v1.manifest.json': '3e271bb50e083127795234c6635b84e39e79eda99ecf84f39c345092359b62bb', 'ypal-ordinary-cache-inverse-authority-v1.py': '569bc5eaca9628329952621a5266077565fe7ea8a56a3983d2e9b6b885d23671', 'ypal-ordinary-cache-peer-v6.py': '4ddd3b021c31e7a2f663df82bb7e3308c22b5b2f1cec5345979286efcff59e04', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-call-profile-v1.py': '5b3aa246bf10e6e69c70d01ed4742d1817d86a0e9095f243428b4c8e9c901d8a', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-ordinary-consumer-inverse-prefix-v1.py': 'a51fac428a549e295c8038adfa5649c9d3b883334ae6f315dd4695f78bb52f74', 'ypal-ordinary-consumer-inverse-prefix-v2.manifest.json': '69f234347c046fdc1f1f489e56cc9ac5e8ad1c3b122cbc7e60074079595837bf', 'ypal-ordinary-consumer-inverse-prefix-v2.py': '1e199c7792a37b8467e6f4081e36be5b5e72de2cba57796629788a4041c696ab', 'ypal-ordinary-consumer-inverse-prefix-v3.manifest.json': '9c3ac0208ec777cb78e993dee15d7216527c39858a9cc68acf5b0ba1cdea10b1', 'ypal-ordinary-consumer-inverse-prefix-v3.py': '6184c37bef4058232528ca8de4bbfda2ef8aa144a12b65714ebbf2740ae99f00', 'ypal-ordinary-consumer-prefix-source-v1.py': '7e134a6bec88265004af64c249fdf67591ef8a7fe682f4b948ea85fd200047a1', 'ypal-ordinary-consumer-prefix-source-v3.manifest.json': '8d19efe32e81a84ce56734cb3f7f05f4bfca696657471cca8f9fbe65bec6aa58', 'ypal-ordinary-consumer-prefix-source-v3.py': '7eb8cd25a2ae267f7b7dff530c94c37f73108318dc8e68520cc7d741366fbc5f', 'ypal-ordinary-downstream-refs-accept-v1.py': '2d2e8b1550332e215564cbeefb12a2fbea42f87ba1d978aab2aa337f212e3ce6', 'ypal-ordinary-downstream-refs-continue-v2.py': '328ef5c05768ec50190bb9fa4a4959611aebf423b229892558dff3fb50028148', 'ypal-ordinary-downstream-refs-continue-v3.py': '4c3c94ac10481e4634c705f1acb553c3a1d464b142605986c7e98f5d28785a5a', 'ypal-ordinary-downstream-refs-continue-v4.py': '9e59c051045dec4664c2cd9f9bb0c27a48a189887cb4fb59b8d6ab9c309c9c5a', 'ypal-ordinary-downstream-refs-continue-v5.py': 'bea5d0cd2b99798d49d777797426a350c0bb4e8e2a2d958a3a764fe9a7ae38da', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f', 'ypal-ordinary-feature-context-accept-v1.py': '3ec482f59adafd674116d821abe3ab39db46b1ab21d3ffeeee5892fe390f6984', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-continue-v2.py': 'b89660a0e8c9a2d2072a235be5eb2cd6afe3c2f89fa8509b1b21b4506024235a', 'ypal-ordinary-feature-context-continue-v3.py': '4fb31734e21ceee3d98bbd3490504bd1d84b98c8a11d5855eafd6d46812d04f0', 'ypal-ordinary-feature-context-continue-v4.py': '39654643321ac658dfb4e393307b686d132f0d5239abb3db6f47feef2bdafa41', 'ypal-ordinary-feature-context-continue-v5.py': '62099f9cd61cb2fdbca6e2c19bb1eb20ebd06bee6e070384b64d09ef2e95787a', 'ypal-ordinary-feature-context-v5.py': 'da2fea0aa36277c1c464ca27ad280b03ba31bfec2730182779ac839638496656', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-accept-v1.manifest.json': '431d59f132898c8302854b78dc6cf4fd44a41504e48ce810b1e8d2f6ffaf3b65', 'ypal-ordinary-feature-handover-accept-v1.py': 'd5d1614372bcbd0008806f5378c6085c56f95d516608493ee9f318b5cc5856b1', 'ypal-ordinary-feature-handover-bound-v1.manifest.json': 'dda74ac69d400d22e6a6cace532a9022e4619cd23643cc9d00b4e9de4c11bb47', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-continue-v2.manifest.json': '10b8b843ace3a38907e265485f61100c30ae4a30bd1aab4e38d6ea2efc2bd30c', 'ypal-ordinary-feature-handover-continue-v2.py': '2fd3323ba89d4db6d6493130093e77e2e1f65ba8c03981717b4ea083d01db107', 'ypal-ordinary-feature-handover-continue-v3.manifest.json': 'b30885e5781e8d8c0d83b3c5bb5e81a0e47566e9e5af169ad4753823714ba1a4', 'ypal-ordinary-feature-handover-continue-v3.py': '34a7b6638081bdc1d01fb90ce38745969a5c69fe42a93579fbfbec9c5186ac0c', 'ypal-ordinary-feature-handover-continue-v4.manifest.json': '5a5f570c694e8927b311af5172e3a63e5e348becb1a63f82bdfcda40433133fc', 'ypal-ordinary-feature-handover-continue-v4.py': 'fcd9df30002b2302f44259a9050fe456b4b575268a655f9a6474ec7064e17de9', 'ypal-ordinary-feature-handover-continue-v5.manifest.json': '9af8add92b833b10c51ad58e7c740fc87d5b38aa6a28ebad149b3879b24f2f85', 'ypal-ordinary-feature-handover-continue-v5.py': '8d392dfcf5d663a9561f4c0d4f39f2aed56f3013567116116693312320a492c8', 'ypal-ordinary-feature-handover-v5.py': 'cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-feature-inverse-actors-v1.py': '3c47d4f9f17d415d3039e939f297c63a29554480a467dc5603a5331da7e49ce2', 'ypal-ordinary-feature-inverse-call-v1.manifest.json': '44d728e05c4f7a6cd19e400790e102987917c7822b21097eb19f0649d75c6259', 'ypal-ordinary-feature-inverse-call-v1.py': 'dfe03159dc60015e175403da7caecb2c4a51212d2a2e620daeb207118e51ad4e', 'ypal-ordinary-feature-inverse-call-v3.manifest.json': 'b6b3989a475934e4f9c6c5c3a4869e674047d3b38dd7d89c8351fb3277926404', 'ypal-ordinary-feature-inverse-call-v3.py': 'd8d6a0ea7d30beee00c037276f90fceaefed099275ba6d0ee853bc59a4b03285', 'ypal-ordinary-feature-inverse-call-v4.manifest.json': '590b7f4db6122c908499dd528ac235ee8eb3c1e425b2bb8a9079f1ffed38dfc8', 'ypal-ordinary-feature-inverse-call-v4.py': 'a191462ce1445d1a9c0afd4363d7d89aab841b7fee46af25ae4c11f751ef6e6a', 'ypal-ordinary-feature-inverse-call-v5.manifest.json': '51abf20ecc40f6b1b66c85a33c6722a51cd2d034374a8b970fae5525594de84f', 'ypal-ordinary-feature-inverse-call-v5.py': '57760d76ba2d8c2ed85f645f4fcb39a99f9cf5ebf0727bb6c4dac74f9fd8ffc1', 'ypal-ordinary-feature-inverse-prefix-v1.py': '3741736fef01c793d8d749d34156cf0891efe380a0b402914a5b2614d1a7ceea', 'ypal-ordinary-feature-inverse-prefix-v3.manifest.json': '2f00589414308d2a5e9cd22f647ad4c2d33babdc149e96efe7caef4e9c33bacf', 'ypal-ordinary-feature-inverse-prefix-v3.py': '22a7d25bce101ff4e5fc46c17ccbde9a12419297a23ccc4f8defadca6bca214e', 'ypal-ordinary-feature-inverse-prefix-v4.manifest.json': '7647241e32f552721bfa29d9b5b2d369e5b3d70e64ea44bb1f6eda60c7134121', 'ypal-ordinary-feature-inverse-prefix-v4.py': 'eb7eebe00e6669b85d0506978d1b484103cfa21a551c76432c533fb150f49e29', 'ypal-ordinary-feature-inverse-prefix-v5.manifest.json': 'e7321fe8fb795a160cd59aae88acbc77ff1e5f0fd24f1016d0ef96773d014546', 'ypal-ordinary-feature-inverse-prefix-v5.py': '0e495fe3ca618cd2f12dcecf1badad84fc076ac453d285849a372af0e1113de8', 'ypal-ordinary-feature-inverse-source-v1.manifest.json': 'ab82933b80168ab99862b443d7656efdf4dd2d8030d6f737b2599850ec3ddf81', 'ypal-ordinary-feature-inverse-source-v1.py': 'f19c67fcef83437c7db856a3b45e06ee416cab7268f79e34447c33d59a55febe', 'ypal-ordinary-feature-inverse-source-v3.manifest.json': 'f224403eb0a7283e0c05fc0e3f349a6455d37e58166b26b3aacf40fba730f78c', 'ypal-ordinary-feature-inverse-source-v3.py': '8cda6c7a7378f21e9ffd1a06517b3798fc8697a9793d771afea21edd73e6bae4', 'ypal-ordinary-feature-inverse-source-v4.manifest.json': '6b20b7a5d64b22a71129989a99c1c378fdc40a18a4c4dcc3440c44335ba2299b', 'ypal-ordinary-feature-inverse-source-v4.py': '38cbc616d1612a38ec39f8155869403e5c7f88684cca99243f94bef640c09f0f', 'ypal-ordinary-feature-inverse-source-v5.manifest.json': 'a01d4d5397aaeb67ac89398b5f5690db1a20af0a93772e9f46a8d3ef9584d79f', 'ypal-ordinary-feature-inverse-source-v5.py': '4308e3b5940cc4d687f42d58bfcb1978d39c37b970ed452d90fb673f45b2e2ea', 'ypal-ordinary-generation-accept-binding-v1.py': '4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758', 'ypal-ordinary-generation-accept-binding-v2.manifest.json': '0f5bcd31ead0971f6d3fba26f238f8d7eefbc20f39d2db8a51ca9a356f6aac27', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-generation-accept-v1.py': '1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d', 'ypal-ordinary-generation-accept-v2.py': 'b6b6eb8c707290c29fbcd6eedf2e13c6c1d5dcc293a3806b0d6ab76bc9ab49fe', 'ypal-ordinary-generation-accept-v3.py': '29c44cdb1e3614eda39601c0e8bff29233f8a39369f01e5acb47530fc88138e3', 'ypal-ordinary-generation-attempt-v1.py': '6202db1e5124ce81823854ffa09e77410b6495c695b463028bc150bc57b564b3', 'ypal-ordinary-generation-attempt-v2.py': '4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753', 'ypal-ordinary-generation-attempt-watch-v1.py': '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41', 'ypal-ordinary-generation-attempt-watch-v2.py': '47005973bc9ec17cd65f8b3044ef9e4dda438821fd651c289608b0fd2f8a86ae', 'ypal-ordinary-generation-binding-v1.manifest.json': 'a6d4f0b8669eadcc44a1c880e76996f015e645ef9976b79e418e02e26bd1859b', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-generation-candidates-v5.py': '869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca', 'ypal-ordinary-generation-recovery-semantic-v1.mjs': 'ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-generation-terminal-v1.py': '5ac441e3c3b0d3494cd256682f987a60b1d4119d4be6c1db7cb446642bb79613', 'ypal-ordinary-generation-v5c.py': 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da', 'ypal-ordinary-generation-watch-v5c.py': 'f1ebc76c182d4146de7c006fa2dad5567aa8fb6d0dfe16e807648a2792911885', 'ypal-ordinary-held-diagnostic-v1.py': '7bf19a75010694cf63be776cff4a3db111515eb0442a8568c9c49e883b2df61a', 'ypal-ordinary-managed-handover-accept-v1.manifest.json': '97104caa6f4b9e907e2b46a0f55b5e0eb3e087917f39643ad1e583b0ea2c1e14', 'ypal-ordinary-managed-handover-accept-v1.py': '83f9c88acd2c27b94cfc785595b30baaf2f26d858df772ff5ecc91c72cfcccdc', 'ypal-ordinary-managed-handover-bound-v1.manifest.json': '5a5e76e842aab87e76baaa540afd851961ff71cee0e7a54d2ac77b646f8a27be', 'ypal-ordinary-managed-handover-bound-v1.py': '415746545c901bedea9424e8e2330940d68a77cd303958b9551350de30e1717c', 'ypal-ordinary-managed-handover-continue-v2.py': 'b0db4b1c1410bc08d57bfc8291fc2f82ddaae0fd6827f37fbfd6abd4b2984e93', 'ypal-ordinary-managed-handover-continue-v3.manifest.json': '07dba4723489d14d7a02fc61aa19ba4116541e471b93d91498b7c2a527a933ac', 'ypal-ordinary-managed-handover-continue-v3.py': '61104eb072d6c5cd46e55d50be7a9d36c12a4b28fb1c6853ad442d89d94e5429', 'ypal-ordinary-managed-handover-continue-v4.manifest.json': 'd147ddf721e41e7e03feb42d42d859a6a299fcfbd639d501ef48964f6d1423f9', 'ypal-ordinary-managed-handover-continue-v4.py': '803997a3fd93e33f3ce143a6a14d1fbaea30bc6613f5d2ece35dd31a8e02a6a2', 'ypal-ordinary-managed-handover-continue-v5.manifest.json': '71f6400d4a4d8740c086f9724ffc25a8dce66ae8d1a511c04c465f2186af135d', 'ypal-ordinary-managed-handover-continue-v5.py': 'ea8f35245f2e487f4d8259c9f1fa49e8ffbc04f381d706222c82b036a61036fc', 'ypal-ordinary-managed-handover-v3.py': '8ca8c1c99c32e31c88c23136bc722c7d8d6c4756e9dd947eddb84ed1ded8ecf3', 'ypal-ordinary-managed-parent-phase-v1.py': '317779c460b99873f4408b0e1b4a9c9992a6c2270d33aa66fbec754affc6d16d', 'ypal-ordinary-managed-runtime-v2.py': '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199', 'ypal-ordinary-metadata-current-effect-v1.manifest.json': '3e9730067b03934d67c307773eaeb4e453eb440225ad45ae249587337065aa33', 'ypal-ordinary-metadata-current-effect-v1.py': '9d79c54f8828f36a120241c61a36e28a4c3423731a87fc8824aaecdf7c9305c7', 'ypal-ordinary-metadata-current-epoch-v1.manifest.json': 'ac005ac44651a31c954426cca6edde676a4e337ab2c926d001538fc784a7ab62', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-metadata-current-epoch-v2.manifest.json': 'acfc5b210f00688b17389c3c6d197398c4e865935ddf2c3e43f340d7c74dbb66', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b', 'ypal-ordinary-metadata-current-epoch-v3.manifest.json': '801d0a1bb33f83dba6645c25babaf9ddae6ba041b9dde967afda171bd4d80bbc', 'ypal-ordinary-metadata-current-epoch-v3.py': '33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51', 'ypal-ordinary-metadata-current-observation-v1.manifest.json': '4f58cbaf4a8ff0d051771c38ceeb37c2a03ded3af53ab795a240e5d2c036ad36', 'ypal-ordinary-metadata-current-observation-v1.py': 'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-metadata-restored-epoch-v1.manifest.json': '400ae476ef1dfb8e1e653e2b87523b87ff95e83682a389d6621c759880ec2569', 'ypal-ordinary-metadata-restored-epoch-v1.py': 'bc3e585454ee9f2e532ee50ab6dfb7455653afb269b01219f739bb46af2ea1e3', 'ypal-ordinary-observer-retained-prefix-v1.py': '451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e', 'ypal-ordinary-postfeature-source-v1.py': '50d99faf6d6f0743e4766a0174b73b100e9b429b5ea1d5c9c53f6f7ef5e809ea', 'ypal-ordinary-postfeature-source-v3.manifest.json': '631a99b712565cca110f2175ef86690da785911da1b2ec836386a1ef6969c96b', 'ypal-ordinary-postfeature-source-v3.py': '9c3dd6cf64745eb5e5dbc762e664f42a2653ad1a546da28530fb4032f76ae049', 'ypal-ordinary-postfeature-source-v4.manifest.json': '25cf69c4900dd740de63984326c3418c38dfa56eeb0ca59c9b6b58f93dc6815b', 'ypal-ordinary-postfeature-source-v4.py': 'd3efe526f1c3925254ec54222f80fcffd80aa1efea4cf891f9a588d225b17461', 'ypal-ordinary-postfeature-source-v5.manifest.json': '4434f271df040e83e3fa5d692c7bef81a1fcf31057e047d61c0726b7cb935239', 'ypal-ordinary-postfeature-source-v5.py': 'a6b6c7312fec21151ea9573b08bae1cbbdb63a95ca648d8b81a633f28f4fa7cd', 'ypal-ordinary-publication-accept-v1.py': '06212b568ee5298679633e3dfc30f9e47007c5624ff1a1ff441891f8128c6fcb', 'ypal-ordinary-publication-accept-v2.py': '7c518d97f1c4f425dce8dee8a4ad3f6f06a37454b0346de177c4cd60b32e56d0', 'ypal-ordinary-publication-bound-v1.py': '667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130', 'ypal-ordinary-publication-caller-v6.py': 'c7828062bbc7446ea4b00b7e84394d3ef8ce0aa11efeb88b82fddc3cc7c4345a', 'ypal-ordinary-publication-continue-inputs-v1.py': '9fb641bf7cd35aed3032e2d080a77e92b53f58e6692c29b9baff012f4e4e0332', 'ypal-ordinary-publication-continue-inputs-v2.py': 'bb89dc2a3e798e7d507a9fa723ba7eb4ec679ffe64c7e83922bfb8d35c697ba7', 'ypal-ordinary-publication-continue-inputs-v3.py': '0d3e1579cb529c2606c861adc1009cfa4217ba3c8b4b3a4081cad878089f5757', 'ypal-ordinary-publication-continue-inputs-v4.py': '2b17e31f4de3c1b236d475ae367aa02058af9f3eea359dc2c66eb81ef8c4f3b2', 'ypal-ordinary-publication-continue-inputs-v5.py': 'e3d950765b1177d2c4dc7e6787a4e08c8852dce676ff722c397a27f6ff205cf1', 'ypal-ordinary-publication-continue-manifest-v1.py': '9be7d281fafd5dfab9fdba1a9c7dff0ee6db4219eb9d4cdaef7d6a57ed7a238c', 'ypal-ordinary-publication-continue-manifest-v2.py': 'ca66e80b9880d945bbadaed2bab40de70b0425d5a49f73f00a3c0d01ae19d7e4', 'ypal-ordinary-publication-continue-manifest-v3.py': '561cf8300d8fd48c5874982fb434928241d8a37ee22c96a0251a7057430db257', 'ypal-ordinary-publication-continue-manifest-v4.py': 'ea04d92ca3ba46c5e35102ebd6a8ce1695704d5538f53dbcc43177b6dafe257b', 'ypal-ordinary-publication-continue-manifest-v5.py': 'b26f441511d3f3ff06dd9ea922e19a7bba24cea4e7c30ad767860c534a32e95e', 'ypal-ordinary-publication-continue-v1.py': '6bf7e33971d3331d84ba843ca4952db3f9024ebcee56fba0ff67a5cecbab0151', 'ypal-ordinary-publication-continue-v2.py': '5234d3fae4d7231ad7b966eae133d9132c71ad3098ce463672720c563d9f3aa2', 'ypal-ordinary-publication-continue-v3.py': 'a4a1269b25aaa336fc101cc51252d7d1c275ccef0be63d84e59a4df1b2a22730', 'ypal-ordinary-publication-continue-v4.py': 'c4d86df5b1228147f9677db49d76932f4d187b67ffd09172a92f553c835a4f92', 'ypal-ordinary-publication-continue-v5.py': 'a51a1bd6a4fcbfba982535cf642870f08f902e4b5cb7f4b328d01891b5b7f72a', 'ypal-ordinary-publication-input-render-accept-v1.py': 'f934344ffa62c336d5dd4a057d05f6a8568139b52452080af02c33849e092705', 'ypal-ordinary-publication-input-render-accept-v2.py': '31ae49e472c2dc03fc84e70fdd8f443094b0959b591542f46a92a74d3f74ba85', 'ypal-ordinary-publication-input-render-v1.py': 'edff30e35a7253e2487afb12938f0c93571897c6ec25eff96769a3d405614b31', 'ypal-ordinary-publication-kernel-v1.py': '6b261303f659ab2f8b9152733b5eeb6f3cb02be1c09f1ab38380dc41d3795e3a', 'ypal-ordinary-publication-kernel-v1.stage.json': 'd527d90edfebd43fae93e6200e58dad1a0f1cc965a31a0f7c39d21ddd3887e5e', 'ypal-ordinary-publication-observation-v1.manifest.json': 'd6fdd6668f73c1bb19574682cbd72e4167c8c990f4da9b6c5ab88e1427c4bbc1', 'ypal-ordinary-publication-observation-v1.py': 'f04a6fde624aa5a3805f6f8b4b3f34fa0d03e1e036f4a8237c88b3261f822d4f', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-publication-query-v2.py': 'deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-read-cache-accept-v1.py': 'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-ordinary-read-cache-bound-v1.py': '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f', 'ypal-ordinary-read-cache-continue-v1.py': 'e4b0a18fc1358a04da6a6a47c8363d193836d23493a28f6c09a1780e3dadc06e', 'ypal-ordinary-read-cache-continue-v2.py': '6155280da8f53e6e3448c024bc3e142a5f69a8d3e1a6a39ae3faa8c1d44d1a34', 'ypal-ordinary-read-cache-continue-v3.py': 'e64a7787a0991e196222998caebd9773da67b8cf9272dcc778758c8953e77e89', 'ypal-ordinary-read-cache-continue-v4.py': 'c8c98989c6cb6b2e301e07faeeda4d99f38d2ec70277f5217acff9b06e21d952', 'ypal-ordinary-read-cache-continue-v5.py': '30ee6c1935822dc2a000ea9aa874117b3e7f5cd8dee1e2d180f6a5206f85b326', 'ypal-ordinary-read-cache-v5.py': '387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2', 'ypal-ordinary-read-cache-v6.py': '46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c', 'ypal-ordinary-read-catalog-v5.sql': '8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd', 'ypal-ordinary-reader-accept-v1.py': '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e', 'ypal-ordinary-reader-accept-v2.manifest.json': '688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666', 'ypal-ordinary-reader-accept-v2.py': '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5', 'ypal-ordinary-reader-bound-v1.manifest.json': 'bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095', 'ypal-ordinary-reader-bound-v1.py': '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17', 'ypal-ordinary-reader-continue-v1.manifest.json': '2f0834fda702e6bc2a2bbbb49a2502c7d50b7201aae6978f7aeed340a28426de', 'ypal-ordinary-reader-continue-v1.py': '5858b50e59ddc1d5ee04e0f8443143d0d6aee78fd927fee4f6d9fbe9b62a747d', 'ypal-ordinary-reader-continue-v2.manifest.json': '8c08dd3285dca10b36012e84807ea932ebfafc119c926989a048e66ff1fed743', 'ypal-ordinary-reader-continue-v2.py': '1d86989516bbcd4823c11f12761a073585437315e0d2e2c9b7f9e7253792f4a7', 'ypal-ordinary-reader-continue-v3.manifest.json': '518d91ec7341543d7a07ba62d92d0b2f583ac52eec240d234b9deeca5f39712d', 'ypal-ordinary-reader-continue-v3.py': 'a476ee8b8f3e19b4b02ff71df596f2b998896adda1743e65ebc98551582bc89a', 'ypal-ordinary-reader-continue-v4.manifest.json': '1c131cf6a0da4613ecf83b3c11028433be0192cd7ee3f99a360ea80268df1b24', 'ypal-ordinary-reader-continue-v4.py': '7514129125e50c35152356e5090de88f3a51758f4090a763f74eb7f417c1d6bc', 'ypal-ordinary-reader-continue-v5.manifest.json': '455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405', 'ypal-ordinary-reader-continue-v5.py': 'c108f1c9c10e9838b05309be28d34afbbb64c369bfe83d5641dc9d09b6762241', 'ypal-ordinary-reader-cutover-v6.manifest.json': '870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200', 'ypal-ordinary-reader-cutover-v6.py': '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0', 'ypal-ordinary-reader-peer-bound-v1.py': '865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4', 'ypal-ordinary-reader-peer-v6.py': '91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6', 'ypal-ordinary-reader-probe-bound-v1.mjs': '4cf1ae4e07477a2183ec46ef0405d5763a6a81bbe28c953a6a813b7dc88a32fc', 'ypal-ordinary-reader-probe-v6.mjs': '5d9f013eaec45299a0b52418d309a9b35d4d1630618297df3595555b840d4e69', 'ypal-ordinary-reader-proof-v6.py': '0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5', 'ypal-ordinary-reader-sql-bound-v1.mjs': '05e8c0a728a90f6ab432d73f4fb1ce51f685495405591d225e82a083fa86c8d9', 'ypal-ordinary-reader-sql-v6.mjs': 'fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019', 'ypal-ordinary-reader-wire-bound-v1.manifest.json': 'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf', 'ypal-ordinary-reader-wire-v6.manifest.json': 'f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-ordinary-restored-source-prefix-v1.manifest.json': '7c3f276e8561ba5a7e22968ad312c47f7586ad6bc2d348f5a9522b4d7621ae77', 'ypal-ordinary-restored-source-prefix-v1.py': '644d69ea670abca2b19c410aaf5e7d7a22065637f50ea63dde4f79b24d052319', 'ypal-ordinary-restored-source-prefix-v2.manifest.json': '581f4e6350f8756ecc30fab9f0548c27ba5735af543f3f05a6f1545947d9eee0', 'ypal-ordinary-restored-source-prefix-v2.py': '6bb7f2e77422ad6beb105db37b13b409ba999c5eda6d29485b5c834ff2f0d5f6', 'ypal-ordinary-restored-source-prefix-v3.manifest.json': '7958ff6dcd3e954e8638c9f491f2e01456156136342e0c27993f9754ddccd3fd', 'ypal-ordinary-restored-source-prefix-v3.py': 'a5eabb8f25f80b9f88188b1496233e2087a2d2230610a57210e112ded61e93ea', 'ypal-ordinary-restored-source-prefix-v4.manifest.json': '832c36438fa242d62468b335d4e3f4faf9c90b79307180eb545d32e3b5353eef', 'ypal-ordinary-restored-source-prefix-v4.py': '8f96b041375d262d9f68fc3582c4b6d51a382ce3a37882ebdd50074861e8d386', 'ypal-ordinary-restored-source-prefix-v5.manifest.json': '1c7c30b47392ac34dec247995921755280c15473b937c852aebbd3499f49eeba', 'ypal-ordinary-restored-source-prefix-v5.py': '3d85eb71188c736608c18879c30a2512dc22824b8464337a59bfa2f44e6a0470', 'ypal-ordinary-source-authority-v5.py': '052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0', 'ypal-ordinary-source-authority-v6.manifest.json': '80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452', 'ypal-ordinary-source-authority-v6.py': '36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3'}

def need(value,code):
    if not value:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None
def public(path,digest=None):
    path=Path(path)
    for item in[*path.parents,path]:
        row=item.lstat();need(row.st_uid==row.st_gid==0 and not stat.S_ISLNK(row.st_mode)and not row.st_mode&0o022,
            'protected_inverse_controller_file_required')
    first=path.lstat();raw=path.read_bytes();last=path.lstat()
    need(stat.S_ISREG(first.st_mode)and first.st_nlink==1 and 0<len(raw)==first.st_size<=4000000 and
        all(getattr(first,key)==getattr(last,key)for key in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
        (digest is None or sha(raw)==digest),'same_actual_inverse_controller_file_bytes_required')
    return raw
def authenticate():
    expected={'format':FORMAT+'-source','files':{FILE.name:sha(public(FILE)),**SOURCE_PINS}}
    need(json.loads(public(MANIFEST,sha(encoded(expected))))==expected,'whole_actual_inverse_controller_source_manifest_required')
    for name,digest in expected['files'].items():public(OPS/name,digest)
def module(name):
    raw=public(OPS/name,SOURCE_PINS[name]);value=types.ModuleType('inverse_controller_'+Path(name).stem.replace('-','_'));value.__file__=str(OPS/name)
    exec(compile(raw,str(OPS/name),'exec'),value.__dict__);return value
def refs3(value,input_ref=False):
    keys={'inputSha256'if input_ref else'resultSha256','producerSha256','manifestSha256'}
    need(type(value)is dict and set(value)==keys and all(pin(item)for item in value.values()),'actual_finite_inverse_controller_refs3_required')
    return copy.deepcopy(value)
def configuration(value):
    need(type(value)is dict and set(value)=={'format','stage','readerRefs','sourcePrefix','metadataInverse','cacheFinish','inverseAuthorityInputSha256','stoppedWorkloads'}and
        value['format']==FORMAT+'-input'and value['stage']in{'stop-workloads','restore-original'},'fixed_explicit_inverse_controller_stage_and_input_required')
    reader=refs3(value['readerRefs']);source=refs3(value['sourcePrefix'],True)
    metadata=None if value['metadataInverse']is None else refs3(value['metadataInverse'],True)
    finish=None if value['cacheFinish']is None else refs3(value['cacheFinish'],True)
    need(reader['producerSha256']==SOURCE_PINS[READER]and reader['manifestSha256']==SOURCE_PINS[READER_MANIFEST]and
        source['producerSha256']==SOURCE_PINS[CORE]and source['manifestSha256']==SOURCE_PINS['ypal-ordinary-consumer-prefix-source-v3.manifest.json'],
        'only_actual_reader5_and_Core3_producers_required')
    if metadata is not None:
        need(metadata['producerSha256']==SOURCE_PINS['ypal-native-metadata-approval-inverse-v2.py']and
            metadata['manifestSha256']==SOURCE_PINS['ypal-native-metadata-approval-inverse-v2.manifest.json'],
            'only_actual_distinct_metadata_inverse2_producer_required')
    if finish is not None:
        need(finish['producerSha256']==SOURCE_PINS['ypal-ordinary-cache-finish-retained-stop-v1.py']and
            finish['manifestSha256']==SOURCE_PINS['ypal-ordinary-cache-finish-retained-stop-v1.manifest.json'],
            'only_actual_retained_stop_cache_owner_refs_required')
    authority=value['inverseAuthorityInputSha256']
    stopped=value['stoppedWorkloads']
    if stopped is not None:
        need(type(stopped)is dict and set(stopped)=={'resultSha256','inputSha256','producerSha256','manifestSha256'}and
            all(pin(item)for item in stopped.values())and stopped['producerSha256']==sha(public(FILE))and
            stopped['manifestSha256']==sha(public(MANIFEST)),'actual_separate_completed_workload_stop_owner_refs_required')
    need((value['stage']=='stop-workloads'and authority is stopped is None)or
        (value['stage']=='restore-original'and pin(authority)and metadata is not None and stopped is not None),
        'restored_inverse_authority_input_only_after_actual_program_restore_required')
    return{'format':value['format'],'stage':value['stage'],'readerRefs':reader,'sourcePrefix':source,
        'metadataInverse':metadata,'cacheFinish':finish,'inverseAuthorityInputSha256':authority,'stoppedWorkloads':copy.deepcopy(stopped)}

class Context:
    def __init__(self,input_sha,stage='stop-workloads'):
        authenticate();need(pin(input_sha)and stage in INPUTS,'actual_protected_inverse_controller_input_SHA_and_stage_required')
        self.input_path=INPUTS[stage];self.input_sha=input_sha;self.config=configuration(json.loads(public(self.input_path,input_sha)));self.observations=[]
        need(self.config['stage']==stage,'actual_separate_stage_input_without_rewriting_first_input_required')
        self.core=module(CORE);self.mapper=module(MAPPER);self.runtime=self.mapper.composition()
        self.reader=module(READER);refs=self.config['readerRefs']
        self.ack=self.reader.acknowledgement(refs['resultSha256'],refs['manifestSha256'])
        need(self.ack['validated']is self.ack['immutableReaderAcknowledgementOnly']is True and
            self.ack['operatorSha256']==refs['producerSha256']and self.ack['manifestSha256']==refs['manifestSha256']and
            self.ack['receiptSha256']==refs['resultSha256']and
            self.ack['sourceActorQualified']is self.ack['currentReadersQualified']is False,
            'actual_pure_reader5_ACK_as_inverse_controller_ancestry_required')
        self.root,self.proof=self.reader.core(refs['manifestSha256']);self.operation=self.root.operation(self.proof)
        need(sha(self.root.public_input(self.root.BASE/'operation.json'))==self.ack['operationSha256'],
            'same_actual_immutable_reader5_operation_required')
        self.program=self.runtime.metadata_program(self.operation,self.config['metadataInverse'])
        self.authority=None
        if self.config['stage']=='restore-original':
            self.stopped=stopped_acknowledgement(self.config['stoppedWorkloads']['resultSha256'],
                self.config['stoppedWorkloads']['inputSha256'])
            need(all(self.stopped[name]==self.config[name]for name in['readerRefs','sourcePrefix','cacheFinish'])and
                self.stopped['operationSha256']==self.ack['operationSha256'],
                'same_actual_completed_workload_stop_before_distinct_restore_stage_required')
            need(self.stopped['metadataInverse']is None or self.stopped['metadataInverse']==self.config['metadataInverse'],
                'only_the_recorded_or_new_actual_metadata_inverse_input_may_follow_workload_stopping')
            self.root.inverse_operation(self.proof)
            need(sha(self.root.public_input(self.root.BASE/'inverse-intent.json'))==self.stopped['inverseIntentSha256'],
                'same_actual_original_business_inverse_intent_owned_by_completed_workload_stop_required')
            self.authority=module(AUTHORITY).Context(self.config['inverseAuthorityInputSha256'])
            need(self.authority.config['readerRefs']==refs and self.program['restoredRefs']==self.authority.config['metadataRestoredRefs']and
                {key:self.program['restoredRefs'][key]for key in['inputSha256','producerSha256','manifestSha256']}==self.config['metadataInverse'],
                'actual_completed_distinct_program_restore_before_inverse_SQL_context_required')
            module(BRIDGE).bind_proof(self.proof)
        else:
            need(self.program['restoredRefs']is None and self.program['proof']['phase']=='owned-upgrade-current',
                'actual_current_upgrade_before_owned_workload_stop_stage_required')
        self.mapper.bind_cache_finish(self.root,self.proof,refs,self.config['cacheFinish'])
        self.bind_phase()
        controller=self
        class InverseContext(self.proof.Context):
            def scope(self,*_args,**_kwargs):raise RuntimeError('inverse_controller_cannot_claim_forward_scope')
            def inverse_scope(self,cache_reads=None):return controller.scope(self,cache_reads)
        self.context=InverseContext(self.operation['binding']['inputs']);self.context.proof=self.proof
        self.context.owned_metadata_program=self.program
        self.cache,self.host=self.context.cache,self.context.host
        if self.authority is not None:self.authority.bind(self.cache,self.host)

    def inputs(self):
        authenticate();need(configuration(json.loads(public(self.input_path,self.input_sha)))==self.config,
            'same_actual_inverse_controller_input_required')
        refs=self.config['readerRefs']
        need(self.reader.acknowledgement(refs['resultSha256'],refs['manifestSha256'])==self.ack and
            self.root.operation(self.proof)==self.operation,'actual_reader5_ACK_and_operation_unchanged_during_inverse_required')
        if self.config['stage']=='restore-original':
            need(stopped_acknowledgement(self.config['stoppedWorkloads']['resultSha256'],self.config['stoppedWorkloads']['inputSha256'])==self.stopped and
                sha(self.root.public_input(self.root.BASE/'inverse-intent.json'))==self.stopped['inverseIntentSha256'],
                'same_actual_stop_receipt_and_original_coordinated_inverse_intent_required_at_each_boundary')

    def source_current(self,inverse=False):
        need(type(inverse)is bool,'typed_inverse_controller_source_observation_direction_required')
        self.inputs();reference=self.config['sourcePrefix']
        source_input=json.loads(public(self.core.INPUT,reference['inputSha256']))
        need(type(source_input)is dict and 'metadataInverse'in source_input and
            (source_input['metadataInverse']is None or
                encoded(source_input['metadataInverse'])==encoded(self.config['metadataInverse'])),
            'actual_Core3_protected_fixed_metadata_inverse_or_null_supplemental_input_required')
        supplemental=self.config['metadataInverse']if source_input['metadataInverse']is None else None
        proof=self.core.validate_current_source(reference['inputSha256'],supplemental)
        need(proof['format']==self.core.FORMAT and proof['operatorSha256']==reference['producerSha256']and
            proof['inputSha256']==reference['inputSha256']and proof['validated']is proof['sourceOnlyCurrent']is
            proof['sourceActorQualified']is proof['currentWriterQualified']is True and type(proof['frameworkReady'])is bool and
            proof['metadataInverseRefs']==self.config['metadataInverse']and proof['cacheFinishRefs']==self.config['cacheFinish']and
            proof['binding']['ownedConsumerPrefix']['refs']==self.config['readerRefs']and
            proof['bindingSha256']==self.core.sha(self.core.encoded(proof['binding']))and
            all(proof[name]is False for name in['sourceReadinessQualified','arenaCurrentQualified','financialAuthorityQualified',
                'oldStandaloneSuccessClaimed','originalWholeStablePassed','originalWholeFeatureInversePassed','currentReadersQualified'])and
            proof['databaseWrites']==proof['serviceActions']==proof['providerCalls']==0,
            'actual_complete_Core3_source_writer_native44_and_owned_consumer_prefix_required')
        self.inputs();return proof

    def bind_phase(self):
        original=self.proof.module_context;controller=self
        def module_context(role):
            provider=original(role)
            if role!='phase':return provider
            if controller.authority is not None:
                factory=module(BRIDGE).bind_provider(provider,controller.program['restoredRefs'])
                metadata=controller.program['restoredRefs'];inverse=True
            else:factory=provider;metadata=controller.program['forwardRefs'];inverse=False
            view=types.SimpleNamespace(**factory.__dict__)
            def create_phase(inputs,manifest):
                phase=factory.create_phase(inputs,manifest,source_guard=controller.source_current,
                    inverse=inverse,metadata_refs=copy.deepcopy(metadata))
                phase.cache.metadata_epoch.reader_operation(controller.operation['binding']['metadata']['metadataEpoch'])
                return phase
            view.create_phase=create_phase;return view
        self.proof.module_context=module_context

    def scope(self,context,cache_reads=None):
        self.inputs();catalog=self.runtime.catalog_scope(self.root,context,cache_reads)
        source=self.source_current(True)
        need(context.proof is self.proof and catalog['validated']is True and
            catalog['sourceActorQualified']is catalog['sourceReadinessQualified']is catalog['originalWholeValidatorPassed']is False,
            'genuine_source_independent_full_owned_catalog_before_inverse_source_qualification_required')
        readiness={'frameworkReadyObserved':source['frameworkReady'],'ownedInverseAllowsReadyZero':False}
        if source['frameworkReady']is False:
            need(self.config['stage']=='restore-original'and self.authority is not None and catalog['apiLoginsEnabled']is False,
                'ready_zero_is_only_an_explicit_owned_post_workload_inverse_phase')
            if catalog['ownedCacheReadsPresent']:
                prior=self.authority.value.prior_aborted(context.cache.prior_cache,context.host)
                need(prior['newHeldOwnerQualified']is True and prior['newHeldOwnerMode']=='inverse'and
                    prior['oldZeroSessionRecoveryPredicatePassed']is False,
                    'ready_zero_before_inverse_COMMIT_requires_actual_positive_owned_held_inverse_backend')
                readiness['heldInverseOwnerQualified']=True
            else:
                need(catalog['cacheInversePrefix']['inverseCommitQualified']is True,
                    'ready_zero_after_inverse_COMMIT_requires_actual_owned_XID_and_exact_restored_catalog')
                readiness['committedCacheInverseQualified']=True
            readiness['ownedInverseAllowsReadyZero']=True
        # Keep every raw observation distinct from the stable context identity.
        self.observations.append({'catalog':copy.deepcopy(catalog),'source':copy.deepcopy(source)})
        return{'format':FORMAT+'-scope','validated':True,'inverseOnly':True,'ready':False,
            **{name:catalog[name]for name in['readAdmissionSha256','readPlanSha256','readContextInputSha256']},
            'inputSha256':self.input_sha,'readerRefs':copy.deepcopy(self.config['readerRefs']),
            'sourcePrefixRefs':copy.deepcopy(self.config['sourcePrefix']),'metadataInverseRefs':copy.deepcopy(self.config['metadataInverse']),
            'cacheFinishRefs':copy.deepcopy(self.config['cacheFinish']),'catalog':catalog,
            'sourceBindingSha256':source['bindingSha256'],'sourceOnlyCurrent':True,'currentWriterQualified':True,
            **readiness,'originalReader5InverseScopePassed':False,'originalWholeValidatorPassed':False,
            'forwardAuthorityQualified':False,'wholeInverseQualified':False,'financialAuthorityQualified':False,
            'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)

def write(path,value):
    path=Path(path);raw=encoded(value)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
    sync(path.parent);return sha(raw)

def directory(branch,name):
    need(branch in{'captures','attempts'}and type(name)is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',name),
        'fixed_exclusive_inverse_controller_audit_name_required')
    for path in[BASE,BASE/branch]:
        parent=path.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==parent.st_gid==0 and not parent.st_mode&0o022,
            'actual_protected_inverse_controller_audit_parent_required')
        try:path.mkdir(mode=0o700);sync(path.parent)
        except FileExistsError:pass
        row=path.lstat();need(stat.S_ISDIR(row.st_mode)and row.st_uid==row.st_gid==0 and stat.S_IMODE(row.st_mode)==0o700,
            'actual_private_inverse_controller_audit_directory_required')
    path=BASE/branch/name;need(not os.path.lexists(path),'no_repeat_unknown_inverse_controller_capture_or_attempt')
    path.mkdir(mode=0o700);sync(path.parent);return path

def stopped_acknowledgement(result_sha,input_sha):
    """Authenticate a new stop receipt; make no current actor/serving claim."""
    authenticate();need(pin(result_sha)and pin(input_sha),'actual_completed_workload_stop_pins_required')
    config=configuration(json.loads(public(INPUTS['stop-workloads'],input_sha)))
    record=json.loads(public(BASE/'stop-workloads-result.json',result_sha))
    fields={'format','completed','operatorSha256','inputSha256','readerRefs','sourcePrefix','cacheFinish','metadataInverse',
        'operationSha256','inverseIntentSha256','nativeReadersTerminal','nativeCacheTerminal','originalBusinessStopPrefixRetained',
        'LOGINUnchanged','cacheFourREADsUnchanged','globalGenerationUnchanged','metadataProgramInversePerformed','forwardAuthorityQualified',
        'wholeInverseQualified','automaticRetryAllowed','attemptId','attemptIntentSha256','stopProofSha256','serviceActionsMayHaveOccurred'}
    need(type(record)is dict and set(record)==fields and config['stage']=='stop-workloads'and record['format']==FORMAT+'-stopped-workloads'and record['completed']is True and
        record['operatorSha256']==sha(public(FILE))and record['inputSha256']==input_sha and
        record['readerRefs']==config['readerRefs']and record['sourcePrefix']==config['sourcePrefix']and record['cacheFinish']==config['cacheFinish']and
        record['metadataInverse']==config['metadataInverse']and
        pin(record['operationSha256'])and pin(record['inverseIntentSha256'])and
        all(record[name]is True for name in['nativeReadersTerminal','nativeCacheTerminal','originalBusinessStopPrefixRetained',
            'LOGINUnchanged','cacheFourREADsUnchanged','globalGenerationUnchanged'])and
        all(record[name]is False for name in['metadataProgramInversePerformed','forwardAuthorityQualified','wholeInverseQualified','automaticRetryAllowed']),
        'actual_new_completed_stop_receipt_without_SQL_or_metadata_inverse_success_alias_required')
    need(type(record['attemptId'])is str and re.fullmatch('[a-z][a-z0-9-]{0,47}',record['attemptId'])and
        pin(record['attemptIntentSha256'])and pin(record['stopProofSha256'])and record['serviceActionsMayHaveOccurred']is True,
        'actual_exclusive_stop_attempt_and_full_private_stop_proof_required')
    intent=json.loads(public(BASE/'attempts'/record['attemptId']/'intent.json',record['attemptIntentSha256']))
    proof=json.loads(public(BASE/'attempts'/record['attemptId']/'stop-proof.json',record['stopProofSha256']))
    need(intent['format']==FORMAT+'-attempt'and intent['inputSha256']==input_sha and intent['mode']=='stop-workloads'and
        intent['readerRefs']==config['readerRefs']and intent['metadataInverse']==config['metadataInverse']and
        intent['cacheFinish']==config['cacheFinish']and intent['automaticRetryAllowed']is False and pin(intent['reference'])and
        set(proof)=={'before','after','inverseIntentSha256','originalInverseReview','publicationUnchanged','fullPostflightSha256',
            'allOriginalReaderTerminalPredicatesPassed','retainedCacheStopPredicatePassed'}and
        proof['inverseIntentSha256']==record['inverseIntentSha256']and
        sha(encoded(proof['originalInverseReview']))==record['inverseIntentSha256']and
        proof['originalInverseReview']['reviewHash']==sha(encoded(proof['originalInverseReview']['binding']))and
        proof['originalInverseReview']['binding']['operationSha256']==record['operationSha256']and proof['publicationUnchanged']is True and
        proof['allOriginalReaderTerminalPredicatesPassed']is proof['retainedCacheStopPredicatePassed']is True and
        all(proof[key]['format']==FORMAT+'-scope'and proof[key]['validated']is proof[key]['inverseOnly']is True and
            proof[key]['wholeInverseQualified']is proof[key]['originalReader5InverseScopePassed']is False and
            proof[key]['inputSha256']==input_sha and proof[key]['readerRefs']==config['readerRefs']and
            proof[key]['sourcePrefixRefs']==config['sourcePrefix']and proof[key]['metadataInverseRefs']==config['metadataInverse']and
            proof[key]['cacheFinishRefs']==config['cacheFinish']and
            proof[key]['sourceOnlyCurrent']is proof[key]['currentWriterQualified']is True and
            type(proof[key]['catalog']['apiLoginsEnabled'])is bool for key in['before','after'])and
        proof['before']['catalog']['apiLoginsEnabled']==proof['after']['catalog']['apiLoginsEnabled']and
        proof['before']['catalog']['ownedCacheReadsPresent']is proof['after']['catalog']['ownedCacheReadsPresent']is True,
        'actual_own_stop_attempt_full_scope_and_original_terminal_proof_chain_required')
    post=json.loads(public(BASE/'attempts'/record['attemptId']/'full-postflight.json',proof['fullPostflightSha256']))
    need(post['format']==FORMAT+'-postflight'and post['validated']is True and post['inputSha256']==input_sha and
        post['operatorSha256']==record['operatorSha256']and
        post['originalSource6FinishPassed']is post['originalReader5WholeInversePassed']is False,
        'actual_new_full_postflight_before_completed_workload_stop_ACK_required')
    return{**record,'receiptSha256':result_sha,'immutableAcknowledgementOnly':True,
        'currentActorQualified':False,'currentReadersQualified':False,'wholeServingInverseQualified':False}

MODES={'roles-inverse':('inverse_role_bits','roles-inverse-prepared.json','reader'),
    'cache-inverse':('inverse_cache_catalog','cache-inverse-prepared.json','cache'),
    'capsule-inverse':('inverse_global','capsule-inverse-prepared.json','reader')}

def timing_key(controller,mode):
    need(mode in MODES and controller.config['stage']=='restore-original'and controller.authority is not None,
        'actual_restored_inverse_stage_and_one_fixed_SQL_boundary_required')
    return{'format':FORMAT,'operatorSha256':sha(public(FILE)),'inputSha256':controller.input_sha,
        'readerRefs':copy.deepcopy(controller.config['readerRefs']),'sourcePrefix':copy.deepcopy(controller.config['sourcePrefix']),
        'metadataInverse':copy.deepcopy(controller.config['metadataInverse']),'cacheFinish':copy.deepcopy(controller.config['cacheFinish']),
        'stoppedWorkloads':copy.deepcopy(controller.config['stoppedWorkloads']),
        'inverseAuthorityInputSha256':controller.config['inverseAuthorityInputSha256'],
        'metadataRestoredEpoch':controller.authority.epoch.binding(),'protocolSha256':SOURCE_PINS[PROTOCOL],
        'protocolPolicy':module(PROTOCOL).policy(),'mode':mode}

def boundary(controller,mode):
    need(mode in MODES and controller.config['stage']=='restore-original'and controller.authority is not None,
        'only_actual_restored_context_may_reach_inverse_SQL_boundary')
    controller.inputs();root,c,op=controller.root,controller.context,controller.operation
    root.inverse_operation(controller.proof);root.all_readers_terminal(c,op)
    scope=c.inverse_scope(mode!='capsule-inverse');catalog=scope['catalog']
    need(catalog['apiLoginsEnabled']is(mode=='roles-inverse')and catalog['ownedCacheReadsPresent']is(mode!='capsule-inverse'),
        'exact_actual_current_LOGIN_and_cache_catalog_for_this_inverse_callback_mode_required')
    controller.cache.stopped(controller.host)
    if mode=='capsule-inverse':c.generation_terminal()
    return scope

def measured_callback(controller,mode,save_observation):
    """Execute the actual retained nested callback with only its save redirected."""
    function_name,expected,_=MODES[mode];function=getattr(controller.root,function_name)
    nested=[value for value in function.__code__.co_consts if isinstance(value,types.CodeType)and value.co_name=='prepared']
    need(len(nested)==1 and nested[0].co_consts.count(expected)==1,
        'one_exact_original_inverse_prepared_callback_and_save_literal_required')
    c,op=controller.context,controller.operation
    closure={'context':c,'op':op,'before':op['binding'].get('afterLoginCatalog'),
        'after':op['binding'].get('beforeLoginCatalog'),'committed':c.sql_ack}
    def cell(value):return(lambda:value).__closure__[0]
    def save(name,value):
        need(name==expected,'only_this_actual_original_prepared_save_may_be_redirected');save_observation(value)
    need(set(nested[0].co_freevars)<=set(closure),'all_original_inverse_callback_closure_values_must_be_actual_context_fields')
    callback=types.FunctionType(nested[0],{**function.__globals__,'save':save},nested[0].co_name,None,
        tuple(cell(closure[name])for name in nested[0].co_freevars))
    if mode=='roles-inverse':packet={'mode':'roles-inverse','before':closure['before'],'after':closure['after']}
    elif mode=='cache-inverse':packet={'mode':'inverse','planSha256':sha(c.sql_ack['resultJson'].encode()),
        'postProof':{'catalog':c.host.read_rehearsal['after']}}
    else:packet={'mode':'capsule-inverse','syntheticTimingInputOnly':True}
    return callback,packet

@contextlib.contextmanager
def retained_locks(controller):
    proof=controller.proof
    generation=proof.module('ypal-native-generation-v1.py',proof.DEPENDENCIES['ypal-native-generation-v1.py'])
    with controller.root.transition_lock(),generation.lock():yield

def postflight(controller):
    controller.inputs();scope=controller.context.inverse_scope(None);controller.inputs()
    need(scope['format']==FORMAT+'-scope'and scope['inputSha256']==controller.input_sha and
        scope['validated']is scope['inverseOnly']is scope['sourceOnlyCurrent']is scope['currentWriterQualified']is True and
        scope['originalReader5InverseScopePassed']is scope['originalWholeValidatorPassed']is False,
        'actual_new_full_Core3_source_and_owned_catalog_postflight_required')
    return{'format':FORMAT+'-postflight','validated':True,'operatorSha256':sha(public(FILE)),
        'inputSha256':controller.input_sha,'scope':scope,'originalSource6FinishPassed':False,
        'originalReader5WholeInversePassed':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def failure_postflight(controller,audit,original_error,already_attempted=False):
    def refused(error):
        return{'format':FORMAT+'-postflight','validated':False,'originalSource6FinishPassed':False,
            'failureType':type(error).__name__,'failureSha256':sha(str(error).encode())}
    if already_attempted or not isinstance(original_error,Exception):value=refused(original_error)
    else:
        try:value=postflight(controller)
        except Exception as error:value=refused(error)
    try:return write(audit/'failure-postflight.json',value)
    except Exception:return None

def failure_record(audit,value):
    # Diagnostics must not replace a genuine callback/effect exception.
    try:write(audit/'failure.json',value)
    except Exception:pass

def qualify(controller,capture_id,mode):
    authenticate();controller.inputs();key=timing_key(controller,mode);audit=directory('captures',capture_id)
    intent_sha=write(audit/'intent.json',{'binding':key,'syntheticTimingInputOnly':True,'productionCOMMITQualified':False})
    postflight_attempted=False
    try:
        with retained_locks(controller):
            prefix=boundary(controller,mode);saved=[]
            def observe(value):
                need(not saved,'exact_one_actual_original_prepared_observation_required')
                saved.append(write(audit/'prepared-observation.json',{
                    'syntheticTimingInputOnly':True,'neverProductionPreparedACK':True,'value':value})
                )
            callback,packet=measured_callback(controller,mode,observe)
            started=time.monotonic_ns();callback(packet);elapsed=time.monotonic_ns()-started
            protocol=module(PROTOCOL);target=MODES[mode][2];policy=protocol.callback_window(target)
            result={'format':FORMAT+'-timing','binding':key,'completed':True,'elapsedNanoseconds':elapsed,
                'reservedEffectNanoseconds':policy['reservedEffectNanoseconds'],'syntheticTimingInputOnly':True,
                'productionCOMMITQualified':False,'actualHeldSQLQualificationClaimed':False,
                'positiveHeldInverseBackendExercised':False,
                'observedPrefix':{name:prefix['catalog'][name]for name in['apiLoginsEnabled','ownedCacheReadsPresent']},
                'originalPreparedSaveRedirectedToOwnAudit':True,'intentSha256':intent_sha,
                'preparedObservationSha256':saved[0]if saved else None,'databaseWrites':0,'serviceActions':0,'providerCalls':0}
            need(len(saved)==1 and encoded(timing_key(controller,mode))==encoded(key),'same_actual_inverse_context_and_complete_nested_callback_required')
            protocol.require_callback_window(result,target)
        postflight_attempted=True;post=postflight(controller)
        need(encoded({name:post['scope']['catalog'][name]for name in['apiLoginsEnabled','ownedCacheReadsPresent']})==encoded(result['observedPrefix']),
            'same_actual_owned_catalog_prefix_after_synthetic_callback_required')
        result['fullPostflightSha256']=write(audit/'full-postflight.json',post)
        digest=write(audit/'result.json',result)
        return{'captureId':capture_id,'sha256':digest,'completed':True,'mode':mode,'productionCOMMITQualified':False}
    except BaseException as error:
        postflight_sha=failure_postflight(controller,audit,error,postflight_attempted)
        failure_record(audit,{'format':FORMAT,'completed':False,'failureType':type(error).__name__,
            'failureSha256':sha(str(error).encode()),'automaticRetryAllowed':False,'productionCOMMITQualified':False,
            'failurePostflightSha256':postflight_sha})
        raise

def require_timing(controller,reference,mode):
    need(type(reference)is dict and set(reference)=={'captureId','sha256'}and
        re.fullmatch('[a-z][a-z0-9-]{0,47}',reference['captureId'])and pin(reference['sha256']),
        'actual_own_inverse_mode_timing_receipt_refs_required')
    value=json.loads(public(BASE/'captures'/reference['captureId']/'result.json',reference['sha256']))
    need(value['format']==FORMAT+'-timing'and value['completed']is True and encoded(value['binding'])==encoded(timing_key(controller,mode))and
        value['syntheticTimingInputOnly']is True and value['productionCOMMITQualified']is value['actualHeldSQLQualificationClaimed']is False and
        value['positiveHeldInverseBackendExercised']is False and
        encoded(value['observedPrefix'])==encoded({'apiLoginsEnabled':mode=='roles-inverse','ownedCacheReadsPresent':mode!='capsule-inverse'})and
        value['originalPreparedSaveRedirectedToOwnAudit']is True and value['databaseWrites']==value['serviceActions']==value['providerCalls']==0,
        'only_actual_same_inverse_controller_stage_refs_and_per_boundary_callback_qualification_required')
    intent=json.loads(public(BASE/'captures'/reference['captureId']/'intent.json',value['intentSha256']))
    observed=json.loads(public(BASE/'captures'/reference['captureId']/'prepared-observation.json',value['preparedObservationSha256']))
    need(encoded(intent)==encoded({'binding':value['binding'],'syntheticTimingInputOnly':True,'productionCOMMITQualified':False})and
        observed['syntheticTimingInputOnly']is observed['neverProductionPreparedACK']is True,
        'actual_own_timing_intent_and_durable_redirected_callback_observation_required')
    post=json.loads(public(BASE/'captures'/reference['captureId']/'full-postflight.json',value['fullPostflightSha256']))
    need(post['format']==FORMAT+'-postflight'and post['validated']is True and post['inputSha256']==controller.input_sha and
        post['operatorSha256']==sha(public(FILE))and post['originalSource6FinishPassed']is post['originalReader5WholeInversePassed']is False,
        'actual_same_new_inverse_controller_full_postflight_after_callback_required')
    module(PROTOCOL).require_callback_window(value,MODES[mode][2]);return value

def business_segments(controller):
    """Authenticate the complete old driver before splitting its effect cuts."""
    root=controller.root;tree=ast.parse(public(OPS/BUSINESS,SOURCE_PINS[BUSINESS]))
    original=copy.deepcopy(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='inverse'))
    imports=[copy.deepcopy(node)for node in tree.body if isinstance(node,(ast.Import,ast.ImportFrom))]
    scope=dict(root.__dict__)
    def compiled(node):
        target=dict(scope);exec(compile(ast.fix_missing_locations(ast.Module(body=[*imports,node],type_ignores=[])),str(FILE),'exec'),target)
        return target[node.name]
    shape=module(BRIDGE).code_body
    need(shape(compiled(copy.deepcopy(original)).__code__)==shape(root.inverse.__code__),
        'complete_actual_original_reader_inverse_driver_before_explicit_stage_cuts_required')
    blocks=[node for node in original.body if isinstance(node,ast.If)and
        ast.unparse(node.test)=="not (BASE / 'inverse-global-restored.json').exists()"]
    need(len(blocks)==1 and [ast.unparse(node)for node in blocks[0].body[-3:]]==[
        'inverse_role_bits(c, op)','inverse_cache_catalog(c, op)','inverse_global(c, op, initial)'],
        'one_exact_original_workload_stop_to_SQL_boundary_cut_required')
    stop=ast.parse('def stopped_business(c,op,initial,proof):\n    pass\n').body[0]
    stop.body=copy.deepcopy(blocks[0].body[:-3])
    tail_index=original.body.index(blocks[0])+1
    tail=copy.deepcopy(original.body[tail_index:])
    need(len(tail)==9 and ast.unparse(tail[0])=='recover_metadata(c, op)'and
        ast.unparse(tail[-2])=="pin = save('inverse-result.json', value)"and isinstance(tail[-1],ast.Return),
        'complete_original_restore_and_serving_tail_with_only_old_final_ACK_save_excluded_required')
    finish=ast.parse('def restored_business(c,op,proof):\n    pass\n').body[0]
    finish.body=[*tail[:-2],ast.Return(value=ast.Name(id='value',ctx=ast.Load()))]
    recover=copy.deepcopy(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='recover_metadata'))
    captures=[node for node in ast.walk(recover)if isinstance(node,ast.Call)and ast.unparse(node)=='h.actor(metadata_op, True, pristine=False)']
    need(len(captures)==1,'one_actual_reader_metadata_inverse_actor_adapter_required')
    captures[0].func=ast.Name(id='metadata_inverse_actor',ctx=ast.Load())
    captures[0].args=[ast.Name(id=name,ctx=ast.Load())for name in['context','owner','h','metadata_op','selection']];captures[0].keywords=[]
    need(shape(compiled(copy.deepcopy(recover)).__code__)==shape(root.recover_metadata.__code__),
        'complete_actual_reader5_metadata_recovery_before_new_restored_epoch_relation_required')
    comparisons=[node for node in ast.walk(recover)if isinstance(node,ast.If)and ast.unparse(node.test)=="native != selection['nativeActor']"]
    need(len(comparisons)==1 and len(comparisons[0].body)==2 and
        'only_exact_owned_auto_restarted_metadata_may_replace_selected_actor_for_inverse'in ast.unparse(comparisons[0]),
        'one_original_selected_actor_restart_comparison_must_be_explicitly_replaced')
    replacement=ast.parse("""need(controller.config['stage']=='restore-original' and controller.authority is not None and
    h.metadata_epoch.refs==controller.authority.config['metadataRestoredRefs'] and
    not h.metadata_epoch.legacy_started(), 'only_actual_completed_C2_epoch_before_original_metadata_inverse_may_replace_historical_selection')
h.metadata_epoch.reader_operation(op['binding']['metadata']['metadataEpoch'])
h.metadata_epoch.actor_relation(native,h.metadata_epoch.ack['actor'])
""").body
    target=comparisons[0]
    for parent in ast.walk(recover):
        for name,value in ast.iter_fields(parent):
            if isinstance(value,list)and any(item is target for item in value):
                index=next(index for index,item in enumerate(value)if item is target)
                value[index:index+1]=replacement
    scope.update(controller=controller)
    recovered=compiled(recover);scope['recover_metadata']=recovered
    return compiled(stop),compiled(finish)

def _review_stop(controller):
    need(controller.config['stage']=='stop-workloads'and controller.authority is None,
        'only_original_current_upgrade_context_can_review_workload_stopping')
    controller.inputs();initial=controller.root.inverse_review(controller.proof,controller.context)
    binding={'format':FORMAT+'-stop-review','operatorSha256':sha(public(FILE)),'manifestSha256':sha(public(MANIFEST)),
        'inputSha256':controller.input_sha,'readerRefs':controller.config['readerRefs'],
        'sourcePrefix':controller.config['sourcePrefix'],'metadataInverse':controller.config['metadataInverse'],
        'cacheFinish':controller.config['cacheFinish'],'originalReview':initial}
    return{**binding,'reviewHash':sha(encoded(binding)),
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def review_stop(controller):
    with retained_locks(controller):return _review_stop(controller)

def execute(controller,mode,attempt_id,reference=None):
    """One explicit owned boundary; unknown attempts never dispatch twice."""
    authenticate();controller.inputs()
    need(mode in{'stop-workloads',*MODES,'restore-serving'},'one_fixed_inverse_controller_effect_boundary_required')
    if mode=='stop-workloads':
        need(type(reference)is str and pin(reference),'exact_fresh_workload_stop_review_hash_required')
    else:
        need(controller.config['stage']=='restore-original'and controller.authority is not None,
            'completed_distinct_C2_restore_and_own_inverse_authority_required_before_inverse_effects')
    audit=directory('attempts',attempt_id);root,c,op=controller.root,controller.context,controller.operation
    intent={'format':FORMAT+'-attempt','inputSha256':controller.input_sha,'mode':mode,
        'readerRefs':controller.config['readerRefs'],'metadataInverse':controller.config['metadataInverse'],
        'cacheFinish':controller.config['cacheFinish'],'reference':copy.deepcopy(reference),'automaticRetryAllowed':False}
    intent_sha=write(audit/'intent.json',intent);invoked=False;postflight_attempted=False
    try:
        with retained_locks(controller):
            controller.inputs();stop,finish=business_segments(controller)
            if mode=='stop-workloads':
                review=_review_stop(controller)
                need(review['reviewHash']==reference,'same_fresh_full_original_inverse_workload_review_required')
                initial=review['originalReview'];before=c.inverse_scope(True)
                root.save('inverse-intent.json',initial);invoked=True
                stop(c,op,initial,controller.proof)
                root.all_readers_terminal(c,op);controller.cache.stopped(controller.host)
                after=c.inverse_scope(True)
                need(after['catalog']['apiLoginsEnabled']==before['catalog']['apiLoginsEnabled']and
                    after['catalog']['ownedCacheReadsPresent']is before['catalog']['ownedCacheReadsPresent']is True,
                    'workload_stop_cannot_reverse_LOGIN_or_cache_four_READs')
                c.generation_terminal()
                need(encoded(root.publication_inverse_state(c))==encoded(initial['binding']['publication']),
                    'same_actual_global_publication_state_after_workload_stop_without_SQL_required')
                inverse_sha=sha(root.public_input(root.BASE/'inverse-intent.json'))
                stop_proof={'before':before,'after':after,'inverseIntentSha256':inverse_sha,
                    'originalInverseReview':initial,'publicationUnchanged':True,
                    'allOriginalReaderTerminalPredicatesPassed':True,'retainedCacheStopPredicatePassed':True}
                completion={'format':FORMAT+'-stopped-workloads','completed':True,'operatorSha256':sha(public(FILE)),
                    'inputSha256':controller.input_sha,**{name:copy.deepcopy(controller.config[name])for name in
                        ['readerRefs','sourcePrefix','cacheFinish','metadataInverse']},
                    'operationSha256':controller.ack['operationSha256'],'inverseIntentSha256':inverse_sha,
                    **{name:True for name in['nativeReadersTerminal','nativeCacheTerminal','originalBusinessStopPrefixRetained',
                        'LOGINUnchanged','cacheFourREADsUnchanged','globalGenerationUnchanged','serviceActionsMayHaveOccurred']},
                    **{name:False for name in['metadataProgramInversePerformed','forwardAuthorityQualified','wholeInverseQualified','automaticRetryAllowed']},
                    'attemptId':attempt_id,'attemptIntentSha256':intent_sha}
                business_return=stop_proof
            elif mode in MODES:
                receipt=require_timing(controller,reference,mode);boundary(controller,mode)
                root.inverse_operation(controller.proof)
                need(not (root.BASE/(mode+'-intent.json')).exists(),
                    'unknown_or_previously_dispatched_inverse_SQL_requires_actual_XID_reconciliation_not_retry')
                write(audit/'timing.json',receipt);invoked=True
                fn=getattr(root,MODES[mode][0])
                value=fn(c,op,root.inverse_operation(controller.proof)[1])if mode=='capsule-inverse'else fn(c,op)
                completion={'format':FORMAT+'-boundary-result','completed':True,
                    'inputSha256':controller.input_sha,'mode':mode,'value':value,'automaticRetryAllowed':False,
                    'originalReader5WholeInversePassed':False}
                business_return=value
            else:
                need(reference is None,'serving_restore_has_no_synthetic_SQL_timing_alias')
                root.inverse_operation(controller.proof);root.all_readers_terminal(c,op)
                c.inverse_scope(False);controller.cache.stopped(controller.host);c.generation_terminal()
                need((root.BASE/'inverse-global-restored.json').exists()and not c.logins_enabled(),
                    'actual_global_and_catalog_inverse_before_original_metadata_and_legacy_serving_restore_required')
                invoked=True;business=finish(c,op,controller.proof)
                completion={'format':FORMAT+'-restored','completed':True,'operatorSha256':sha(public(FILE)),
                    'inputSha256':controller.input_sha,'readerRefs':controller.config['readerRefs'],
                    'metadataInverse':controller.config['metadataInverse'],'cacheFinish':controller.config['cacheFinish'],
                    'retainedBusinessObservation':business,'originalReader5WholeInversePassed':False,
                    'oldReader5InverseResultFabricated':False,'forwardAuthorityQualified':False,'automaticRetryAllowed':False}
                business_return=business
        write(audit/'business-return.json',{'mode':mode,'value':business_return,'originalReader5WholeInversePassed':False})
        postflight_attempted=True;post_sha=write(audit/'full-postflight.json',postflight(controller))
        if mode=='stop-workloads':
            stop_proof['fullPostflightSha256']=post_sha
            completion['stopProofSha256']=write(audit/'stop-proof.json',stop_proof)
            result_sha=write(BASE/'stop-workloads-result.json',completion)
        else:
            completion['fullPostflightSha256']=post_sha
            result_sha=write(audit/'result.json',completion)
        return{'format':FORMAT,'completed':True,'mode':mode,'attemptId':attempt_id,'sha256':result_sha,
            'automaticRetryAllowed':False,'originalReader5WholeInversePassed':False}
    except BaseException as error:
        postflight_sha=failure_postflight(controller,audit,error,postflight_attempted)
        failure_record(audit,{'format':FORMAT,'completed':False,'mode':mode,'failureType':type(error).__name__,
            'failureSha256':sha(str(error).encode()),'effectsMayHaveOccurred':invoked,'automaticRetryAllowed':False,
            'unknownOutcomeRequiresActualJournalsXIDAndCatalogInspection':invoked,'failurePostflightSha256':postflight_sha})
        raise
if __name__=='__main__':
    print(json.dumps({'format':FORMAT,'staticOnly':True,'forwardAuthorityQualified':False,'inverseEffectsQualified':False,
        'databaseWrites':0,'serviceActions':0,'providerCalls':0}))
