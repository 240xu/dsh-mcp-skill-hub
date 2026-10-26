# 3b 真机授权步骤（只有人能点浏览器）

> 这是整个 OAuth 工作的**唯一人肉步骤**。Cloudflare 授权必须由人在真实浏览器点
> 「Allow」——agent 拿不到你的 Cloudflare 账号会话。
>
> 目标：真机验证三件事 —— `expires_in` 实际值 / refresh 是否轮换 /
> `redirect_uri` 严格匹配。

---

## 前置确认（30 秒）

```bash
# 1. dsh 在跑且 Hub OAuth 路由已注册
TOKEN=$(cat ~/.config/opencode/kpad-dsh.token)
curl -s "http://127.0.0.1:3080/api/dsh-mcp-skill-hub/oauth/status?id=mcp-cloudflare" | head -c 300
```

期望：`{"id":"mcp-cloudflare","status":"not_authenticated",...}`
若不是这个（404 / 401 / 连接拒绝）→ **停**，把输出贴回来。

**当前实况**（2026-10-21 20:00 实测）：
```json
{"id":"mcp-cloudflare","status":"not_authenticated","hasClientId":false,
 "hasTokens":false,"expiresAt":null,"pendingAgeSec":null,"inFlight":false}
```

---

## 步骤

### 1. 打开 dsh Web UI

浏览器开（用上面的 token）：

```
http://127.0.0.1:3080/?token=$(cat ~/.config/opencode/kpad-dsh.token)
```

或本地直接：
```bash
echo "http://127.0.0.1:3080/?token=$(cat ~/.config/opencode/kpad-dsh.token)"
```
复制这个完整 URL（含 token）到浏览器。

### 2. 找到 MCP 面板里的 cloudflare 行

在 MCP / 工具配置界面找到 **cloudflare** 那一行
（patch 行 id = `mcp-cloudflare`，serverName = `cloudflare`，
url = `https://mcp.cloudflare.com/mcp`）。

它应该显示「未授权」状态 + 一个**授权按钮**。

### 3. 点授权按钮

点击后会发生：

1. Hub 起一个临时回调 server 在 `127.0.0.1:<随机端口>`（TTL 300 秒）
2. 浏览器**新标签页**打开 Cloudflare 授权页（`window.open(..., "_blank")`）
3. URL 形如：
   ```
   https://mcp.cloudflare.com/authorize?
     client_id=<动态注册得到的 id>&
     response_type=code&
     redirect_uri=http://127.0.0.1:<端口>/mcp/oauth/callback&
     state=<256bit 随机>&
     code_challenge=<S256>&
     code_challenge_method=S256
   ```

> ⚠️ **300 秒内必须点完**，否则 pending 过期，需重点一次授权按钮。
> UI 会显示「授权已超时，请重新点击授权」。

### 4. 在 Cloudflare 页点「Allow」

- 如果你**从未**用 dsh 授权过：Cloudflare 可能先做**动态客户端注册（DCR）**，
  这是自动的，你只会看到授权同意页。
- 点 **Allow / Authorize / 授权**（ wording 取决于 Cloudflare 当前 UI）。

### 5. 浏览器跳回 `http://127.0.0.1:<端口>/mcp/oauth/callback`

你应该看到一个 Hub 的**成功页面**（静态 HTML，写「授权成功」之类）。

- 看到成功页 → 继续步骤 6
- 看到「授权校验失败 / state 无效或已过期」→ **停**，把完整 URL 和页面文字贴回来
- 页面打不开 / 连接被拒 → **停**，贴回来

### 6. 回 UI 看状态

cloudflare 那行的 badge 应从「未授权」变为「已授权」（或显示过期时间）。

### 7. 验证凭据真的落盘（关键！）

```bash
ls -la ~/.dsh/mcp-auth.json
```

期望：文件存在，权限 `600`。

