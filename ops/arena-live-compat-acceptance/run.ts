// No server/worker is started. Every API request stays in-process; every DB/RPC
// dependency used by these acceptance tests is an explicit synthetic fixture.
import "./catalog-config.test";
import "./public-api.test";
import "./native-guards.test";
import "./artwork-funding.test";
import "./native-history.test";
