# OAuth Provider 契约（先于代码）

> 阶段 3 的施工契约。本文定义 `lib/oauth-provider.js` 与 `lib/oauth-server.js` 的接口边界，
> **代码未写之前先定契约**——任何实现不得偏离本文；若要偏离，先改本文并记录原因。
>
> 依据：`oauth-reference.md`（SDK 2.2.0 契约 + opencode 实现实证）、`lib/auth-store.js`（已交付并 29 测试全绿）。
> 状态：**待实现**。本篇只定义「谁调用谁、数据怎么流、失败怎么退」，不含具体算法。

---

## 1. 参与方与依赖方向

```
lib/index.js (host 半, 唯一装配点)
   ├─ import auth-store.js   ← 已存在, 单向依赖
   ├─ import oauth-provider.js  ← 待建
   └─ import oauth-server.js    ← 待建(被 index.js 调用, 不反向依赖)

lib/client.js (浏览器半)  ──HTTP──►  lib/index.js 注册的 /api/dsh-mcp-skill-hub/oauth/*

dsh-src 底座 dsh-mcp-client
   └─ ctx.get('mcpAuth', false) → 由 index.js 注册的 mcpAuth 服务
       └─ 每 MCP 行一个 provider 实例(按 serverUrl 索引)
```

**禁止**：`oauth-provider.js` / `oauth-server.js` import `lib/index.js`（会成环，因为 index.js 要 import 它们）。
两者只能 import `auth-store.js`、node 内置模块、`@modelcontextprotocol/sdk`。

---

## 2. auth-store 已交付的能力（契约的事实基础）

`lib/auth-store.js` 现有导出（29 测试全绿，勿改其语义）：

| 函数 | provider/server 用途 |
|---|---|
| `getEntry(filePath, name)` | 取整条（含 serverUrl 匹配前的原始条目） |
| `getEntryForUrl(filePath, name, url)` | **防串凭据**：URL 规范化后比对，不匹配返回 undefined |
| `getClientInfo / setClientInfo` | clientId / clientIdIssuedAt / clientSecret |
| `getTokens / setTokens / clearTokens` | accessToken / refreshToken / expiresAt(unix 秒) / scope |
| `getCodeVerifier / setCodeVerifier` | PKCE verifier；**自动打 pendingAt** |
| `getOAuthState / setOAuthState` | CSRF state；**自动打 pendingAt** |
| `clearOAuthState(filePath, name)` | 成对清除 verifier + state + pendingAt |
| `purgeStalePending(filePath, maxAgeMs)` | 清理过期 pending（判据 pendingAt） |
| `loadAuthStore / saveAuthStore / listEntries / mergeExternalStore` | 文件级 |

**凭据文件路径**：`~/.dsh/mcp-auth.json`，0600，按 `{[name]: entry}` 扁档，`serverUrl` 为防串凭据的比对键。

---

## 3. `lib/oauth-provider.js` 契约

### 3.1 工厂签名

```js
createAuthProvider({ name, serverUrl, staticHeaders }) → OAuthClientProvider 实例
```

- `name`：MCP 行的 id（patch 里的 `- id:`，如 `mcp-cloudflare`）；auth-store 的索引键
- `serverUrl`：该行 config.url；auth-store 的防串凭据比对键
- `staticHeaders`：patch 里该行 config.headers（可能为空对象）——**provider 不持有、不写入它**，仅用于审计日志

### 3.2 SDK 必需成员的实现职责

