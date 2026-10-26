# opencode MCP OAuth 实现参考笔记

> 供 dsh-mcp-skill-hub 的 MCP OAuth 登录能力实现对照使用。
> 目标实现文件：`lib/auth-store.js`、`lib/oauth-provider.js`、`lib/oauth-server.js`、底座 seam、UI。
>
> **材料来源**：`@modelcontextprotocol/sdk` 2.2.0 类型定义（本机安装版）、opencode v1.18.35 编译产物提取、2026-10-20 对 Cloudflare MCP 端点的 curl 实测。
> 本文所有事实均为实测/实证，未实证的内容统一收敛到文末「待实测项」，不要凭印象补全。

---

## 1. 文档目的与适用范围

本文是**实现参考笔记**，不是设计提案（设计决策见 §6，已与用户确认），也不是 API 手册。

后续施工时按 §7「实现检查清单」逐项对照：

| 未来文件 | 职责 | 主要对照章节 |
|---|---|---|
| `lib/auth-store.js` | 按 serverUrl 持久化 clientInfo / tokens / codeVerifier / oauthState | §2（`OAuthClientProvider` 存储语义）、§3（opencode 的 pending 态与文件结构） |
| `lib/oauth-provider.js` | 实现 `OAuthClientProvider` 11 成员，包装 auth-store | §2（逐成员要点与坑）、§3（opencode provider 类逻辑） |
| `lib/oauth-server.js` | 回调路由 + state 校验 + 授权码换取编排 | §2（401 行为）、§3（startAuth/authenticate/finishAuth 流程）、§5 |
| 底座 seam（`dsh-mcp-client` 的 `createTransport`） | 加可选 `authProvider` 第二参数 | §2（`StreamableHTTPClientTransportOptions.authProvider`）、§6.4 |
| UI（设置页） | 触发授权、展示状态、诊断输出 | §3（opencode CLI 交互面） |

适用范围：Streamable HTTP 传输的 MCP 服务器、走 `authorization_code` + PKCE + DCR（或预置 clientId）的标准 OAuth 2.1 授权流程。不适用 stdio 传输（无 OAuth 需求）、DPoP 场景（见 §2）。

---

## 2. SDK 契约速查

SDK：`@modelcontextprotocol/sdk` **2.2.0**，本机安装版路径
`/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@modelcontextprotocol/client/dist/index.d.mts`
（即 dsh 自带的 `@modelcontextprotocol/client`，实现时用 dsh 内的这份，不要另装版本）。

### 2.1 入口：`StreamableHTTPClientTransportOptions`

```ts
interface StreamableHTTPClientTransportOptions {
  authProvider?: AuthProvider | OAuthClientProvider;
  // ...
}
```

SDK 文档原文要点（三条，全部重要）：

1. "`AuthProvider.token()` is called **before every request** to obtain the bearer token. When the server responds with **401**, `AuthProvider.onUnauthorized()` is called (if provided) to refresh credentials, **then the request is retried once**. If the retry also gets 401, or if `onUnauthorized` is not provided, the transport throws `UnauthorizedError`."
2. "For simple bearer tokens: `{ token: async () => myApiKey }`."
3. "For OAuth flows, pass an `OAuthClientProvider` implementation directly — the transport adapts it to `AuthProvider` internally via `adaptOAuthProvider`. **No changes are needed to existing implementations.**"

结论：**我们不需要自己写 `adaptOAuthProvider`**，直接把 `OAuthClientProvider` 实例传给 transport 即可。

### 2.2 `AuthProvider` 简化面（只有 2 个成员）

| 成员 | 签名 | 调用时机 |
|---|---|---|
| `token` | `token(): Promise<string \| undefined>` | 每次请求前 |
| `onUnauthorized` | `onUnauthorized?(ctx: UnauthorizedContext): Promise<void>` | 收到 401 后，之后请求重试一次 |

- `token()` 返回 `undefined` = 无 token，transport 不发 `Authorization`（或发静态 headers 里的那个，见 §2.4）。
- `onUnauthorized` 是**刷新凭据**的钩子（典型实现：用 refresh_token 换新 access token 并落盘），不是"重新授权"的钩子。refresh 失败时应抛错或让 `token()` 继续返回旧值，最终 transport 抛 `UnauthorizedError` 给上层。

### 2.3 `OAuthClientProvider` 接口 11 成员

