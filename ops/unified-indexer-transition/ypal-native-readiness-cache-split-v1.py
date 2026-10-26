#!/usr/bin/env python3
"""Owned guard preparation/full verification/READ activation; no old prepared ACK."""
import ast,copy,hashlib,json,os,re,stat,time,types
from pathlib import Path
OPS=Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE=OPS/'ypal-native-readiness-cache-split-v1.py'
MANIFEST=FILE.with_suffix('.manifest.json')
FORMAT='yunipals-native-readiness-cache-split-v1'
BASE=Path('/var/backups/yunipals-native-readiness-cache-split-v1-20261026')
INPUT=Path('/var/backups/yunipals-native-readiness-cache-split-input-v1-20261026/input.json')
ENTRY=OPS/'ypal-ordinary-cache-two-phase-sql-v1.mjs'
DRIVER=OPS/'ypal-ordinary-cache-two-phase-driver-v1.mjs'
COMPONENT=OPS/'ypal-ordinary-cache-two-phase-v1.mjs'
SQL_MANIFEST=COMPONENT.with_suffix('.manifest.json')
SQL_SOURCE_REVIEWED=True
CLASSIFIER_REFS={'producerSha256':'4d4840a66b9c2cd7dd045f399294c5445232c73dbe58e56e1f46b1b3fcb6e0da','manifestSha256':'c27e4fe498bf70561f94bd8a7737c7c9a217965dff8ad7352b6491e8e2f47944'}
SQL_REFS={'entrySha256':'464f103743169d55a1cc237b1db397d8e7f19d7869952457ce25f4c8dd6563cb','driverSha256':'72e2bec6aa91997029d31074d40165fc79dc99f1c8003aab3ab9f3973380a3c7','componentSha256':'cd14d8dc2cdfaaf0e223d4531f28747519cdd7fb07fcfefad868546eea99687d','manifestSha256':'037072fc91809e25caec68d26036cf8fc28d3ab8b0c501d70b9f2b57f775abba'}
SOURCE_PINS={'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-ordinary-accept-v1.manifest.json': '8494ce4ba63ca8d0f7be8889ef90ea23395632ac1ca1d032a93d63567cc4f08b', 'arena-ypal-ordinary-accept-v1.py': 'b3dce2f8dbfa26dc219101dd29be866aad1d3944f0db6de9915a838555080295', 'arena-ypal-ordinary-bound-v1.manifest.json': 'bc38a18b86b181624305f0e1d754ee7e6cf3b333368afe1de3daa44a91757dd4', 'arena-ypal-ordinary-bound-v1.py': '1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'final-supervisor-inventory-v1.py': 'ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-readview-v5-plan.mjs': '91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201', 'ypal-combined-readview-v5.preparation.json': 'd968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-combined-source-manifest-v1.json': 'a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-generation-runtime-install-v3.py': '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b', 'ypal-latest-complete-main-api-install-v1.py': '43d98f0aa8993b408133f24a77bdab50663fa79fb77840c7478db369d7e7be9f', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-metadata-peer-stat-churn-classifier-v1.manifest.json': 'c27e4fe498bf70561f94bd8a7737c7c9a217965dff8ad7352b6491e8e2f47944', 'ypal-metadata-peer-stat-churn-classifier-v1.py': '4d4840a66b9c2cd7dd045f399294c5445232c73dbe58e56e1f46b1b3fcb6e0da', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-approval-current-observer-v1.manifest.json': 'cbd018b3dd15b2874a6b6834e76b07538d2ac493831428d6701136de2a41d432', 'ypal-native-metadata-approval-current-observer-v1.py': '17a24566753c1903e1c4be3a0f9d66f24d44cd9aaee30b16ceedb21cceeb2498', 'ypal-native-metadata-approval-epoch-prefix-v1.manifest.json': '4412879f5b71b61f17d16a6cf852c1516e2d9332389b14fe4d2c546b94d3763b', 'ypal-native-metadata-approval-epoch-prefix-v1.py': '744812132f794887e4025515045fbd74dc9b9ec298deb454e4b13ea7bb402923', 'ypal-native-metadata-approval-epoch-v1.manifest.json': 'd30975e78bad3bdb80a16c498bd7b069ce557dfdb4328c5628d0101088aa2575', 'ypal-native-metadata-approval-epoch-v1.py': '68759ef0f1d5909e50b06620e79ab41aa13faa350333cca1b9632bda6252cf25', 'ypal-native-metadata-approval-epoch-v2.manifest.json': '7d53fd78c48264f41b1c053468b61c806f57e135b90f70dbaa0828cca69fc90e', 'ypal-native-metadata-approval-epoch-v2.py': '5f395d9e4cc68edd88e7b0a7c0d3db2fff80901aa881c373186387285e5a92e3', 'ypal-native-metadata-approval-epoch-v3.manifest.json': '464c94cd0bea1412573bfdf026fe43e2dc36f0fb04e46e01b7a3ae58e65b391e', 'ypal-native-metadata-approval-epoch-v3.py': '62eb7e6b138b83818842b4848e5e9512b4cb3196890ef298dc2513932f2862e1', 'ypal-native-metadata-approval-install-v1.py': '5fa35ac24e6747b06a648504967c1be6b7f52687ee5f9e3295bcd79c2fe3981a', 'ypal-native-metadata-approval-inverse-v1.manifest.json': 'd2178d4232fb95bd98690098e49282ce124f6dcfbc695d18c92620ff78e576eb', 'ypal-native-metadata-approval-inverse-v1.py': '545a0b389c162af6fda15c64ab998621d796ec87409218738e2c5faaad6ebbd7', 'ypal-native-metadata-approval-inverse-v2.manifest.json': '759c0d1120dd1fc4aa597472fcc4a548eaf7c766c8023bc91ae8cf42e2f8f1bd', 'ypal-native-metadata-approval-inverse-v2.py': '2910f1376f96d4ced4107b67ca10dbed05b587012c01518b2955b7f2bf9a91ea', 'ypal-native-metadata-approval-inverse-v3.manifest.json': 'd94d2c8ed899f9b4fd3e222adea2d0e660596f130de93fc65462bfa8141f41c6', 'ypal-native-metadata-approval-inverse-v3.py': 'e0d455c4e9e53f2f0540dd6f26ae74485b645cb31be945931e8a52474f219654', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-metadata-readiness-policy-v1.py': 'cf90a20457cd981f4b4c94ed93e3bd8ad6729588bdbeaa748d3b2146bae787a9', 'ypal-native-metadata-readiness-policy-v2.manifest.json': '89b2d78177b5e7356fb65a21ae87f8eac7e6a6c0a59184b68dd202858e99ea53', 'ypal-native-metadata-readiness-policy-v2.py': '33c6cae5ffe0980376a3ce5a6baa76096e2a619a7869b1b57c5f82de7e941210', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-native-readiness-context-v2.manifest.json': 'c02976516442987d2da4999b821842916766cf30c70442fc62b006fc7483f865', 'ypal-native-readiness-context-v2.py': '7b967fd41bbac13827da508fca011a282c7aee6844e7c95b2255e8e492c8af95', 'ypal-native-readiness-direct-commit-v1.manifest.json': '29a6a2cca203bd613372456368310b1a67bbe8d58222b45c522e0f3c8944c735', 'ypal-native-readiness-direct-commit-v1.py': 'f9d6c7e9fbd39fe7e922ec132a41069024e63c79f18b946d9ce2eda51f682ecb', 'ypal-native-readiness-generation-binding-v1.manifest.json': '326928118cf5953d1b366acffcf5e27296bd82a5b02649544eb4316ca82ac56c', 'ypal-native-readiness-generation-binding-v1.py': 'b774481ba6920a8904d8fc4f0ef279a00546e9cc70e8ad87efba5b65fc499915', 'ypal-native-readiness-prepared-binding-v1.manifest.json': '8c775588084c7c5d37b57ac43abe251d3facef29543dd5fea9ce756dfa6118d4', 'ypal-native-readiness-prepared-binding-v1.py': '77fab87ac98eafe2487627151b0dc7d09ce6083cced00dc8c84ffa1f4089fe2a', 'ypal-old-runtime-inventory-v1.py': '7034021dd679f1f6739e2a3591da9b9507e555382f86cbfc3de22f52829d4c3b', 'ypal-ordinary-cache-callback-timing-v5.py': 'c32c3885d322d4fbcd4b06998d5969e66d5ea4beb6f818341723353379f43bfb', 'ypal-ordinary-cache-continuation-authority-v1.manifest.json': '1131a7c181917cef8521475b7181341a15fbc9c09019beb3dff91e7d0cc13c48', 'ypal-ordinary-cache-continuation-authority-v1.py': 'c413474538ad61e21b5d41736b1ca86687c2b4540639a1a760b4993ae2438dd7', 'ypal-ordinary-cache-continuation-authority-v2.manifest.json': 'cd1f95a8db31650e2eb1283819a25ca9f528b5a950d35b19ae757625e3b4ffe6', 'ypal-ordinary-cache-continuation-authority-v2.py': '6ab6b0ae7e0bff7107cee6c50a709de631e505c1acef101a34ce9ec6290e303f', 'ypal-ordinary-cache-continuation-authority-v3.manifest.json': '3c2ae723c55faa505c834a604f13feb3b98f7f193202b017cf761f04bf002263', 'ypal-ordinary-cache-continuation-authority-v3.py': '0446dea37801f282c97d613ded19f75491925487fddbea5dc25441a1733b5ca7', 'ypal-ordinary-cache-continuation-authority-v4.manifest.json': 'a6516798d717724fdce8086fe6afeb05888badcbc60199ebc346eb629890f60a', 'ypal-ordinary-cache-continuation-authority-v4.py': '938b15ee463f7c950828eadeac3e599305d01dbfd8b8ddccd8a974f88b31a240', 'ypal-ordinary-cache-continuation-authority-v5.manifest.json': '2b19fe520f291ef01bc2133b18e0fe9406c6a67a0eeae55067ee1dc5fa399d78', 'ypal-ordinary-cache-continuation-authority-v5.py': 'd95bbcceb812dd7d3acc9e828a78f6125870a021dbfeed952f6c477f48003bef', 'ypal-ordinary-cache-continuation-authority-v6.manifest.json': 'c43a672f4261f437f829dc32b55b4ed9c903bc60e7420b955c976687dae02651', 'ypal-ordinary-cache-continuation-authority-v6.py': '3062235af98d22a2d357c44d6f1e85160bddc1cf0ef1f51ab620ecf982c33873', 'ypal-ordinary-cache-continuation-context-v1.py': 'f0aeed34d9bfc0fe710a82465af253c879d2c118c36ec9ff9232d75318b88449', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-finish-v6.py': 'ec9a88b93543a114138b1198b865ef5b31de2d79ef08a6d014b4e938ca51b4a0', 'ypal-ordinary-cache-peer-v6.py': '4ddd3b021c31e7a2f663df82bb7e3308c22b5b2f1cec5345979286efcff59e04', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-cache-two-phase-driver-v1.mjs': '72e2bec6aa91997029d31074d40165fc79dc99f1c8003aab3ab9f3973380a3c7', 'ypal-ordinary-cache-two-phase-sql-v1.mjs': '464f103743169d55a1cc237b1db397d8e7f19d7869952457ce25f4c8dd6563cb', 'ypal-ordinary-cache-two-phase-v1.manifest.json': '037072fc91809e25caec68d26036cf8fc28d3ab8b0c501d70b9f2b57f775abba', 'ypal-ordinary-cache-two-phase-v1.mjs': 'cd14d8dc2cdfaaf0e223d4531f28747519cdd7fb07fcfefad868546eea99687d', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-ordinary-downstream-refs-accept-v1.py': '2d2e8b1550332e215564cbeefb12a2fbea42f87ba1d978aab2aa337f212e3ce6', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f', 'ypal-ordinary-feature-context-accept-v1.py': '3ec482f59adafd674116d821abe3ab39db46b1ab21d3ffeeee5892fe390f6984', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-v5.py': 'da2fea0aa36277c1c464ca27ad280b03ba31bfec2730182779ac839638496656', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-accept-v1.manifest.json': '431d59f132898c8302854b78dc6cf4fd44a41504e48ce810b1e8d2f6ffaf3b65', 'ypal-ordinary-feature-handover-accept-v1.py': 'd5d1614372bcbd0008806f5378c6085c56f95d516608493ee9f318b5cc5856b1', 'ypal-ordinary-feature-handover-bound-v1.manifest.json': 'dda74ac69d400d22e6a6cace532a9022e4619cd23643cc9d00b4e9de4c11bb47', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-v5.py': 'cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-feature-inverse-actors-v1.py': '3c47d4f9f17d415d3039e939f297c63a29554480a467dc5603a5331da7e49ce2', 'ypal-ordinary-feature-inverse-call-v1.manifest.json': '44d728e05c4f7a6cd19e400790e102987917c7822b21097eb19f0649d75c6259', 'ypal-ordinary-feature-inverse-call-v1.py': 'dfe03159dc60015e175403da7caecb2c4a51212d2a2e620daeb207118e51ad4e', 'ypal-ordinary-feature-inverse-prefix-v1.py': '3741736fef01c793d8d749d34156cf0891efe380a0b402914a5b2614d1a7ceea', 'ypal-ordinary-feature-inverse-source-v1.manifest.json': 'ab82933b80168ab99862b443d7656efdf4dd2d8030d6f737b2599850ec3ddf81', 'ypal-ordinary-feature-inverse-source-v1.py': 'f19c67fcef83437c7db856a3b45e06ee416cab7268f79e34447c33d59a55febe', 'ypal-ordinary-generation-accept-binding-v1.py': '4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758', 'ypal-ordinary-generation-accept-binding-v2.manifest.json': '0f5bcd31ead0971f6d3fba26f238f8d7eefbc20f39d2db8a51ca9a356f6aac27', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-generation-accept-v1.py': '1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d', 'ypal-ordinary-generation-accept-v2.py': 'b6b6eb8c707290c29fbcd6eedf2e13c6c1d5dcc293a3806b0d6ab76bc9ab49fe', 'ypal-ordinary-generation-accept-v3.py': '29c44cdb1e3614eda39601c0e8bff29233f8a39369f01e5acb47530fc88138e3', 'ypal-ordinary-generation-attempt-v1.py': '6202db1e5124ce81823854ffa09e77410b6495c695b463028bc150bc57b564b3', 'ypal-ordinary-generation-attempt-v2.py': '4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753', 'ypal-ordinary-generation-attempt-watch-v1.py': '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41', 'ypal-ordinary-generation-attempt-watch-v2.py': '47005973bc9ec17cd65f8b3044ef9e4dda438821fd651c289608b0fd2f8a86ae', 'ypal-ordinary-generation-binding-v1.manifest.json': 'a6d4f0b8669eadcc44a1c880e76996f015e645ef9976b79e418e02e26bd1859b', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-generation-candidates-v5.py': '869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca', 'ypal-ordinary-generation-recovery-semantic-v1.mjs': 'ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-generation-terminal-v1.py': '5ac441e3c3b0d3494cd256682f987a60b1d4119d4be6c1db7cb446642bb79613', 'ypal-ordinary-generation-v5c.py': 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da', 'ypal-ordinary-generation-watch-v5c.py': 'f1ebc76c182d4146de7c006fa2dad5567aa8fb6d0dfe16e807648a2792911885', 'ypal-ordinary-managed-handover-accept-v1.manifest.json': '97104caa6f4b9e907e2b46a0f55b5e0eb3e087917f39643ad1e583b0ea2c1e14', 'ypal-ordinary-managed-handover-accept-v1.py': '83f9c88acd2c27b94cfc785595b30baaf2f26d858df772ff5ecc91c72cfcccdc', 'ypal-ordinary-managed-handover-bound-v1.manifest.json': '5a5e76e842aab87e76baaa540afd851961ff71cee0e7a54d2ac77b646f8a27be', 'ypal-ordinary-managed-handover-bound-v1.py': '415746545c901bedea9424e8e2330940d68a77cd303958b9551350de30e1717c', 'ypal-ordinary-managed-handover-v3.py': '8ca8c1c99c32e31c88c23136bc722c7d8d6c4756e9dd947eddb84ed1ded8ecf3', 'ypal-ordinary-managed-parent-phase-v1.py': '317779c460b99873f4408b0e1b4a9c9992a6c2270d33aa66fbec754affc6d16d', 'ypal-ordinary-managed-runtime-v2.py': '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199', 'ypal-ordinary-metadata-capture-diagnostic-v1.py': '2e40af94d2f5108d199678166454da8a5c872a4f650fbbc03ac4aeb022c86465', 'ypal-ordinary-metadata-current-effect-v1.manifest.json': '3e9730067b03934d67c307773eaeb4e453eb440225ad45ae249587337065aa33', 'ypal-ordinary-metadata-current-effect-v1.py': '9d79c54f8828f36a120241c61a36e28a4c3423731a87fc8824aaecdf7c9305c7', 'ypal-ordinary-metadata-current-epoch-v1.manifest.json': 'ac005ac44651a31c954426cca6edde676a4e337ab2c926d001538fc784a7ab62', 'ypal-ordinary-metadata-current-epoch-v1.py': '7175b73f0f278a77b92ccabc2bd38258de81197884cc24bcbe30a7abdaa09e0f', 'ypal-ordinary-metadata-current-epoch-v2.manifest.json': 'acfc5b210f00688b17389c3c6d197398c4e865935ddf2c3e43f340d7c74dbb66', 'ypal-ordinary-metadata-current-epoch-v2.py': '3486c4c59e936e32f17694b33edd626f336d37119d67b674a60c65f723d8f98b', 'ypal-ordinary-metadata-current-epoch-v3.manifest.json': '801d0a1bb33f83dba6645c25babaf9ddae6ba041b9dde967afda171bd4d80bbc', 'ypal-ordinary-metadata-current-epoch-v3.py': '33ae8619fe0a43b94745b1a00ae57db166592c83ccf6a997d50cd8c583fdff51', 'ypal-ordinary-metadata-current-observation-v1.manifest.json': '4f58cbaf4a8ff0d051771c38ceeb37c2a03ded3af53ab795a240e5d2c036ad36', 'ypal-ordinary-metadata-current-observation-v1.py': 'f536ddc6eb003a04817642833846fd2d035b4c74c2aa7477b4f85ce3b548fdc2', 'ypal-ordinary-metadata-current-policy-v1.manifest.json': '168564578553273d2eacfe5515f04989bc91deb0dca487934b0e905c77307d3c', 'ypal-ordinary-metadata-current-policy-v1.py': '8de587a380c63341cbcbd0fc1d831f3e531e5b88bbdb8775eb1a4c2f7b584479', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-observer-retained-prefix-v1.py': '451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e', 'ypal-ordinary-publication-accept-v1.py': '06212b568ee5298679633e3dfc30f9e47007c5624ff1a1ff441891f8128c6fcb', 'ypal-ordinary-publication-accept-v2.py': '7c518d97f1c4f425dce8dee8a4ad3f6f06a37454b0346de177c4cd60b32e56d0', 'ypal-ordinary-publication-bound-v1.py': '667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130', 'ypal-ordinary-publication-caller-v6.py': 'c7828062bbc7446ea4b00b7e84394d3ef8ce0aa11efeb88b82fddc3cc7c4345a', 'ypal-ordinary-publication-continue-inputs-v1.py': '9fb641bf7cd35aed3032e2d080a77e92b53f58e6692c29b9baff012f4e4e0332', 'ypal-ordinary-publication-continue-inputs-v2.py': 'bb89dc2a3e798e7d507a9fa723ba7eb4ec679ffe64c7e83922bfb8d35c697ba7', 'ypal-ordinary-publication-continue-inputs-v3.py': '0d3e1579cb529c2606c861adc1009cfa4217ba3c8b4b3a4081cad878089f5757', 'ypal-ordinary-publication-continue-inputs-v4.py': '2b17e31f4de3c1b236d475ae367aa02058af9f3eea359dc2c66eb81ef8c4f3b2', 'ypal-ordinary-publication-continue-manifest-v1.py': '9be7d281fafd5dfab9fdba1a9c7dff0ee6db4219eb9d4cdaef7d6a57ed7a238c', 'ypal-ordinary-publication-continue-manifest-v2.py': 'ca66e80b9880d945bbadaed2bab40de70b0425d5a49f73f00a3c0d01ae19d7e4', 'ypal-ordinary-publication-continue-manifest-v3.py': '561cf8300d8fd48c5874982fb434928241d8a37ee22c96a0251a7057430db257', 'ypal-ordinary-publication-continue-manifest-v4.py': 'ea04d92ca3ba46c5e35102ebd6a8ce1695704d5538f53dbcc43177b6dafe257b', 'ypal-ordinary-publication-continue-v1.py': '6bf7e33971d3331d84ba843ca4952db3f9024ebcee56fba0ff67a5cecbab0151', 'ypal-ordinary-publication-continue-v2.py': '5234d3fae4d7231ad7b966eae133d9132c71ad3098ce463672720c563d9f3aa2', 'ypal-ordinary-publication-continue-v3.py': 'a4a1269b25aaa336fc101cc51252d7d1c275ccef0be63d84e59a4df1b2a22730', 'ypal-ordinary-publication-continue-v4.py': 'c4d86df5b1228147f9677db49d76932f4d187b67ffd09172a92f553c835a4f92', 'ypal-ordinary-publication-continue-v6.py': '55391a93cabc13393abf449a77bb667e6ab41a853cdd9089af6fa437c2c4532c', 'ypal-ordinary-publication-input-render-accept-v1.py': 'f934344ffa62c336d5dd4a057d05f6a8568139b52452080af02c33849e092705', 'ypal-ordinary-publication-input-render-accept-v2.py': '31ae49e472c2dc03fc84e70fdd8f443094b0959b591542f46a92a74d3f74ba85', 'ypal-ordinary-publication-input-render-v1.py': 'edff30e35a7253e2487afb12938f0c93571897c6ec25eff96769a3d405614b31', 'ypal-ordinary-publication-kernel-v1.py': '6b261303f659ab2f8b9152733b5eeb6f3cb02be1c09f1ab38380dc41d3795e3a', 'ypal-ordinary-publication-kernel-v1.stage.json': 'd527d90edfebd43fae93e6200e58dad1a0f1cc965a31a0f7c39d21ddd3887e5e', 'ypal-ordinary-publication-observation-v1.manifest.json': 'd6fdd6668f73c1bb19574682cbd72e4167c8c990f4da9b6c5ab88e1427c4bbc1', 'ypal-ordinary-publication-observation-v1.py': 'f04a6fde624aa5a3805f6f8b4b3f34fa0d03e1e036f4a8237c88b3261f822d4f', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-publication-query-v2.py': 'deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-read-cache-accept-v1.py': 'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-ordinary-read-cache-bound-v1.py': '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f', 'ypal-ordinary-read-cache-continue-v1.py': 'e4b0a18fc1358a04da6a6a47c8363d193836d23493a28f6c09a1780e3dadc06e', 'ypal-ordinary-read-cache-continue-v2.py': '6155280da8f53e6e3448c024bc3e142a5f69a8d3e1a6a39ae3faa8c1d44d1a34', 'ypal-ordinary-read-cache-continue-v3.py': 'e64a7787a0991e196222998caebd9773da67b8cf9272dcc778758c8953e77e89', 'ypal-ordinary-read-cache-continue-v4.py': 'c8c98989c6cb6b2e301e07faeeda4d99f38d2ec70277f5217acff9b06e21d952', 'ypal-ordinary-read-cache-continue-v5.py': '30ee6c1935822dc2a000ea9aa874117b3e7f5cd8dee1e2d180f6a5206f85b326', 'ypal-ordinary-read-cache-continue-v6.py': '34d9c17004896b2164b21891502e89198019ffac4764f9d6ff279a31542aab22', 'ypal-ordinary-read-cache-v5.py': '387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2', 'ypal-ordinary-read-cache-v6.py': '46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c', 'ypal-ordinary-read-catalog-v5.sql': '8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd', 'ypal-ordinary-reader-accept-v1.py': '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e', 'ypal-ordinary-reader-accept-v2.manifest.json': '688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666', 'ypal-ordinary-reader-accept-v2.py': '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5', 'ypal-ordinary-reader-bound-v1.manifest.json': 'bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095', 'ypal-ordinary-reader-bound-v1.py': '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17', 'ypal-ordinary-reader-continue-v1.manifest.json': '2f0834fda702e6bc2a2bbbb49a2502c7d50b7201aae6978f7aeed340a28426de', 'ypal-ordinary-reader-continue-v1.py': '5858b50e59ddc1d5ee04e0f8443143d0d6aee78fd927fee4f6d9fbe9b62a747d', 'ypal-ordinary-reader-continue-v2.manifest.json': '8c08dd3285dca10b36012e84807ea932ebfafc119c926989a048e66ff1fed743', 'ypal-ordinary-reader-continue-v2.py': '1d86989516bbcd4823c11f12761a073585437315e0d2e2c9b7f9e7253792f4a7', 'ypal-ordinary-reader-continue-v3.manifest.json': '518d91ec7341543d7a07ba62d92d0b2f583ac52eec240d234b9deeca5f39712d', 'ypal-ordinary-reader-continue-v3.py': 'a476ee8b8f3e19b4b02ff71df596f2b998896adda1743e65ebc98551582bc89a', 'ypal-ordinary-reader-continue-v4.manifest.json': '1c131cf6a0da4613ecf83b3c11028433be0192cd7ee3f99a360ea80268df1b24', 'ypal-ordinary-reader-continue-v4.py': '7514129125e50c35152356e5090de88f3a51758f4090a763f74eb7f417c1d6bc', 'ypal-ordinary-reader-continue-v5.manifest.json': '455c09d5f17761892d1d46718bafac3f97c317753d0040d55938794ee6957405', 'ypal-ordinary-reader-continue-v5.py': 'c108f1c9c10e9838b05309be28d34afbbb64c369bfe83d5641dc9d09b6762241', 'ypal-ordinary-reader-continue-v6.manifest.json': '524c45b6453c7eee4bfc876a47f1e93df49c59afc8be7a383ee068f177c799ca', 'ypal-ordinary-reader-continue-v6.py': '00df5c7aaef17793eba8a1c07ff70a4a8b744c31afcd8a77a2a902a683d9da96', 'ypal-ordinary-reader-cutover-v6.manifest.json': '870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200', 'ypal-ordinary-reader-cutover-v6.py': '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0', 'ypal-ordinary-reader-peer-bound-v1.py': '865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4', 'ypal-ordinary-reader-peer-v6.py': '91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6', 'ypal-ordinary-reader-probe-bound-v1.mjs': '4cf1ae4e07477a2183ec46ef0405d5763a6a81bbe28c953a6a813b7dc88a32fc', 'ypal-ordinary-reader-probe-v6.mjs': '5d9f013eaec45299a0b52418d309a9b35d4d1630618297df3595555b840d4e69', 'ypal-ordinary-reader-proof-v6.py': '0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5', 'ypal-ordinary-reader-sql-bound-v1.mjs': '05e8c0a728a90f6ab432d73f4fb1ce51f685495405591d225e82a083fa86c8d9', 'ypal-ordinary-reader-sql-v6.mjs': 'fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019', 'ypal-ordinary-reader-wire-bound-v1.manifest.json': 'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf', 'ypal-ordinary-reader-wire-v6.manifest.json': 'f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4', 'ypal-ordinary-readiness-family-v1.manifest.json': '007cecccd07233192d654cca359735746cee14497b4b145d5cb7936d8c71abb3', 'ypal-ordinary-readiness-family-v1.py': 'fe24870db3a6adb079c28c57c5ae1cfa77bbf8b3e6b039c967b2fc352811c346', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-ordinary-restored-source-prefix-v1.manifest.json': '7c3f276e8561ba5a7e22968ad312c47f7586ad6bc2d348f5a9522b4d7621ae77', 'ypal-ordinary-restored-source-prefix-v1.py': '644d69ea670abca2b19c410aaf5e7d7a22065637f50ea63dde4f79b24d052319', 'ypal-ordinary-source-authority-v5.py': '052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0', 'ypal-ordinary-source-authority-v6.manifest.json': '80e2b98a8b69542ea438ebe7f8a1bc90144b48ca2238c74bb8f40fb21b5d7452', 'ypal-ordinary-source-authority-v6.py': '36832c82b1e0ee26664630c18bf7496ef26eea596ae68bb878e54ba61b6d7e82', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3'}
STAGES={'prepare-guards','activate-reads'}
SEMANTIC=('release','identity','state','implementation','errorCode','frontier')
SQL_FORMAT='yunipals-ordinary-cache-two-phase-v1'
RECONCILIATION_ROOT=Path('/var/backups/yunipals-root-cont6-failed-cache-reconciliation-20261026-2/result.json')
RECONCILIATION_PRODUCER_SHA='caea00d91f690822b5f042ec4fbf9547b74961060354f68c931e4f61538b497b'
FAILED_ROOT=Path('/var/backups/yunipals-root-cont6-cache-commit-20261026-1/result.json')

def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)+'\n').encode()
def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def js_encoded(value):return json.dumps(value,separators=(',',':'),ensure_ascii=False).encode()
def pin(value):return type(value)is str and re.fullmatch('[a-f0-9]{64}',value)is not None and value!='0'*64
def public(path,digest=None):
 path=Path(path)
 for item in[*path.parents,path]:
  r=item.lstat();need(r.st_uid==r.st_gid==0 and not stat.S_ISLNK(r.st_mode)and not r.st_mode&0o022,'protected_split_source_or_owned_record_required')
 before=path.lstat();raw=path.read_bytes();after=path.lstat()
 need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and 0<len(raw)==before.st_size<=8000000 and
  all(getattr(before,k)==getattr(after,k)for k in['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])and
  (digest is None or pin(digest)and sha(raw)==digest),'same_exact_split_source_or_record_required');return raw
def document(path,digest=None):return json.loads(public(path,digest))
def authenticate():
 value={'format':FORMAT+'-source','files':{FILE.name:sha(public(FILE)),**SOURCE_PINS}}
 need(document(MANIFEST)==value,'complete_owned_split_source_manifest_required')
 for name,digest in value['files'].items():public(OPS/name,digest)
def load(name):
 value=types.ModuleType('owned_split_'+name.replace('-','_'));value.__file__=str(OPS/name)
 exec(compile(public(OPS/name,SOURCE_PINS[name]),str(OPS/name),'exec'),value.__dict__);return value
def sync(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:os.fsync(fd)
 finally:os.close(fd)
def save(area,name,value):
 need(re.fullmatch('[a-z0-9-]+[.]json',name)is not None,'fixed_owned_split_journal_name_required')
 raw=value if type(value)is bytes else encoded(value);fd=os.open(area/name,os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_WRONLY,0o600)
 with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
 sync(area);return sha(raw)
def frame(paths):
 rows={}
 for path in paths:
  path=Path(path);raw=public(path);r=path.lstat();rows[str(path)]={'sha256':sha(raw),**{k:getattr(r,k)for k in['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns','st_ctime_ns']}}
 return rows

class Context:
 def __init__(self,session,input_sha):
  authenticate();need(pin(input_sha),'actual_owned_split_sidecar_SHA_required')
  self.input_sha=input_sha;self.config=document(INPUT,input_sha);cfg=self.config
  need(type(cfg)is dict and set(cfg)=={'format','nativePolicyRefs','forwardAuthorityInputSha256','forwardBaselineCapture','failedCommitRootSha256','reconciliationRootSha256','captureClassifierRefs','sqlRefs'}and cfg['format']==FORMAT+'-input',
   'exact_owned_split_sidecar_without_legacy_input_changes_required')
  need(cfg['captureClassifierRefs']==CLASSIFIER_REFS,'actual_reviewed_metadata_capture_classifier_sidecar_refs_required')
  self.session=session;self.cache,self.host=session.cache,session.host;self.family=session.continuation_caller.native_readiness_family
  self.authority=self.family.authority_context;self.value=self.authority.value
  need(session.source.inverse is False and session.readonly_preflight is not None and self.cache is self.authority.bound_cache and self.host is self.authority.bound_host and
   cfg['nativePolicyRefs']==self.family.readiness.refs and cfg['forwardAuthorityInputSha256']==self.authority.input_sha and
   not hasattr(session,'native_readiness_direct_commit_binding')and self.value.TTL_NS==120_000_000_000 and self.value.COMMIT_RESERVE_NS==5_000_000_000,
   'fresh_full_preflight_constructor_and_generation_bound_native120_split_context_required')
  need(hasattr(session,'native_readiness_prepared_binding')and hasattr(session,'native_readiness_generation_binding'),
   'both_actual_owned_forward_constructor_bindings_required')
  capture_cfg={**cfg,'upgradeRefs':session.metadata_epoch.refs}
  self.forward=load('ypal-native-metadata-approval-inverse-v3.py').forward_capture(capture_cfg)
  self.before,self.rehearsal,_=self.cache.stopped(self.host)
  need(self.before['binding']['config']==self.host.config and sha(public(self.cache.BASE/'before.json'))==self.forward['result']['beforeSha256'],
   'same_actual_baseline4_original_configuration_and_before_required')
  self.original_plan_json=self.rehearsal['sql']['resultJson'];self.original_plan=json.loads(self.original_plan_json);self.cache.exact_four(self.original_plan)
  self.reconciliation=document(RECONCILIATION_ROOT,cfg['reconciliationRootSha256'])
  recon=self.reconciliation
  need(pin(RECONCILIATION_PRODUCER_SHA)and recon['rootSourceSha256']==RECONCILIATION_PRODUCER_SHA and recon['format']=='yunipals-root-cont6-failed-cache-reconciliation-v2'and
   recon['completed']is recon['completeBaselineCatalogQualified']is recon['allColumnACLsQualified']is recon['fullSourcePostflightPassed']is recon['allOriginalFileBytesAndInodesUnchanged']is True and
   recon['failedCommitResultSha256']==cfg['failedCommitRootSha256']and recon['transactionId']=='17621037'and recon['transactionStatus']=='aborted'and
   recon['ownedChildGone']is True and recon['ownedBackendCount']==0 and recon['productionPreparedACKCreated']is recon['productionCOMMITQualified']is recon['automaticRetryAllowed']is False,
   'actual_completed_owned_failure_reconciliation_before_any_guard_preparation_required')
  for name,digest in recon['privateHashes'].items():
   need(re.fullmatch('[a-z0-9-]+[.]json',name)and pin(digest),'finite_real_reconciliation_proof_name_required');public(RECONCILIATION_ROOT.parent/name,digest)
  self.failed=document(FAILED_ROOT,cfg['failedCommitRootSha256']);packet=self.cache.document(self.cache.BASE/'sql-prepared.json')
  need(self.failed['completed']is False and self.failed['commitInvoked']is True and self.failed['commitReturned']is False and
   self.failed['heldTestWaived']is True and self.failed['automaticRetryAllowed']is False and packet['mode']=='apply'and packet['xid']=='17621037'and
   self.cache.xact_status(self.host,packet['xid'])=='aborted','actual_failed_old_commit_must_be_aborted_not_replayed_or_unknown')
  self.cache.child_gone(self.host,'apply-sql-child.json')
  self.old_frames=frame(self.cache.BASE.iterdir());self.initial_identity=self.value.new_identity(self.cache,self.host)
  self.gates={};self.observations={};self.preparation=None;self.verification=None

 def inputs(self):
  authenticate();self.authority.inputs()
  need(document(INPUT,self.input_sha)==self.config and document(RECONCILIATION_ROOT,self.config['reconciliationRootSha256'])==self.reconciliation and frame(map(Path,self.old_frames))==self.old_frames and
   self.value.new_identity(self.cache,self.host)==self.initial_identity,'same_split_sidecar_ancestry_old_journals_and_current_identity_required')
  return self.binding()

 def binding(self):
  return{'format':FORMAT,'operatorSha256':sha(public(FILE)),'manifestSha256':sha(public(MANIFEST)),'inputSha256':self.input_sha,
   'nativePolicyRefs':copy.deepcopy(self.config['nativePolicyRefs']),'forwardAuthorityInputSha256':self.authority.input_sha,
   'forwardBaselineCapture':copy.deepcopy(self.config['forwardBaselineCapture']),'failedCommitRootSha256':self.config['failedCommitRootSha256'],'reconciliationRootSha256':self.config['reconciliationRootSha256'],
   'constructorBindingSha256':sha(encoded(self.session.native_readiness_prepared_binding)),
   'generationBindingSha256':sha(encoded(self.session.native_readiness_generation_binding)),
   'captureClassifierRefs':copy.deepcopy(self.config['captureClassifierRefs']),'sqlRefs':copy.deepcopy(self.config['sqlRefs']),'sealedPublicTransportTemplateSha256':SOURCE_PINS['ypal-ordinary-cache-peer-v6.py'],'approvalTTLSeconds':120,'literalACKTailSeconds':5,
   'heldTestWaived':True,'heldQualificationPerformed':False,'oldC54WholeValidatorPassed':False,'oldCachePreparedACKClaimed':False}

 def sql_sources(self):
  need(SQL_SOURCE_REVIEWED is True,'reviewed_actual_two_phase_SQL_producer_required_before_any_child')
  refs=self.config['sqlRefs'];need(refs==SQL_REFS,'exact_frozen_owned_two_phase_SQL_source_refs_required');need(type(refs)is dict and set(refs)=={'entrySha256','driverSha256','componentSha256','manifestSha256'}and all(pin(x)for x in refs.values()),'actual_two_phase_SQL_source_refs_required')
  for path,key in[(ENTRY,'entrySha256'),(DRIVER,'driverSha256'),(COMPONENT,'componentSha256'),(SQL_MANIFEST,'manifestSha256')]:public(path,refs[key])
  manifest=document(SQL_MANIFEST,refs['manifestSha256'])
  need(manifest['files'][ENTRY.name]==refs['entrySha256']and manifest['files'][DRIVER.name]==refs['driverSha256']and manifest['files'][COMPONENT.name]==refs['componentSha256'],
   'complete_real_SQL_driver_component_and_entry_manifest_required')
  for name,digest in manifest['files'].items():
   need(Path(name).name==name and pin(digest),'finite_owned_SQL_source_basename_required');public(OPS/name,digest)
  return refs

 def peer_transport(self):
  self.sql_sources();peer=load('ypal-ordinary-cache-peer-v6.py')
  # Only the immutable public module allowlist/entry changes in a fresh
  # namespace. Complete sealed-FD creation, hook template, environment, close
  # and no-private-files rules remain the frozen transport implementation.
  manifest=document(SQL_MANIFEST,self.config['sqlRefs']['manifestSha256'])
  pins={name:digest for name,digest in manifest['files'].items()if name.endswith('.mjs')}
  need(ENTRY.name in pins and DRIVER.name in pins and COMPONENT.name in pins and len(pins)<=16,
   'finite_exact_public_two_phase_ESM_import_closure_required')
  peer.ENTRY=ENTRY.name;peer.PINS=pins
  return peer.public_transport()

 def launch_gate(self,host,mode,stage):
  need(host is self.host and mode in{'apply','inspect'},'same_actual_split_Host_and_wire_apply_mode_required')
  self.inputs()
  if mode=='inspect':return None
  observations=[]
  selected=load('ypal-native-readiness-direct-commit-v1.py').renewal_wait(self.value,self.authority,host,observations)
  metadata_actor=self.session.metadata_epoch.current()
  need(self.session.source.authority._snapshot()==self.session.source.authority.expected,'same_live_source_actor_private_and_program_frame_immediately_before_SQL_required')
  gate=self.authority.approval_snapshot(host)
  need(gate['ttlNanoseconds']==120_000_000_000 and gate['remainingNanoseconds']>5_000_000_000 and gate['officialApprovalRefreshedByThisGate']is False,
   'genuine_unchanged_native120_launch_approval_required')
  self.gates[stage]=gate;self.observations[stage]={'observations':observations,'selected':selected,'actualLaunchApproval':gate,'metadataActorCurrent':metadata_actor}
  save(self.stage_area,'approval-launch.json',self.observations[stage])

 def late_gate(self,host,mode,stage):
  need(host is self.host and mode=='apply'and stage in self.gates,'same_actual_split_packet_and_launch_ancestry_required')
  gate=self.gates[stage]
  if stage=='prepare-guards':self.value.check_deadline(gate)
  # The activation packet carries the SQL transaction's genuine final approval,
  # taken after all SQL proof/fence work. The packet checker sets this deadline;
  # no Python clock or stale launch row is reset/relabelled as that approval.
  deadline=getattr(self,'packet_deadline',None)
  need(type(deadline)is float and time.monotonic()<deadline,'actual_final_split_approval_and_five_second_literal_ACK_required')
  return deadline

 def transport(self,area,stage):
  refs=self.sql_sources();raw=self.cache._sql_child
  expected=self.value.bounded_sql_parent(self.cache.prior_cache._sql_child,self.cache.prior_cache._sql_child)
  need(self.value.code_identity(raw.__code__)==self.value.code_identity(expected.__code__)and raw.__defaults__==expected.__defaults__ and raw.__closure__==expected.__closure__,
   'complete_original_V6_cache_parent_before_owned_split_identity_required')
  fn=copy.deepcopy(self.value.original_parent_ast());counts={'launch':0,'ack':0}
  for node in ast.walk(fn):
   for field,body in ast.iter_fields(node):
    if not isinstance(body,list):continue
    out=[]
    for item in body:
     if isinstance(item,ast.Assign)and isinstance(item.value,ast.Call)and ast.unparse(item.value.func)=='subprocess.Popen':
      out+=ast.parse('_split_launch(host,mode)').body;counts['launch']+=1
     if isinstance(item,ast.Expr)and isinstance(item.value,ast.Call)and ast.unparse(item.value.func)=='proc.stdin.write'and any(isinstance(v,ast.Constant)and v.value=='commit-authorized'for v in ast.walk(item)):
      out+=ast.parse('deadline=min(deadline,_split_ack(host,mode))').body;counts['ack']+=1
     out.append(item)
    setattr(node,field,out)
  need(counts=={'launch':1,'ack':1},'exact_two_original_launch_and_literal_ACK_hook_locations_required')
  scope={**raw.__globals__,'transport_scope':self.peer_transport,
   'public_cache_node_args':lambda public:[*public.node_arguments()[:-1],'--import',str(self.cache.TSX),public.node_arguments()[-1]],'BASE':area,'ENTRY':ENTRY,'ENTRY_SHA':refs['entrySha256'],'COMPONENT':COMPONENT,'COMPONENT_SHA':refs['componentSha256'],
   'save':lambda name,value:save(area,name,value),'_split_launch':lambda host,mode:self.launch_gate(host,mode,stage),
   '_split_ack':lambda host,mode:self.late_gate(host,mode,stage)}
  return self.value.compiled_parent(fn,scope,raw.__defaults__,raw.__closure__)

 def plan(self,stage):
  need(stage in STAGES,'fixed_owned_split_stage_required')
  return{**self.original_plan,'phase':stage,'originalPlanJson':self.original_plan_json,
   'preparationReceiptJson':None if stage=='prepare-guards'else self.preparation['resultJson'],
   'verificationFence':None if stage=='prepare-guards'else self.verification['fence']}

 def packet(self,area,stage,plan,packet):
  need(packet['mode']=='apply'and re.fullmatch('[1-9][0-9]*',packet['xid'])and packet['event']=='commit-prepared'and
   packet['planSha256']==sha(canonical(plan)),'same_owned_split_apply_prepared_packet_required')
  contract=packet['postProof']['phaseContract']
  expected={'format','phase','originalPlanSha256','catalogSha256','epochs','fullHeldCallbackClaimed','oldC54CommitClaimed'}
  if stage=='activate-reads':expected|={'approval','verificationFenceSha256'}
  need(set(contract)==expected and contract['format']==SQL_FORMAT+'-commit-boundary'and contract['phase']==stage and
   contract['originalPlanSha256']==sha(canonical(self.original_plan))and contract['catalogSha256']==sha(canonical(self.catalog(packet['after'])))and
   contract['epochs']==packet['after']['epochs']and contract['fullHeldCallbackClaimed']is contract['oldC54CommitClaimed']is False,
   'actual_complete_pinned_SQL_phase_and_catalog_boundary_required')
  need(packet['postProof']['allColumnAcl']==self.before['catalog']['postProof']['allColumnAcl']and
   packet['postProof']['catalog']==self.expected_read_catalog(stage,packet),
   'complete_original_READ143_plus71_and_only_owned_four_READ_delta_required')
  if stage=='prepare-guards':
   self.value.check_deadline(self.gates[stage])
   self.packet_deadline=min(time.monotonic()+5,(self.gates[stage]['capturedMonotonicNanoseconds']+self.gates[stage]['remainingNanoseconds'])/1e9)
  else:
   approval=contract['approval'];snap=approval['snapshot']
   need(approval['policyTTLSeconds']==120 and approval['literalACKReserveSeconds']==5 and approval['producerApprovalWrittenByThisGate']is False and
    all(type(approval[k])is str and re.fullmatch('[0-9]+',approval[k])for k in['ageNanoseconds','queryNanoseconds','remainingNanoseconds','capturedMonotonicNanoseconds'])and
    0<=int(approval['ageNanoseconds'])<120_000_000_000 and int(approval['remainingNanoseconds'])>5_000_000_000 and
    snap['probe']is snap['nativeMode']is snap['canonical']is True and snap['frontier']==snap['frameFrontier']and
    {key:snap[key]for key in SEMANTIC}==self.verification['fence']['approvalSemantic'],
    'real_late_native120_approval_same_semantic_identity_and_full_canonical_frame_required')
   need(contract['verificationFenceSha256']==sha(canonical(self.verification['fence']))and
    packet['before']['epochs']==self.verification['fence']['epochs'],
    'actual_locked_same_verified_epoch_and_catalog_fence_required')
   self.packet_deadline=time.monotonic()+5
  # Child independently enforces its own capture-to-COMMIT five-second bound
  # and actual producer expiry. Its hrtime origin is never compared to Python.
  save(area,'sql-prepared.json',packet)

 @staticmethod
 def catalog(value):return{**value,'epochs':[{'collection':row['collection']}for row in value['epochs']]}

 def expected_read_catalog(self,stage,packet):
  before=self.before['catalog']['postProof']['catalog']
  if stage=='prepare-guards':return before
  # Execute the complete original comparator. The only accepted graph delta is
  # the four exact authorized READ edges; actual graphs are never normalized.
  self.cache.read_extension(before,packet['postProof']['catalog'],self.original_plan,packet['postProof']['catalog'])
  return packet['postProof']['catalog']

 def execute(self,stage):
  self.inputs();need(stage in STAGES,'fixed_owned_split_stage_required')
  if stage=='prepare-guards':
   need(not os.path.lexists(BASE),'fresh_owned_split_operation_required_no_replay');BASE.mkdir(mode=0o700);sync(BASE.parent)
   save(BASE,'intent.json',{'binding':self.binding(),'oldFiles':self.old_frames,'customerREADsPermitted':False,'automaticRetryAllowed':False})
  else:
   self.preparation=acknowledgement(self.config,self.input_sha,'prepare-guards')
   self.verification=document(BASE/'verification.json')
   need(self.cache.xact_status(self.host,self.preparation['transactionId'])=='committed','actual_preparation_COMMIT_must_remain_proven')
   need(self.verification['binding']==self.binding()and self.verification['preparationReceiptSha256']==self.preparation['receiptSha256'],
    'actual_owned_preparation_and_fresh_full_verification_before_activation_required')
  area=BASE/stage;area.mkdir(mode=0o700);sync(BASE);self.stage_area=area;plan=self.plan(stage);plan_json=js_encoded(plan).decode()
  save(area,'intent.json',{'binding':self.binding(),'phase':stage,'planJson':plan_json,'automaticRetryAllowed':False})
  with self.host.read_host.primitives['sdk'].lock():
   result=self.transport(area,stage)(self.host,'apply',plan,lambda packet:self.packet(area,stage,plan,packet),plan_json=plan_json)
  need(result['acknowledged']is True and result['mode']=='apply'and json.loads(result['resultJson'])==result['result']and
   self.cache.xact_status(self.host,result['xid'])=='committed','actual_owned_split_COMMIT_ACK_and_committed_XID_required')
  save(area,'sql-committed.json',result)
  self.inputs();receipt={'format':FORMAT+'-'+stage,'binding':self.binding(),'phase':stage,'committed':True,'transactionId':result['xid'],
   'result':result['result'],'resultJson':result['resultJson'],'sqlCommittedSha256':sha(public(area/'sql-committed.json')),
   'phaseFiles':{path.name:sha(public(path))for path in area.iterdir()},
   'customerREADsGranted':stage=='activate-reads','originalCachePreparedACKClaimed':False,'automaticRetryAllowed':False}
  digest=save(area,'receipt.json',receipt);return{**receipt,'receiptSha256':digest}

 def activation_record(self,host):
  self.inputs();need(host.config==self.before['binding']['config'],'same_original_cache_configuration_for_owned_activation_current_required')
  receipt=acknowledgement(self.config,self.input_sha,'activate-reads');record=document(BASE/'activate-reads'/'sql-committed.json',receipt['sqlCommittedSha256'])
  need(record['mode']=='apply'and record['xid']==receipt['transactionId']and self.cache.xact_status(host,record['xid'])=='committed',
   'actual_owned_activation_XID_and_full_journal_not_oldC54_COMMIT_required')
  return record

 def current_reads_function(self):
  original=getattr(self,'original_current_reads',None)
  if original is None:original=self.cache.validate_reads.__globals__['current_reads_new']
  raw=public(OPS/'ypal-restored-read-cache-provider-v1.py',SOURCE_PINS['ypal-restored-read-cache-provider-v1.py']);tree=ast.parse(raw)
  fn=copy.deepcopy(next(node for node in tree.body if isinstance(node,ast.FunctionDef)and node.name=='current_reads'))
  counts={'catalog':0};fn=self.family.readiness.transform_catalog_node(fn,counts)
  need(counts=={'catalog':1},'one_existing_native120_expected_catalog_seam_before_owned_activation_required')
  imports=[node for node in tree.body if isinstance(node,(ast.Import,ast.ImportFrom))];scope={}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[*imports,copy.deepcopy(fn)],type_ignores=[])),str(FILE),'exec'),scope)
  need(self.value.code_identity(original.__code__)==self.value.code_identity(scope['current_reads'].__code__),
   'complete_actual_Family6_current_READ_body_before_owned_receipt_branch_required')
  branch=[node for node in fn.body if isinstance(node,ast.If)and ast.unparse(node.test)=='cache_reads']
  need(len(branch)==1,'one_original_four_READ_journal_branch_required')
  branch[0].body=ast.parse("saved=_split.activation_record(host)\nexpected=saved['postProof']['catalog']\nneed(saved['postProof']['allColumnAcl']==columns,'all_actual_global_column_ACLs_preserved_by_owned_activation')\nhost.cache.read_extension(rehearsal['after']['read'],expected,_split.original_plan,expected)").body
  scope={**original.__globals__,'_split':self}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[*imports,fn],type_ignores=[])),str(FILE),'exec'),scope)
  return scope['current_reads']

 def bind_host_current(self):
  host=self.host;need(not getattr(host,'native_readiness_split_current',None),'one_owned_split_current_binding_per_Host_required')
  self.original_current_reads=self.cache.validate_reads.__globals__['current_reads_new'];actual=self.current_reads_function();context=self
  def current(host_,cache_reads=False,enabled=False,expected_catalog=None,inverse=False):
   need(host_ is host and inverse is False,'same_owned_activation_forward_Host_required_no_inverse_alias')
   value=actual(host_,True,enabled,expected_catalog,False)
   return{**value,'format':FORMAT+'-current-reads','operatorSha256':sha(public(FILE)),'splitBinding':context.binding(),
    'oldC54WholeValidatorPassed':False,'oldCachePreparedACKClaimed':False}
  method=host.refresh.__func__;refresh=method.__globals__['refresh_current']
  need(refresh.__code__==load('ypal-restored-read-cache-provider-v1.py').refresh.__code__,
   'whole_original_static_file_and_official_closure_refresh_before_owned_READ_route_required')
  refreshed=types.FunctionType(refresh.__code__,{**refresh.__globals__,'current_reads':current},refresh.__name__,refresh.__defaults__,refresh.__closure__)
  host.refresh=types.MethodType(types.FunctionType(method.__code__,{**method.__globals__,'refresh_current':refreshed},method.__name__,method.__defaults__,method.__closure__),host)
  validate=self.cache.validate_reads
  self.cache.validate_reads=types.FunctionType(validate.__code__,{**validate.__globals__,'current_reads_new':current},validate.__name__,validate.__defaults__,validate.__closure__)
  host.native_readiness_split_current=self.binding();self.owned_current_reads=current
  return current

 def accept(self):
  self.inputs();activation=acknowledgement(self.config,self.input_sha,'activate-reads')
  need(not os.path.lexists(BASE/'prepared.json'),'one_honest_owned_split_prepared_acknowledgement_required')
  if not getattr(self.host,'native_readiness_split_current',None):self.bind_host_current()
  else:need(self.host.native_readiness_split_current==self.binding(),'same_already_owned_activation_consumer_before_accept_required')
  before,_,_=self.cache.stopped(self.host);current=self.cache.validate_reads(self.host)
  self.host.refresh();need(self.host.prerequisites()==before['binding']['prerequisites']and
   self.host.read.consumer_frame(self.host.h)==before['binding']['consumerFrame'],
   'all_original_unpublished_generation_metadata_and_private_legacy_readers_before_owned_ACK_required')
  http=self.cache.legacy_http(self.host,True)
  need(self.host.read.consumer_frame(self.host.h)==before['binding']['consumerFrame'],'same_legacy_reader_private_configuration_after_actual_HTTP_required')
  value={'format':FORMAT+'-prepared','prepared':True,'operatorSha256':sha(public(FILE)),'manifestSha256':sha(public(MANIFEST)),
   'binding':self.binding(),'config':copy.deepcopy(self.host.config),'beforeSha256':sha(public(self.cache.BASE/'before.json')),'originalReviewHash':self.before['reviewHash'],
   'originalBeforeFile':str(self.cache.BASE/'before.json'),'originalProviderSha256':self.before['binding']['operatorSha256'],
   'readAdmissionSha256':self.host.config['readAdmissionSha256'],'additionalReadCount':4,
   'additionalReadAcknowledgementSha256':activation['sqlCommittedSha256'],'activationReceiptSha256':activation['receiptSha256'],
   'preparationReceiptSha256':sha(public(BASE/'prepare-guards'/'receipt.json')),'verificationSha256':sha(public(BASE/'verification.json')),
   'nativeWorkerStarted':False,'nativeGenerationPublished':False,'legacy103ServingAccepted':True,'legacyHTTP':http,
   'preservation':current['preservation'],'cacheBootDisabled':True,'coordinatedPublicationAndReaderSwitchStillRequired':True,
   'oldC54WholeValidatorPassed':False,'oldCachePreparedACKClaimed':False}
  digest=save(BASE,'prepared.json',value);return{**value,'receiptSha256':digest}

 def validate_prepared_current(self,result_sha):
  value=prepared_acknowledgement(result_sha,self.input_sha)
  if not getattr(self.host,'native_readiness_split_current',None):self.bind_host_current()
  current=self.cache.validate_reads(self.host);self.cache.stopped(self.host)
  need(self.host.prerequisites()==self.before['binding']['prerequisites']and
   self.host.read.consumer_frame(self.host.h)==self.before['binding']['consumerFrame'],
   'all_original_same_unpublished_generation_metadata_and_terminal_cache_current_required')
  return{**current,'format':FORMAT+'-prepared-current','preparedReceiptSha256':result_sha,'generationId':self.before['binding']['prerequisites']['generationId'],
   'legacyHTTP':self.cache.legacy_http(self.host,True),'nativeWorkerStarted':False,'nativeGenerationPublished':False,
   'databaseWrites':0,'serviceActions':0,'providerCalls':0,'oldCachePreparedACKClaimed':False}

 def verify(self):
  self.inputs();self.preparation=acknowledgement(self.config,self.input_sha,'prepare-guards')
  need(not os.path.lexists(BASE/'verification.json'),'one_owned_full_verification_after_preparation_required')
  area=BASE/'verification';area.mkdir(mode=0o700);sync(BASE)
  observe=self.transport(area,'observe');first=observe(self.host,'inspect')
  need(first['inspected']is True and first['databaseWrites']==0 and self.catalog(first['state'])==self.catalog(self.preparation['result']['after']),
   'actual_current_complete_owned_guard_preparation_catalog_before_full_proof_required')
  first_gate=self.authority.approval_snapshot(self.host)
  source_before=self.session.source.current();self.cache.stopped(self.host);self.host.refresh();proof=self.host.prerequisites()
  need(proof==self.before['binding']['prerequisites'],'all_original_metadata_generation_prerequisites_after_guard_prep_required')
  http=self.cache.legacy_http(self.host,True);source_after=self.session.source.current();last=observe(self.host,'inspect')
  gate=self.authority.approval_snapshot(self.host)
  need(source_before==source_after and self.host.read.consumer_frame(self.host.h)==self.before['binding']['consumerFrame']and
   first['state']==last['state']and {key:first_gate['snapshot'][key]for key in SEMANTIC}=={key:gate['snapshot'][key]for key in SEMANTIC},
   'full_source_metadata_private_reader_catalog_epoch_and_semantic_bookends_required')
  full={'source':source_after,'prerequisites':proof,'legacyHTTP':http,'metadataEpoch':self.session.metadata_epoch.binding(),
   'approvalBefore':first_gate,'approvalAfter':gate,'catalogBefore':first,'catalogAfter':last}
  fence={'format':SQL_FORMAT+'-verification-fence','preparationReceiptSha256':sha(canonical(self.preparation['result'])),
   'catalogSha256':sha(canonical(self.catalog(last['state']))),'epochs':last['state']['epochs'],
   'approvalSemantic':{key:gate['snapshot'][key]for key in SEMANTIC},'fullVerificationSha256':sha(canonical(full))}
  value={'format':FORMAT+'-verification','binding':self.binding(),'preparationReceiptSha256':self.preparation['receiptSha256'],'full':full,'fence':fence,
   'allOriginalPredicatesEvaluated':True,'heldQualificationPerformed':False,'automaticRetryAllowed':False}
  save(BASE,'verification.json',value);return value

