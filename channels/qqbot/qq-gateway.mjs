// channels/qqbot/qq-gateway.mjs
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export const DEFAULT_INTENTS =
  (1 << 0) | (1 << 12) | (1 << 25) | (1 << 26) | (1 << 30);

const BACKOFF = [1000, 2000, 5000, 10000, 30000, 60000];
const REPLY_WINDOW = 270_000;
const FATAL_CODES = new Set([4914, 4915]);
const RESET_CODES = new Set([4004, 4006, 4007, 4009]);
const MESSAGE_EVENTS = new Set([
  'C2C_MESSAGE_CREATE',
  'GROUP_AT_MESSAGE_CREATE',
  'GROUP_MESSAGE_CREATE',
  'DIRECT_MESSAGE_CREATE',
  'AT_MESSAGE_CREATE',
]);

/**
 * 按 Unicode 码点切分，优先保留完整行，并在分段处闭合、重开代码围栏。
 * maxChars 包含自动添加的围栏；不是字节数或 UTF-16 code unit 数。
 */
export function splitReplyText(text, maxChars = 1600) {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError('maxChars 必须是正整数');
  }

  const chars = Array.from(String(text ?? ''));
  if (!chars.length) return [];

  const result = [];
  let offset = 0;
  let fence = null;

  const scan = (part, initial) => {
    let current = initial;
    for (const line of part.split('\n')) {
      const match = /^ {0,3}(`{3,})([^`]*)$/.exec(line);
      if (!match) continue;
      if (!current) {
        current = { marker: match[1], info: match[2].trim() };
      } else if (!match[2].trim() && match[1].length >= current.marker.length) {
        current = null;
      }
    }
    return current;
  };

  while (offset < chars.length) {
    const prefix = fence ? `${fence.marker}${fence.info}\n` : '';
    const prefixSize = Array.from(prefix).length;
    const remaining = chars.length - offset;

    const rest = chars.slice(offset).join('');
    const restFence = scan(rest, fence);
    const restSuffix = restFence ? `\n${restFence.marker}` : '';
    if (prefixSize + remaining + Array.from(restSuffix).length <= maxChars) {
      result.push(prefix + rest + restSuffix);
      break;
    }

    let count = Math.min(remaining, maxChars - prefixSize);
    let chosen = null;

    while (count > 0) {
      let part = chars.slice(offset, offset + count).join('');

      const lineStart = part.lastIndexOf('\n') + 1;
      const tail = part.slice(lineStart);
      const continuesLine = chars[offset + count - 1] !== '\n' &&
        offset + count < chars.length;
      if (continuesLine && /^ {0,3}`/.test(tail)) {
        if (lineStart === 0) {
          throw new RangeError('maxChars 太小，无法容纳完整代码围栏');
        }
        count = Array.from(part.slice(0, lineStart)).length;
        continue;
      }

      const nextFence = scan(part, fence);
      const suffix = nextFence ? `${part.endsWith('\n') ? '' : '\n'}${nextFence.marker}` : '';
      if (prefixSize + count + Array.from(suffix).length > maxChars) {
        count--;
        continue;
      }

      const newline = part.lastIndexOf('\n');
      if (newline >= 0 && newline < part.length - 1 &&
          part.slice(0, newline).trim()) {
        count = Array.from(part.slice(0, newline + 1)).length;
        part = chars.slice(offset, offset + count).join('');
      }

      const endFence = scan(part, fence);
      const closing = endFence
        ? `${part.endsWith('\n') ? '' : '\n'}${endFence.marker}`
        : '';
      chosen = { part, closing, endFence };
      break;
    }

    if (!chosen) {
      throw new RangeError('maxChars 太小，无法容纳代码围栏及正文');
    }

    result.push(prefix + chosen.part + chosen.closing);
    fence = chosen.endFence;
    offset += count;
  }

  return result;
}

export class QQGateway extends EventEmitter {
  constructor({
    appId,
    clientSecret,
    intents = DEFAULT_INTENTS,
    fetchImpl = globalThis.fetch,
    wsFactory = url => new globalThis.WebSocket(url),
    apiBaseUrl = 'https://api.sgroup.qq.com',
    tokenUrl = 'https://bots.qq.com/app/getAppAccessToken',
    requestTimeout = 30_000,
  } = {}) {
    super();
    if (!appId || !clientSecret) throw new Error('缺少 appId 或 clientSecret');
    if (typeof fetchImpl !== 'function' || typeof wsFactory !== 'function') {
      throw new TypeError('fetchImpl 和 wsFactory 必须是函数');
    }

    Object.assign(this, {
      appId: String(appId),
      clientSecret,
      intents,
      fetchImpl,
      wsFactory,
      tokenUrl,
      requestTimeout,
    });
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');

    this.state = 'offline';
    this.botUser = null;
    this.sessionId = null;
    this.lastSeq = null;
    this.lastConnectedAt = null;
    this.lastError = null;
    this.reconnectAttempt = 0;

    this._running = false;
    this._generation = 0;
    this._tokenEpoch = 0;
    this._token = null;
    this._tokenFlight = null;
    this._ws = null;
    this._heartbeat = null;
    this._helloTimer = null;
    this._reconnectTimer = null;
    this._awaitingAck = false;
    this._replies = new Map();
  }

  getStatus() {
    return {
      state: this.state,
      appId: this.appId,
      botUser: this.botUser,
      sessionId: this.sessionId,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      reconnectAttempt: this.reconnectAttempt,
    };
  }

  _report(error) {
    const err = error instanceof Error ? error : new Error(String(error));
    this.lastError = err.message;
    if (this.listenerCount('error')) this.emit('error', err);
    return err;
  }

  async _json(url, init = {}) {
    const response = await this.fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(this.requestTimeout),
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new Error(`接口返回非 JSON：${response.status}`);
      }
    }
    if (!response.ok) {
      const error = new Error(
        `QQ API ${response.status}: ${data?.message ?? text.slice(0, 500)}`,
      );
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  _invalidateToken() {
    this._tokenEpoch++;
    this._token = null;
    this._tokenFlight = null;
  }

  async getAccessToken() {
    if (this._token && Date.now() < this._token.refreshAt) {
      return this._token.value;
    }
    if (this._tokenFlight) return this._tokenFlight;

    const epoch = this._tokenEpoch;
    const flight = (async () => {
      const data = await this._json(this.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: this.appId,
          clientSecret: this.clientSecret,
        }),
      });
      const ttl = Number(data?.expires_in) * 1000;
      if (!data?.access_token || !Number.isFinite(ttl) || ttl <= 0) {
        throw new Error('QQ Token 响应无效');
      }
      if (epoch !== this._tokenEpoch) return this.getAccessToken();
      this._token = {
        value: data.access_token,
        refreshAt: Date.now() + Math.max(0, ttl - 300_000),
      };
      return data.access_token;
    })();

    this._tokenFlight = flight;
    try {
      return await flight;
    } finally {
      if (this._tokenFlight === flight) this._tokenFlight = null;
    }
  }

  async _api(method, path, body) {
    const token = await this.getAccessToken();
    return this._json(`${this.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  async start() {
    if (this._running) return;
    this._running = true;
    this.reconnectAttempt = 0;
    this.state = 'connecting';
    await this._connect();
  }

  stop() {
    this._running = false;
    this._generation++;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._disposeSocket();
    this.state = 'offline';
  }

  _clearSession() {
    this.sessionId = null;
    this.lastSeq = null;
  }

  _disposeSocket() {
    clearInterval(this._heartbeat);
    clearTimeout(this._helloTimer);
    this._heartbeat = this._helloTimer = null;
    this._awaitingAck = false;
    const socket = this._ws;
    this._ws = null;
    try {
      socket?.close(1000, '连接已结束');
    } catch {
      // 尚未完成握手的连接也可能拒绝 close。
    }
  }

  _scheduleReconnect(error) {
    if (!this._running || this.state === 'fatal' || this._reconnectTimer) return;
    if (error) this._report(error);
    this._generation++;
    this._disposeSocket();
    this.state = 'reconnecting';
    const delay = BACKOFF[Math.min(this.reconnectAttempt, BACKOFF.length - 1)];
    this.reconnectAttempt++;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      void this._connect();
    }, delay);
  }

  _fatal(code, reason) {
    this._running = false;
    this._generation++;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    this._disposeSocket();
    this.state = 'fatal';
    const error = this._report(new Error(`QQ 网关致命关闭 ${code}: ${reason || ''}`));
    this.emit('fatal', { code, reason, error });
  }

  _send(packet) {
    if (!this._ws || this._ws.readyState !== 1) {
      throw new Error('QQ WebSocket 尚未连接');
    }
    this._ws.send(JSON.stringify(packet));
  }

  async _connect() {
    if (!this._running) return;
    const generation = ++this._generation;
    const current = () => this._running && generation === this._generation;

    try {
      const token = await this.getAccessToken();
      const gateway = await this._api('GET', '/gateway');
      if (!current()) return;
      if (!gateway?.url) throw new Error('QQ Gateway URL 缺失');

      const socket = this.wsFactory(gateway.url);
      this._ws = socket;

      this._helloTimer = setTimeout(() => {
        if (current()) this._scheduleReconnect(new Error('QQ HELLO 超时'));
      }, 30_000);

      socket.addEventListener('message', event => {
        if (!current()) return;
        try {
          if (typeof event.data !== 'string') {
            throw new Error('QQ 网关收到非文本帧');
          }
          this._handlePacket(JSON.parse(event.data), token);
        } catch (error) {
          this._scheduleReconnect(error);
        }
      });

      socket.addEventListener('error', () => {
        if (current()) this._scheduleReconnect(new Error('QQ WebSocket 连接错误'));
      });

      socket.addEventListener('close', event => {
        if (!current()) return;
        if (FATAL_CODES.has(event.code)) {
          this._fatal(event.code, event.reason);
          return;
        }
        if (RESET_CODES.has(event.code)) this._clearSession();
        if (event.code === 4004) this._invalidateToken();
        this._scheduleReconnect(
          new Error(`QQ WebSocket 关闭 ${event.code}: ${event.reason || ''}`),
        );
      });
    } catch (error) {
      if (current()) this._scheduleReconnect(error);
    }
  }

  _handlePacket(packet, token) {
    if (packet.s !== undefined && packet.s !== null) this.lastSeq = packet.s;

    switch (packet.op) {
      case 10: {
        clearTimeout(this._helloTimer);
        clearInterval(this._heartbeat);
        const interval = Number(packet.d?.heartbeat_interval);
        if (!Number.isFinite(interval) || interval <= 0) {
          throw new Error('QQ heartbeat_interval 无效');
        }
        if (this.sessionId && this.lastSeq !== null) {
          this._send({
            op: 6,
            d: {
              token: `QQBot ${token}`,
              session_id: this.sessionId,
              seq: this.lastSeq,
            },
          });
        } else {
          this._send({
            op: 2,
            d: { token: `QQBot ${token}`, intents: this.intents, shard: [0, 1] },
          });
        }
        this._awaitingAck = false;
        this._heartbeat = setInterval(() => {
          try {
            if (this._awaitingAck) throw new Error('QQ 心跳 ACK 超时');
            this._send({ op: 1, d: this.lastSeq });
            this._awaitingAck = true;
          } catch (error) {
            this._scheduleReconnect(error);
          }
        }, interval);
        break;
      }
      case 11:
        this._awaitingAck = false;
        break;
      case 1:
        this._send({ op: 1, d: this.lastSeq });
        break;
      case 7:
        this._scheduleReconnect();
        break;
      case 9:
        if (packet.d === false) {
          this._clearSession();
          this._invalidateToken();
        }
        this._scheduleReconnect(new Error('QQ 会话失效'));
        break;
      case 0:
        this._dispatch(packet.t, packet.d);
        break;
      default:
        break;
    }
  }

  _dispatch(type, data) {
    if (type === 'READY' || type === 'RESUMED') {
      if (type === 'READY') {
        this.sessionId = data.session_id;
        this.botUser = data.user ?? null;
      }
      this.state = 'online';
      this.lastConnectedAt = new Date().toISOString();
      this.lastError = null;
      this.reconnectAttempt = 0;
      this.emit(type === 'READY' ? 'ready' : 'resumed', data);
      return;
    }

    if (MESSAGE_EVENTS.has(type) || type === 'INTERACTION_CREATE') {
      const inbound = this._normalize(type, data);
      if (type !== 'INTERACTION_CREATE' && inbound.messageId) {
        this._rememberMessage(inbound.messageId, inbound.replyTarget.receivedAt);
      }
      this.emit('inbound', inbound);
      if (type === 'INTERACTION_CREATE') this.emit('interaction', inbound);
    }
    this.emit('dispatch', { type, data });
  }

  _normalize(type, raw) {
    const interaction = type === 'INTERACTION_CREATE';
    const chatType = Number(raw.chat_type);
    const kind = type === 'C2C_MESSAGE_CREATE' || (interaction && chatType === 2)
      ? 'c2c'
      : type.startsWith('GROUP_') || (interaction && chatType === 1)
        ? 'group'
        : type === 'DIRECT_MESSAGE_CREATE'
          ? 'dm'
          : 'guild';

    const author = raw.author ?? {};
    const senderId = author.user_openid ?? author.member_openid ??
      author.id ?? raw.user_openid ?? raw.group_member_openid ??
      raw.data?.resolved?.user_id ?? null;
    const groupOpenid = raw.group_openid ?? null;
    const channelId = raw.channel_id ?? null;
    const guildId = raw.guild_id ?? null;
    const targetId = kind === 'c2c' ? senderId
      : kind === 'group' ? groupOpenid
        : kind === 'dm' ? guildId : channelId;
    const receivedAt = Date.now();
    let content = String(raw.content ?? raw.data?.resolved?.button_data ?? '');

    if (kind === 'group' || kind === 'guild') {
      content = content.replace(/^\s*(?:<@!?\d+>\s*)+/, '').trimStart();
    }

    return {
      rawEventType: type,
      kind,
      senderId,
      senderName: author.username ?? author.nickname ??
        raw.member?.nick ?? null,
      groupOpenid,
      channelId,
      guildId,
      messageId: raw.id ?? null,
      content,
      attachments: raw.attachments ?? [],
      timestamp: raw.timestamp ?? new Date(receivedAt).toISOString(),
      replyTarget: {
        scope: kind,
        targetId,
        msgId: interaction ? null : (raw.id ?? null),
        channelId,
        guildId,
        receivedAt,
      },
      raw,
    };
  }

  _pruneReplies() {
    const now = Date.now();
    for (const [id, entry] of this._replies) {
      if (now - entry.receivedAt >= REPLY_WINDOW) this._replies.delete(id);
    }
  }

  _rememberMessage(id, receivedAt) {
    this._pruneReplies();
    if (!this._replies.has(id)) {
      this._replies.set(id, { receivedAt, seq: 0 });
    }
  }

  _target(target) {
    const value = target?.replyTarget ?? target;
    if (!value || !['c2c', 'group', 'dm', 'guild'].includes(value.scope)) {
      throw new TypeError('target 必须包含 scope 和 targetId，可直接传入 inbound.replyTarget');
    }
    const id = value.targetId ??
      (value.scope === 'dm' ? value.guildId : value.channelId);
    if (!id) throw new TypeError('targetId 不能为空');
    return { ...value, targetId: String(id) };
  }

  _messagePath(target) {
    const id = encodeURIComponent(target.targetId);
    switch (target.scope) {
      case 'c2c': return `/v2/users/${id}/messages`;
      case 'group': return `/v2/groups/${id}/messages`;
      case 'dm': return `/dms/${id}/messages`;
      default: return `/channels/${id}/messages`;
    }
  }

  _replyFields(target, msgId) {
    this._pruneReplies();
    const id = msgId ?? target.msgId;
    if (typeof id !== 'string' || !id.trim()) return {};

    if (!this._replies.has(id) && Number.isFinite(target.receivedAt)) {
      const age = Date.now() - target.receivedAt;
      if (age >= 0 && age < REPLY_WINDOW) {
        this._rememberMessage(id, target.receivedAt);
      }
    }
    const entry = this._replies.get(id);
    if (!entry || Date.now() - entry.receivedAt >= REPLY_WINDOW) return {};
    return { msg_id: id, msg_seq: ++entry.seq };
  }

  async sendText(target, content, { msgId, markdownSupport = false } = {}) {
    const normalized = this._target(target);
    const body = markdownSupport
      ? { msg_type: 2, markdown: { content: String(content) } }
      : { msg_type: 0, content: String(content) };
    return this._api('POST', this._messagePath(normalized), {
      ...body,
      ...this._replyFields(normalized, msgId),
    });
  }

  async sendTyping(openid, msgId, inputSecond = 60) {
    try {
      const target = this._target({ scope: 'c2c', targetId: openid });
      const reply = this._replyFields(target, msgId);
      if (!reply.msg_id) return null;
      return await this._api('POST', this._messagePath(target), {
        msg_type: 6,
        input_notify: {
          input_type: 1,
          input_second: Math.max(1, Math.min(60, Math.trunc(inputSecond) || 60)),
        },
        ...reply,
      });
    } catch (error) {
      if (error.status === 401) this._invalidateToken();
      this.emit('warning', error);
      return null;
    }
  }

  async sendFile(target, localPath, { msgId } = {}) {
    const normalized = this._target(target);
    if (!['c2c', 'group'].includes(normalized.scope)) {
      throw new Error('QQ 文件上传仅支持 c2c 或 group');
    }

    const name = basename(localPath);
    const data = readFileSync(localPath);
    const root = normalized.scope === 'group' ? 'groups' : 'users';
    const uploaded = await this._api(
      'POST',
      `/v2/${root}/${encodeURIComponent(normalized.targetId)}/files`,
      {
        file_type: 4,
        srv_send_msg: false,
        file_data: data.toString('base64'),
        file_name: name,
      },
    );
    if (!uploaded?.file_info) throw new Error('QQ 文件上传未返回 file_info');

    return this._api('POST', this._messagePath(normalized), {
      msg_type: 7,
      media: { file_info: uploaded.file_info },
      ...this._replyFields(normalized, msgId),
    });
  }

  async acknowledgeInteraction(interactionId, code = 0) {
    if (!interactionId) throw new TypeError('interactionId 不能为空');
    return this._api(
      'PUT',
      `/interactions/${encodeURIComponent(interactionId)}`,
      { code },
    );
  }
}

export default QQGateway;
