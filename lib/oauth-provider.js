/**
 * OAuth provider —— 为 dsh-mcp-skill-hub 的 MCP HTTP 行实现 OAuth 授权。
 *
 * 契约: oauth-provider-contract.md §3
 * 底层: auth-store.js（凭据持久化，0600）
 * 形态: @modelcontextprotocol/sdk 2.2.0 的 OAuthClientProvider 是 **interface**
 *       而非 class（安装版未导出该名字），故用对象字面量实现。
 *
 * 静态 Bearer 兜底 + OAuth 优先：SDK 的 StreamableHTTPClientTransport 在
 * provider.tokens() 有返回值时用 token 作 Authorization，否则才发 requestInit
 * 里的静态 headers —— 所以「patch 里的静态 API Token」与「OAuth token」天然共存，
 * OAuth 优先。
 *
 * 铁律 6: 任何错误信息只含 name 与 host，绝不含 token/client_secret。
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  getClientInfo, setClientInfo, getTokens, setTokens,
  getCodeVerifier, setCodeVerifier, getOAuthState, setOAuthState,
} from './auth-store.js'

const CALLBACK_PATH = '/mcp/oauth/callback'
const CLIENT_NAME = 'dsh-mcp-skill-hub'
const STATE_BYTES = 32

export { CALLBACK_PATH, CLIENT_NAME }

/** 主机名（错误信息里只能出现这个，不能出现 path/query/token）。 */
function hostOf(url) {
  try { return new URL(url).host } catch { return String(url) }
}

/**
 * 取一个 provider 工厂的可复现错误构造器：消息只含 name + host。
 */
function makeError(name, serverUrl) {
  const host = hostOf(serverUrl)
  return (detail) => new Error(`[mcpAuth:${name}@${host}] ${detail}`)
}

/**
 * 创建一个 OAuthClientProvider（SDK interface 形状）。
 *
 * @param {object} options
 * @param {string} options.name MCP 行 id（auth-store 索引键）
 * @param {string} options.serverUrl MCP 行 config.url
 * @param {string} options.filePath 凭据文件路径（auth-store）
 * @param {object} [options.staticHeaders] patch 里的静态 headers（仅审计，不参与读写）
 * @returns {object} OAuthClientProvider
 */
