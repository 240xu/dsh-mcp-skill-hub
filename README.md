# dsh-mcp-skill-hub

DSH 专属插件:在 **设置** 页新增「MCP 与技能」分区,统一管理 MCP 服务器与技能(Skills),
并为远程 MCP(Cloudflare 等)提供 **OAuth 2.1 + PKCE 授权链路**。

- npm: <https://www.npmjs.com/package/dsh-mcp-skill-hub>
- 零 npm 依赖,Node ≥ 18.8(用到 `node:test` 的 `test.before/after`)。

## 安装

```sh
dsh plugin --profile web add dsh-mcp-skill-hub     # 双端同命令
```

装完重启 profile,**全部功能即可用,无需任何手工步骤**。

> **不改官方文件**。0.3.6 起 OAuth 由插件自己的原生连接层承担:直接使用
> `StreamableHTTPClientTransport({ authProvider })` 与公开导出的
> `createMcpToolDefinition`,自己 `ctx.tools.register`。因此 dsh 升级永远不会
> 弄坏 OAuth,卸载也不需要还原任何东西。
>
> 0.3.5 及更早版本会改写 `@deepseek-ai/dsh-mcp-client` 的编译产物(seam patch)。
> 该能力仅为兼容旧部署保留,需显式 `DSH_SKILL_HUB_PATCH_BUNDLE=1` 才会启用。

## 功能

### MCP 服务器
列出 / 新增 / 编辑 / 启停 / 删除 profile 里的 `@deepseek-ai/dsh-mcp-client`
组合行(streamable-http + stdio)。写盘是定向块编辑,**注释与无关内容逐字节保留**
(包括块内未知字段如 `toolCallTimeoutMs`、嵌套 `reconnect:`、行内注释)。

### 技能(Skills)
按来源(用户 / 项目 / 自定义 / 内建 / 运行时)列出;用户侧技能可创建、编辑、
删除(移入 `.trash/` 可恢复)、切换「模型可调用」。内建/运行时只读。
YAML 标量安全:含 `: ` / 换行 / 引号的 description 自动正确转义(曾致 patch 写坏)。

### 生效方式
profile 启用 `dsh-hmr` 后 MCP 改动**热生效**(自动 reconcile 对应行);
未启用则提示「重启后生效」。技能文件改动由 `skill-filesystem` 的 watch 即时反映。

### OAuth 授权
- **needs_auth 判定学 opencode**:只有服务端明确返回 401 才显示授权入口;
  探测不可达时显示「探测失败,可手动授权」——不猜,也不隐藏。
- 授权流程:DCR 注册 → 打开授权页 → 随机 loopback 端口收回调 → 换 token → 落盘
  `~/.dsh/mcp-auth.json`。refresh token 由 SDK 自动驱动续期。
- 主行只有「删除 + 开关」;**未授权行另起一行**(缩进 + 黄字 + 单个授权按钮)。
  黄字按状态分级:授权超时 / 授权失败 / 探测不可达 / 常规提示 —— 提示与按钮
  同行,用户不会把「授权已超时」误当成另一个问题。

### 安全
API 仅 loopback 或已配对设备可访问;env/headers 中的 key/token 值列表时打码,
编辑回传 `•••` 哨兵 = 保留原值;技能路径全部白名单校验。

## OAuth 实现(原生,不碰官方文件)

### 为什么不用官方 mcp-client

**dsh 上游的 mcp-client 没有把 `authProvider` 透传给 MCP SDK**,所以如果沿用它,
OAuth 永远连不上。0.3.6 起改为自己建立连接:

```js
new StreamableHTTPClientTransport(new URL(url), { authProvider })  // SDK 公开构造
ctx.tools.register(createMcpToolDefinition(ctx, { ... }))          // dsh 公开导出
```

好处是插件不修改任何官方文件,升级与卸载都不再有补丁相关的连带风险。

### 接管判据