#### 必需（9 个）

| # | 成员 | 实现要点 / 坑 |
|---|---|---|
| 1 | `get redirectUrl(): string \| URL \| undefined` | 回调地址。opencode 用 `config.redirectUri ?? http://127.0.0.1:${port ?? 19876}/mcp/oauth/callback`。**本方案用随机端口**，见 §6.1。 |
| 2 | `get clientMetadata(): OAuthClientMetadata` | DCR 元数据。opencode 版见 §3.1，可直接照抄改字段。`token_endpoint_auth_method` 必须按有无 clientSecret 在 `none` / `client_secret_post` 间切换。 |
| 3 | `state?(): string \| Promise<string>` | 签名标为**可选**，但交互式授权流**建议实现**（CSRF 防护，opencode 生成 32 字节随机 hex = 64 字符）。SDK 在交互流里会调用它。 |
| 4 | `clientInformation(ctx?: OAuthClientInformationContext)` | 返回已存 clientId/Secret，或 `undefined`（= 需要 DCR）。注意 opencode 的**过期判定**：`clientSecretExpiresAt` 已过 → 返回 `undefined` 触发重新 DCR（见 §3.1）。 |
| 5 | `tokens(ctx?: OAuthClientInformationContext)` | **最大的坑，见 §2.5-A**。 |
| 6 | `saveTokens(tokens, ctx?)` | 落盘。opencode 把 `expires_in`（相对秒）换算成 `expiresAt`（unix 秒）再存，见 §3.1。 |
| 7 | `redirectToAuthorization(authorizationUrl: URL)` | 打开浏览器。opencode 额外**校验协议只允许 http/https**，否则抛错（防止 file:/javascript: 等）。建议照做。 |
| 8 | `saveCodeVerifier(codeVerifier)` | PKCE verifier 持久化（授权流程跨进程/跨重启，必须落盘）。 |
| 9 | `codeVerifier()` | 读回 verifier。SDK 换取 token 时调用。 |

#### 可选（3 个）

| # | 成员 | 说明 |
|---|---|---|
| 10 | `saveClientInformation?(clientInformation, ctx?)` | **强烈建议实现**——DCR 成功后 SDK 调它保存 clientId；不实现则每次重新注册。 |
| 11 | `addClientAuthentication?` | 自定义 token 请求的客户端认证。Cloudflare 支持 `client_secret_post` / `none`，标准路径够用，**可不实现**；仅在遇到非标准认证时再加。 |
| 12 | `dpop?()` | DPoP 发送方约束 token。**本方案不需要**（Cloudflare 未要求）。 |

#### `OAuthClientInformationContext`

```ts
{ issuer: string }  // 授权服务器 issuer，用于按 AS 分键存凭据
```

RFC 6749 §2.2：client_id 对授权服务器唯一。多 AS 场景应按 issuer 分键；provider **可选忽略**（我们的存储按 serverUrl 索引，serverUrl 已隐含 issuer，见 §3.4）。

### 2.4 优先级规则（关键，两个坑之一）

SDK 原文：

> "transport-managed headers take precedence over a same-named entry here: **`Authorization`** when `authProvider` yields a token, `mcp-session-id`, and `mcp-protocol-version`. A caller-supplied `Authorization` value is therefore **only sent while the provider has no token**, which lets a static API key fall back to OAuth once the provider obtains one."

拆开说：

- **坑 B-1（provider 有 token 时）**：transport 自己下发的 `Authorization: Bearer <token>` **覆盖**调用方静态 headers 里的同名 `Authorization`。所以：一旦 OAuth token 到手，静态 API key 自动失效——这是好事，不会出现"两个 Authorization 打架"。
- **坑 B-2（provider 无 token 时）**：静态 headers 里的 `Authorization` **会被原样发送**。这正是「静态 API key 兜底」的实现基础：provider 没 token 时先拿用户的静态 API Token 顶着，server 认它就完全不需要走 OAuth；不认才 401 → 走授权 → token 到手后自动切换到 OAuth。

> ⚠️ **注意**：同一个请求**不会**同时发两个 Authorization。不要试图自己拼装两个值。

推论（本方案授权起点策略的依据，见 §6.5）：`createTransport(config, provider)` 后先不发任何静态 token 试连——provider 无 token → 只有静态 headers 里的 API Token 生效；401 才启动 OAuth。SDK 的优先级规则保证这条路径成立。