| SDK 成员 | 实现职责 | 读/写 auth-store |
|---|---|---|
| `get redirectUrl()` | 返回本方案的回调 URL（占位，见 §4.2） | 无 |
| `get clientMetadata()` | `{redirect_uris:[redirectUrl], client_name:"dsh-mcp-skill-hub", client_uri, grant_types:["authorization_code","refresh_token"], response_types:["code"], token_endpoint_auth_method:"none", scope}` | 无 |
| `clientInformation(ctx)` | 有存储返回 `{client_id, client_secret}`；`clientSecretExpiresAt` 已过返回 undefined（触发重新 DCR）；无则 undefined | 读 `getClientInfo` |
| `saveClientInformation(info, ctx)` | DCR 成功后持久化 | 写 `setClientInfo` |
| `tokens(ctx)` | **`ctx === undefined` 时必须返回最近 token（per-request 读取路径）**；返回 `{access_token, token_type:"Bearer", refresh_token, expires_in, scope}`，其中 `expires_in = max(0, floor(expiresAt - now))` | 读 `getTokens` |
| `saveTokens(tokens, ctx)` | 持久化，`expiresAt = floor(now) + expires_in` | 写 `setTokens` |
| `redirectToAuthorization(url)` | 校验协议仅 http/https；否则抛错。其余由 server 层处理 | 无 |
| `saveCodeVerifier(v)` | 同时打 pendingAt | 写 `setCodeVerifier` |
| `codeVerifier()` | 读；无则抛错（SDK 会在授权回调时调用） | 读 `getCodeVerifier` |
| `state()` | 可选;实现为 32B hex，与 server 层约定 | 写 `setOAuthState` |

### 3.3 明确不实现的（含理由）

| 成员 | 理由 |
|---|---|
| `addClientAuthentication` | Cloudflare 两端点 `token_endpoint_auth_methods` 含 `none`，public client 足够 |
| `dpop()` | 本方案无 DPoP 需求（SEP-1932 未涉及） |
| `clientMetadataUrl` | Cloudflare 主端点虽支持 `client_id_metadata_document_supported: true`，但 DCR 更直接且两端点都有 registration_endpoint |

### 3.4 降级与失败约定

- 所有方法**同步或 async 均可**，但不得抛未包装的原始错误——错误 message 只能含 name 与 serverUrl 的 host，**不得含 token/client_secret**（铁律 6）
- `tokens()` 返回 undefined 表示「需要授权」；SDK 会据此发出 UnauthorizedError
- provider **不负责**触发授权跳转（那是 §4 server 层的职责）

---

## 4. `lib/oauth-server.js` 契约

### 4.1 路由（挂在 Hub 既有 webserver，`kind:'exact'`，自动继承 loopback 围栏）

| 路由 | 方法 | 请求 | 响应 |
|---|---|---|---|
| `/oauth/start` | POST | `{id}` | `{status:"already-works"}` 或 `{status:"need-auth", authUrl, state}` 或 `{status:"failed", error}` |
| `/oauth/callback` | GET | `?code=&state=` | HTML「授权成功，可关闭」/ 400 错误页 |
| `/oauth/status` | GET | `?id=` | `{status:"not_authenticated"│"pending"│"authenticated"│"expired", hasClientId}` |
| `/oauth/finish` | POST | `{id}` | `{status:"ok"}` 或 `{status:"failed", error}` |
| `/oauth/logout` | POST | `{id}` | `{status:"ok"}` |

### 4.2 回调 URL 的构造（与 opencode 的差异点，已定）

- **随机端口**：授权开始时 `http.createServer` 监听 `127.0.0.1:0`（OS 分配），拿到端口后才知道 redirectUrl
- 因此 `provider.redirectUrl` **不能是构造期常量**——必须由 server 层在 start 时注入
- 契约：`createAuthProvider` 返回的对象带一个 `setRedirectUrl(url)` 方法（非 SDK 成员，Hub 内部扩展）
- **回调路径固定 `/mcp/oauth/callback`**（与 opencode 一致，便于将来复用其实现经验）

### 4.3 状态机（每个 MCP 行一份，内存态）

```
idle ──start──► connecting(直连尝试)
      ├─ 成功 ──────────────────► already-works(结束)
      └─ 401 + 有 authorize URL ─► authorizing
                                   ├─ 收到合法回调 ──► exchanging(换 token)
                                   │                      ├─ 成功 ─► finish → idle(已认证)
                                   │                      └─ 失败 ─► idle(清除 pending)
                                   ├─ 超时(默认 300s)──► idle(清除 pending)
                                   └─ 用户取消 ────────► idle(清除 pending)
```