export function createAuthProvider(options) {
  const { name, serverUrl, filePath, staticHeaders } = options ?? {}
  if (typeof name !== 'string' || name === '') throw new Error('createAuthProvider: name must be a non-empty string')
  if (typeof serverUrl !== 'string' || serverUrl === '') throw new Error('createAuthProvider: serverUrl must be a non-empty string')
  if (typeof filePath !== 'string' || filePath === '') throw new Error('createAuthProvider: filePath must be a non-empty string')

  const fail = makeError(name, serverUrl)
  /** Hub 内部扩展（非 SDK 成员）：回调 server 起来后注入真实 redirect URL。 */
  let redirectUrl = ''

  const provider = {
    // ── SDK: 用户授权完成后回跳的 URL。授权开始前占位为空串，由 setRedirectUrl 注入。 ──
    get redirectUrl() {
      return redirectUrl === '' ? undefined : redirectUrl
    },

    setRedirectUrl(url) {
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw fail('setRedirectUrl requires an http(s) URL')
      }
      redirectUrl = url
    },

    get callbackPath() {
      return CALLBACK_PATH
    },

    /** 审计用：暴露静态 headers 的存在性，不暴露值。 */
    get hasStaticHeaders() {
      return staticHeaders != null && Object.keys(staticHeaders).length > 0
    },

    // ── SDK: public client 元数据（token_endpoint_auth_method: none）。 ──
    get clientMetadata() {
      return {
        redirect_uris: redirectUrl === '' ? [`http://127.0.0.1:0${CALLBACK_PATH}`] : [redirectUrl],
        client_name: CLIENT_NAME,
        client_uri: 'https://github.com/240xu/dsh-plugins-src',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'user:read account:read offline_access',
      }
    },

    // ── SDK: CSRF state。同时落 pending 态供回调校验。 ──
    state() {
      const state = randomBytes(STATE_BYTES).toString('hex')
      setOAuthState(filePath, name, state)
      return state
    },

    // ── SDK: DCR 结果读取。过期 clientSecret 视为未注册（触发重新 DCR）。 ──
    clientInformation() {
      const info = getClientInfo(filePath, name)
      if (!info) return undefined
      // RFC 7591: client_secret_expires_at = 0 表示永不过期。只有 > 0 才判过期。
      if (Number.isFinite(info.clientSecretExpiresAt) && info.clientSecretExpiresAt > 0
        && info.clientSecretExpiresAt <= Math.floor(Date.now() / 1000)) {
        return undefined
      }
      return {
        client_id: info.clientId,
        ...(info.clientSecret ? { client_secret: info.clientSecret } : {}),
        ...(Number.isFinite(info.clientIdIssuedAt) ? { client_id_issued_at: info.clientIdIssuedAt } : {}),
      }
    },

    /**
     * RFC 7591 动态客户端注册（DCR）。
     *
     * 为什么需要: Cloudflare 等授权服务器要求 /authorize 必须带 client_id。
     * Hub 的 /oauth/start 原先直接读 clientInformation()?.client_id, 若 dsh 的
     * mcp-client 库还没做过 DCR(它只在连接时触发), authUrl 就缺 client_id →
     * 授权页 400 invalid_request。
     *
     * 幂等: 已有未过期 clientInfo 时直接复用, 不再发 /register。
     * clientSecret 过期(client_secret_expires_at <= now)视为未注册, 重新注册。
     *
     * 返回 { client_id, client_secret?, ... }（同时落盘, 后续 clientInformation() 可读）。
     */
    async registerClient() {
      const existing = provider.clientInformation()
      if (existing) return existing

      const meta = provider.clientMetadata
      const base = String(serverUrl).endsWith('/') ? String(serverUrl) : String(serverUrl) + '/'
      const regUrl = new URL('/register', base)
      const body = {
        client_name: meta.client_name,
        client_uri: meta.client_uri,
        redirect_uris: meta.redirect_uris,
        grant_types: meta.grant_types,
        response_types: meta.response_types,
        token_endpoint_auth_method: meta.token_endpoint_auth_method,
        scope: meta.scope,
      }

      const res = await fetch(regUrl.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        // 错误信息不得泄露任何凭据(铁律 6); 只带状态码与端点路径。
        throw fail(`DCR rejected by ${regUrl.pathname} (status ${res.status})`)
      }
      const json = await res.json()
      if (!json || typeof json.client_id !== 'string' || json.client_id === '') {
        throw fail('DCR response has no client_id')
      }
      provider.saveClientInformation(json)
      return provider.clientInformation() || { client_id: json.client_id }
    },

    // ── SDK: DCR 成功持久化。 ──
    saveClientInformation(info) {
      if (!info || typeof info.client_id !== 'string' || info.client_id === '') {
        throw fail('saveClientInformation received no client_id')
      }
      setClientInfo(filePath, name, {
        clientId: info.client_id,
        clientIdIssuedAt: Number.isFinite(info.client_id_issued_at)
          ? info.client_id_issued_at
          : Math.floor(Date.now() / 1000),
        ...(typeof info.client_secret === 'string' && info.client_secret !== ''
          ? { clientSecret: info.client_secret } : {}),
        ...(Number.isFinite(info.client_secret_expires_at)
          ? { clientSecretExpiresAt: info.client_secret_expires_at } : {}),
      })
    },

    /**
     * SDK: per-request token 读取路径。
     * ctx === undefined 时（transport 每请求调用）必须返回最近 token，
     * 不得返回 undefined —— 否则 SDK 会重复发起授权流。
     */
    tokens() {
      const stored = getTokens(filePath, name)
      if (!stored) return undefined
      const accessToken = typeof stored.accessToken === 'string' && stored.accessToken !== ''
        ? stored.accessToken
        : undefined
      if (accessToken === undefined) return undefined
      const now = Math.floor(Date.now() / 1000)
      const expiresIn = Number.isFinite(stored.expiresAt)
        ? Math.max(0, stored.expiresAt - now)
        // 无过期时间的 token 视为长期有效（Cloudflare API Token 的常见形态）
        : undefined
      return {
        access_token: accessToken,
        token_type: 'Bearer',
        ...(typeof stored.refreshToken === 'string' && stored.refreshToken !== ''
          ? { refresh_token: stored.refreshToken } : {}),
        ...(typeof stored.scope === 'string' && stored.scope !== '' ? { scope: stored.scope } : {}),
        ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
      }
    },

    /**
     * SDK: 授权/刷新成功后存 token。
     * expires_in → expiresAt；不带 expires_in 时保留原值（防写坏）。
     */
    saveTokens(tokens) {
      if (!tokens || typeof tokens.access_token !== 'string' || tokens.access_token === '') {
        throw fail('saveTokens received no access_token')
      }
      const prev = getTokens(filePath, name) ?? {}
      const now = Math.floor(Date.now() / 1000)
      const expiresAt = Number.isFinite(tokens.expires_in) && tokens.expires_in >= 0
        ? now + tokens.expires_in
        : prev.expiresAt
      setTokens(filePath, name, {
        accessToken: tokens.access_token,
        ...(typeof tokens.refresh_token === 'string' && tokens.refresh_token !== ''
          ? { refreshToken: tokens.refresh_token } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(typeof tokens.scope === 'string' && tokens.scope !== ''
          ? { scope: tokens.scope } : {}),
      })
    },

    /**
     * SDK: SDK 要求跳转到授权页时调用。
     * 本方案由 oauth-server.js 的 /start 路由打开浏览器（dsh 无内嵌浏览器），
     * 故这里只做协议校验，不真的 redirect。
     */
    redirectToAuthorization(authorizationUrl) {
      if (authorizationUrl == null) throw fail('redirectToAuthorization called without a URL')
      const url = authorizationUrl instanceof URL ? authorizationUrl : new URL(String(authorizationUrl))
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw fail(`redirectToAuthorization rejected non-http protocol: ${url.protocol}`)
      }
      // 协议合法即视为已交接给上层；真实跳转由 oauth-server 的 /start 完成。
    },

    // ── SDK: PKCE。 ──
    saveCodeVerifier(codeVerifier) {
      if (typeof codeVerifier !== 'string' || codeVerifier.length < 43) {
        throw fail('saveCodeVerifier requires a PKCE verifier')
      }
      setCodeVerifier(filePath, name, codeVerifier)
    },

    codeVerifier() {
      const v = getCodeVerifier(filePath, name)
      if (typeof v !== 'string' || v === '') {
        throw fail('no stored code verifier — authorization flow was not started for this entry')
      }
      return v
    },

    /** Hub 内部：已存 oauthState（供 /callback 校验）。 */
    getStoredState() {
      return getOAuthState(filePath, name)
    },

    /** Hub 内部：生成 S256 challenge（供 /start 调 authorize 用）。 */
    staticChallengeFor(verifier) {
      return createHash('sha256').update(String(verifier)).digest('base64url')
    },
  }

  return provider
}

export const __internals = { hostOf, makeError, CALLBACK_PATH, CLIENT_NAME, STATE_BYTES }