### 2.5 两个必须醒防的坑

#### 坑 A：`tokens()` 在 `ctx === undefined` 时必须返回最近保存的 token set

SDK 特别说明：`tokens()` 有两种调用路径——

1. **per-request bearer-token 读取**（transport 每次请求前 adapt 后调 `token()` 最终走到这里）：`ctx === undefined`。
2. 授权/刷新流程内调用：`ctx` 带 `{ issuer }`。

**`ctx === undefined` 时不得返回 `undefined`**，必须返回最近一次保存的完整 token set（`{ access_token, token_type, refresh_token, expires_in, scope }`）。返回 `undefined` 会让 transport 认为"没有凭据"，表现为：明明已经授权过，下次请求还是 401 或直接不发 token。

实现约束：`auth-store.js` 的读接口必须做到「读到的 tokens 对象字段齐全」，而 opencode 的存储结构是 `{ accessToken, refreshToken, expiresAt, scope }`（**没有 `token_type`、没有 `expires_in`**），所以 `oauth-provider.js` 的 `tokens()` 要做**字段映射 + `expires_in` 反算**：

```js
// 参考 opencode：expires_in = max(0, floor(expiresAt - now))
const expires_in = Math.max(0, Math.floor(entry.tokens.expiresAt - Date.now() / 1000));
return {
  access_token: entry.tokens.accessToken,
  token_type: 'Bearer',
  refresh_token: entry.tokens.refreshToken,
  expires_in,
  scope: entry.tokens.scope,
};
```

`expires_in` 为 0（已过期）时**也要返回对象**，让 SDK 走 `onUnauthorized` → refresh，而不是当成"无凭据"。

#### 坑 B：静态 headers 与 provider token 的优先级

见 §2.4。一句话：**provider 无 token → 静态 `Authorization` 生效；provider 有 token → OAuth token 覆盖静态值。** 这是「静态 API key 兜底 + 平滑升级到 OAuth」的全部机制基础。

### 2.6 401 行为链路

```
请求 → token() 取 token
  ├─ 有 token → 发 Authorization: Bearer
  │    ├─ 200 → 正常
  │    └─ 401 → onUnauthorized()（刷新）→ 重试一次
  │           ├─ 200 → 正常
  │           └─ 401 → throw UnauthorizedError
  └─ 无 token → 发静态 headers 的 Authorization（若有）
       ├─ 200 → 正常（无需授权）
       └─ 401 → onUnauthorized()？没有凭据可刷 → throw UnauthorizedError
```

对上层（Hub）的含义：`UnauthorizedError` = "需要（重新）授权"，应转成 UI 上的"去授权"入口，而不是致命错误。**不要**在 transport 外面再包一层无脑重试，会与 SDK 的"重试一次"叠加成多次请求。

---

## 3. opencode 实现要点（v1.18.35，编译产物提取实证）

### 3.1 provider 类（`T2`）逻辑

**`redirectUrl` getter：**

```js
this.config.redirectUri ?? `http://127.0.0.1:${this.config.callbackPort ?? 19876}${"/mcp/oauth/callback"}`
```

**`clientMetadata` getter：**

```js
{
  redirect_uris: [this.redirectUrl],
  client_name: "OpenCode",
  client_uri: "https://opencode.ai",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: this.config.clientSecret ? "client_secret_post" : "none",
  ...(this.config.scope ? { scope: this.config.scope } : {})
}
```

要点：
- `client_name` / `client_uri` 我们改成 dsh-mcp-skill-hub 自己的标识。
- `scope` 仅在配置显式给了才带；Cloudflare 主端点有 384 个细粒度 scope，不给 scope 时由 AS 决定默认集（见 §4）。
- `token_endpoint_auth_method` 的 `none` 分支对应 public client + PKCE，DCR 场景正确。

**`clientInformation()`：**

- config 显式给了 `clientId` → 直接用（预置 clientId 路径）。
- 否则从存储读。
- **过期判定**：`clientSecretExpiresAt` 已过 → 返回 `undefined`（触发重新 DCR）。
  → 我们 `saveClientInformation` 必须存 `clientIdIssuedAt` / `clientSecretExpiresAt`，Cloudflare 注册响应若给这两个字段务必保留。

**`saveClientInformation(info)`：** 持久化 `{ clientId, clientSecret, clientIdIssuedAt, clientSecretExpiresAt }`。

**`tokens()`：** 从存储读，返回 `{ access_token, token_type: "Bearer", refresh_token, expires_in, scope }`，其中

```js
expires_in = Math.max(0, Math.floor(expiresAt - Date.now() / 1000))
```

**`saveTokens(t)`：** 持久化 `{ accessToken, refreshToken, expiresAt: Date.now()/1000 + expires_in, scope }`。
即**存储用绝对时间戳、接口用相对秒**，边界换算只在 provider 层做（对应 §2.5 坑 A 的映射代码）。

**`redirectToAuthorization(url)`：** 校验协议只允许 `http`/`https`，否则抛错。建议照做。

### 3.2 授权编排流程（`MCP.startAuth` / `MCP.authenticate` / `MCP.finishAuth`）

```
startAuth(name):
  1. 构造 provider + transport
  2. 先尝试「无 token 直连」
       ├─ 成功 → 直接返回，无需授权（already-works）
       └─ 失败且拿到 redirect URL →
             a. 生成 32 字节随机 oauthState（hex，64 字符）
             b. 起回调 server
             c. 返回 authorizationUrl（给 UI/CLI）
