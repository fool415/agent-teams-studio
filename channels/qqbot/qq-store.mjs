// channels/qqbot/qq-store.mjs
// Node.js 24 ESM，仅使用内置模块。

import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  chmodSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { randomInt, randomUUID } from 'node:crypto';
import {
  resolve,
  dirname,
  relative,
  isAbsolute,
  sep,
  join,
} from 'node:path';
import { homedir } from 'node:os';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const PAIRING_TTL = 10 * MINUTE;
const DEDUPE_TTL = 7 * DAY;

// 排除容易混淆的 I、L、O、0、1。
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const POLICIES = new Set(['allowlist', 'open', 'disabled']);
const REPLY_DETAILS = new Set(['concise', 'verbose']);

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  appId: '',
  c2cPolicy: 'allowlist',
  groupPolicy: 'allowlist',
  requireMentionInGroup: true,
  allowUsers: Object.freeze([]),
  allowGroups: Object.freeze([]),
  defaultModel: 'gpt-6.1-sol',
  defaultEffort: 'medium',
  defaultMode: 'direct',
  defaultReplyDetail: 'verbose',
  defaultTeamPreset: 'chatgpt-crew',
  defaultWorkspace: '',
  allowedWorkspaces: Object.freeze([]),
  markdownSupport: false,
});

const CONFIG_KEYS = new Set(Object.keys(DEFAULT_CONFIG));

const SESSION_COLUMNS = Object.freeze({
  scope: 'scope',
  targetId: 'target_id',
  actorId: 'actor_id',
  model: 'model',
  effort: 'effort',
  mode: 'mode',
  replyDetail: 'reply_detail',
  teamPreset: 'team_preset',
  cwd: 'cwd',
  pendingTeamId: 'pending_team_id',
  history: 'history_json',
});

const TASK_COLUMNS = Object.freeze({
  sessionKey: 'session_key',
  actorId: 'actor_id',
  scope: 'scope',
  targetId: 'target_id',
  mode: 'mode',
  model: 'model',
  effort: 'effort',
  cwd: 'cwd',
  prompt: 'prompt',
  teamId: 'team_id',
  status: 'status',
  summary: 'summary',
  error: 'error',
  changedPaths: 'changed_paths_json',
  usage: 'usage_json',
  undelivered: 'undelivered',
  startedAt: 'started_at',
  finishedAt: 'finished_at',
});

function bestEffortChmod(path, mode) {
  try {
    chmodSync(path, mode);
  } catch {
    // Windows NTFS 等不支持 POSIX 权限位的环境安全忽略。
  }
}

function fail(message, code = 'ERR_QQ_STORE') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireString(value, name, { empty = false } = {}) {
  if (
    typeof value !== 'string' ||
    (!empty && value.trim().length === 0) ||
    value.includes('\0')
  ) {
    throw new TypeError(`${name} 必须是${empty ? '' : '非空'}字符串`);
  }
  return value;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} 必须是对象`);
  }
  return value;
}

function stringArray(value, name) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} 必须是字符串数组`);
  }
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function jsonStringify(value, name) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError(`${name} 不能序列化为 JSON`);
  }
  return encoded;
}

function nullableString(value, name) {
  return value === null ? null : requireString(value, name, { empty: true });
}