def acknowledgement(config,input_sha,stage):
 authenticate();need(stage in STAGES and document(INPUT,input_sha)==config,'same_owned_split_receipt_input_required')
 area=BASE/stage;value=document(area/'receipt.json');raw=public(area/'receipt.json')
 binding=value['binding']
 need(binding['nativePolicyRefs']==config['nativePolicyRefs']and binding['forwardAuthorityInputSha256']==config['forwardAuthorityInputSha256']and
  binding['captureClassifierRefs']==config['captureClassifierRefs']==CLASSIFIER_REFS and binding['failedCommitRootSha256']==config['failedCommitRootSha256']and binding['reconciliationRootSha256']==config['reconciliationRootSha256']and binding['sqlRefs']==config['sqlRefs']and
  binding['forwardBaselineCapture']==config['forwardBaselineCapture']and binding['manifestSha256']==sha(public(MANIFEST)),
  'same_complete_actual_split_phase_identity_and_owned_sidecar_required')
 need(value['format']==FORMAT+'-'+stage and value['phase']==stage and value['committed']is True and value['binding']['inputSha256']==input_sha and
  value['binding']['operatorSha256']==sha(public(FILE))and value['sqlCommittedSha256']==sha(public(area/'sql-committed.json'))and
  value['originalCachePreparedACKClaimed']is value['automaticRetryAllowed']is False,'actual_owned_split_phase_acknowledgement_required')
 need(set(value['phaseFiles'])=={path.name for path in area.iterdir()if path.name!='receipt.json'},'complete_exclusive_owned_phase_journal_namespace_required')
 for name,digest in value['phaseFiles'].items():
  need(re.fullmatch('[a-z0-9-]+[.]json',name)and pin(digest),'finite_immutable_phase_file_required');public(area/name,digest)
 result=document(area/'sql-committed.json');need(result['xid']==value['transactionId']and result['resultJson']==value['resultJson']and result['result']==value['result'],
  'same_actual_split_SQL_transaction_and_exact_receipt_serialization_required')
 return{**value,'receiptSha256':sha(raw)}