authenticate(name):
  4. open(url)（打不开浏览器则 publish 事件让 UI 展示链接）
  5. 等待回调
回调到达:
  6. 校验 state；不匹配 → 抛 "OAuth state mismatch - potential CSRF attack"
finishAuth(name):
  7. provider.commit()
  8. 清理 codeVerifier / oauthState
  9. 重新 connect
```

分三段的理由（值得保留的设计）：`startAuth` 无副作用轻量（可被"探测"复用），`authenticate` 是阻塞的人机交互段，`finishAuth` 幂等收尾。Hub 的 `oauth-server.js` 建议照此三段切，UI 只要驱动这三段。

### 3.3 pending 态设计（重要）

授权未完成时，**`codeVerifier` / `oauthState` / `clientInfo` 已落盘，`tokens` 为空**；完成后 `tokens` 才写入。

意义：
- DCR 已成功的 clientId 可复用（重启不必重新注册）。
- 用户中途关掉浏览器/进程退出，下次 `mcp auth` 可续（也可能选择作废重来，本方案默认**重来更安全**——state 与 verifier 与旧 authorizationUrl 绑定，复用有 CSRF 时序风险，见 §7 检查清单）。
- 状态可从存储内容直接推断，不需要额外的 status 字段：`tokens` 空 + 有 `codeVerifier` = pending。

### 3.4 凭据存储

- 路径：opencode 用 `~/.local/share/opencode/mcp-auth.json`，权限 **600**。
- **按 `serverUrl` 索引，不是按 name**（同一 server 不同 name 共享凭据；URL 才是 AS 关联的稳定键）。
- 结构：

```json
{
  "<mcpName>": {
    "serverUrl": "https://...",
    "clientInfo": { "clientId": "...", "clientIdIssuedAt": 1786151616 },
    "tokens": { "accessToken": "...", "refreshToken": "...", "expiresAt": 1786151616 },
    "codeVerifier": "<43字符>",
    "oauthState": "<64字符>"
  }
}
```

字段长度实证：`codeVerifier` 43 字符（PKCE S256 base64url 标准长度）、`oauthState` 64 字符（32 字节 hex）。

### 3.5 CLI 交互面（UI 设计借鉴）

| 命令 | 输出 | 借鉴点 |
|---|---|---|
| `opencode mcp list` | `✓ connected` / `⚠ needs authentication` | 状态二态一目了然；Hub 列表直接复用这两个态 |
| `opencode mcp auth <name>` | 触发授权 | 单个服务器触发入口 |
| `opencode mcp auth list` | OAuth 状态总览 | 批量总览：哪些已授权/待授权 |
| `opencode mcp logout <name>` | 清凭据 | 删除 storage 条目（含 clientInfo，回到"从未授权"） |
| `opencode mcp debug <name>` | OAuth 诊断：显示 401 头、auth status、clientId、"requires OAuth" 判定、**试跑 OAuth 流程（不完成授权）** | **最有价值的一屏**：不真授权就能看到 401 / WWW-Authenticate 头 / clientId 是否可用 / AS 是否要求 OAuth。Hub 的诊断面板应包含同要素 |

---

## 4. Cloudflare 端点实证数据（2026-10-20 curl 实测）

### 4.1 三端点行为

| 端点 | 行为 |
|---|---|
| `https://mcp.cloudflare.com/mcp` | **401** + `WWW-Authenticate: Bearer realm="OAuth", resource_metadata="https://mcp.cloudflare.com/.well-known/oauth-protected-resource/mcp", scope="user:read account:read"` |
| `https://radar.mcp.cloudflare.com/mcp` | **401**，`resource_metadata` 指向 radar 自己 |
| `https://docs.mcp.cloudflare.com/mcp` | **200 直接初始化成功，无需任何认证**（serverInfo: `docs-ai-search v0.4.14`） |