function timestamp(value, name) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} 必须是非负毫秒时间戳或 null`);
  }
  return value;
}

function validateConfig(input) {
  requireObject(input, '配置');

  for (const key of Object.keys(input)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new TypeError(`未知配置项：${key}`);
    }
  }

  const config = { ...DEFAULT_CONFIG, ...input };

  for (const key of ['enabled', 'requireMentionInGroup', 'markdownSupport']) {
    if (typeof config[key] !== 'boolean') {
      throw new TypeError(`${key} 必须是 boolean`);
    }
  }

  for (const key of ['c2cPolicy', 'groupPolicy']) {
    if (!POLICIES.has(config[key])) {
      throw new TypeError(`${key} 必须是 allowlist、open 或 disabled`);
    }
  }

  if (!REPLY_DETAILS.has(config.defaultReplyDetail)) {
    throw new TypeError('defaultReplyDetail 必须是 concise 或 verbose');
  }

  for (const key of [
    'appId',
    'defaultModel',
    'defaultEffort',
    'defaultMode',
    'defaultReplyDetail',
    'defaultTeamPreset',
    'defaultWorkspace',
  ]) {
    requireString(config[key], key, {
      empty: key === 'appId' || key === 'defaultWorkspace',
    });
  }

  for (const key of ['allowUsers', 'allowGroups', 'allowedWorkspaces']) {
    config[key] = stringArray(config[key], key);
  }

  return config;
}

function expandHome(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}

function assertDirectory(path) {
  try {
    if (!statSync(path).isDirectory()) {
      throw fail('工作路径不是目录', 'ERR_QQ_WORKSPACE_INVALID');
    }
  } catch (error) {
    if (error.code === 'ERR_QQ_WORKSPACE_INVALID') throw error;
    throw fail('工作目录不存在或无法访问', 'ERR_QQ_WORKSPACE_INVALID');
  }
}

function decodeSession(row) {
  if (!row) return null;
  return {
    sessionKey: row.session_key,
    scope: row.scope,
    targetId: row.target_id,
    actorId: row.actor_id,
    model: row.model,
    effort: row.effort,
    mode: row.mode,
    replyDetail: row.reply_detail ?? null,
    teamPreset: row.team_preset,
    cwd: row.cwd,
    pendingTeamId: row.pending_team_id,
    history: JSON.parse(row.history_json ?? '[]'),
    updatedAt: row.updated_at,
  };
}

function decodeTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionKey: row.session_key,
    actorId: row.actor_id,
    scope: row.scope,
    targetId: row.target_id,
    mode: row.mode,
    model: row.model,
    effort: row.effort,
    cwd: row.cwd,
    prompt: row.prompt,
    teamId: row.team_id,
    status: row.status,
    summary: row.summary,
    error: row.error,
    changedPaths: JSON.parse(row.changed_paths_json ?? '[]'),
    usage: JSON.parse(row.usage_json ?? 'null'),
    undelivered: Boolean(row.undelivered),
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class QQStore {
  #db;
  #closed = false;
  #dataDir;
  #secretsPath;

  constructor({ dataDir } = {}) {
    const selected =
      dataDir ??
      process.env.STUDIO_QQBOT_DIR ??
      join(homedir(), '.agent-teams-studio', 'qqbot');

    requireString(selected, 'dataDir');
    this.#dataDir = resolve(expandHome(selected));
    this.#secretsPath = join(this.#dataDir, 'secrets.json');

    mkdirSync(this.#dataDir, { recursive: true, mode: 0o700 });
    bestEffortChmod(this.#dataDir, 0o700);

    const dbPath = join(this.#dataDir, 'qqbot.db');
    this.#db = new DatabaseSync(dbPath);

    try {
      bestEffortChmod(dbPath, 0o600);
      this.#db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS pairing_codes (
          code TEXT PRIMARY KEY,
          created_at INTEGER,
          expires_at INTEGER,
          used_at INTEGER,
          used_by TEXT
        );
        CREATE INDEX IF NOT EXISTS pairing_codes_expires_idx
          ON pairing_codes(expires_at);

        CREATE TABLE IF NOT EXISTS inbox_dedupe (
          dedupe_key TEXT PRIMARY KEY,
          created_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS inbox_dedupe_created_idx
          ON inbox_dedupe(created_at);

        CREATE TABLE IF NOT EXISTS sessions (
          session_key TEXT PRIMARY KEY,
          scope TEXT,
          target_id TEXT,
          actor_id TEXT,
          model TEXT,
          effort TEXT,
          mode TEXT,
          reply_detail TEXT,
          team_preset TEXT,
          cwd TEXT,
          pending_team_id TEXT,
          history_json TEXT,
          updated_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS remote_tasks (
          id TEXT PRIMARY KEY,
          session_key TEXT,
          actor_id TEXT,
          scope TEXT,
          target_id TEXT,
          mode TEXT,
          model TEXT,
          effort TEXT,
          cwd TEXT,
          prompt TEXT,
          team_id TEXT,
          status TEXT,
          summary TEXT,
          error TEXT,
          changed_paths_json TEXT,
          usage_json TEXT,
          undelivered INTEGER DEFAULT 0,
          created_at INTEGER,
          started_at INTEGER,
          finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS remote_tasks_session_created_idx
          ON remote_tasks(session_key, created_at);
        CREATE INDEX IF NOT EXISTS remote_tasks_delivery_idx
          ON remote_tasks(session_key, undelivered, created_at);

        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event TEXT,
          actor_id TEXT,
          detail TEXT,
          created_at INTEGER
        );
      `);

      this.#db.prepare(`
        INSERT OR IGNORE INTO settings(key, value) VALUES ('config', ?)
      `).run(JSON.stringify(DEFAULT_CONFIG));

      const sessionCols = this.#db.prepare('PRAGMA table_info(sessions)').all();
      if (!sessionCols.some((c) => c.name === 'reply_detail')) {
        this.#db.exec('ALTER TABLE sessions ADD COLUMN reply_detail TEXT');
      }

      this.#readConfig();
      this.#readSecrets();
    } catch (error) {
      this.#db.close();
      this.#closed = true;
      throw error;
    }
  }

  get dataDir() {
    return this.#dataDir;
  }

  #assertOpen() {
    if (this.#closed) {
      throw fail('QQStore 已关闭', 'ERR_QQ_STORE_CLOSED');
    }
  }

  #transaction(callback) {
    this.#assertOpen();
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.#db.exec('ROLLBACK');
      } catch {
        // 保留最初的异常。
      }
      throw error;
    }
  }

  #readConfig() {
    this.#assertOpen();
    const row = this.#db.prepare(
      "SELECT value FROM settings WHERE key = 'config'",
    ).get();
    if (!row) throw fail('缺少配置记录');
    return validateConfig(JSON.parse(row.value));
  }

  #writeConfig(config) {
    this.#db.prepare(`
      INSERT INTO settings(key, value) VALUES ('config', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(JSON.stringify(validateConfig(config)));
  }

  #readSecrets() {
    this.#assertOpen();
    let content;
    try {
      content = readFileSync(this.#secretsPath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return { appSecret: '' };
      throw error;
    }

    bestEffortChmod(this.#secretsPath, 0o600);
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw fail('secrets.json 不是有效 JSON', 'ERR_QQ_SECRETS_INVALID');
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      typeof parsed.appSecret !== 'string'
    ) {
      throw fail('secrets.json 格式无效', 'ERR_QQ_SECRETS_INVALID');
    }
    return { appSecret: parsed.appSecret };
  }

  #audit(event, actorId, detail) {
    this.#db.prepare(`
      INSERT INTO audit_logs(event, actor_id, detail, created_at)
      VALUES (?, ?, ?, ?)
    `).run(event, actorId ?? null, JSON.stringify(detail ?? null), Date.now());
  }

  getPublicConfig() {
    const config = this.#readConfig();
    const hasSecret = this.#readSecrets().appSecret.length > 0;
    return {
      ...config,
      hasSecret,
      secretPreview: hasSecret ? '********' : '',
    };
  }

  updateConfig(patch) {
    requireObject(patch, 'patch');
    this.#transaction(() => {
      const next = validateConfig({ ...this.#readConfig(), ...patch });
      this.#writeConfig(next);
      this.#audit('config.updated', null, { keys: Object.keys(patch) });
    });
    return this.getPublicConfig();
  }

  getAppSecret() {
    return this.#readSecrets().appSecret;
  }

  setAppSecret(appSecret) {
    this.#assertOpen();
    requireString(appSecret, 'appSecret', { empty: true });

    const temporary = join(
      dirname(this.#secretsPath),
      `.secrets-${randomUUID()}.tmp`,
    );

    try {
      writeFileSync(temporary, JSON.stringify({ appSecret }, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
        flush: true,
      });
      renameSync(temporary, this.#secretsPath);
      bestEffortChmod(this.#secretsPath, 0o600);
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }

    this.#audit('secret.updated', null, { hasSecret: appSecret.length > 0 });
    return this.getPublicConfig();
  }

  createPairingCode() {
    return this.#transaction(() => {
      const now = Date.now();
      this.#db.prepare(
        'DELETE FROM pairing_codes WHERE expires_at <= ?',
      ).run(now);

      const insert = this.#db.prepare(`
        INSERT OR IGNORE INTO pairing_codes
          (code, created_at, expires_at, used_at, used_by)
        VALUES (?, ?, ?, NULL, NULL)
      `);

      for (let attempt = 0; attempt < 128; attempt++) {
        let code = '';
        for (let i = 0; i < 6; i++) {
          code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
        }

        const expiresAt = now + PAIRING_TTL;
        if (Number(insert.run(code, now, expiresAt).changes) > 0) {
          this.#audit('pairing.created', null, { expiresAt });
          return { code, createdAt: now, expiresAt };
        }
      }

      throw fail('无法生成唯一配对码', 'ERR_QQ_PAIRING_CAPACITY');
    });
  }

  getActivePairingStatus() {
    this.#assertOpen();
    const now = Date.now();
    const row = this.#db.prepare(`
      SELECT code, created_at, expires_at
      FROM pairing_codes
      WHERE used_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(now);
    return row
      ? { active: true, code: row.code, createdAt: row.created_at, expiresAt: row.expires_at }
      : { active: false, code: null, createdAt: null, expiresAt: null };
  }

  consumePairingCode({ code, senderId, groupOpenid } = {}) {
    requireString(code, 'code');
    requireString(senderId, 'senderId');
    if (groupOpenid !== undefined && groupOpenid !== null) {
      requireString(groupOpenid, 'groupOpenid');
    }

    const normalized = code.trim().toUpperCase();
    if (
      normalized.length !== 6 ||
      [...normalized].some((char) => !CODE_ALPHABET.includes(char))
    ) {
      return { ok: false, reason: 'invalid_or_expired_code' };
    }

    return this.#transaction(() => {
      const now = Date.now();
      const result = this.#db.prepare(`
        UPDATE pairing_codes
        SET used_at = ?, used_by = ?
        WHERE code = ? AND used_at IS NULL AND expires_at > ?
      `).run(now, senderId, normalized, now);

      if (Number(result.changes) === 0) {
        return { ok: false, reason: 'invalid_or_expired_code' };
      }

      const config = this.#readConfig();
      config.allowUsers = [...new Set([...config.allowUsers, senderId])];
      if (groupOpenid) {
        config.allowGroups = [
          ...new Set([...config.allowGroups, groupOpenid]),
        ];
      }
      this.#writeConfig(config);
      this.#audit('pairing.consumed', senderId, {
        groupOpenid: groupOpenid ?? null,
      });
      return { ok: true, senderId, groupOpenid: groupOpenid ?? null };
    });
  }

  tryRecordInbound(key) {
    requireString(key, 'key');
    return this.#transaction(() => {
      const now = Date.now();
      this.#db.prepare(
        'DELETE FROM inbox_dedupe WHERE created_at < ?',
      ).run(now - DEDUPE_TTL);

      return Number(this.#db.prepare(`
        INSERT OR IGNORE INTO inbox_dedupe(dedupe_key, created_at)
        VALUES (?, ?)
      `).run(key, now).changes) > 0;
    });
  }

  // 安全策略：群聊在 allowlist 下必须同时满足群白名单与操作者白名单；
  // 即使群聊策略为 open，也要求发送者在已配对操作者白名单中，避免无关群友触发本地命令。
  authorizeActor({ kind, senderId, groupOpenid } = {}) {
    const deny = (reason) => ({ allowed: false, reason });

    if (typeof senderId !== 'string' || !senderId.trim()) {
      return deny('missing_sender');
    }
    if (kind !== 'c2c' && kind !== 'group') {
      return deny('unsupported_kind');
    }

    const config = this.#readConfig();

    if (kind === 'group') {
      if (typeof groupOpenid !== 'string' || !groupOpenid.trim()) {
        return deny('missing_group');
      }
      if (config.groupPolicy === 'disabled') return deny('group_disabled');
      if (
        config.groupPolicy === 'allowlist' &&
        !config.allowGroups.includes(groupOpenid)
      ) {
        return deny('group_not_allowed');
      }
      if (!config.allowUsers.includes(senderId)) {
        return deny('user_not_allowed');
      }
    } else {
      if (config.c2cPolicy === 'disabled') return deny('c2c_disabled');
      if (
        config.c2cPolicy === 'allowlist' &&
        !config.allowUsers.includes(senderId)
      ) {
        return deny('user_not_allowed');
      }
    }

    return { allowed: true, reason: 'allowed' };
  }

  resolveAllowedCwd(requestedPath, fallbackWorkspace) {
    const config = this.#readConfig();

    for (const [name, value] of [
      ['requestedPath', requestedPath],
      ['fallbackWorkspace', fallbackWorkspace],
    ]) {
      if (value !== undefined && value !== null) {
        requireString(value, name, { empty: true });
      }
    }

    const fallback =
      fallbackWorkspace || config.defaultWorkspace || undefined;
    const selected = requestedPath || fallback;

    if (!selected) {
      throw fail('未指定工作目录', 'ERR_QQ_WORKSPACE_REQUIRED');
    }
    if (config.allowedWorkspaces.length === 0) {
      throw fail('没有已授权的工作目录', 'ERR_QQ_WORKSPACE_DENIED');
    }

    const expanded = expandHome(selected);
    let absolute;
    if (isAbsolute(expanded)) {
      absolute = expanded;
    } else if (requestedPath && fallback) {
      if (!isAbsolute(expandHome(fallback))) {
        throw fail('回退工作目录必须是绝对路径', 'ERR_QQ_WORKSPACE_INVALID');
      }
      absolute = resolve(expandHome(fallback), expanded);
    } else {
      throw fail('相对路径需要绝对的回退工作目录', 'ERR_QQ_WORKSPACE_INVALID');
    }

    let canonical;
    try {
      canonical = realpathSync(absolute);
    } catch {
      throw fail('工作目录不存在或无法访问', 'ERR_QQ_WORKSPACE_INVALID');
    }

    let permitted = false;
    for (const workspace of config.allowedWorkspaces) {
      const rootPath = expandHome(workspace);
      if (!isAbsolute(rootPath)) continue;

      try {
        const root = realpathSync(rootPath);
        if (isWithin(root, canonical)) {
          permitted = true;
          break;
        }
      } catch {
        // 忽略无效的白名单路径。
      }
    }

    if (!permitted) {
      throw fail(
        `工作目录不在授权范围内，允许根目录：${config.allowedWorkspaces.join(', ')}`,
        'ERR_QQ_WORKSPACE_DENIED',
      );
    }

    assertDirectory(canonical);
    return canonical;
  }

  getSession(key) {
    this.#assertOpen();
    requireString(key, 'sessionKey');
    return decodeSession(this.#db.prepare(
      'SELECT * FROM sessions WHERE session_key = ?',
    ).get(key));
  }

  #updateSession(key, patch) {
    requireString(key, 'sessionKey');
    requireObject(patch, 'patch');

    const entries = [];
    for (const [name, value] of Object.entries(patch)) {
      if (!Object.hasOwn(SESSION_COLUMNS, name)) {
        throw new TypeError(`未知会话字段：${name}`);
      }
      if (value === undefined) continue;

      if (name === 'history') {
        if (!Array.isArray(value)) throw new TypeError('history 必须是数组');
        entries.push([SESSION_COLUMNS[name], jsonStringify(value, name)]);
      } else {
        entries.push([SESSION_COLUMNS[name], nullableString(value, name)]);
      }
    }

    const now = Date.now();
    const config = this.#readConfig();
    this.#db.prepare(`
      INSERT OR IGNORE INTO sessions (
        session_key, model, effort, mode, reply_detail, team_preset, cwd, history_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)
    `).run(
      key,
      config.defaultModel,
      config.defaultEffort,
      config.defaultMode,
      config.defaultReplyDetail,
      config.defaultTeamPreset,
      config.defaultWorkspace || null,
      now,
    );

    const assignments = entries.map(([column]) => `${column} = ?`);
    assignments.push('updated_at = ?');

    this.#db.prepare(`
      UPDATE sessions SET ${assignments.join(', ')} WHERE session_key = ?
    `).run(...entries.map(([, value]) => value), now, key);

    return this.getSession(key);
  }

  updateSession(key, patch = {}) {
    return this.#transaction(() => this.#updateSession(key, patch));
  }

  appendHistory(key, turns, max = 16) {
    requireString(key, 'sessionKey');
    if (!Array.isArray(turns)) throw new TypeError('turns 必须是数组');
    if (!Number.isSafeInteger(max) || max < 0) {
      throw new TypeError('max 必须是非负整数');
    }

    return this.#transaction(() => {
      const history = [...(this.getSession(key)?.history ?? []), ...turns];
      return this.#updateSession(key, {
        history: max === 0 ? [] : history.slice(-max),
      });
    });
  }

  resetHistory(key) {
    return this.updateSession(key, { history: [] });
  }

  #taskEntries(patch) {
    requireObject(patch, '任务字段');
    const entries = [];

    for (const [name, value] of Object.entries(patch)) {
      if (!Object.hasOwn(TASK_COLUMNS, name)) {
        throw new TypeError(`未知任务字段：${name}`);
      }
      if (value === undefined) continue;

      let encoded;
      if (name === 'changedPaths') {
        encoded = JSON.stringify(stringArray(value, name));
      } else if (name === 'usage') {
        encoded = jsonStringify(value, name);
      } else if (name === 'undelivered') {
        if (typeof value !== 'boolean' && value !== 0 && value !== 1) {
          throw new TypeError('undelivered 必须是 boolean 或 0/1');
        }
        encoded = value ? 1 : 0;
      } else if (name === 'startedAt' || name === 'finishedAt') {
        encoded = timestamp(value, name);
      } else {
        encoded = nullableString(value, name);
      }

      entries.push([TASK_COLUMNS[name], encoded]);
    }

    return entries;
  }

  createTask(input = {}) {
    requireObject(input, 'task');
    const { id = randomUUID(), ...fields } = input;
    requireString(id, 'id');

    return this.#transaction(() => {
      const config = this.#readConfig();
      const entries = this.#taskEntries({
        model: config.defaultModel,
        effort: config.defaultEffort,
        mode: config.defaultMode,
        status: 'queued',
        changedPaths: [],
        usage: null,
        undelivered: false,
        ...fields,
      });

      const columns = ['id', 'created_at', ...entries.map(([key]) => key)];
      this.#db.prepare(`
        INSERT INTO remote_tasks (${columns.join(', ')})
        VALUES (${columns.map(() => '?').join(', ')})
      `).run(id, Date.now(), ...entries.map(([, value]) => value));

      this.#audit('task.created', fields.actorId ?? null, { id });
      return this.getTask(id);
    });
  }

  updateTask(id, patch = {}) {
    requireString(id, 'id');
    return this.#transaction(() => {
      const entries = this.#taskEntries(patch);
      if (!this.getTask(id)) return null;

      if (entries.length > 0) {
        this.#db.prepare(`
          UPDATE remote_tasks
          SET ${entries.map(([column]) => `${column} = ?`).join(', ')}
          WHERE id = ?
        `).run(...entries.map(([, value]) => value), id);
      }
      return this.getTask(id);
    });
  }

  getTask(id) {
    this.#assertOpen();
    requireString(id, 'id');
    return decodeTask(this.#db.prepare(
      'SELECT * FROM remote_tasks WHERE id = ?',
    ).get(id));
  }

  listTasks({
    sessionKey,
    actorId,
    scope,
    targetId,
    status,
    limit = 100,
    offset = 0,
  } = {}) {
    this.#assertOpen();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new TypeError('limit 必须是 1 到 1000 的整数');
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypeError('offset 必须是非负整数');
    }

    const where = [];
    const values = [];
    for (const [column, value] of [
      ['session_key', sessionKey],
      ['actor_id', actorId],
      ['scope', scope],
      ['target_id', targetId],
      ['status', status],
    ]) {
      if (value !== undefined) {
        requireString(value, column);
        where.push(`${column} = ?`);
        values.push(value);
      }
    }

    return this.#db.prepare(`
      SELECT * FROM remote_tasks
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset).map(decodeTask);
  }

  listUndelivered(sessionKey) {
    this.#assertOpen();
    requireString(sessionKey, 'sessionKey');
    return this.#db.prepare(`
      SELECT * FROM remote_tasks
      WHERE session_key = ? AND undelivered = 1
      ORDER BY created_at ASC, id ASC
    `).all(sessionKey).map(decodeTask);
  }

  markDelivered(ids) {
    const uniqueIds = stringArray(ids, 'ids');
    return this.#transaction(() => {
      const statement = this.#db.prepare(`
        UPDATE remote_tasks SET undelivered = 0
        WHERE id = ? AND undelivered <> 0
      `);
      let changed = 0;
      for (const id of uniqueIds) {
        changed += Number(statement.run(id).changes);
      }
      return changed;
    });
  }

  recordAudit(event, actorId = null, detail = null) {
    this.#assertOpen();
    requireString(event, 'event');
    if (actorId !== null) requireString(actorId, 'actorId');
    this.#audit(event, actorId, detail);
  }

  close() {
    if (this.#closed) return;
    this.#db.close();
    this.#closed = true;
  }

  [Symbol.dispose]() {
    this.close();
  }
}

export function createQQStore(options) {
  return new QQStore(options);
}

export default createQQStore;