def prepared_acknowledgement(result_sha,input_sha):
 authenticate();need(pin(result_sha)and pin(input_sha),'actual_owned_split_prepared_and_sidecar_SHA_required')
 config=document(INPUT,input_sha);value=document(BASE/'prepared.json',result_sha)
 need(value['format']==FORMAT+'-prepared'and value['prepared']is True and value['operatorSha256']==sha(public(FILE))and
  value['manifestSha256']==sha(public(MANIFEST))and value['binding']['inputSha256']==input_sha and
  value['oldC54WholeValidatorPassed']is value['oldCachePreparedACKClaimed']is value['nativeWorkerStarted']is value['nativeGenerationPublished']is False,
  'new_split_prepared_ACK_never_oldC54_whole_success_required')
 prep=acknowledgement(config,input_sha,'prepare-guards');activation=acknowledgement(config,input_sha,'activate-reads')
 verification=document(BASE/'verification.json',value['verificationSha256'])
 need(value['binding']==prep['binding']==activation['binding']==verification['binding']and verification['preparationReceiptSha256']==prep['receiptSha256'],
  'same_complete_owned_preparation_verification_activation_and_prepared_binding_required')
 need(value['preparationReceiptSha256']==prep['receiptSha256']and value['activationReceiptSha256']==activation['receiptSha256']and
  value['additionalReadAcknowledgementSha256']==activation['sqlCommittedSha256']and value['additionalReadCount']==4 and
  value['verificationSha256']==sha(public(BASE/'verification.json'))and
  value['originalBeforeFile']=='/var/backups/yunipals-ypal-ordinary-read-cache-continue-v6-20261026/before.json'and
  value['beforeSha256']==sha(public(Path(value['originalBeforeFile'])))and
  document(Path(value['originalBeforeFile']))['binding']['config']==value['config']and
  value['originalProviderSha256']==SOURCE_PINS['ypal-ordinary-read-cache-continue-v6.py'],
  'complete_actual_split_guard_verification_activation_and_original_config_ACK_chain_required')
 return{**value,'receiptSha256':result_sha,'immutableAcknowledgementOnly':True,'currentQualified':False,'databaseWrites':0,'serviceActions':0,'providerCalls':0}