要点：
- **前两个端点 resource_metadata 各自独立**，authorization_endpoint 也不同（`/authorize` vs `/oauth/authorize`）→ 存储按 serverUrl 索引的必要性（§3.4）。
- `docs.mcp.cloudflare.com` 是"已可用"端点，正对应 §6.5 的 already-works 路径——连它不应触发授权 UI。
- 401 的 `WWW-Authenticate` 头里带 `scope` 提示（`user:read account:read`），可作 UI 展示素材，但不是授权请求的 scope 权威来源（权威在 AS 元数据）。

### 4.2 授权服务器元数据（两个需认证端点都有）

| 项 | 主端点 | radar |
|---|---|---|
| `authorization_endpoint` | `/authorize` | `/oauth/authorize` |
| `token_endpoint` | `/token` | `/token` |
| `registration_endpoint` | `/register`（**有 DCR**） | `/register`（**有 DCR**） |
| `grant_types_supported` | `authorization_code`, `refresh_token` | 同 |
| `code_challenge_methods_supported` | `S256` | 同 |
| `token_endpoint_auth_methods_supported` | `client_secret_basic`, `client_secret_post`, **`none`**, `private_key_jwt` | 同 |
| `client_id_metadata_document_supported` | **true** | **false** |
| scope | 384 个细粒度 scope + `offline_access` | 未列 |

实现含义：
- **PKCE 必须 S256**（唯一支持的方法）；`code_verifier` 43 字符 base64url（§3.4 的实证长度吻合）。
- `none` 在支持列表里 → public client + DCR 路径成立，`clientMetadata.token_endpoint_auth_method` 用 `none`。
- `offline_access` 存在 → 想要 refresh_token 需申请该 scope（授予与否待实测，见 §8）。
- 主端点支持 `client_id_metadata_document`（CIMD）：这是另一种免注册客户端识别方式，本方案不走（走 DCR），但记录在案。

### 4.3 API Token 可用性

Cloudflare 官方文档（developers.cloudflare.com，Last updated Oct 12 2026）明确：

> `mcp.cloudflare.com` 同时接受「OAuth access token」和「Cloudflare API Token」作 `Authorization: Bearer`——"Both user tokens and account tokens are supported"。

- radar 是否接受 API Token：**文档未明说**（待实测，见 §8）。
- 这直接支撑 §2.4 坑 B 的"静态兜底"策略：用户可先贴一个 Cloudflare API Token 进静态 headers，能连就连；不能连再走 OAuth。

---

## 5. 本机半成品（opencode 侧）

`~/.local/share/opencode/mcp-auth.json`（600）中 `cloudflare` 条目**当前状态**：

```json
{
  "clientInfo": { "clientId": "UqYJUsYbd3hG6iPP", "clientIdIssuedAt": 1786151616 },
  "codeVerifier": "<43字符,已生成>",
  "oauthState": "<64字符,已生成>",
  "serverUrl": "https://mcp.cloudflare.com/mcp"
}
```

`tokens` 为空 → **DCR 已成功、授权未完成、token 未换取**。
`opencode mcp debug cloudflare` 实测确认：not authenticated、clientId 可用、401 + `WWW-Authenticate` 头如 §4.1 所述。

**价值与边界**：

