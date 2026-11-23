# Needs validation

## Per-IP auth and join rate limits only work if TRUST_PROXY matches Railway's edge hop count. A mismatch either puts all clients in one bucket or lets clients spoof X-Forwarded-For

Fingerprint: `src/http/middleware/rate-limit.ts:limitByIp:trust-proxy-hop-count`

Google sign-in (POST /v1/auth/google), demo sign-in (/v1/auth/demo, when enabled) and token refresh (/v1/auth/refresh) share one in-memory per-IP limiter (30/min, scope 'auth'). Join preview and join share another (60/min, scope 'join'). mount() runs these limiters before authenticate (route.ts:46-47), so both are reached before any authentication. Both limiters key on req.ip. Express 5.3.0 derives req.ip from the bare numeric TRUST_PROXY hop count, which defaults to 0. If the deployed value is lower than the real proxy hops in front of the container, req.ip is the proxy's address for every client. One anonymous client sending more than 30 auth requests a minute (or 60 join requests) would then get 429 returned to every user's Google sign-in and refresh (or join) until the window resets, and this lasts as long as the client keeps sending. If the value is higher than the real hops, the leftmost X-Forwarded-For entries, which the client controls, become req.ip, and the client can rotate buckets to bypass the IP limits. The bypass impact is limited: sign-in still needs a valid Google ID token, refresh tokens are 32 random bytes, and join-code guessing is still capped by the per-student 5-failures/15-min limiter, which does not use req.ip. The code is correct only when TRUST_PROXY equals the exact number of appending proxy hops. The README tells operators to set it to 1 for Railway. The value actually deployed, and how Railway's edge handles X-Forwarded-For, are not in the repository.

**Claimed root cause.** limitByIp keys on req.ip. Express derives req.ip from a bare hop count (app.set('trust proxy', config.trustProxy)), and that count comes from an env var with a 0 default. Nothing checks that the immediate peer is the platform edge, and nothing guards against a wrong value. So whether the per-IP limits isolate clients depends entirely on an unverified deployment variable matching the platform's proxy topology.

**Trace**

- entrypoint: `src/modules/auth/auth.controller.ts:23` (authController): limited = [limitByIp(deps.authLimiter, 'auth')] is applied to googleSignIn (line 30), demoSignIn when enabled (line 40) and refresh (line 49). All three are public, anonymous endpoints.
- propagation: `src/config/config.ts:28` (EnvSchema.TRUST_PROXY): TRUST_PROXY: z.coerce.number().int().min(0).default(0). It maps to config.trustProxy at line 73.
- propagation: `src/app.ts:65` (createApp): app.set('trust proxy', config.trustProxy). In express 5.3.0 (lib/utils.js:202-205), compileTrust(number) returns (a,i)=>i<val. That is a pure hop count with no check on the address.
- propagation: `src/app.ts:50` (createApp limiters): authIp = new MemoryRateLimiter(30, MINUTE, clock): one process-wide fixed window per key. joinIp (line 49) is 60/min.
- propagation: `src/http/route.ts:46` (mount): Endpoint middleware (the limiter) runs before authenticate (line 47), so the join IP limiter is also reached without authentication.
- sink: `src/http/middleware/rate-limit.ts:8` (limitByIp): limiter.hit(`${scope}:${req.ip}`). Once over the limit, it throws RATE_LIMITED (lines 10-13) for every request that shares that req.ip.

**Evidence**

- `src/config/config.ts:28`: TRUST_PROXY defaults to 0. Behind any proxy this makes req.ip the proxy's socket address.
- `src/app.ts:65`: The numeric hop count goes straight into Express trust proxy, with no address allowlist.
- `src/http/middleware/rate-limit.ts:8`: The rate-limit key comes only from req.ip.
- `src/modules/auth/auth.controller.ts:49`: Token refresh shares the 30/min auth bucket, so a merged bucket also blocks session renewal for all clients.
- `src/modules/enrollments/enrollment.controller.ts:13`: Join preview and join use limitByIp(joinIpLimiter,'join') (60/min) on the same req.ip.
- `README.md:131`: The README documents TRUST_PROXY default 0 and says 'Railway: 1'. Line 230 lists TRUST_PROXY=1 in the production variables. Neither railway.json nor the Dockerfile sets it, so the deployed value is an operator fact.
- `src/lib/rate-limiter.ts:33`: MemoryRateLimiter.hit is a fixed-window counter per key string. It has no notion of identity beyond the key, so the effect depends entirely on how req.ip is derived.

**Blockers**

- The TRUST_PROXY value on the deployed Railway production service is not in source. README.md:131/230 tell operators to set 1, but railway.json and the Dockerfile do not set it, and .env.example has 0.
- How many proxy hops Railway's edge adds in front of the container, and whether it appends to or overwrites a client-supplied X-Forwarded-For, are hosted-platform facts. They are not visible in the repository and cannot be observed locally.

**Local plan (performed)**

Done in the bounded fixture agents/v2-trust-proxy/artifacts/trust-proxy-limiter.test.ts, which mounts the real limitByIp and MemoryRateLimiter (limit 2/min) on Express 5.3.0 and sends requests over supertest loopback. With trust proxy 0 and XFF set to 198.51.100.1, .2 and .3, the statuses were [200,200,429] (one merged bucket). With trust proxy 2 and XFF '203.0.113.<i>, 198.51.100.9', all 5 returned 200, with req.ip equal to the spoofed 203.0.113.<i>. With trust proxy 1, the same headers gave req.ip 198.51.100.9 and statuses [200,200,429] (correct per-client bucket). The source behavior is therefore reproduced. Only the deployed hop count remains open.

**Owner-observed check**

The owner should check the production service's TRUST_PROXY variable in the Railway dashboard (expect 1). On a non-production review deployment of the same service type, temporarily log req.ip and req.ips for one request sent from a known client IP with the header 'X-Forwarded-For: 203.0.113.9'. Expected for TRUST_PROXY=1: req.ip is the known client IP, not 203.0.113.9, and not a private or edge address. This shows Railway adds exactly one hop that appends to the header. Do not send rate-limit load to production.