只有 patch 里 `disabled: true` 的 `streamable-http` 行才由本插件接管。
若某行在 `nativeTakeover` 配置里被点名、但在 dsh 侧仍然启用,**插件会拒绝接管**
并告警 —— 两层同时注册会让同名工具互相覆盖,表现为调用随机失败。

### 自动重连

上游瞬时不可用(5xx / 网络中断)会指数退避重连,封顶 5 分钟。
**401/403 不重试**:那需要你在面板里完成一次授权,重试只会掩盖这个状态。
`/state` 的 `native` 字段会显示 `active` / `retrying` / `failed` 以及每行
已注册的工具名,便于判断工具为何没出现。

三方分工:

| 层 | 能力 | 状态 |
|---|---|---|
| MCP SDK 2.2.0(`@modelcontextprotocol/client`) | OAuth 全流程:发现 metadata → DCR → 授权 → 换 token → 401 重试 → token 失效自动重授权 | ✅ 有,但**收不到 provider** |
| dsh mcp-client | 把 provider 传给 SDK | ❌ 上游没做 |
| 本插件 | 提供 `OAuthClientProvider` 实现(16 个成员) | ✅ |

Hub 实现的 16 个成员:

- **SDK 契约(10)**:`redirectUrl` · `clientMetadata` · `state()` · `clientInformation()` ·
  `saveClientInformation()` · `tokens()` · `saveTokens()` ·
  `redirectToAuthorization()` · `saveCodeVerifier()` · `codeVerifier()`
- **Hub 扩展(6)**:`setRedirectUrl()`(注入随机 loopback 端口回调地址) ·
  `callbackPath` · `hasStaticHeaders` · `registerClient()`(RFC 7591 DCR) ·
  `getStoredState()` · `staticChallengeFor()`(PKCE S256)

SDK 侧的相关逻辑(实证于 `dist/index.cjs`):

```js
// 401 时自动触发授权
function handleOAuthUnauthorized(provider, ctx, extraAuthOptions) {
  const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(ctx.response);
  if (await auth(provider, { serverUrl, resourceMetadataUrl, scope, ... }) !== "AUTHORIZED")
    throw new UnauthorizedError();
}

// auth() 内含自动恢复:凭据失效 → 清缓存 → 重试
async function auth(provider, options) {
  try { return await authInternal(provider, options); }
  catch (error) {
    if (error.code === InvalidClient || UnauthorizedClient) {   // 重新 DCR
      await provider.invalidateCredentials?.("client");
      await provider.invalidateCredentials?.("tokens");
      return await authInternal(...);
    } else if (error.code === InvalidGrant) {                    // 重新授权
      await provider.invalidateCredentials?.("tokens");
      return await authInternal(...);
    }
    throw error;
  }
}
```

### 旧版补丁(0.3.5 及更早,仅归档)

0.3.5 及更早为了把 `authProvider` 透传给 SDK,会改写官方 bundle 的
`createTransport` / `createMcpToolDefinition` 等 3 处函数。0.3.6 起不再需要,
代码与脚本保留仅供已部署的老版本排障。

### 手工体检 / 打补丁 / 回滚(旧版)

脚本在 `node_modules/dsh-mcp-skill-hub/scripts/` 下(或源码目录)。
用 `bash <script>` 调用,不要直接 `./script.sh` —— 这样不依赖 shebang
(Termux 没有 `/usr/bin/env`,写死解释器路径又会让 Linux/macOS 失效):

```sh
# 以下仅适用于仍在使用旧 patch 方案的部署:
bash scripts/patch-installed.sh                  # dry-run 预检(只报告,不改文件)
bash scripts/patch-installed.sh --apply          # 打补丁(幂等:已 patch 则跳过)
bash scripts/verify-patch-applied.sh             # 体检
bash scripts/rollback-installed.sh <bak-path>    # 回滚(需传 patch 时生成的 .bak 路径)
```

`verify-patch-applied.sh` 退出码:

| code | 含义 |
|---|---|
| 0 | 已 patch(3/3 结构特征命中),附 sha256 |
| 1 | 未 patch / 半 patch(列出缺失项 + 修复命令) |
| 2 | bundle 文件不存在 |