- ✅ `clientId` `UqYJUsYbd3hG6iPP` **可复用**——DCR 已成功且 `clientIdIssuedAt` 未过期。把它预置进我们的 `auth-store` 可跳过注册步骤（相当于 opencode 的 `config.clientId` 显式路径，§3.1）。
- ⚠️ **`codeVerifier` / `oauthState` 不可跨工具复用**：它们与 opencode 发起的那一次 `authorize` 请求绑定，authorizationUrl 若已过期/已用过，用它换 token 会失败。我们启动新授权时应**重新生成**（§3.3 pending 态）。
- ⚠️ **`serverUrl` 必须一致**：`https://mcp.cloudflare.com/mcp`（无尾斜杠、精确匹配），否则索引对不上。
- 我们的存储是 `~/.dsh/mcp-auth.json`，**不由 opencode 写入**；两个文件互不影响，但结构兼容（§6.3）。

---

## 6. 本方案差异决策（已与用户确认）

| # | 决策 | 理由 |
|---|---|---|
| 1 | **回调端口用随机端口（port 0）**，不用固定 19876 | Hub 与 opencode 可能同机运行，固定端口冲突；Termux 端口占用不可控。注意：`redirectUrl` 里的端口只有在**监听成功后**才已知，所以顺序必须是「先监听拿到实际端口 → 再构造/暴露 `redirectUrl` 供 `clientMetadata` 使用」。 |
| 2 | **回调路由挂 Hub 已有的 webserver 路由（`kind:'exact'`），不另起独立 HTTP server** | 减少一个监听面；自动继承 webserver 的 loopback 围栏（Hub 现有路由已有 `isLoopbackRequest` 防护）。路径建议 `/mcp/oauth/callback`（与 opencode 的路径保持一致，仅端口随机）。 |
| 3 | **凭据存储 `~/.dsh/mcp-auth.json`（600），按 serverUrl 索引**，结构与 opencode 兼容 | 便于生态互通；但不由 opencode 写入，两边文件独立。 |
| 4 | **底座 seam**：底座 `dsh-mcp-client` 的 `createTransport(config, authProvider?)` 加可选第二参数；`index.ts` 通过 `ctx.get('mcpAuth', false)` 取 provider 传入 | 不传时行为**逐字节不变**（有快照测试断言）。provider 实例由 Hub 的 `mcpAuth` 服务提供。 |
| 5 | **授权起点策略沿用 opencode**：先以「静态 headers + provider 无 token」试连，成功则无需授权（直接返回 already-works），401 才走授权 | 依赖 §2.4 的 SDK 优先级规则：provider 无 token 时才发静态 `Authorization`。 |

---

## 7. 实现检查清单（施工图）

> 每项 = 必须实现的要点 + 对应契约/参考。

### 7.1 `lib/auth-store.js`

- [ ] **存储路径与权限**：`~/.dsh/mcp-auth.json`，创建时 `mode: 0o600`；写入用「临时文件 + rename」保证原子性（授权流程中会被多次读写）。
  *参考：§3.4、§6.3*
- [ ] **按 serverUrl 索引**，顶层 key 用 mcpName，值内含 `serverUrl`；读取时以 serverUrl 为准（name 可变，URL 不可变）。
  *参考：§3.4*
- [ ] **条目结构**与 opencode 兼容：`{ serverUrl, clientInfo:{clientId, clientIdIssuedAt, clientSecret?, clientSecretExpiresAt?}, tokens:{accessToken, refreshToken, expiresAt, scope}, codeVerifier?, oauthState? }`。
  *参考：§3.4*
- [ ] **读接口保证字段齐全**（坑 A 的前提）：`getTokens(serverUrl)` 在 tokens 存在时返回可映射为完整 `StoredOAuthTokens` 的对象；不存在时返回 `undefined`（= 无凭据，与"已过期"是两回事，provider 层负责区分）。
  *参考：§2.5 坑 A*
- [ ] **写接口**：`saveClientInformation` / `saveTokens` / `saveCodeVerifier` / `saveOAuthState` / `clearAuth(serverUrl)`（logout：删整条）。
  *参考：§3.1、§3.4*
- [ ] **pending 态可推断**：不引入额外 status 字段；`tokens` 缺失即 pending/未授权。
  *参考：§3.3*
- [ ] **并发写保护**：同一 server 的授权流程中多次写盘，加简单的串行化（promise 链或锁），避免 read-modify-write 竞态。
  *参考：§3.3（多阶段写入）*

### 7.2 `lib/oauth-provider.js`

实现 `OAuthClientProvider`，全部 11 成员的落点：