def bind_current(cache,host,input_sha,readiness):
 """Construct only an owned consumer route; every current fact executes live."""
 authenticate();config=document(INPUT,input_sha);activation=acknowledgement(config,input_sha,'activate-reads')
 genuine=load('ypal-native-readiness-context-v2.py').Context
 need(all(getattr(type(readiness),name,None).__code__==method.__code__ for name,method in vars(genuine).items()if isinstance(method,types.FunctionType))and
  config['nativePolicyRefs']==readiness.refs and host.cache is cache and host.inverse_mode is False,
  'actual_same_native120_Context_and_fresh_forward_Host_for_owned_cache_receipt_required')
 if hasattr(host,'_native_readiness_split_consumer'):
  prior=host._native_readiness_split_consumer
  need(prior.input_sha==input_sha and host.native_readiness_split_current==activation['binding'],'same_already_owned_split_consumer_required')
  return prior.owned_current_reads
 value=Context.__new__(Context);value.input_sha=input_sha;value.config=config;value.cache,value.host=cache,host
 value.family=types.SimpleNamespace(readiness=readiness);value.value=load('ypal-ordinary-cache-continuation-authority-v1.py')
 value.before,value.rehearsal=cache.owned(host);value.original_plan_json=value.rehearsal['sql']['resultJson'];value.original_plan=json.loads(value.original_plan_json);cache.exact_four(value.original_plan)
 need(host.config==value.before['binding']['config']and cache.xact_status(host,activation['transactionId'])=='committed',
  'actual_committed_owned_activation_and_unchanged_original_cache_config_for_consumer_required')
 def inputs():
  authenticate();need(document(INPUT,input_sha)==config and acknowledgement(config,input_sha,'activate-reads')==activation,
   'same_actual_owned_activation_chain_during_current_consumer_required')
  readiness.current();return copy.deepcopy(activation['binding'])
 value.inputs=inputs;value.binding=lambda:copy.deepcopy(activation['binding'])
 result=value.bind_host_current();host._native_readiness_split_consumer=value;return result