**超时与取消**：回调 server 必须有 TTL（默认 300s，可配），到期 `server.close()` 并清 pending；提供 `cancelAuth(id)` 供 UI「取消」按钮。

### 4.4 state 校验（安全红线）

- `state` 由 provider 的 `state()` 生成（32B hex），存入 auth-store（pending 态）
- 回调到达时**必须**先比对，不匹配返回 400 且**不**写任何凭据
- 比对用的 message 不得含 state 本身

---

## 5. 数据流（端到端）

```
1. UI 点「授权」→ POST /oauth/start {id:"mcp-cloudflare"}
2. index.js: 从 patch 读该行 url(与 mcpAuth 服务里的 provider 同源)
3. provider.tokens(ctx=undefined) → undefined(未认证)
4. 「静态 headers + 无 token」直连尝试(复用 mcpAuth 服务的 transport)
   ├─ 成功 → {status:"already-works"}                     [opencode 同策略]
   └─ 401 → SDK 调 provider.redirectToAuthorization(url)
5. server 起回调 server(127.0.0.1:0) → 拿到 port → provider.setRedirectUrl(...)
6. 存 codeVerifier + oauthState 到 auth-store(pending 态)
7. 返回 {status:"need-auth", authUrl, state} → UI window.open(authUrl)
8. 用户在浏览器完成 Cloudflare 授权(勾选 scope)
9. 回跳 127.0.0.1:<port>/mcp/oauth/callback?code=&state=
10. 校验 state → SDK 用 codeVerifier 换 token → provider.saveTokens 落盘
11. 返回「授权成功」HTML；回调 server 关闭
12. UI 轮询到成功 → POST /oauth/finish {id}
13. index.js: clearOAuthState(清 pending) + 触发 hmr reload 该 MCP 行
14. 底座 createTransport(config, authProvider) 用同一 provider 重建 transport
15. 工具上线, live=true
```

**关键依赖**：步骤 14 的 `authProvider` 来自 `ctx.get('mcpAuth', false)`，即底座 seam。
seam 未就绪时步骤 13-15 退化为「提示需重启 dsh」（applyAfterWrite 已返回 watch/restart-required）。

---

## 6. 底座 seam 的最小改动（用户硬约束 2：只加可选参数 + 一行透传，无 if/else 分支）

| 文件 | 改动 | 预估行数 |
|---|---|---|
| `dsh-src/packages/mcp/mcp-client/src/transport.ts` | `createTransport(config, authProvider?)`；streamable-http 分支传 `authProvider` | +4 |
| `dsh-src/packages/mcp/mcp-client/src/connection.ts` | `startConnection(...)` 增透传参数至 `createTransport` 调用点 | +3 |
| `dsh-src/packages/mcp/mcp-client/src/index.ts` | `ctx.get('mcpAuth', false)` 取服务并传入 | +6 |

**合计 +13 行**（上限 25）。三个文件均为「加可选参数 + 一行透传」，无分支逻辑。

**装配点（index.ts）形状**（示意，非最终代码）：
```js
const mcpAuth = ctx.get('mcpAuth', false)
// mcpAuth.getAuthProvider(serverName, url) → provider | undefined
```

---

## 7. 待实测项（实现前需验证，阻塞项已标注）

| # | 项 | 是否阻塞 |
|---|---|---|
| 1 | Cloudflare access token 实际 `expires_in` | 阻塞（决定是否必须做自动 refresh） |
| 2 | refresh_token 是否轮换 | 阻塞 |
| 3 | radar.mcp.cloudflare.com 是否接受 API Token | 不阻塞（radar 非首批目标） |
| 4 | `ctx.get('mcpAuth', false)` 在 Cordis 的可用性（服务未注册时返回 undefined 而非抛错） | **阻塞 seam** |
| 5 | dsh-src 里 REAL-composition 测试的既有写法（`load-path.spec.ts` 的真实 loader 路径） | 阻塞（硬约束 2 要求） |

---

## 8. 变更记录

| 日期 | 变更 | 原因 |
|---|---|---|
| 2026-10-20 | 初版 | 阶段 3 开工前契约 |
