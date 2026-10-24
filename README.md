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
(含 OAuth:插件启动时会自动为 dsh 的 mcp-client 补上 seam 补丁,见下文。)

> 为什么不用 `postinstall`:npm 12 起默认阻止依赖的 install scripts,
> pnpm 11 遇 `scripts.postinstall` 更会以 `ERR_PNPM_IGNORED_BUILDS` 把
> `dsh plugin add` 卡到 exit 1。故补丁改由 dsh 启动时自愈。

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

## OAuth 补丁(自动,通常无需操心)

### 为什么需要它

**DSH 的上游 mcp-client 没有把 `authProvider` 透传给 MCP SDK**,所以 SDK 内置的
整套 OAuth 自动流程收不到 provider,处于「断线」状态。

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

补丁只改 3 处(seam 最小改动):

```diff
-function createTransport(config) {
+function createTransport(config, authProvider) {
   case "streamable-http": return new StreamableHTTPClientTransport(new URL(config.url),
-    { requestInit: { headers: config.headers } });
+    { requestInit: { headers: config.headers }, authProvider });

-      transport = createTransport(config);
+      const authProvider = ctx.get("mcpAuth", false)?.getAuthProvider(config.serverName, config);
+      transport = createTransport(config, authProvider);
```

### 自动补(默认行为)

插件每次启动时会检测这个 seam,**缺失就自动补**(`lib/self-heal.mjs`):

- **幂等** —— 已补则只读不写,启动开销约等于一次文件读取
- **必留备份** —— 写入前生成 `<bundle>.bak-selfheal`,内容与上游原版逐字节一致
- **写后校验** —— 逐锚点确认,任一不符立即恢复原文件
- **不阻塞启动** —— 延到下一 tick 执行,失败不抛异常;
  但**异常状态一定会发声**(stderr + 面板红色横幅),不会静默失效

> **为什么不用 `postinstall`**:npm 12 起默认阻止依赖的 install scripts
> (需 `npm install-scripts approve`),postinstall 无法保证执行。故改为运行时自愈。

若补丁与当前 dsh 版本不匹配(升级后锚点漂移)或 bundle 损坏,面板顶部会出现
**红色横幅**说明原因 —— 不会像早期版本那样静默失效。

不想让它自动改第三方包可设 `DSH_MCP_SKILL_HUB_NO_SELF_HEAL=1`(只检测不补),
或手工跑下面的脚本。

### 手工体检 / 打补丁 / 回滚

脚本在 `node_modules/dsh-mcp-skill-hub/scripts/` 下(或源码目录)。
用 `bash <script>` 调用,不要直接 `./script.sh` —— 这样不依赖 shebang
(Termux 没有 `/usr/bin/env`,写死解释器路径又会让 Linux/macOS 失效):

```sh
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
```

`/oauth/status` 的 `needsAuth` 是三态:`true`(探测确认 401) / `false`(不需要) /
`"unknown"`(探测不可达,附 `probeFailed: true`)。

## 测试

```sh
bash scripts/run-tests.sh         # 16 个文件 / 226 用例(推荐: 失败时输出完整详情)
# 裸 glob 会多跑 test-postinstall.mjs —— 那是 postinstall 方案的遗留
# 测试(该方案已被 pnpm 11 卡死, 见上文「为什么不用 postinstall」), 已不打进包
```

`test-oauth-fixture.mjs` 会起一个真实的本地 OAuth 授权服务器
(`fixtures/oauth-test-mcp.mjs`,与 Cloudflare 协议同构)做端到端验证——
不用 mock,因为 mock 抓不到协议级缺陷(如 authUrl 缺 `client_id` 这类时序 bug)。

## 卸载

`dsh plugin --profile web remove dsh-mcp-skill-hub`,或手工:
bundles 删一行 + 依赖删一行 + `pnpm install`。补丁可用 `bash scripts/rollback-installed.sh <bak-path>` 还原。