def bind_session(session,input_sha):
 """After genuine Host init and before its first metadata-slot refresh."""
 authenticate();config=document(INPUT,input_sha);activation=acknowledgement(config,input_sha,'activate-reads')
 need(session.cache is None and session.host is None and session.source.inverse is False and
  not hasattr(session,'native_readiness_split_consumer_binding'),'fresh_forward_session_before_owned_activated_cache_construction_required')
 provider=session.provider;readiness=session.continuation_caller.native_readiness_family.readiness
 proxy=load('ypal-native-readiness-context-v2.py').Proxy;original_namespace=provider.namespace
 def namespace(configured,manifest=None,source_guard=None):
  original=original_namespace(configured,manifest,source_guard);factory=original.cache_runtime
  def runtime():
   cache=factory();parent=cache.Host
   class Host(parent):
    def __init__(self,config):
     super().__init__(config);bind_current(cache,self,input_sha,readiness)
   cache.Host=Host;return cache
  return proxy(original,cache_runtime=runtime)
 session.provider=proxy(provider,namespace=namespace);session.native_readiness_split_consumer_binding=copy.deepcopy(activation['binding'])
 return copy.deepcopy(activation['binding'])


def activation_record(prepared_sha,input_sha):
 value=prepared_acknowledgement(prepared_sha,input_sha)
 return document(BASE/'activate-reads'/'sql-committed.json',value['additionalReadAcknowledgementSha256'])

if __name__=='__main__':print(json.dumps({'format':FORMAT,'staticOnly':True,'SQL_SOURCE_REVIEWED':SQL_SOURCE_REVIEWED,'databaseWrites':0,'serviceActions':0,'oldCachePreparedACKClaimed':False}))