- [ ] `redirectUrl` getter → 从 oauth-server 拿「实际监听端口」，拼 `http://127.0.0.1:<port>/mcp/oauth/callback`。**未监听时不得暴露一个猜的端口**。
  *参考：§2.3 #1、§6.1、§6.2*
- [ ] `clientMetadata` getter → 照 opencode 结构改 `client_name`/`client_uri`；`token_endpoint_auth_method` = 有 clientSecret ? `client_secret_post` : `none`；`scope` 仅在配置显式给时带。
  *参考：§3.1*
- [ ] `state()` → 32 字节随机 hex（64 字符）。**必须实现**（CSRF）。
  *参考：§2.3 #3、§3.2*
- [ ] `clientInformation(ctx?)` → 显式 config.clientId 优先；否则读 store；**`clientSecretExpiresAt` 已过 → 返回 undefined**（触发重新 DCR）。可忽略 `ctx.issuer`（serverUrl 已隐含）。
  *参考：§2.3 #4、§2.3 ctx、§3.1*
- [ ] `tokens(ctx?)` → **`ctx === undefined` 也必须返回最近 token set**，字段映射见 §2.5 代码（`token_type:'Bearer'`、`expires_in = max(0, floor(expiresAt - now))`）。过期也返回对象，不返回 undefined。
  *参考：§2.5 坑 A*
- [ ] `saveTokens(t)` → 换算为 `{ accessToken, refreshToken, expiresAt: now + expires_in, scope }` 落盘。
  *参考：§3.1*
- [ ] `saveClientInformation(info)` → 存 `{ clientId, clientSecret, clientIdIssuedAt, clientSecretExpiresAt }`。**务必保留 issuedAt/expiresAt 字段**（opencode 的过期重注册依赖它）。
  *参考：§3.1*
- [ ] `redirectToAuthorization(url)` → **校验协议仅 http/https**，否则抛错；然后按平台 open/browser。
  *参考：§2.3 #7、§3.1*
- [ ] `saveCodeVerifier(v)` / `codeVerifier()` → 落盘 / 读回（43 字符 base64url）。
  *参考：§2.3 #8/#9、§3.4*
- [ ] `addClientAuthentication` / `dpop` → **不实现**（Cloudflare 支持 `none`/`client_secret_post`，无 DPoP 要求）。
  *参考：§2.3 #11/#12、§4.2*
- [ ] `commit()` 语义对照：opencode 的 finishAuth 调 `provider.commit()` 完成 SDK 侧授权码换取。我们的 `oauth-server.js` 在收到回调后应调用 SDK 提供的等价收尾（以 dsh 内 SDK 2.2.0 实际导出为准）。
  *参考：§3.2*

### 7.3 `lib/oauth-server.js`

- [ ] **三段编排**：`startAuth`（无 token 直连 → 生成 state → 起回调 → 返回 authorizationUrl）/ `authenticate`（打开浏览器 / 发事件给 UI 展示链接 → 等回调）/ `finishAuth`（换取 token → 清 codeVerifier+oauthState → 重新 connect）。
  *参考：§3.2*
- [ ] **startAuth 先试连**：无 token 直连成功 → 返回 `already-works`，**不进入授权流程**（这正是 docs 端点与 API Token 兜底的行为）。
  *参考：§3.2、§6.5、§4.1*
- [ ] **随机端口**：`listen(0)` → 拿到实际 port 后再让 provider 暴露 `redirectUrl`；port 0 关闭冲突与占用问题。
  *参考：§6.1*
- [ ] **路由挂 Hub webserver**（`kind:'exact'`，路径 `/mcp/oauth/callback`），不另起 server；确认继承 loopback 围栏（`isLoopbackRequest`）。
  *参考：§6.2*
- [ ] **state 校验**：不匹配 → 抛 "OAuth state mismatch - potential CSRF attack"（错误文案照 opencode，便于对照排障）。
  *参考：§3.2*
- [ ] **重启授权时重置 pending**：发起新授权前重新生成 `codeVerifier`/`oauthState`（**不复用 opencode 遗留的那对**，它们绑定旧 authorize 请求）。
  *参考：§3.3、§5*
- [ ] **错误路径**：用户拒绝授权（`error=access_denied`）、回调超时、授权码已用过——都要能回到"未授权"态并向 UI 报可读原因，不要挂起。
  *参考：§3.2（finishAuth 幂等收尾的反面）*