**dsh 升级后会失效**:npm 重装 `@deepseek-ai/dsh-mcp-client` 会把 bundle 换回上游
原版,且**不报错**(只是连接时 401,UI 无提示)。自愈机制会在下次启动时自动发现并重打;
也可升级后跑一次 `verify-patch-applied.sh` 确认。详见 `APPLY-RUNBOOK.md`。

## API(同源)

```
GET  /api/dsh-mcp-skill-hub/state
POST /api/dsh-mcp-skill-hub/mcp/upsert|toggle|delete
POST /api/dsh-mcp-skill-hub/skills/create|update|toggle|delete
GET  /api/dsh-mcp-skill-hub/skills/read?path=
GET  /api/dsh-mcp-skill-hub/oauth/status?id=<rowId>
POST /api/dsh-mcp-skill-hub/oauth/start
POST /api/dsh-mcp-skill-hub/oauth/finish
POST /api/dsh-mcp-skill-hub/oauth/cancel
GET  /api/dsh-mcp-skill-hub/oauth/callback     # 仅说明;真实回调由 /oauth/start 起的临时服务提供
GET  /api/dsh-mcp-skill-hub/uninstall/plan     # 卸载计划(只读预览)
POST /api/dsh-mcp-skill-hub/uninstall/run      # 执行卸载;body 需 {"confirm":"UNINSTALL"}
GET  /api/dsh-mcp-skill-hub/uninstall/status   # 回看卸载 worker 的步骤日志
```

`/uninstall/run` 校验 `confirm` 令牌,计划存在阻断项(如没有可信原版备份)时返回 409 且不执行;
通过则返回 202 并立刻 spawn 一个**脱离本插件**的 worker(写在 `~/.dsh/` 下)——插件随后会被删、
dsh 会被重启,worker 若活在插件进程内就会被打断。

`/oauth/status` 的 `needsAuth` 是三态:`true`(探测确认 401) / `false`(不需要) /
`"unknown"`(探测不可达,附 `probeFailed: true`)。

`/state` 的 `native` 字段是原生连接层的实时状态:
`active`(已连通的行) / `retrying`(退避中) / `failed`(放弃,通常是待授权) /
`tools`(每行已注册的工具名与注册失败详情)。工具没出现时先看这里。

## 测试

```sh
bash scripts/run-tests.sh         # 20 个文件 / 289 用例(推荐: 失败时输出完整详情)
# 裸 glob 会多跑 test-postinstall.mjs —— 那是 postinstall 方案的遗留
# 测试(该方案已被 pnpm 11 卡死, 见上文「为什么不用 postinstall」), 已不打进包
```

`test-oauth-fixture.mjs` 会起一个真实的本地 OAuth 授权服务器
(`fixtures/oauth-test-mcp.mjs`,与 Cloudflare 协议同构)做端到端验证——
不用 mock,因为 mock 抓不到协议级缺陷(如 authUrl 缺 `client_id` 这类时序 bug)。

`test-native-mcp.mjs` 与 `test-native-manager.mjs` 同样起真实 HTTP MCP 服务器,
覆盖:工具名归一化与碰撞消解、真实连接+注册+调用、close 注销、401 优雅失败、
authProvider 注入、退避重连、鉴权错误不重试。

## 卸载

**没有需要还原的东西。** 0.3.6 起插件不修改任何官方文件，所以卸载就是删插件：

```bash
dsh plugin --profile web remove dsh-mcp-skill-hub
# 重启 dsh
```

设置页的「危险区 → 完整卸载」仍然可用，它会做三件事：把 patch 里被接管的行
重新启用（交回 dsh）、移除插件、重启。之所以要「重新启用」，是因为接管时这些行
被写成了 `disabled: true` —— 不还原的话，卸载后这些 MCP 服务器会从 dsh 里消失。

如果该 profile 从未用过 0.3.5 及更早的补丁版本，面板不会显示还原步骤。


