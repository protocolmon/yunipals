#!/usr/bin/env python3
"""Compatible post-adoption Arena recovery; import/default have no effects."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import stat
import types

OPS = Path('/opt/yunipals-unified/operations/free-replay-20261020')
FILE = OPS/'arena-ypal-business-inverse-v1.py'
MANIFEST = OPS/'arena-ypal-business-inverse-v1.manifest.json'
FORMAT = 'yunipals-arena-ypal-business-inverse-v1'
AREA = Path('/var/backups/yunipals-arena-ypal-business-inverse-v1-20261025')
INPUT = Path('/var/backups/yunipals-arena-ypal-business-inverse-input-v1-20261025/input.json')
CUTOVER = Path('/var/backups/yunipals-arena-ypal-ordinary-accept-v1-20261025')
OWNER = OPS/'arena-ypal-ordinary-accept-v1.py'
OWNER_SHA = 'b3dce2f8dbfa26dc219101dd29be866aad1d3944f0db6de9915a838555080295'
OWNER_MANIFEST = OPS/'arena-ypal-ordinary-accept-v1.manifest.json'
OWNER_MANIFEST_SHA = '8494ce4ba63ca8d0f7be8889ef90ea23395632ac1ca1d032a93d63567cc4f08b'
ARTIFACT = 'e6bc1f61d64fa85700a2b83cf2cd16daaef4a8d4897f93800cdf773cc6cac234'
INSTALL_ACK = 'ad024517f4ae8e348382cea0f589b4c432eaf4261797048cba5c66b676dabe84'
BASE_SOURCE = '264a33229f4c47c004362d264fa90f670784b70be8a6ec6d82187cc7e987ae24'
CHILD = OPS/'arena-ypal-business-inverse-child-v1.mjs'
CHILD_SHA = '1140edcb47428a104fdaa46cc8001b6d5d34671b33febb4f98dcb0353245d9ec'
CHILD_FORMAT = 'yunipals-arena-ypal-business-inverse-child-v1'
TEMPLATE = OPS/'arena-modern-public-rollback-v2.py'
TEMPLATE_SHA = '272b827c55b2db7a8a85fbb581602d07302e2d0daa03b2f3820692c5350b18fa'
FACTORY = OPS/'ypal-fresh-forward-epoch-v1.py'
FACTORY_SHA = '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c'
TARGET_HELPER = Path('/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py')
TARGET_HELPER_SHA = 'c0b36e15808e6ec60e0386f8d7535748b56b0964369841321840000eac44acec'
FINANCIAL = OPS/'ypal-alchemy-ordinary-financial-v1.py'
FINANCIAL_SHA = '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0'
PROJECTION = OPS/'arena-native-derived-projector-v1.py'
PROJECTION_SHA = '83525842042c1483ba66732f9a006235b940cbff4ae714a66103d69723a1a3ba'
PROJECTION_MANIFEST = OPS/'arena-native-derived-projector-v1.manifest.json'
PROJECTION_MANIFEST_SHA = '4141ac2dc1aaf49c275aa9cd35965acb441b6d6150a82cab8a466c59b42ca309'
SUPPORT = {'artifactDigest': 'a330c3f1ba2701ba287f0675b0c6c11ca010e85d504d5e8798df574625972f67',
           'manifestSha256': '19a9a5737c153192c0723aa73c3d3f4e119f2492cb775ac617a63b0b57bbaf5e',
           'facadeSha256': '08905983dc0f5556190d311fd648eecc9ebfea4c958e607902a93ac7a2ad24ba'}
EFFECT_SOURCE = OPS/'ypal-ordinary-restored-source-prefix-v1.py'
EFFECT_SOURCE_SHA = '644d69ea670abca2b19c410aaf5e7d7a22065637f50ea63dde4f79b24d052319'
MAXIMUM_PARENT_SECONDS = 1200

SOURCE_PINS = {'application-recovery-native-column-v1.py': '435770a5a764477cb298140383f7afc39309088d496714b37c242b5257e616a9', 'arena-config-observer-v4.py': '88f38aba39b9da8e5085135179bf4adfa3b1919eb9814471b30f3dfce11c13ba', 'arena-config-public-baseline-v1.json': '374bdaeb8c8ee82194491b198abbf11b424c8f146bf512ed2944d018aae4b2fa', 'arena-modern-public-rollback-v1.mjs': 'f606f0a85b4d59c7eb1084c2546daaed257e5fc56bdccb57c43e81e6beaf40c2', 'arena-modern-public-rollback-v2.py': '272b827c55b2db7a8a85fbb581602d07302e2d0daa03b2f3820692c5350b18fa', 'arena-modern-runtime-preflight-v1.py': '527701897b15ccf25c67aa372013f76405308b2b300a565d96271ba15f0a6631', 'arena-native-derived-projector-v1.manifest.json': '4141ac2dc1aaf49c275aa9cd35965acb441b6d6150a82cab8a466c59b42ca309', 'arena-native-derived-projector-v1.mjs': '8c598c9ae4c6b7b07c2a4ebaf6fc5d2d4ae64c84c5578a2919fee6c579f92a89', 'arena-native-derived-projector-v1.py': '83525842042c1483ba66732f9a006235b940cbff4ae714a66103d69723a1a3ba', 'arena-native-derived-support-build-v1.mjs': '54c1802082898283d7033ef61dd440cd98da20449162fcb414cbf6477794f4b1', 'arena-native-derived-support-install-v1.py': '94ae80f4b5bacdb3ca8f3ef831cd6abbe71f40a77deaa344f4953c63e8826ddf', 'arena-native-derived-support-v1.manifest.json': '19a9a5737c153192c0723aa73c3d3f4e119f2492cb775ac617a63b0b57bbaf5e', 'arena-native-read-pool-v1.mjs': 'f04d85aff78b2baadb8cae93bc98588bd0ed3b69da62c2c7d0b8cca9967e2dfa', 'arena-operational-role-inventory-v1.py': 'c99cfd2f240721727da66594f0e720f2dfe7f2fed36cfb942d9b147d71b3d785', 'arena-ordinary-latest-complete-build-v1.mjs': '011ba9d3a3769024b8cee3c321aae263c8c0a023c417f286a2a5011693710e88', 'arena-ordinary-latest-complete-v1.manifest.json': '73e260b3ed441ec7cf607d1da9215ae368972b523285ca251f2910adae44a2cf', 'arena-ordinary-runtime-v1.py': '7889fca5e47734f263eb51c5f2338e4080e17070188876db26bf4cc0080b2dad', 'arena-ypal-business-inverse-child-v1.mjs': '1140edcb47428a104fdaa46cc8001b6d5d34671b33febb4f98dcb0353245d9ec', 'arena-ypal-current-admission-v1.proposal.json': '0789c643ff3513aec9f8d5cceb95eb15226b60c007e82d80ac37b51d4a538ac4', 'arena-ypal-current-admission-v1.py': 'c04d5c42fff6934b89b8d009c947e4230c63555cbe91e5a5a91aa3a0b9281035', 'arena-ypal-current-credentials-v1.py': '0bd21ca83b63aba02d3eb0113704edaac3a4f2dc34148d322db38a356d9f021f', 'arena-ypal-native-v1.actors.py': '07eaedc6b3a5616ae2473d386187f72f7bbd56665a0f26483c4edeaf9812ef46', 'arena-ypal-native-v1.adoption.mjs': 'd45e552bd0bc76fa526acaa1e37b6e910498cb88af03bbd17b501812b348a162', 'arena-ypal-native-v1.catalog.py': '933c3357ae1c231012f24d9235ec6a97fb2e7db2f1a5ce1046adbf9e6cdb1430', 'arena-ypal-native-v1.proposal.json': 'ca56a4be29abe53f5b7a6b3f4c8a13d6a557c1e38fa07521df78e10fd4fe3d80', 'arena-ypal-native-v1.py': 'c539c8d99a2e14eedaa0387dd25fdce044e51f3c68459b95768c60c081f2d22e', 'arena-ypal-native-v1.rehearsal.py': '2eb8c84292b8547650e94ead891a8b987e027786e082f6377c8299d38e69edaf', 'arena-ypal-native-v1.source.py': 'df20acc91c6f16454c28c39e00cc80870a25efaf33f72cd60af40e54c09368e2', 'arena-ypal-native-v2.admission.py': '543986e8986b4b44b11b65d247cfcc0b6ebd7a6cf27ef52626f22a6fd650db7e', 'arena-ypal-native-v2.context.py': 'b50169a2cd5f4b88454d85046cc48e1a861e07c103d4b39faa3ec98dcb3775bd', 'arena-ypal-native-v2.credentials.py': '30a28e1037131ae94a00fc6b6ac527c80f42fcff34c42536d64ed06ba1d3187e', 'arena-ypal-native-v2.rehearsal.py': 'ed2c7fee798b343d10dde2904ff7d3a2ac8ebfe97879e8d14e503632a8ac3e1a', 'arena-ypal-ordinary-accept-v1.manifest.json': '8494ce4ba63ca8d0f7be8889ef90ea23395632ac1ca1d032a93d63567cc4f08b', 'arena-ypal-ordinary-accept-v1.py': 'b3dce2f8dbfa26dc219101dd29be866aad1d3944f0db6de9915a838555080295', 'arena-ypal-ordinary-bound-v1.manifest.json': 'bc38a18b86b181624305f0e1d754ee7e6cf3b333368afe1de3daa44a91757dd4', 'arena-ypal-ordinary-bound-v1.py': '1a0ddc4b7f65d92a43953537e0ab55b620d7913c5482b2f7ad6a098c725dc523', 'arena-ypal-ordinary-v1.mjs': 'e7606911c387bc987c3c0d217a7ae9c5a593f7178b07bb180845dccc540cafcf', 'arena-ypal-ordinary-v1.py': '60c3dbbfc90a8d7540616278eb51cb329a097a1bab20d0b6e66d9f17f92c1fd0', 'arena-ypal-ordinary-v1.source.py': '9940e8d3f310f940dab4fbf9753179954d594e484728b0fe37650c475ffb6dd0', 'arena-ypal-restored-v1.py': 'cd4c11b5f0127f5b852aa14b72334da5efad77c26625abf4d4c9ae9c3783a91a', 'arena-ypal-source-completion-v1.py': '2cac6ffdb5b3162b3e6431364974a2ab61a3c33be97cb358c3505a80d8046dc6', 'booster-api-admit.py': 'c62778869948e0a94a190a1edd839d9c982ea3fd4b82cc69c82776f0499fb58e', 'booster-api-collector-inverse.sql': 'e83ed9a3840166e15f09939ae6f24edc984698b3d651c258ac6ffaa4ec532526', 'booster-api-collector-rehearsal.sql': '69dfd1ed1bfa2980d32d9f8e113eed2020a0e7dcc3c730ed8ef705e1878ffb42', 'consumer-accepted-staking-acl-v1.py': '722f113a253009cb67f0695bdeaaa9e27bde9544e98fb0bad53dc6990b63bd92', 'consumer-action-read-owner-v2.py': '7d9f4dd24155862e73ac96a30fe3647d616d0352ef1a1f0f82b033f635d4f71f', 'consumer-api-preview-v5.py': 'f03f303c38d64099b22fb61577de35dcfac5691aa424c39d7b62b429e822511c', 'consumer-final-runtime-v1.py': '4dbcff442c7253c3cc2266b4a3578317744e5653f0860392d410ebae21b26b81', 'consumer-generation-v4-proof-v1.py': '0e438bf1157a0097cdebdd9df4c96d3681995806c4317ee73c35a0f4d119154f', 'consumer-operational-admission-v1.review.json': 'ff9426e780ca9c6ed302e1a99a09db08b4bdeb7f453fdc9d0f600dc5a45c4db0', 'consumer-operational-owner-v2.py': '2612f277cde8db85dd05901069a45a7332954d9134a881a49820dd1f2197535b', 'consumer-operational-owner-v6.py': 'f120fbadfc36170be1c8d29eff15015ab23106042953436faf37474953fce27d', 'consumer-operational-preview-v6.py': '447e7f6c25842b983ba23c59dbc6486be156f43c524de780d4f6b77966973777', 'consumer-operational-read-plan.review.json': 'e80beb3acce6cd0de70c0ff2653b5ac095a4b4257dc972e11ee16c5d214a9796', 'consumer-owned-booster-graph-v1.json': 'dd3ca9be25666cb223c157ed942094669884b5145f595d457fe559fdcc834dc0', 'consumer-owned-booster-policy.py': '54f1b81223a7003261c08c845a1f6614bd7f22ac68160d8d1081974e8d32f859', 'consumer-owned-booster-runtime-v2.py': 'f8b32d84e552ab6df51836a0e297f26131fb1d2faecb2aba1e4c7bc3bf82945e', 'consumer-retained-read-dependencies-v1.json': 'bb53caab5bab10e981853ed7061ca2c5cef66164702b4bb71e517d1580ebe6db', 'consumer-runtime-preflight.py': '5a74ac2a26a1beb148d42f232d90ec223499be58b4095809296da7e26d719daa', 'consumer-topic-runtime-v1.py': 'd064012011428d28d56a6e81d7546b1b570b105efdb7b46db268eb5b3ed01cdc', 'consumer-v4-read-runtime-v1.py': '993da3a0261e6930c91ac46c2ccf4e3d90342cbdf1fbbe84779d1097cb23291b', 'final-supervisor-inventory-v1.py': 'ba5727f3774e697800181e0b7a36921db6a328ea5f0e6d95f213f5a1aae44912', 'fixed-boundary-witness-v3.mjs': 'bba7bd4bdb74908c85fd51fc93cdf8a53c8cbbce25e647f37004762c8e59796c', 'fixed-boundary-witness-v5.mjs': '359ebcef8fb6e2342087eb4a7e62811cd1dd10b2ad7353ff682d20112f08c484', 'marketplace-consumer-stage-v1.py': 'fb08501e2f06c0079f6fb69655341451d2724aec5d7f2b2114ecde9f98785798', 'marketplace-grants-rehearsal-v1.py': '00cdaae15f98bb1f832f5aa8af91503201d6834e160b1c7eda757cd54446ddf0', 'metadata-fixed-parity-v4.py': 'd367701ea44de7cb5fada336d182f5c1a47536cc4221fdd120a048ea9641ee53', 'metadata-normalization-runtime-install-v1.py': '08fa7d4cd522ecfab8140e00ded0fe384ad92ad3f7d5df8b07d96e85d8b4e8ab', 'metadata-readview-v4-candidates-stage-v1.py': '19b3ab7f987e652f74288d5da681a569258f94d3eccc3207db7a9ec8e23bfb5c', 'metadata-readview-v4-owner-v1.py': '011343704eb3e8a6de8d7002776692f8cb063cabeedf22cfa2084448693ce948', 'metadata-readview-v4-plan.review.json': '04e1432517738d21d4a0168f74aa69727c792653d3ec6e84f033741f86cd8d29', 'native-metadata-publication-column-v1.py': '97dbaa5579d9a3f483bfd020e185946205e015d66acd288206b8267294fcfda8', 'nonmarket-consumer-runtime-install-v1.py': '506d26bbe9ab66eb5647794c58bd2996cf458b7fc704b51d0210263bc773f93b', 'nonmarket-retained-candidates-stage-v2.py': '1f3e64031d8cc0070f151703e7f37b166dbae95df6d11d98be3e847de6153486', 'ownership-common-grants.review.sql': '72541d4e8076ef3468f849b50907d0c4b9f7514924f61728a89619edd16d0e49', 'ownership-parity-peer-v2.mjs': 'd1e8283b440d6debe046edf25b7fdf6b18b552604e35256eadf210a3734db920', 'ownership-parity-peer-v4.mjs': 'b86fbfacfee337623fa0b3aaa77dbdf145d5ef85610e4e07c91d36bc51ed2b8e', 'ownership-readview-catalog.review.sql': '24c4912597b135b8e2890afc410e3235b6e12c19128475d990afb4c2a64b2813', 'ownership-readview-owned-booster-v1.py': '69f32e008aca3d8ac49c062755f0290eb6f73884c0fdaf0a2b5e066ade3a7a92', 'ownership-readview-owner-v1.py': '6ccc1b0bf6ab6a1f1cae9575dd350a428dac446c9c0fda72d5833d006bf94b80', 'ownership-readview-plan.mjs': '656cc449ce5d5a45cc1d81c7836470736f73f5e18dde20524be4805543ffc877', 'ownership-readview-plan.review.json': '1467b1a604aceb45a20ea593b4a04d750876c7a534359cfce25102597ef8fa59', 'proxy-upgrade.py': 'ea99a90fe4836880a97af185d1c238e53571b2b5ef262ff35a2410d943483965', 'retained-workers-stage-v1.py': '4cf40a8e43c5eec383d17834099b8da5e5b700ec229b7c3de8909cf601ca2416', 'staking-support-admission-v1.sql': 'a571e203b9d4efae66348ecc5cd9504dd180e2830f410c966e78930578b51950', 'staking-support-owner-v1.py': '6746e569aad240f76ec17de69426a4b34453cab87f5e99515b277093bd99eb6f', 'staking-support-prerequisite-observe-v1.py': 'd80cd71888346ea8f9539324fae3639b410cb378e4a48cbf060e348b1e27e135', 'ypal-alchemy-catchup-financial-v1.model.py': '703da46a374d7f8fa5617c11153fbff60f7a669593cdedd642d75ad6033d5d14', 'ypal-alchemy-catchup-financial-v1.py': '19710cfe5ab8d5c5e57f8668bb9761beac5080acba17b03da6aa54e3932c4803', 'ypal-alchemy-consumer-current-context-v1.py': '70faf2514d0240625f0a1eaa84f527be5fb16bcf4391e56e8644bc708ae2d420', 'ypal-alchemy-controlpid-adapter-v1.py': '91c992dd50e50722e21f46ccf0fbc06607df8e8e0a69929424cb4cd3d0c6c770', 'ypal-alchemy-ordinary-consumer-context-v1.py': '5a1f4629899bed7ad498c84f016afa75cacbaf67663974d94c65453a84787986', 'ypal-alchemy-ordinary-financial-v1.py': '89a4bfd327ce52419af20e915fb13d2e5a856d27f51fa6a896838869ad4977d0', 'ypal-alchemy-ordinary-plan-v1.py': 'cf7191a578de5ee2390acccb95fb5812253c461ffe178d009660819911f54980', 'ypal-alchemy-ordinary-runtime-v1.py': '3bf5811a6bc6163ede96e18ce57e9b0b45583889c15a639b79291d8c3be31be5', 'ypal-alchemy-primary-current-v1.py': '753c701d62f3fd03f23a8a9ed7436eafea98a8627054fcdc24cedd61d9bd6215', 'ypal-alchemy-primary-import-v2.py': '44d502b19bdae6a484db2da719bae154c9a96480d006d7bb9536f0c4ea36f083', 'ypal-alchemy-primary-stage-v1.py': '01da39ab60ba2fc73b5acf8184b0c3bd44a074bf0f9c8f95ffbfecc510b43c73', 'ypal-alchemy-read-admission-v1.py': 'c2da9d590d75823ec5ecf3038f73da93854e760faadb91bbc71e135f56e0a15a', 'ypal-alchemy-restart-cache-v1.filters.json': '394bbecf8d0b7c115bc7b56b085a17fb857d549a36eb336514bbb10bd72f2675', 'ypal-alchemy-restart-cache-v1.py': '35f751938c96bcd10e5f36412c8e7f7e0a31129874c2544c49116e85fafc59e4', 'ypal-alchemy-source-completion-v1.py': '0e147b366ff29194326f09d9a56d5a8d5bca77fe6c83b3ac9584f30dc6dee8f0', 'ypal-alchemy-source-identity-v2.py': '01e9bfb127a29edeb6a985702a3d921d706186c8a3680e8c3765bce5f68321c2', 'ypal-alchemy-source-switch-v1.host.py': '3b73d2f804c2c64f212c6b11eb3f108087a54af580baecb35ddffa2033dd4e02', 'ypal-alchemy-source-switch-v1.plan.py': '3a13f1f4e9a7896d9e4535b670bf06786c3fb0d199986356b336cb32565d3d56', 'ypal-alchemy-source-switch-v1.py': '7ae9a516fe1145f25676ba97e98c92a86123bf8797cf7758537ef7fde855f5a6', 'ypal-alchemy-source-switch-v2.py': '440f5b39d803c2332a4531327ec46df2692370a70d543b27eca12ae03865eb0f', 'ypal-booster-source-parity-v1.py': '4f7dbc2c03251fcfd0e91aa13dc64a4463d2d6c54008be3ae742bde90a3214fb', 'ypal-cache-finish-v2.py': '8deaa8209713732e6505daf097972c203b68790f371aee8deb6a0b0d91189baa', 'ypal-cache-finish-v3.py': 'f072c85e82872a750e7e76dd17349718c7e6574b2e833c9c4d9b80ff9e147374', 'ypal-cache-guard-owner-v1.mjs': 'd44194958061ce06517d41579ec36b8d0f31b166f871d80849eb48093c3f1551', 'ypal-cache-guard-owner-v1.py': 'c54f8af6846df7a013fe0b39680806aa623e29d0bde145e62fc47e65107794ba', 'ypal-cache-guard-transition-v1.mjs': '6cba5a1d840df67dc0a25dbde5f73bbf064daab92e9b5d5ff7396c40d48595a2', 'ypal-combined-ordinary-observer-install-v1.py': 'bf012fab894bee4e28d5f8e492309e492ca32c3d3bedbd97f699c17ed31be738', 'ypal-combined-ordinary-observer-owner-v1.py': 'f81c2e321304c36c1dc63f26dfecb23ecb1a5a84dc3facabdce06a240300f0f6', 'ypal-combined-read-admission-v1.catalog.sql': 'cd1b8c49f3682a73c9136fbb4e6146eae437258470fa8943ee54f6630d4ed991', 'ypal-combined-read-admission-v2.py': 'c9b54f2c2e82f03b7481bd1c3c11c24443db16530b9824ff2dd6d86a991bf5cd', 'ypal-combined-read-current-context-v1.py': 'f77cb1b93f655f2caa1fedbfd0a6275030320719093d97aa8e607fd7922b30dc', 'ypal-combined-readview-owner-v1.py': '2e8e97476d4102de0660bb224995d584b03756a8e717c35d44da229ade63e058', 'ypal-combined-readview-v1.preparation.json': '091cdf8618716173216dc64c78ac84ca1ed82c06f0000e9a2fce2b07a2a6af7b', 'ypal-combined-readview-v5-plan.mjs': '91b48f86211b08ceb251e840f89c52ea3e83452fdce17af19a610ef3cc5ac201', 'ypal-combined-readview-v5.preparation.json': 'd968a31c4ea5314f4a84f0ccf5e0e9a24ce7bb9ae647d81d37c419b6f5714cb7', 'ypal-combined-release-register-v1.mjs': '6dd896530633e5d2a2f932305eb80d1e4b9c63c99b2b967694887a9583f6aaca', 'ypal-combined-release-register-v1.py': 'c034cca76a101a19aa1a668ff5b91eaa883fda775406ba52e9b6a3ec8993133d', 'ypal-combined-rpc-admission-v3.py': '55ba89a1b2e3249720a63cb9c740c3655ce83dbf076ae3bf7ab3d9a2409ec862', 'ypal-combined-rpc-routes-v1.py': '5e5e82df6744e8a6c049b062ef39ae7c68171cf72920e58ce4bdba7877cac4ff', 'ypal-combined-source-manifest-v1.json': 'a80c527caa8b7696cd9dc351d695a2b9d973c215a05a051669f1aa469dc68bd7', 'ypal-feature-handover-v1.py': 'e50658bc8f0430c85f624b94a931469b3a12b956d1f8ab14d0ed673b18e0ab8e', 'ypal-fresh-forward-epoch-v1.py': '0d6d97ad9bb2ac258380586344e194c6c64a83e8c480cfa9aed600cb292ca81c', 'ypal-generation-cache-candidates-v1.py': '3d42ae007e722edc582a2a8907282869af37d940eeba93f7426d327280a428b3', 'ypal-generation-capacity-watch-v1.py': '0a0d1cfa850e60850ea3f2f53ffeccacbdc66130e058112443269064f3f4d36a', 'ypal-generation-publisher-install-v1.py': '6fd77eac7014eb68b5f605d04a8d432c95866bc55a9f0814bf76ffb24943610c', 'ypal-generation-recovery-v1.mjs': 'b45dd8e4f3e470afb18c192a27c50b6d6161ade514b8babdd2225ed18dd5ef21', 'ypal-generation-runtime-install-v2.py': '0c031bdc798b8466ea29624bbfdb253e392830ab2b2f833be4c41d6fb91c5e8f', 'ypal-generation-runtime-install-v3.py': '3baf253bba615e30d0f2ffb1c6a1b76625b7bd5f3cfb0cebbe176a41ee952a9b', 'ypal-latest-complete-main-api-install-v1.py': '43d98f0aa8993b408133f24a77bdab50663fa79fb77840c7478db369d7e7be9f', 'ypal-main-api-install-v1.py': '2f789f343ccfd0c99800e98e735bce366a4747c54f6f1372519b2e1fe92db633', 'ypal-managed-handover-v1.columns.sql': '2fb66a5b8e2460827a60c5e4f70ffc0f9d16ac165ca79aba1fa04c1033629264', 'ypal-managed-handover-v1.py': 'f5d34eabe593302c33c4a2247fd19526aae94b066c9863178918e3c2186040ea', 'ypal-managed-handover-v1.solana.sql': '2fe15a226fb8f92fc5dada1e7551e9f722fbc72ae1d791aa4a642b55223d02f0', 'ypal-native-cutover-proof-v1.py': '9ab496cd169190d2bc4373857b0d358f4278ff58e06c708694ac65b11c3e3946', 'ypal-native-cutover-proof-v2.py': 'cf4b55e5230bc22c721da74d5978e1cda977e0d2fa128a62606f3e41d7df8c14', 'ypal-native-cutover-v1.action.sql': 'ac8d08858a28a11b75f51f70e3b841d363db7ac98654afb244a274a34a705f50', 'ypal-native-cutover-v1.manifest.json': 'efca68cf0194b26f611166c9e2e9db8caa8a4247329e02effba2c06a9cbc8168', 'ypal-native-cutover-v1.mjs': '950b18cfb42d210e3fca47f4f3464de7dd5dc0d1dbc42fd846c2171aa8b2d1a7', 'ypal-native-cutover-v1.py': '344f7d0e015d728ec134d00c4ada2c82a3a2f1aab023cf78880eb600a57ef62b', 'ypal-native-cutover-v2.manifest.json': '15998fac4a84cbaa65ca51bf8f2ec7bcd6ebe22ea4666a0efbf89286d735f0b8', 'ypal-native-cutover-v2.py': '3e133cada3a015baccab82aa58d558e731c75942c88211f19672cb408f922003', 'ypal-native-generation-v1.py': '762bc10ea3e882cf8016c846e22bc8073a36a32cf680ea4b3527f520ce092ce6', 'ypal-native-inverse-leaf-v1.py': 'd5dbc3923b3256328f8bb4f3d5fef3c641a64b843d761696629039b4bb4b5e28', 'ypal-native-metadata-candidates-v1.py': '146128b95c9577a555b8c6119f302df62f703425132eeecb34dea10129e74525', 'ypal-native-metadata-handover-v1.py': '772a626934399a9ed53bc9a6c1a6b4af688c88b41995268a75246adc878b4ba1', 'ypal-native-reader-probe-v1.mjs': '4dadc7ad35c0fa7a68f07ec03b5bb74f5386b5c5de3817ee9dc2af683ff48c3f', 'ypal-ordinary-cache-driver-v5.mjs': '5e35b8c21a7f378a767740bf45bd86cab39d25c126618d68f3747be745b5784a', 'ypal-ordinary-cache-finish-v6.py': 'ec9a88b93543a114138b1198b865ef5b31de2d79ef08a6d014b4e938ca51b4a0', 'ypal-ordinary-cache-peer-v6.py': '4ddd3b021c31e7a2f663df82bb7e3308c22b5b2f1cec5345979286efcff59e04', 'ypal-ordinary-cache-sql-v6.mjs': 'a8a4ac308c56fa3bb678b4c7bf74b74a1aa1bc0f923df2f6676237e3ec5d7705', 'ypal-ordinary-cache-transition-v5.mjs': '591fce0365e6581644a064470cb830d0ec06c2e135e439cb58dac02d8bc1e8b2', 'ypal-ordinary-consumer-handover-v5.py': 'dc0e4a9bc5f4cfbc895c0a8a734c5f11692d3ee33a2f1389fc1b231313bb6e6c', 'ypal-ordinary-downstream-refs-accept-v1.py': '2d2e8b1550332e215564cbeefb12a2fbea42f87ba1d978aab2aa337f212e3ce6', 'ypal-ordinary-downstream-refs-v1.py': 'a43d0f79dafb629a7b57be7f67e5c2e0bf5ba2b05bc8dbb370afc30449fe1f4f', 'ypal-ordinary-feature-context-accept-v1.py': '3ec482f59adafd674116d821abe3ab39db46b1ab21d3ffeeee5892fe390f6984', 'ypal-ordinary-feature-context-bound-v1.py': '9c025c89b021b7cfd156b4094c030041152f46aa62305d8c80a641f505677118', 'ypal-ordinary-feature-context-v5.py': 'da2fea0aa36277c1c464ca27ad280b03ba31bfec2730182779ac839638496656', 'ypal-ordinary-feature-context-v6.py': '743645a993e46268c7b50251d0a4867037af814a57747389abca7ab3b305a635', 'ypal-ordinary-feature-handover-accept-v1.manifest.json': '431d59f132898c8302854b78dc6cf4fd44a41504e48ce810b1e8d2f6ffaf3b65', 'ypal-ordinary-feature-handover-accept-v1.py': 'd5d1614372bcbd0008806f5378c6085c56f95d516608493ee9f318b5cc5856b1', 'ypal-ordinary-feature-handover-bound-v1.manifest.json': 'dda74ac69d400d22e6a6cace532a9022e4619cd23643cc9d00b4e9de4c11bb47', 'ypal-ordinary-feature-handover-bound-v1.py': '2a6b2c598004a621eb0282daec74b191a118d9d2bf44b1c68db50342b3fe081f', 'ypal-ordinary-feature-handover-v5.py': 'cb21c6f6b6ffa627d24d67922892b7377191063f687253c65940e7a2a9f3e880', 'ypal-ordinary-feature-handover-v6.py': '4e66f48d9f24bbac28f09be3223f80a1e9d052442d5f4ba4b056e61efe847312', 'ypal-ordinary-feature-inverse-actors-v1.py': '3c47d4f9f17d415d3039e939f297c63a29554480a467dc5603a5331da7e49ce2', 'ypal-ordinary-generation-accept-binding-v1.py': '4a2e27c9943959e76bf26b6639727833ede7ff8224fe1c6d2b8b50e9f7e42758', 'ypal-ordinary-generation-accept-binding-v2.manifest.json': '0f5bcd31ead0971f6d3fba26f238f8d7eefbc20f39d2db8a51ca9a356f6aac27', 'ypal-ordinary-generation-accept-binding-v2.py': 'e8eeb5f9fb883dc7a94227abf21d2cf4899ce913864dcca006720b2c905682dc', 'ypal-ordinary-generation-accept-v1.py': '1e29585a8c1b09747c061e47e0b2fbf2a984d10949c12f36d847b336f8a5259d', 'ypal-ordinary-generation-accept-v2.py': 'b6b6eb8c707290c29fbcd6eedf2e13c6c1d5dcc293a3806b0d6ab76bc9ab49fe', 'ypal-ordinary-generation-accept-v3.py': '29c44cdb1e3614eda39601c0e8bff29233f8a39369f01e5acb47530fc88138e3', 'ypal-ordinary-generation-attempt-v1.py': '6202db1e5124ce81823854ffa09e77410b6495c695b463028bc150bc57b564b3', 'ypal-ordinary-generation-attempt-v2.py': '4f0a3e35683444f68b089c4122f513998415f6fea4f1b61ce0d8cee68a0c1753', 'ypal-ordinary-generation-attempt-watch-v1.py': '9b48b382b16c7fbdbc7d345a76bf727e68ea2ae38c775c48714731c2a0c26b41', 'ypal-ordinary-generation-attempt-watch-v2.py': '47005973bc9ec17cd65f8b3044ef9e4dda438821fd651c289608b0fd2f8a86ae', 'ypal-ordinary-generation-binding-v1.manifest.json': 'a6d4f0b8669eadcc44a1c880e76996f015e645ef9976b79e418e02e26bd1859b', 'ypal-ordinary-generation-binding-v1.py': 'acfeda7dc55b5ea7c99a3ef3a11855397c56317cf38a1d792a3e769540c0e962', 'ypal-ordinary-generation-candidates-v5.py': '869a37bf324575c569c22fe020cc4ad62e9776429e1e5a137078bf5acaa262ca', 'ypal-ordinary-generation-recovery-semantic-v1.mjs': 'ca20dab6095290c78617a9ded63b21020c5e8aeda2e0de664d6947bbfa5f59ff', 'ypal-ordinary-generation-recovery-v5.mjs': 'a19482296a09123fdc63df1cebc9d7a0f1747083faecc669f6b2836ed6fb66df', 'ypal-ordinary-generation-terminal-v1.py': '5ac441e3c3b0d3494cd256682f987a60b1d4119d4be6c1db7cb446642bb79613', 'ypal-ordinary-generation-v5c.py': 'ada329e57969155d091d3b5d276de767cb5a09760095a4499090b0589d81b7da', 'ypal-ordinary-generation-watch-v5c.py': 'f1ebc76c182d4146de7c006fa2dad5567aa8fb6d0dfe16e807648a2792911885', 'ypal-ordinary-managed-handover-accept-v1.manifest.json': '97104caa6f4b9e907e2b46a0f55b5e0eb3e087917f39643ad1e583b0ea2c1e14', 'ypal-ordinary-managed-handover-accept-v1.py': '83f9c88acd2c27b94cfc785595b30baaf2f26d858df772ff5ecc91c72cfcccdc', 'ypal-ordinary-managed-handover-bound-v1.manifest.json': '5a5e76e842aab87e76baaa540afd851961ff71cee0e7a54d2ac77b646f8a27be', 'ypal-ordinary-managed-handover-bound-v1.py': '415746545c901bedea9424e8e2330940d68a77cd303958b9551350de30e1717c', 'ypal-ordinary-managed-handover-v3.py': '8ca8c1c99c32e31c88c23136bc722c7d8d6c4756e9dd947eddb84ed1ded8ecf3', 'ypal-ordinary-managed-parent-phase-v1.py': '317779c460b99873f4408b0e1b4a9c9992a6c2270d33aa66fbec754affc6d16d', 'ypal-ordinary-managed-runtime-v2.py': '1636f8f2d2634845944f3fa32346bdb3fbc285fd3b731a716a513f42cbed5199', 'ypal-ordinary-metadata-handover-v5.py': '9b9184e685d3171beba3bce2f09aa3ddbb9c57f980e5243bd4c9710017f7825f', 'ypal-ordinary-observer-retained-prefix-v1.py': '451f1abe40d4bfba0d561e20f64c3e36c1c050ecbbea3415ecf318b00333e32e', 'ypal-ordinary-publication-accept-v1.py': '06212b568ee5298679633e3dfc30f9e47007c5624ff1a1ff441891f8128c6fcb', 'ypal-ordinary-publication-accept-v2.py': '7c518d97f1c4f425dce8dee8a4ad3f6f06a37454b0346de177c4cd60b32e56d0', 'ypal-ordinary-publication-bound-v1.py': '667d46ada5895b62fad16e5c42dee033a157bd187fd1a5360f91994bfe64c130', 'ypal-ordinary-publication-caller-v6.py': 'c7828062bbc7446ea4b00b7e84394d3ef8ce0aa11efeb88b82fddc3cc7c4345a', 'ypal-ordinary-publication-protocol-v6.py': '543d563bdd2d980c2019a5033c751a61a4d7b99d609f2f060d50f39b0b3af502', 'ypal-ordinary-publication-query-v2.py': 'deeaead42909617877af48b6749ab2704e205624ee979ed55b3df92c9dbd544c', 'ypal-ordinary-read-admission-v5b.py': 'a47d4f6b41839d3856244b7d08a92d3a8f56de71b8f566a22122bfb80f5213c3', 'ypal-ordinary-read-cache-accept-v1.py': 'b2b10b7e107bf3cd89aeb4838bdb08828e511abc2b3ebf453d7bbcf240b9215a', 'ypal-ordinary-read-cache-accept-v2.py': '8be988601c168c37ed5cc9dbbf348e2ad00312cd234786a2d3e00c6f4224a834', 'ypal-ordinary-read-cache-bound-v1.py': '7c09671036b712700a5bb4bafa83e0c209243dea06103c8c297e8f332af0555f', 'ypal-ordinary-read-cache-v5.py': '387c6a16d5f0c203731212d1a54b618919c0413e4235a37a35510cff584d8cc2', 'ypal-ordinary-read-cache-v6.py': '46bd4b093988f9a85c83d40dcc10a490831d5fefe85f40ccceba93ed511fda8c', 'ypal-ordinary-read-catalog-v5.sql': '8362df110cd3b0d70f9e5969b0619d373885c17ec2f5b8f5921517b71678c7dd', 'ypal-ordinary-reader-accept-v1.py': '99c720965851e15a6aaca0bad39d616c0bc3daef3d581a58888d9f0a9a3a9b6e', 'ypal-ordinary-reader-accept-v2.manifest.json': '688442913b575d8d68c9e2f07b46f355c57ebe7e2ab79a055d3d8d614774a666', 'ypal-ordinary-reader-accept-v2.py': '973cc75929e6ee3c906ac12103933603272cb41fdceec248bea3461b971dbda5', 'ypal-ordinary-reader-bound-v1.manifest.json': 'bbd19325eded8dd90b2ea8c0e8844b9ad6134fd78416206bb0491978a07f3095', 'ypal-ordinary-reader-bound-v1.py': '7e3783576548c680561a3d44c9b280948520d91acc95a4ac165501a1520caf17', 'ypal-ordinary-reader-cutover-v6.manifest.json': '870c6fe395ba30c7f3ed6d405d96bb9fd4cfdee485c871112c26f5f96b7c4200', 'ypal-ordinary-reader-cutover-v6.py': '7601a4f94c6b3dc7b016320944d53dd335e45cbe52838852b0cb4277934831a0', 'ypal-ordinary-reader-peer-bound-v1.py': '865f796407aaad784761cdb247a9cf1d4efe99ed3b0f9ea81e7809d37dc0c2b4', 'ypal-ordinary-reader-peer-v6.py': '91eacbca363ad3e17ca91b043776518847f303a3b474d4c26237d3c3c8f55cc6', 'ypal-ordinary-reader-probe-bound-v1.mjs': '4cf1ae4e07477a2183ec46ef0405d5763a6a81bbe28c953a6a813b7dc88a32fc', 'ypal-ordinary-reader-probe-v6.mjs': '5d9f013eaec45299a0b52418d309a9b35d4d1630618297df3595555b840d4e69', 'ypal-ordinary-reader-proof-v6.py': '0b4a31b7da89901091c2a68807acb86b5513f99a554c60fdc54809db653069f5', 'ypal-ordinary-reader-sql-bound-v1.mjs': '05e8c0a728a90f6ab432d73f4fb1ce51f685495405591d225e82a083fa86c8d9', 'ypal-ordinary-reader-sql-v6.mjs': 'fc31022549840e324c584c9fd5033fd9348e93cb00b7e308c427433b1f95f019', 'ypal-ordinary-reader-wire-bound-v1.manifest.json': 'af30ebc298546ec060cdefcc47bb25856a8b05aa654d6f0cdc527990ea806ddf', 'ypal-ordinary-reader-wire-v6.manifest.json': 'f38f5636bdd5681159eece772e2a981fde910ee26d745712df7b05f05fe879c4', 'ypal-ordinary-readview-v5.py': '1e08f4f09ed8774fe75e8d94b5a0286f010a62b2fc80b2dd4fffe75fcb8feda2', 'ypal-ordinary-restored-source-prefix-v1.manifest.json': '7c3f276e8561ba5a7e22968ad312c47f7586ad6bc2d348f5a9522b4d7621ae77', 'ypal-ordinary-restored-source-prefix-v1.py': '644d69ea670abca2b19c410aaf5e7d7a22065637f50ea63dde4f79b24d052319', 'ypal-ordinary-source-authority-v5.py': '052f363ca94a74aed1b278079c3e70661c8068328342bba559eecfe3c1939ac0', 'ypal-reader-peer-runtime-host-v1.py': '06eb5f166dbbc746336d93933f35c2aca5ac9d9ff3750af03690d79a39caad76', 'ypal-reader-peer-runtime-v1.mjs': '6728fcb405de2bf7fc302678dae4aa6184ed51effd22823375d4e0a078792cc1', 'ypal-reader-peer-runtime-v1.preparation.json': 'f1c184ac037df22314a563a008961f835b91a265e1a2bc29910e7d165c501be1', 'ypal-reader-peer-runtime-v1.py': 'cc7842d51a6adb242991423b3bfb850452315c37e169107331332d2460dc0ffa', 'ypal-reader-peer-runtime-v1.test.py': '71aacef972af251b765d7e6f40e49c70e857af59b6e9f98d6510c4696fec002d', 'ypal-restored-cache-peer-runtime-v1.py': '055ce7679c040de4286a30d71cf132c041878fa858d35cc4cdb81a62167fda6f', 'ypal-restored-cache-sql-v1.mjs': '118fdf4723320fed6b761ff953878dadc055ccfd62f4cf9da8219ce46e2492ab', 'ypal-restored-feature-context-v1.py': '3eae0ed86f861182d0a3b1e2c936b492f4377e0597464c8f0fb480c415ef36be', 'ypal-restored-feature-handover-v1.py': '11b2a886b8fe773f3fd9855a2b883efe26ec7841f6f149d3b681b67d5678b035', 'ypal-restored-generation-capacity-watch-v1.py': 'c65a9e9c88b397c98ff21c93bcf0a0782e054b2d6313620820603c6dd7f67ac6', 'ypal-restored-generation-v1.py': '48cc2e291e24816d6de9f668dfcb6a0bee891526865d3f42c99f4e99ac201946', 'ypal-restored-managed-handover-v1.py': 'ea2664fa573ed40a12478a9e9476b4d72828604a341f726a2f7570095b6374b5', 'ypal-restored-metadata-context-v1.py': 'fbb0c43433a943fdf10a85c8eb25e1cb9a30a34eec7d36f20826a16dfe86c8f4', 'ypal-restored-metadata-handover-v1.py': 'cf7799dbbfc68bf1fba4633651df2b32aa5a89d61e1991754bc890017a82bbf3', 'ypal-restored-ordinary-observer-v1.py': '62d37dcd63ac6b5ba5f4462290fc389c4f0e7f6e1b5709795cecf5f55f62bfc3', 'ypal-restored-read-admission-v1.columns.sql': '8efbbf11ba14c0ec645dfa0a9acc1ef64e89fc70315fb8d3b4cb66308162e4bf', 'ypal-restored-read-admission-v1.py': '91b0993d9ad604fc3a63d4e4f36817636af44121a9ab6346fdaf609fb42876e4', 'ypal-restored-read-cache-provider-v1.py': '2cf7cdf57a51c99acfeca7fa91f0b339b74ee46e0d74b2911ad0290fe5b1f8e9', 'ypal-restored-read-current-context-v1.py': 'e82a9037e21af0de3e62efcc6008545d1790295809183955d405e4c181cf0932', 'ypal-restored-reader-cache-phase-v1.py': '287438e26dfe75be24502cc547481a6bbeda3f1264b79ff2e0d994d068d093f1', 'ypal-retained-proxy-current-v3.py': '80519249b13b968c696b5582104990cb6e310a410eeac42fe0f139296ecf99bf', 'ypal-source-restored-current-context-v1.py': '994231005b15e04cc6e2d57ac73712c71b80791ddc774cdc7ea5966cbbcca4ae', 'ypal-source-tail-restore-v1.py': 'de4a42360c46a641896d5a03847bca15b8aa48bb9fdf19aa3dc9cfedda7c1d34', 'ypal-v5-witness-official-v1.mjs': '347782b2c992f47d084f92bf45389a352b85ecc7d8a6f163968d2bc6a20d4cdc', 'ypal-v5-witness-official-v1.sources.json': 'ba5d4f5f89191f069f01b71becc5d4db540646458638b1ce188d38a4013d2fb3'}
EXTERNAL_PROGRAMS = {'/opt/yunipals-unified/operations/arena-public-rollback-target-20261023/admit-target.py': 'c0b36e15808e6ec60e0386f8d7535748b56b0964369841321840000eac44acec'}


def need(value, code):
    if not value:raise RuntimeError(code)


def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
def pin(value):return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None and value != '0'*64


def public(path, expected=None, maximum=4000000, private=False):
    path = Path(path); need(path.is_absolute() and '..' not in path.parts, 'fixed_absolute_inverse_input_required')
    for item in [*path.parents, path]:
        row = item.lstat()
        need(row.st_uid == row.st_gid == 0 and not stat.S_ISLNK(row.st_mode) and not row.st_mode & 0o022,
             'protected_business_inverse_source_or_receipt_required')
    key = lambda row: tuple(getattr(row, name) for name in ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'])
    before = path.lstat(); fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW)
    try:
        raw = os.read(fd, maximum+1)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < len(raw) == before.st_size <= maximum and
             key(before) == key(os.fstat(fd)) == key(path.lstat()) and (not private or stat.S_IMODE(before.st_mode) == 0o600) and
             (expected is None or pin(expected) and sha(raw) == expected), 'same_exact_business_inverse_bytes_required')
        return raw
    finally:os.close(fd)


def evaluate(path, digest):
    raw = public(path, digest); value = types.ModuleType('business_inverse_'+Path(path).stem.replace('-', '_'))
    value.__file__ = str(path); exec(compile(raw, str(path), 'exec'), value.__dict__); public(path, digest); return value


def code_manifest():
    return {'format': FORMAT+'-source', 'files': {FILE.name: sha(public(FILE)), **SOURCE_PINS},
            'externalPrograms': EXTERNAL_PROGRAMS}


def source_manifest():
    expected = code_manifest()
    need(json.loads(public(MANIFEST)) == expected, 'same_actual_complete_business_inverse_source_manifest_required')
    return expected


def reference(value):
    need(type(value) is dict and set(value) == {'file', 'sha256'} and pin(value['sha256']), 'actual_existing_inverse_reference_required')
    return json.loads(public(value['file'], value['sha256']))


def owner_namespace():
    manifest = json.loads(public(OWNER_MANIFEST, OWNER_MANIFEST_SHA)); files = manifest['files']
    need(manifest['format'] == 'yunipals-arena-ypal-ordinary-accept-v1-code' and len(files) == 16 and files.get(OWNER.name) == OWNER_SHA,
         'actual_finite_bound_Arena_owner_manifest_required')
    for name, digest in files.items():
        need(type(name) is str and re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json)', name) and pin(digest), 'finite_upstream_Arena_source_required')
        public(OPS/name, digest)
    value = evaluate(OWNER, OWNER_SHA)
    need(value.code_manifest() == manifest, 'exact_actual_Arena_namespace_and_manifest_required')
    return value.namespace()


def validate_plan(plan):
    keys = {'format', 'operationId', 'cutoverOwner', 'cutoverResult', 'predecessor', 'targetAdmission', 'targetAuth',
            'targetHelper', 'floor', 'targetKind', 'childSha256', 'support', 'projection', 'financialReceiptSha256', 'effectSource'}
    need(type(plan) is dict and set(plan) == keys and plan['format'] == FORMAT and re.fullmatch('[a-f0-9]{16}', plan['operationId']),
         'exact_actual_business_inverse_plan_required')
    for name in ['cutoverOwner', 'cutoverResult', 'predecessor', 'targetAdmission', 'targetAuth', 'targetHelper']:
        value = plan[name]; need(type(value) is dict and set(value) == {'file', 'sha256'} and pin(value['sha256']), 'exact_existing_business_inverse_refs_required')
    need(plan['cutoverOwner'] == {'file': str(OWNER), 'sha256': OWNER_SHA} and
         Path(plan['cutoverResult']['file']).parent == CUTOVER and
         re.fullmatch(r'(result|continuation-result-[0-7])\.json', Path(plan['cutoverResult']['file']).name), 'actual_new_bound_Arena_ACK_required')
    need(plan['targetAdmission']['file'] == '/var/backups/yunipals-arena-public-rollback-target-v1-20261023/result.json' and
         plan['targetAuth']['file'] == '/var/backups/yunipals-arena-public-rollback-credentials-v1-20261023/auth-result.json' and
         plan['targetHelper'] == {'file': str(TARGET_HELPER), 'sha256': TARGET_HELPER_SHA}, 'actual_separate_target_admission_and_auth_required')
    need(plan['childSha256'] == CHILD_SHA and plan['targetKind'] == 'legacy_rollback' and pin(plan['financialReceiptSha256']) and
         type(plan['floor']) is dict and set(plan['floor']) == {'block', 'hash'} and re.fullmatch('[1-9][0-9]*', plan['floor']['block']) and
         re.fullmatch('0x[a-f0-9]{64}', plan['floor']['hash']), 'actual_child_direction_financial_receipt_and_canonical_floor_required')
    support = plan['support']; projection = plan['projection']
    need(type(support) is dict and set(support) == {'artifactDigest', 'manifestSha256', 'facadeSha256'} and all(pin(v) for v in support.values()) and
         type(projection) is dict and set(projection) == {'resultSha256', 'inputSha256', 'producerSha256'} and all(pin(v) for v in projection.values()),
         'actual_derived_native_projector_and_support_refs_required')
    need(support == SUPPORT and projection['producerSha256'] == PROJECTION_SHA,
         'fixed_reviewed_native_projector_and_epoch_authenticated_support_required')
    need(type(plan['effectSource']) is dict and set(plan['effectSource']) == {'inputSha256', 'producerSha256'} and
         all(pin(item) for item in plan['effectSource'].values()) and plan['effectSource']['producerSha256'] == EFFECT_SOURCE_SHA,
         'actual_pre_inverse_source_effect_fence_required')


def projection_sources():
    manifest = json.loads(public(PROJECTION_MANIFEST, PROJECTION_MANIFEST_SHA))
    need(type(manifest) is dict and set(manifest) == {'format', 'files', 'externalPrograms'} and
         manifest['format'] == 'yunipals-arena-native-derived-projector-owner-v1-source' and
         type(manifest['files']) is dict and len(manifest['files']) == 158 and manifest['files'].get(PROJECTION.name) == PROJECTION_SHA and
         type(manifest['externalPrograms']) is dict and len(manifest['externalPrograms']) == 6,
         'exact_reviewed_finite_projector_source_manifest_required')
    for name, digest in manifest['files'].items():
        need(type(name) is str and re.fullmatch(r'[a-z][a-z0-9.-]{1,110}\.(py|mjs|json|sql)', name) and
             pin(digest) and SOURCE_PINS.get(name) == digest, 'same_pinned_projector_transitive_source_required')
        public(OPS/name, digest)
    for path, digest in manifest['externalPrograms'].items():
        need(type(path) is str and Path(path).parent == TARGET_HELPER.parent and
             Path(path).name in {'admit-target.py', 'credentials.py', 'manifest.json', 'proposal.json', 'roles.sql', 'schema.sql'} and pin(digest),
             'fixed_projector_external_target_package_required')
        public(Path(path), digest)
    return manifest


def projection_namespace():
    projection_sources()
    return evaluate(PROJECTION, PROJECTION_SHA)


def composition():
    source_manifest()
    for name, digest in SOURCE_PINS.items():public(OPS/name, digest)
    for path, digest in EXTERNAL_PROGRAMS.items():public(path, digest)
    projection_sources()
    factory = evaluate(FACTORY, FACTORY_SHA)
    changes = {'journal': 0, 'authority': 0, 'bootstrap': 0, 'read-pool-fd': 0, 'projection-result': 0}
    def transform(node):
        for function in ast.walk(node):
            if isinstance(function, ast.FunctionDef) and function.name == 'child':
                descriptors = [row for row in function.body if isinstance(row, ast.Assign) and
                    any(isinstance(target, ast.Name) and target.id == 'fds' for target in row.targets)]
                need(len(descriptors) == 1 and isinstance(descriptors[0].value, ast.List) and len(descriptors[0].value.elts) == 3,
                     'three_original_sealed_authority_code_and_ledger_descriptors_required')
                descriptors[0].value.elts.append(ast.parse('self.read_pool_descriptor()', mode='eval').body)
                changes['read-pool-fd'] += 1
                for row in ast.walk(function):
                    if isinstance(row, ast.Constant) and row.value == 'yunipals-arena-modern-public-rollback-authority-v1':
                        row.value = 'yunipals-arena-ypal-business-inverse-authority-v1'; changes['authority'] += 1
                    elif isinstance(row, ast.Constant) and isinstance(row.value, str) and "format:'yunipals-arena-modern-public-rollback-child-v1'" in row.value:
                        need(row.value.count('Number(process.argv[4])).catch') == 1, 'one_original_child_ledger_argument_boundary_required')
                        row.value = row.value.replace('yunipals-arena-modern-public-rollback-child-v1', CHILD_FORMAT).replace(
                            'Number(process.argv[4])).catch', 'Number(process.argv[4]),Number(process.argv[5])).catch')
                        changes['bootstrap'] += 1
            if isinstance(function, ast.FunctionDef) and function.name == 'journal_intents':
                for row in ast.walk(function):
                    if isinstance(row, ast.Constant) and row.value == 'yunipals-arena-modern-public-rollback-child-v1':
                        row.value = CHILD_FORMAT; changes['journal'] += 1
            if isinstance(function, ast.FunctionDef) and function.name == 'publish':
                for row in ast.walk(function):
                    if isinstance(row, ast.Dict):
                        for key in row.keys:
                            if isinstance(key, ast.Constant) and key.value == 'scannerContinuous':
                                key.value = 'derivedProjectionContinuous'; changes['projection-result'] += 1
        return node
    value = factory.namespace(public(TEMPLATE, TEMPLATE_SHA), TEMPLATE_SHA, FILE,
        {'FORMAT': FORMAT, 'AREA': AREA, 'CUTOVER': CUTOVER, 'SOURCE': ARTIFACT, 'CHILD': CHILD,
         'ROOT': Path('/opt/yunipals-unified/releases')/BASE_SOURCE,
         'NATIVE_RELEASE': '0x4e77f52be3e0daa7075a22afe03fbeb7352daee788265ff69fe5c9ec2cf5c1f3',
         'PROFILE_ID': '0xebc51f361d9eb029d93f6f3f0ff2be78be8b7330ab7daff9a43deca1ae99aaff'}, transform=transform)
    need(changes == {'journal': 1, 'authority': 1, 'bootstrap': 1, 'read-pool-fd': 1, 'projection-result': 1},
         'exact_inverse_peer_identity_pool_descriptor_and_truthful_projection_result_seams_required')
    original = value.Host
    class Host(original):
        def __init__(self, plan, read_only_leaf=False, reconcile_only=False):
            need(type(read_only_leaf) is type(reconcile_only) is bool and not(read_only_leaf and reconcile_only),
                 'explicit_inverse_context_direction_required')
            self.read_only_leaf = read_only_leaf; self.reconcile_only = reconcile_only
            validate_plan(plan); self.plan = copy.deepcopy(plan); self.base = AREA/plan['operationId']; self.owner = owner_namespace()
            original_plan = json.loads(public(CUTOVER/'plan.json')); self.h = self.owner.Host(original_plan)
            self.h.recovery_binding(); self.h.files_and_roles(); self.h.artifacts(fresh=False)
            need(original_plan['runtimeInstall']['sha256'] == INSTALL_ACK and self.owner.installer.ARTIFACT == ARTIFACT,
                 'actual_e6bc_workers_and_ad024_install_ACK_required')
            actual = reference(plan['cutoverResult'])
            need(actual['format'] == 'yunipals-arena-ypal-ordinary-accept-v1' and actual['completed'] is True and actual['sourceDigest'] == BASE_SOURCE and
                 actual['currentActorsAcknowledgementSha256'] == self.owner.ACTOR_ACK_SHA, 'genuine_bound_Arena_base_code_ancestry_without_old_owner_alias_required')
            self.previous = reference(plan['predecessor'])
            need(self.previous['completed'] is True and ((plan['predecessor'] == plan['cutoverResult']) or
                 self.previous['format'] == FORMAT and self.previous['sourceDigest'] == ARTIFACT and Path(plan['predecessor']['file']).parent.parent == AREA),
                 'actual_bound_or_owned_compatible_inverse_predecessor_required')
            self.provision = reference(plan['targetAdmission']); self.auth = reference(plan['targetAuth'])
            self.target_helper = evaluate(TARGET_HELPER, TARGET_HELPER_SHA)
            need(self.provision['format'] == 'yunipals-arena-public-rollback-target-v1' and self.provision['commitOutcome'] == 'commit_confirmed' and
                 self.provision['operatorSha256'] == TARGET_HELPER_SHA and self.auth['targetResultSha256'] == plan['targetAdmission']['sha256'] and
                 self.auth['loginEnabled'] is self.auth['tcpAuthenticationProven'] is True and self.provision['database']['name'] == 'yunipals_arena_public_rollback' and
                 self.provision['database']['port'] == 5432 and set(self.provision['tables']) == {'chain_event', 'credit', 'deployment', 'tournament'},
                 'actual_target_four_public_tables_and_separate_auth_required')
            self.catalog = {**{key: self.provision[key] for key in ['tables', 'readerRole', 'writerRole']}, 'databaseOid': self.provision['database']['oid']}
            self.expected = self.previous_selection()
            if self.previous['format'] == FORMAT:
                self.expected_ledger = self.previous['retainedLedger']; self.expected_identities = self.previous['identities']
            else:
                intents = self.owner.transaction_intents(); adoptions = [row for row in intents if row['phase'] == 'adoption_commit_intent']
                need(len(adoptions) == 1 and type(adoptions[0].get('retainedLedger')) is dict, 'actual_owned_private_eleven_table_ledger_required')
                self.expected_ledger = adoptions[0]['retainedLedger']; self.expected_identities = None
            need(self.expected['kind'] != plan['targetKind'], 'compatible_source_switch_must_change_direction')
            public(CHILD, CHILD_SHA)
            if not reconcile_only:self.projection_current()

        def effect_source(self):
            need(not self.read_only_leaf and not self.reconcile_only, 'read_only_inverse_leaf_forbids_effect_dispatch')
            refs = self.plan['effectSource']; module = evaluate(EFFECT_SOURCE, refs['producerSha256'])
            config = json.loads(public(module.INPUT, refs['inputSha256']))
            need(config['stage'] == 'managed-restored' and config['arenaInverse'] is config['featureInverse'] is None,
                 'pre_Arena_and_feature_inverse_owned_source_phase_without_leaf_cycle_required')
            proof = module.validate_current_source(refs['inputSha256'])
            need(proof['validated'] is proof['currentWriterQualified'] is proof['sourceActorQualified'] is proof['frameworkReady'] is True and
                 proof['operatorSha256'] == refs['producerSha256'] and proof['inputSha256'] == refs['inputSha256'] and
                 proof['sourceKind'] == 'restored-owned-prefix' and proof['routingMode'] == 'ordinary-paid' and
                 proof['sourceRelease'] == value.NATIVE_RELEASE and proof['schemaOid'] == '75963410' and proof['buildId'] == '71e2a7f3b7' and
                 proof['ordinaryRuntimeAncestry'] == self.h.plan['ordinaryRuntime'] and
                 proof['databaseWrites'] == proof['serviceActions'] == proof['providerCalls'] == 0,
                 'actual_same_ready_restored_source_private_routes_native_and_positive_kernel_before_inverse_effect_required')
            return copy.deepcopy(proof['binding'])

        def financial(self):
            module = evaluate(FINANCIAL, FINANCIAL_SHA); proof = module.validate_current(self.plan['financialReceiptSha256'])
            need(proof['validated'] is proof['financialQualified'] is True and proof['sourceActorQualified'] is False,
                 'separate_current_actual_ordinary_financial_authority_required')
            if not self.read_only_leaf:self.effect_source()
            return {'producerSha256': FINANCIAL_SHA, 'receiptSha256': self.plan['financialReceiptSha256'],
                    'profileId': proof['profileId'], 'expiresMs': proof['expiresMs'], 'permits': proof['permits'], 'dailyPolicy': proof['dailyPolicy'],
                    'sourceRuntimeRequired': False, 'newPaidAllowance': False, 'financialWindowRenewed': False}

        def projection_current(self):
            refs = self.plan['projection']; module = projection_namespace()
            proof = module.validate_current(refs['resultSha256'], refs['inputSha256'], self.plan['support']['manifestSha256'])
            need(proof['validated'] is True and proof['producerSha256'] == refs['producerSha256'] and proof['receiptSha256'] == refs['resultSha256'] and
                 proof['inputSha256'] == refs['inputSha256'] and proof['support'] == self.plan['support'] and
                 proof['providerCalls'] == proof['databaseWrites'] == proof['serviceActions'] == 0,
                 'genuine_current_derived_native_projection_without_new_scanner_required')
            need(proof['bindingSha256'] == module.sha(module.encoded(proof['binding'])), 'same_genuine_projector_binding_digest_required')
            binding = proof['binding']
            need(binding['targetAdmissionSha256'] == self.plan['targetAdmission']['sha256'] and
                 binding['targetAuthSha256'] == self.plan['targetAuth']['sha256'] and binding['target'] == self.provision and
                 binding['sourceAuthSha256'] == self.h.plan['roleAuth']['sha256'] and binding['sourceRole'] == self.h.auth['sourceRole'],
                 'same_actual_native_and_target_admission_auth_and_catalog_receipts_required')
            self.checked_read_pool_identity(binding['readPoolIdentity'], binding['actor'])
            self.projection_actor = copy.deepcopy(binding['actor'])
            self.projection_binding_sha = proof['bindingSha256']
            return copy.deepcopy(proof['binding'])

        def checked_read_pool_identity(self, identity, actor=None):
            keys = {'format', 'producerSha256', 'inputSha256', 'support', 'sourceRole', 'nativeRelease', 'nativeDatabaseOid',
                    'publicReaderRole', 'publicDatabaseOid', 'targetAdmissionSha256', 'targetAuthSha256', 'nativePoolMaximum',
                    'publicReadPoolMaximum', 'nativeWorkerPoolMaximum', 'publicWorkerPoolMaximum', 'sourceRoleLimit', 'publicRoleLimit', 'runtimeEpoch'}
            need(type(identity) is dict and set(identity) == keys and
                 identity['format'] == 'yunipals-arena-native-derived-projector-owner-v1-read-pools' and
                 identity['producerSha256'] == self.plan['projection']['producerSha256'] and
                 identity['inputSha256'] == self.plan['projection']['inputSha256'] and identity['support'] == self.plan['support'] and
                 identity['sourceRole'] == self.h.auth['sourceRole'] and identity['nativeDatabaseOid'] == 17584 and
                 identity['publicReaderRole'] == self.provision['readerRole'] and identity['publicDatabaseOid'] == self.provision['database']['oid'] and
                 identity['targetAdmissionSha256'] == self.plan['targetAdmission']['sha256'] and identity['targetAuthSha256'] == self.plan['targetAuth']['sha256'] and
                 all(type(identity[key]) is int and identity[key] == number for key, number in [('nativePoolMaximum', 1), ('publicReadPoolMaximum', 1),
                    ('nativeWorkerPoolMaximum', 31), ('publicWorkerPoolMaximum', 31), ('sourceRoleLimit', 32), ('publicRoleLimit', 32)]),
                 'same_actual_two_roles_shared_owner_slots_and_native_target_pool_identity_required')
            actor = self.projection_actor if actor is None else actor
            epoch = identity['runtimeEpoch']
            need(type(epoch) is dict and set(epoch) == {'pid', 'startTicks', 'invocation', 'bootId'} and
                 epoch == {key: actor[key] for key in epoch} and type(epoch['pid']) is type(epoch['startTicks']) is int and
                 epoch['pid'] > 1 and epoch['startTicks'] > 0 and re.fullmatch('[a-f0-9]{32}', epoch['invocation']) and
                 re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', epoch['bootId']),
                 'same_actual_acknowledged_projector_runtime_epoch_before_delegated_SQL_required')
            source = identity['nativeRelease']; expected = self.h.manifest['source']
            need(source['releaseId'] == value.NATIVE_RELEASE and all(source[key] == expected[key] for key in
                 ['schema', 'schemaOid', 'buildId', 'manifestHash', 'startBlock', 'abiHash']),
                 'same_registered_actual_native_source_release_schema_and_definition_required')
            return copy.deepcopy(identity)

        scanner_identity = projection_current

        def retire_links(self, rows):
            self.effect_source(); return super().retire_links(rows)

        def stop_native(self, actors):
            self.effect_source(); return super().stop_native(actors)

        def install_source(self, review, selection):
            self.effect_source(); return super().install_source(review, selection)

        def start_native(self, review):
            self.effect_source(); return super().start_native(review)

        def child(self, action, *, journal=None, **extra):
            need(not self.reconcile_only or action == 'reconcile', 'reconcile_only_context_forbids_public_queries_and_effects')
            if action in {'halt', 'unhalt'} or action == 'switch' and extra.get('applyHash') is not None:self.effect_source()
            self._transport_action = action
            if action == 'reconcile':
                try:return super().child(action, journal=journal, **extra)
                finally:del self._transport_action
            refs = self.plan['projection']; module = projection_namespace()
            channel = module.open_read_pool(refs['resultSha256'], refs['inputSha256'], self.plan['support']['manifestSha256'], 'target')
            need(type(channel) is dict and set(channel) == {'socket', 'identity', 'bindingSha256'} and
                 isinstance(channel['socket'], socket.socket), 'actual_root_delegated_shared_public_reader_channel_required')
            try:
                need(channel['bindingSha256'] == self.projection_binding_sha,
                     'same_acknowledged_projector_at_read_pool_delegation_boundary_required')
                self._read_pool_socket = channel['socket']; self._read_pool_identity = self.checked_read_pool_identity(channel['identity'])
                return super().child(action, journal=journal, **extra)
            finally:
                channel['socket'].close()
                for key in ['_read_pool_socket', '_read_pool_identity', '_transport_action']:
                    if hasattr(self, key):delattr(self, key)

        def read_pool_descriptor(self):
            if self._transport_action == 'reconcile':
                return self.owner.sealed('arena-operational-reconcile', b'operational_readonly_reconcile_only')
            need(hasattr(self, '_read_pool_socket') and self._read_pool_socket.family == socket.AF_UNIX,
                 'actual_connected_shared_target_reader_descriptor_required')
            return os.dup(self._read_pool_socket.fileno())

        def payload(self, **extra):
            return {'targetUrl': self.public_url if self.plan['targetKind'] == 'legacy_rollback' else self.h.source_url,
                    'targetKind': self.plan['targetKind'], 'nativeReleaseId': value.NATIVE_RELEASE,
                    'cutoverChildSha256': self.h.child_sha, 'nativeSourceRole': self.h.auth['sourceRole'], 'provision': self.catalog,
                    'floor': self.plan['floor'], 'expectedSelection': self.expected, 'retainedLedger': self.expected_ledger,
                    'expectedIdentities': self.expected_identities, 'support': copy.deepcopy(self.plan['support']),
                    'readPoolKind': 'operational-reconcile' if self._transport_action == 'reconcile' else 'target',
                    'readPoolIdentity': None if self._transport_action == 'reconcile' else copy.deepcopy(self._read_pool_identity),
                    'rpc': {'url': 'http://127.0.0.1:19222/unified', 'profileId': value.PROFILE_ID}, **extra}

    value.Host = Host; value.validate_plan = validate_plan
    def scanner_closed(*args, **kwargs):raise RuntimeError('RPC_scanner_and_historical_owner_CLI_are_closed_in_derived_native_recovery')
    for name in ['main', 'scanner_start', 'scanner_setup_review', 'scanner_stop', 'scanner_stop_review', 'scanner_inspect',
                 'scanner_ack_start', 'finish_scanner_stop', 'scanner_definition', 'public_directory']:
        if hasattr(value, name):setattr(value, name, scanner_closed)
    return value


def snapshot(host, value):
    review = host.load_operation(); raw = public(host.base/'result.json'); result = json.loads(raw)
    need(result['format'] == FORMAT and result['completed'] is True and result['sourceDigest'] == ARTIFACT and
         result['planSha256'] == sha(encoded(host.plan)) and result['privateHistoriesRetained'] is True and
         result['privateDatabaseRestored'] is result['originalRuntimeStarted'] is False and result['schemaMigrations'] == 0,
         'actual_completed_compatible_business_inverse_result_required')
    need(result.get('derivedProjectionContinuous') is True and 'scannerContinuous' not in result,
         'truthful_derived_native_projection_without_scanner_success_alias_required')
    state = host.status(); observed = state['state']; intents = host.journal_intents()
    need(state['phase'] == 'published' and observed['selection'] == result['selection'] and observed['mode'] == {'indexer_mode': 'unified', 'halted': False},
         'actual_owned_selected_unhalted_compatible_epoch_required')
    statuses = {(row['phase'], row['xid']): row['status'] for row in observed['transactions']}
    for phase in ['halt_commit_intent', 'selection_commit_intent', 'unhalt_commit_intent']:
        rows = [row for row in intents if row['phase'] == phase]
        need(len(rows) == 1 and statuses.get((phase, rows[0]['xid'])) == 'committed', 'all_three_actual_owned_committed_inverse_boundaries_required')
    need(observed['retainedLedger']['verified'] is True, 'all_eleven_private_ledger_tables_preserved_required')
    host.h.files_and_roles(); host.h.m.verify_inputs(host.h.o, host.h.binding['privateInputHashes']); host.h.original_quiet()
    for unit in host.h.native:
        body = public(Path('/etc/systemd/system')/unit, maximum=100000)
        receipt = json.loads(public(host.base/(unit+'.source-file.json'))); row = (Path('/etc/systemd/system')/unit).lstat()
        need(sha(body) == receipt['unitSha256'] and [row.st_dev, row.st_ino] == receipt['identity'], 'same_owned_selected_worker_definition_inode_required')
        host.h.native[unit] = {'body': body, 'sha256': sha(body)}
    actors = host.h.native_set(allow_descendants=True); boots = host.links()
    need(len(actors) == 8 and actors == result['nativeActors'] and boots == review['bootLinks'], 'same_eight_acknowledged_e6bc_workers_and_owned_boot_inodes_required')
    target = host.target_verify(); finance = host.financial(); projection = host.projection_current()
    host.expected = observed['selection']
    current = host.child('inspect', retainedLedger=review['online']['retainedLedger'], expectedIdentities=review['online']['identities'])
    need(current['selection'] == observed['selection'] and current['mode']['halted'] is False, 'target_and_private_data_current_under_actual_selected_epoch_required')
    return {'resultSha256': sha(raw), 'operationSha256': sha(public(host.base/'operation.json')),
            'planSha256': sha(public(INPUT)), 'producerSha256': sha(public(FILE)), 'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'originalArena': copy.deepcopy(host.plan['cutoverResult']), 'originalArenaProducerSha256': OWNER_SHA,
            'originalArenaManifestSha256': OWNER_MANIFEST_SHA, 'originalBaseSourceDigest': BASE_SOURCE,
            'installedArtifactDigest': ARTIFACT, 'runtimeInstallReceiptSha256': INSTALL_ACK,
            'selection': observed['selection'], 'nativeActors': actors, 'bootLinks': boots,
            'privateInputHashes': copy.deepcopy(host.h.binding['privateInputHashes']),
            'retainedLedgerSha256': sha(encoded(review['online']['retainedLedger'])),
            'nativeIdentitySha256': sha(encoded(review['online']['identities'])),
            'transactions': [{'phase': row['phase'], 'xid': row['xid'], 'status': statuses[(row['phase'], row['xid'])]} for row in intents],
            'target': target, 'financial': finance, 'projection': projection, 'support': copy.deepcopy(host.plan['support'])}


def current_leaf(host, value):
    before = snapshot(host, value); after = snapshot(host, value)
    need(after == before, 'owned_inverse_actors_private_bindings_or_source_changed_during_capture')
    return before


def accept(host, value):
    binding = current_leaf(host, value)
    receipt = {'format': FORMAT+'-ack', 'producerSha256': sha(public(FILE)), 'completed': True,
               'binding': binding, 'bindingSha256': sha(encoded(binding)), 'compatibleBusinessInverse': True,
               'nativeEightWorkersRetained': True, 'allElevenPrivateLedgerTablesPreserved': True,
               'privateDatabaseRestored': False, 'preAdoptionRuntimeStarted': False, 'oldOwnerMainInvoked': False,
               'sourceActorQualified': False, 'financialAuthorityQualified': False, 'databaseWrites': 0, 'serviceActions': 0}
    path = host.base/'inverse-ack.json'
    if path.exists():need(json.loads(public(path)) == receipt, 'same_once_owned_inverse_ACK_required')
    else:value.save(path, receipt)
    return {'receiptSha256': sha(public(path)), 'planSha256': binding['planSha256'], 'producerSha256': receipt['producerSha256'],
            'compatibleBusinessInverse': True, 'databaseWrites': 0, 'serviceActions': 0}


def validate_inverse_leaf(result_sha, plan_sha):
    need(pin(result_sha) and pin(plan_sha), 'actual_owned_business_inverse_ACK_and_input_refs_required')
    plan = json.loads(public(INPUT, plan_sha)); value = composition(); host = value.Host(plan, read_only_leaf=True)
    result = json.loads(public(host.base/'inverse-ack.json', result_sha)); binding = current_leaf(host, value)
    need(result['format'] == FORMAT+'-ack' and result['producerSha256'] == sha(public(FILE)) and result['completed'] is True and
         result['binding'] == binding and result['bindingSha256'] == sha(encoded(binding)) and binding['planSha256'] == plan_sha,
         'exact_same_current_compatible_business_inverse_ACK_required')
    return {'format': FORMAT+'-leaf', 'validated': True, 'producerSha256': result['producerSha256'], 'receiptSha256': result_sha,
            'planSha256': plan_sha, 'binding': binding, 'bindingSha256': result['bindingSha256'], 'compatibleBusinessInverse': True,
            'nativeEightWorkersRetained': True, 'allElevenPrivateLedgerTablesPreserved': True,
            'privateDatabaseRestored': False, 'preAdoptionRuntimeStarted': False, 'sourceActorQualified': False,
            'financialAuthorityQualified': False, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0}


def main():
    import argparse
    import socket
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument('--plan-sha'); parser.add_argument('--prepare')
    parser.add_argument('--publish'); parser.add_argument('--continue-published'); parser.add_argument('--reconcile', action='store_true')
    parser.add_argument('--accept', action='store_true'); parser.add_argument('--finish-prepared', action='store_true')
    args = parser.parse_args()
    if args.plan_sha is None:
        need(not any([args.prepare, args.publish, args.continue_published, args.reconcile, args.accept, args.finish_prepared]), 'actual_plan_before_explicit_phase_required')
        print(json.dumps({'format': FORMAT, 'staticOnly': True, 'databaseWrites': 0, 'serviceActions': 0, 'providerCalls': 0})); return
    need(os.geteuid() == os.getegid() == 0 and socket.gethostname() == 'yunipals-main' and
         sum(bool(item) for item in [args.prepare, args.publish, args.continue_published, args.reconcile, args.accept, args.finish_prepared]) <= 1,
         'one_explicit_owned_root_inverse_phase_required')
    os.umask(0o077)
    value = composition(); host = value.Host(json.loads(public(INPUT, args.plan_sha)), reconcile_only=args.reconcile)
    with host.h.m.existing_source_lease():
        if args.reconcile:result = host.status()
        elif args.accept:result = accept(host, value)
        elif args.finish_prepared:result = value.finish_prepared(host)
        elif args.prepare:result = value.prepare(host, host.review(), args.prepare)
        elif args.publish or args.continue_published:
            value.publish(host, args.publish or args.continue_published, bool(args.continue_published)); result = accept(host, value)
        else:
            review = host.review(); result = {'review': review, 'reviewHash': value.review_hash(review), 'databaseWrites': 0, 'serviceActions': 0}
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda *_: need(False, 'bounded_inverse_parent_unknown_readonly_reconcile_required'))
    signal.alarm(MAXIMUM_PARENT_SECONDS)
    try:main()
    except BaseException as error:
        print(json.dumps({'format': FORMAT, 'completed': False, 'errorClass': type(error).__name__,
                          'fixedCode': str(error) if type(error) is RuntimeError and re.fullmatch('[A-Za-z0-9_]+', str(error)) else 'private_inverse_diagnostics_withheld',
                          'automaticRetry': False, 'reconciliationRequired': True})); raise SystemExit(1)
    finally:signal.alarm(0)