- [ ] **收尾清理**：成功后删 `codeVerifier`/`oauthState`，仅留 `clientInfo`+`tokens`。
  *参考：§3.2、§3.3*

### 7.4 底座 seam（`dsh-mcp-client` 的 `createTransport`）

- [ ] 签名加可选第二参数：`createTransport(config, authProvider?)`；透传给 `StreamableHTTPClientTransportOptions.authProvider`。
  *参考：§2.1、§6.4*
- [ ] **不传时行为逐字节不变**——已有快照测试断言，改动不得破坏。
  *参考：§6.4*
- [ ] `index.ts`（Hub 侧）：`ctx.get('mcpAuth', false)` 取 provider，非空才传入；为空走原路径。
  *参考：§6.4*
- [ ] **不要在 transport 外层加重试**：SDK 自己已有"401 → onUnauthorized → 重试一次"语义，叠加会造成重复请求。
  *参考：§2.6*

### 7.5 UI（设置页）

- [ ] **状态二态**（照 `mcp list`）：`✓ connected` / `⚠ needs authentication`。
  *参考：§3.5*
- [ ] **单服务器触发授权** + **总览** + **登出**（清凭据，删整条 storage 条目）。
  *参考：§3.5*
- [ ] **诊断面板**（照 `mcp debug`）：显示 401 头（`WWW-Authenticate` 原样）、auth status、clientId、`requires OAuth` 判定、试跑 OAuth 流程但**不完成授权**。
  *参考：§3.5*
- [ ] **打不开浏览器时展示链接**：publish 事件把 authorizationUrl 送到 UI 让用户手动复制（Termux/无桌面环境常见）。
  *参考：§3.2*
- [ ] **API Token 兜底提示**：对 Cloudflare 端点，提示可先填 API Token；连接成功即无需 OAuth。
  *参考：§4.3、§2.4 坑 B*
- [ ] **复用半成品 clientId 的展示**：`cloudflare` 条目已有可用 clientId，UI/日志可显示"复用已注册客户端"而不是"正在注册"。
  *参考：§5*

---

## 8. 待实测项

以下为材料中**未验证**的点，实现/联调时必须实测，不要按假设写代码：

1. **Cloudflare access token 的实际 `expires_in`**——未从真实 token 响应读取。影响：`saveTokens` 的 `expiresAt` 换算与刷新时机；若很短（分钟级）需要更积极的预刷新。
2. **`refresh_token` 是否轮换**——Cloudflare 刷新时是否返回**新的** refresh_token（轮换语义）未知。影响：`saveTokens` 是否必须用新值覆盖旧 refresh_token；若轮换且我们漏保存，下次刷新会失败。
3. **`offline_access` scope 是否真的授予 refresh_token**——元数据列了该 scope，但未验证"不带它是否就没有 refresh_token / 带了是否一定给"。
4. **radar 是否接受 Cloudflare API Token**——文档只对 `mcp.cloudflare.com` 明确"user tokens and account tokens are supported"，radar 未明说。影响：radar 端点能否走静态兜底，还是必须 OAuth。
5. **`mcp.cloudflare.com` 对 user 级 API Token 的 scope 校验**——API Token 带哪些 permission 才能通过 `user:read account:read` 的 scope 要求，未测。影响：静态兜底路径的用户指引文案。
6. **401 响应的 `resource_metadata` 具体内容**（除 URL 外是否还有 scope/资源指示）——实测只记录了 `WWW-Authenticate` 头中的 `realm`/`resource_metadata`/`scope` 三个参数，未记录完整 AS 元数据文档的全部字段。
7. **`docs.mcp.cloudflare.com` 的 200 是否稳定**（是否会在某些条件下变成 401）——单次实测 200，需复测确认可直接归入 already-works。
8. **dsh 内 SDK 2.2.0 的 `adaptOAuthProvider` / `commit` 实际导出形态**——本文 SDK 行为描述来自该版本类型定义与文档，但 provider 侧"完成授权"的确切调用名（opencode 用 `provider.commit()`）需以 dsh 内 `@modelcontextprotocol/client` 的实际导出为准。

---

*材料来源：`@modelcontextprotocol/sdk` 2.2.0 类型定义（`/data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@modelcontextprotocol/client/dist/index.d.mts`）、opencode 1.18.35 编译产物提取、2026-10-20 Cloudflare MCP 端点 curl 实测。*