```bash
python3 -c "
import json
d = json.load(open('$HOME/.dsh/mcp-auth.json'))
k = 'mcp-cloudflare'   # 必须是 patch 行 id, 不是 serverName
e = d.get(k)
if not e:
    print('❌ 行 id 键下没有条目。实际键:', list(d.keys()))
else:
    t = e.get('tokens') or {}
    print('键           :', k)
    print('accessToken  :', ('有(' + str(len(t.get('accessToken',''))) + ' 字符)') if t.get('accessToken') else '无')
    print('refreshToken :', ('有(' + str(len(t.get('refreshToken',''))) + ' 字符)') if t.get('refreshToken') else '无')
    print('expiresAt    :', t.get('expiresAt'))
    print('serverUrl    :', e.get('serverUrl'))
"
```

**期望**：`键 = mcp-cloudflare`（**不是** `cloudflare`，也不是 `degraded:cloudflare`）。

如果键是 `degraded:cloudflare` → 说明 `resolveRowId` 没解析出行 id，
**必须贴回来**（这是 M1 修复要覆盖的场景，值得知道为何没命中）。

### 8. 把这三件事的实测值贴回来（3b 的核心目标）

**（a）`expires_in` 实际值**

Cloudflare 的 token 响应里 `expires_in` 是多少秒？换算成小时/天。
（决定 `expiresAt` 与 UI 的「即将过期」提示阈值是否合理。）

**（b）refresh 是否轮换**

如果需要，做一次刷新（可以等 token 自然过期，或重启 dsh 触发重连），
然后对比刷新前后的 `refreshToken` 值是否变化：
```bash
python3 -c "
import json,hashlib
d=json.load(open('$HOME/.dsh/mcp-auth.json'))
t=(d.get('mcp-cloudflare') or {}).get('tokens') or {}
rt=t.get('refreshToken','')
print('refreshToken 指纹:', hashlib.sha256(rt.encode()).hexdigest()[:16] if rt else '(无)')
print('expiresAt:', t.get('expiresAt'))
"
```
前后跑两次比对指纹。变了 = 轮换；没变 = 不轮换。
（当前实现**没有 refresh 逻辑**，只是声明了 `refresh_token` grant ——
这个实测结果决定要不要补 refresh，见 PROGRESS.md 审计 L1。）

**（c）`redirect_uri` 严格匹配**

授权 URL 里的 `redirect_uri` 是否被 Cloudflare 原样接受？
- 接受 → 记下实际端口
- 拒绝（`redirect_uri mismatch`）→ **贴回完整错误**

---

## 如果任何一步失败

**不要反复重试点授权**（每次都会新起一个临时 server + 新 state）。
把下面这些贴回来：

```bash
# 诊断三件套
TOKEN=$(cat ~/.config/opencode/kpad-dsh.token)
curl -s "http://127.0.0.1:3080/api/dsh-mcp-skill-hub/oauth/status?id=mcp-cloudflare"
echo
ls -la ~/.dsh/mcp-auth.json 2>&1
echo
tail -30 ~/dsh-web.log | grep -iE "mcpAuth|oauth|error" | tail -15
```

---

## 回滚（如果授权把什么东西搞坏了）

```bash
cd ~/dsh-plugins-src/dsh-mcp-skill-hub
./scripts/rollback-installed.sh \
  /data/data/com.termux/files/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js.bak-20261021T113912Z
# 然后让守护脚本重启 dsh（杀当前 dsh 进程即可，守护会自动拉起）
```

只删凭据（不动 bundle）：
```bash
# 备份后删 ~/.dsh/mcp-auth.json，下次授权会重新动态注册
cp ~/.dsh/mcp-auth.json ~/.dsh/mcp-auth.json.bak-$(date -u +%Y%m%dT%H%M%SZ)
rm ~/.dsh/mcp-auth.json
```

---

## 关于 opencode 遗留的 pending（重要，别被它骗）

`~/.local/share/opencode/mcp-auth.json` 里有一个 **opencode 遗留的 pending**
（`clientIdIssuedAt: 1786151616`，verifier 绑定 `127.0.0.1:19876/mcp/oauth/callback`）。

**那是 opencode 的，不是 dsh 的。** dsh 用它换 token 必 `400 invalid_grant`
（端口和路径都不同）。dsh 必须用**自己的** `/oauth/start` 重新生成一对 ——
也就是上面步骤 3 点授权按钮所做的事。

不要手动去合并/编辑那个文件。
