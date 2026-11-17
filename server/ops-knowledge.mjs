/**
 * Built-in Ops Runbooks & Knowledge Base Registry for AgentTeams Studio.
 *
 * Integrates the `VPS 统一监控主控中心 v4.3 (zkl & novixlink)` AI operational &
 * troubleshooting manual into both the Studio UI and CPA/Antigravity agent prompts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(MODULE_DIR, '..')
const RUNBOOK_MD_PATH = join(PACKAGE_ROOT, 'docs', 'runbooks', 'vps-zkl-novixlink.md')

const EMBEDDED_RAW_MARKDOWN = `# VPS 统一监控主控中心 v4.3 使用与排障手册（For AI · \`zkl\` & \`novixlink\` 专版）

> **文档定位**：本手册面向协助用户 **\`zkl\`** 管理及排查 **NovixLink（诺联）** 节点的 AI 助手编写。文档内所有账号、权限边界、阈值、指令与架构均对照运行中系统（\`vps-control v4.3\`）实测整理，**未包含超级管理员（\`root\`）及无关节点信息**。

## 一、系统入口与基础信息
* **主控标题**：\`VPS 统一监控主控中心 v4.3\`
* **当前 Web 公网入口**：https://example-tunnel.trycloudflare.com/
  * **访问机制**：后端 \`127.0.0.1:8090\` + \`vps-cloudflared.service\` (Cloudflare Quick Tunnel)。
  * **域名变更兜底**：仅在隧道进程或宿主节点重启时 \`*.trycloudflare.com\` 会变更；TG 发送 \`/panel\`（或 \`/url\`、\`/tunnel\`）获取最新域名。
* **Telegram 双向机器人**：\`@VpsPingBellBot\` (https://t.me/VpsPingBellBot)，\`getUpdates\` 纯出站 HTTPS 长轮询。

## 二、双账号身份体系、凭据与 RBAC 边界
* **\`zkl\`** (\`<YOUR_MEMBER_PASSWORD>\`, \`member_pure\`, \`us-la-novixlink / member_tag: zkl\`): 可见个人 AA 规则与续费状态、个人流量与线路健康；不可见整机矩阵/34省热力图/多用户曲线；可改密、绑TG、备忘录、自助 \`/why\`、限时只读分享 \`?share=\`、导出纯净 HTML、复制对账摘要。
* **\`novixlink\`** (\`<YOUR_OPERATOR_PASSWORD>\`, \`node_operator\`, \`us-la-novixlink\`): 物理剥离采购总账与同机他人费用（\`overview.billing\` 仅留 \`next_due_at / days_left / billing_reset_day\`，TG \`/user\` 强制 \`costConv=nil\`）；可见整机负载、34省热力图、黑匣子与分用户对比；可一键立即同步 (\`can_sync\`)、15m 极速观察窗 (\`FastWatch\`)、一键解除限速 (\`can_unthrottle\`)、24h 只读分享。
* **仅 \`root\` 可见**：多节点同轴对比、机器账单与汇率台账、账号与通报设置、\`/digest\` 早报、删除黑匣子/快照。
* **认证防爆破**：SQLite WAL \`bcrypt (cost=12)\`；\`HttpOnly + SameSite=Lax\` 30 天 Cookie；同 IP \`10 分钟\` 内失败 \`5 次\` 锁 \`15 分钟\`（切勿连续盲试）；改密 \`POST /api/auth/password\` 至少 6 位。

## 三、NovixLink (\`us-la-novixlink\`) 规格与策略红线
* **基础设施**：LAX，\`1 vCPU / 956 MB RAM / 20 GB NVMe / KVM\`，AS2914 NTT 原生双 ISP 家宽（回程电信/联通 AS9929 + 移动 CMIN2）。
* **协议**：\`VLESS + TCP:443 + REALITY + Vision (纯 IPv4)\`，\`SNI: mirrors.ocf.berkeley.edu\`。
* **双向计费 ×2**：\`traffic_multiplier = 2\`；整机 \`1000 GB/月\`、\`zkl\` 个人 \`750 GB/月\`（每月 \`6\` 号重置）；已年付至 \`2027-12-06\`（双人 AA 50%，整机 \`C$121.29 CAD/年\` -> 分摊 \`C$60.65 CAD/年\` ≈ \`$3.54 USD/月\` ≈ \`¥23.71 CNY/月\`，首月 \`C$6.50 CAD\` 已结清）。
* **端口与红线**：标称 \`150 Mbps\`，实测峰值 \`~117 Mbps\`；建议 \`12h 均速 < 80 Mbps\`（超限易触发 FUP 抢核导致 \`CPU Steal\` 飙高）。
* **两级限速 (\`bw_policies\`)**：\`normal\` (\`root fq\`) -> \`stage1_20m\` (≥95 Mbps 持续 60s -> \`tc HTB + fq_codel\` 限至 20 Mbps；回落 120s 自动恢复) -> \`stage2_100kb\` (再顶满 600s/10m -> 800 kbps ≈ 100 KB/s；**不自动恢复**，需 \`novixlink\` 或 \`root\` 手动解限)。
`

function loadRawMarkdown() {
  if (existsSync(RUNBOOK_MD_PATH)) {
    try {
      return readFileSync(RUNBOOK_MD_PATH, 'utf8')
    } catch {
      return EMBEDDED_RAW_MARKDOWN
    }
  }
  return EMBEDDED_RAW_MARKDOWN
}

export const VPS_ZKL_NOVIXLINK_MANUAL = {
  id: 'vps-zkl-novixlink',
  title: 'VPS 统一监控主控中心 v4.3 使用与排障手册',
  subtitle: 'For AI · zkl & novixlink 专版（含 v4.4「优化查看体验」看板）',
  version: 'v4.3 / v4.4',
  scopeLabel: 'zkl (member_pure) & novixlink (node_operator) · 零 root 敏感泄密',
  systemEntry: {
    controlTitle: 'VPS 统一监控主控中心 v4.3',
    webUrl: 'https://example-tunnel.trycloudflare.com/',
    loopbackAddr: '127.0.0.1:8090',
    tunnelService: 'vps-cloudflared.service (Cloudflare Quick Tunnel)',
    domainFallbackCommands: ['/panel', '/url', '/tunnel'],
    telegramBot: '@VpsPingBellBot',
    telegramBotUrl: 'https://t.me/VpsPingBellBot',
    telegramPollingMode: 'getUpdates 纯出站 HTTPS 长轮询（无需入站 Webhook 端口）',
  },
  accounts: [
    {
      id: 'zkl',
      label: '个人主账号 (zkl)',
      username: 'zkl',
      initialPassword: '<YOUR_MEMBER_PASSWORD>',
      role: 'member_pure',
      roleLabel: '个人专属纯净视图',
      nodeScope: 'us-la-novixlink (member_tag: zkl)',
      billingVisibility: '✅ 可见本人 AA 规则与续费状态',
      matrixHeatmapVisibility: '❌ 不可见（仅看本人专属流量与线路健康）',
      allowedActions: [
        '改密 (POST /api/auth/password)',
        '绑定 TG (6位码 / 账密)',
        '管理个人备忘录',
        '自助 /why 排障',
        '签发本人限时只读分享 (?share=)',
        '导出本人纯净 HTML',
        '复制对账摘要',
      ],
      restrictedFeatures: [
        '多节点同轴对比',
        '机器账单与汇率台账',
        '账号与通报设置',
        '/digest 早报',
        '删除黑匣子/快照运维记录',
      ],
    },
    {
      id: 'novixlink',
      label: '诺联单机管控账号 (novixlink)',
      username: 'novixlink',
      initialPassword: '<YOUR_OPERATOR_PASSWORD>',
      role: 'node_operator',
      roleLabel: '单机专属运维管控',
      nodeScope: 'us-la-novixlink',
      billingVisibility:
        '❌ 物理剥离机器采购总账与同机他人个人费用（overview.billing 仅留 next_due_at / days_left / billing_reset_day；TG /user 下强制 costConv=nil）',
      matrixHeatmapVisibility: '✅ 可见诺联整机负载、34 省热力图、黑匣子历史与分用户占用对比',
      allowedActions: [
        '通用能力（改密 / 绑TG / 备忘录 / 自助排障）',
        '一键立即同步 (can_sync: true)',
        '开启 15m 极速观察窗 (FastWatch)',
        '一键解除带宽限速 (can_unthrottle: true)',
        '签发单机或指定成员 24h 只读分享参数 (?share=)',
      ],
      restrictedFeatures: [
        '多节点同轴对比',
        '机器账单与汇率台账',
        '账号与通报设置',
        '/digest 早报',
        '删除黑匣子/快照运维记录',
      ],
    },
  ],
  authRules: {
    passwordHashing: 'SQLite WAL 存储 bcrypt (cost=12) 哈希，磁盘零明文密码',
    sessionCookie: '随机 Token 写入 HttpOnly + SameSite=Lax Cookie，有效期 30 天 (MaxAge = 30 * 86400)',
    antiBruteForce: '同一来源 IP 在 10 分钟窗口内连续登录失败达 5 次，自动锁定 15 分钟（排查登录失败时切勿连续盲试密码）',
    passwordChangePolicy: '网页右上角「🔑 改密」（POST /api/auth/password），密码长度至少 6 位',
  },
  nodeSpec: {
    nodeId: 'us-la-novixlink',
    displayName: 'NovixLink（诺联）',
    location: '美国洛杉矶 (LAX)',
    hardware: '1 vCPU / 956 MB RAM / 20 GB NVMe / KVM',
    network: 'AS2914 NTT 原生双 ISP 家宽（回程电信/联通 AS9929 + 移动 CMIN2 优化）',
    proxyProtocol: 'VLESS + TCP:443 + REALITY + Vision (纯 IPv4)',
    sni: 'mirrors.ocf.berkeley.edu',
    trafficMultiplier: 2,
    trafficMultiplierNote: '双向计费 ×2：所有上行 + 下行流量均按双向乘数纳入统计并与配额比对',
    nodeCapGb: 1000,
    zklQuotaGb: 750,
    billingResetDay: 6,
    paidUntil: '2027-12-06',
    billingSplit: '诺联双人 AA (50%)：整机 C$121.29 CAD/年 -> zkl 分摊 C$60.65 CAD/年（约 $3.54 USD/月 ≈ ¥23.71 CNY/月；首月体验分摊 C$6.50 CAD 已结清）',
    nominalPortMbps: 150,
    measuredPeakMbps: 117,
    fupRedline: '建议 12h 均速 < 80 Mbps（连续跑满 110M+ 曾触发宿主机 FUP 抢核降频，表现为面板 CPU Steal 飙高）',
    pollingInterval: '默认每 1 分钟自动增量同步；novixlink 可开启「⏱️ 15m 极速观察窗」或点击「⚡ 立即同步节点」',
    bwPolicies: [
      {
        stage: 'normal',
        badge: '🟢 满速护航态',
        condition: '正常负载（未持续触发 ≥95 Mbps 阈值）',
        effect: '维持原生 root fq 队列，无人工限速',
        recovery: '自动保持',
      },
      {
        stage: 'stage1_20m',
        badge: '🟡 一级温和限速',
        condition: '端口实时吞吐持续 ≥ 95 Mbps 达 60 秒',
        effect: '通过 tc HTB + fq_codel 自动限速至 20 Mbps',
        recovery: '速率平稳回落连续 120 秒后自动卸载限速恢复满速',
      },
      {
        stage: 'stage2_100kb',
        badge: '🔴 二级死锁熔断',
        condition: '进入一级限速后仍持续顶满 600 秒（10 分钟）',
        effect: '判定失控下载/拉流死循环，压降至 800 kbps（约 100 KB/s）死锁保护',
        recovery: '不会自动恢复！必须使用 novixlink 账号（或联系 root）手动解除',
      },
    ],
  },
  telegramBot: {
    bindingMethods: [
      {
        title: '免密 6 位绑定码（推荐）',
        steps: [
          '网页登录目标账号后点击右上角「🔗 绑定 TG」生成 6 位数字一次性绑定码（有效期 300 秒 / 5 分钟）',
          '点击 Deep Link https://t.me/VpsPingBellBot?start=bind_<6位码> 或在 TG 发送 /bind <6位码>',
          '密码全程不经过 TG 聊天记录',
        ],
      },
      {
        title: '账密直绑（备用）',
        steps: [
          '私聊 @VpsPingBellBot 发送 /bind zkl <YOUR_MEMBER_PASSWORD> 或 /bind novixlink <YOUR_OPERATOR_PASSWORD>',
          '机器人接收后会主动调用 deleteMessage 撤回含密码消息',
        ],
      },
      {
        title: '身份热切换与独立静音',
        steps: [
          'tg_bindings 原生支持 1 个 TG 会话绑定多个面板账号，建议将 zkl 与 novixlink 同时绑定',
          '发送 /switch 查看账号列表并点击内联按钮秒切主身份，支持单账号独立切换 🔔 开启 / 🔕 静音',
          '发送 /unbind [账号名] 解除指定账号绑定',
        ],
      },
    ],
    commands: [
      {
        command: '/self 或 /me',
        identity: '两者通用',
        description:
          '核心总览。zkl 输出本人套餐费用、到期天数、750 GB 双向已用占比、重置日倒计时与端口守护；novixlink 输出整机流量占比、24h SLA、延迟/丢包、限速态与到期日（无价格）。',
      },
      {
        command: '/traffic',
        identity: '两者通用',
        description:
          '输出双向计费(×2)明细、账期重置日、账期日均 vs 近 3 日燃尽斜率（GB/天）与月底触顶风险预测（novixlink 额外列出机内活跃成员流量对比）。',
      },
      {
        command: '/why [novixlink]',
        identity: '两者通用',
        description:
          '一键秒级自助排障：基于本地遥测决策树判定慢/卡原因（① 两级带宽限速；② 北京时间 20:00–24:00 晚高峰抖动/丢包；③ 宿主机抢核/伪装源站握手异常；④ 服务端正常提示查本地网络/分流）。',
      },
      {
        command: '/line',
        identity: '两者通用',
        description: '输出诺联直连回程 RTT、:443 重传率、全国三网平均 RTT / 首包丢包、伪装源站握手健康度及实测端口健康度。',
      },
      {
        command: '/panel / /url / /tunnel',
        identity: '两者通用',
        description: '读取线上实时隧道状态与最新 https://*.trycloudflare.com 访问 URL（标注 CST 更新时间）及一键打开按钮。',
      },
      {
        command: '/guard',
        identity: '两者可看，仅 novixlink 可操作',
        description:
          '查看诺联当前限速状态（normal / stage1_20m / stage2_100kb）及近期峰值活跃用户（仅 novixlink 可见 TopUser 与「🔓 立即解除 us-la-novixlink 限速」按钮）。',
      },
      {
        command: '/node [novixlink]',
        identity: '仅 novixlink',
        description:
          '输出机器级实时遥测：CPU 占用与 CPU Steal、可用内存、代理 RSS、:443 并发数、24h/30d SLA、电信/联通/移动分网延迟、同步游标与耗时（zkl 会被拒绝并引导改用 /self 或 /line）。',
      },
      {
        command: '/sync',
        identity: '仅 novixlink',
        description: '立即触发主控对诺联节点进行一次增量 SSH 数据拉取并返回新增记录数及耗时。',
      },
      {
        command: '/user [成员名]',
        identity: '仅 novixlink',
        description:
          '调阅挂载于诺联节点上的成员流量纯净快照（无价格），并提供一键签发 24h 只读分享参数 (/?share=<token>) 按钮，方便转发他人只读对账。',
      },
      {
        command: '/switch / /bind / /unbind / /help',
        identity: '两者通用',
        description: '身份切换、绑定、解绑、显示快捷命令按钮菜单。',
      },
    ],
  },
  webConsole: {
    experienceBanner: {
      title: '🚀 即时可用性与体验看板 (v4.4 新增 · 顶栏下方可折叠并记忆状态)',
      endpoints: ['GET /api/experience?region=&isp=&mode=auto', 'POST /api/auth/preferred-route'],
      highlights: [
        '权限隔离：zkl (member_pure) 仅见个人双向配额与可用性 (can_unthrottle: false)；novixlink (node_operator) 可见整机月包并解锁限速按钮；访客模式常用线路存 localStorage',
        '常用路线加权识别：读取授权范围 ops_15m 大陆直连记录（排除 relay 占位），按 70% 近24h + 30% 全量历史权重识别主用省市与运营商；无记录默认「广东移动 (gd + cm)」；支持「📍 常用线路 ▾」手动切换 31省+港澳台 × 三网',
        '1 小时平滑探针：对最近最多 4 个 trend_15m 窗口取均值降噪，结合 ret_route.core_tag 与 ASN 输出优化档位（如 ✨ 精品优化 · 回程 CMIN2 / AS9929），多节点时标出 🏆 首选推荐',
        '时区与 top_banners 紧急异常横幅：晚高峰 (20:00–24:00) 严格按北京时间 CST (UTC+8) 计算；仅在到期/临期(≤7天)、限速、出站异常、配额 ≥90%/预计触顶、12h均速 ≥85% 红线或同步延迟 ≥15 分钟时浮现',
      ],
    },
    zklModules: [
      '顶栏：🩺 自助排障、📝 备忘录（SQLite 个人持久化）、🔗 绑定 TG、🎟️ 限时分享、🔑 改密、退出',
      '操作区：📋 复制对账摘要、📤 导出我的纯净版 HTML（单文件离线报告）',
      '可视化：维护通知与专属变更记录、个人吞吐与消耗曲线（支持 ✨ 去噪 / 🧹 已滤小包 / 🌙 晚高峰色带 / 🪷 丝滑 开关）、去回程路由与三网连通状态',
    ],
    novixlinkExtraModules: [
      '🌐 节点矩阵总览 与 🖥️ 单节点深度态势 切换浏览',
      '⏱️ 15m 极速观察窗 & ⚡ 立即同步节点（排查实时突发性卡顿）',
      '🔔 通报日志（查看告警记录，滑动消红点）',
      '🔓 立即解除限速（处于 stage1_20m / stage2_100kb 时出现高危按钮，恢复 root fq）',
      '全国三网热力图 & 34 省去回程参考库、运行监控 · 分用户去回程链路 & 纯净版导出、Check.Place 体检原图归档 (SVG)',
    ],
  },
  sopScenarios: [
    {
      id: 'slow_or_stalled',
      icon: '🐢',
      symptom: '好卡 / 断流 / 突然只有几十 KB',
      quickPrompt: '排查 us-la-novixlink 卡顿/断流/降速至几十KB问题，按 v4.3 SOP 给出限速核验、CPU Steal 与晚高峰诊断步骤',
      steps: [
        'Step 1：让用户在 TG (@VpsPingBellBot) 发送 /why 或在网页点击「🩺 自助排障」。',
        'Step 2：若确认触发 stage2_100kb（锁 ~100 KB/s）或 stage1_20m（限 20M），先提示停止本机多线程下载/测速工具；随后引导在 TG 发送 /switch 切为 novixlink → 发 /guard → 点击「🔓 立即解除 us-la-novixlink 限速」（或用 novixlink 登录网页点击解限）。',
        'Step 3：若非限速，用 novixlink 执行 /node 检查 CPU Steal（是否 FUP 抢核）、24h SLA、伪装源站 mirrors.ocf.berkeley.edu 握手是否正常，并核对是否处于北京时间 20:00–24:00 晚高峰。若服务端全绿（:443 重传率低、源站正常、三网 RTT 平稳），结论大概率在用户本地宽带/Wi-Fi/客户端分流。',
      ],
      relatedCommands: ['/why', '/switch', '/guard', '/node', '/line'],
    },
    {
      id: 'web_unreachable',
      icon: '🌐',
      symptom: '网页打不开 / 提示隧道失效',
      quickPrompt: '处理 VPS 统一监控主控中心网页打不开问题，指导通过 @VpsPingBellBot /panel 获取最新 Cloudflare Quick Tunnel 域名',
      steps: [
        '确认用户是否通过旧收藏域名访问（当前入口为 Cloudflare 免域名临时隧道 *.trycloudflare.com，隧道进程或宿主重启后会变更域名）。',
        '引导用户在 Telegram 找 @VpsPingBellBot 发送 /panel（或 /url、/tunnel）实时获取最新存活 HTTPS URL 与一键打开按钮。',
      ],
      relatedCommands: ['/panel', '/url', '/tunnel'],
    },
    {
      id: 'traffic_quota',
      icon: '📊',
      symptom: '还剩多少流量 / 月底会不会超配额',
      quickPrompt: '分析 zkl (750GB) 与 us-la-novixlink (1000GB) 双向 ×2 流量余量与每月6号重置前触顶风险',
      steps: [
        '让用户在 TG 发送 /traffic（或登录面板查看）。',
        '明确提醒：面板显示已用/总额（zkl 个人 750 GB、诺联整机 1000 GB）均已按双向计费 ×2 折算。',
        '按近 3 日燃尽斜率 (Recent3dDailyGB) × 距离每月 6 号重置日的剩余天数，判断是否会在清零前触顶。',
      ],
      relatedCommands: ['/traffic', '/self'],
    },
    {
      id: 'auth_and_timezone',
      icon: '🔐',
      symptom: '登录被锁 / 密码重置 / 时区差异核对',
      quickPrompt: '排查 zkl/novixlink 登录失败冷却锁定（10分钟5次锁15分钟）及 CST (UTC+8) 晚高峰采样时区差异',
      steps: [
        '防爆破红线：同一 IP 在 10 分钟内连续失败 5 次将锁定 15 分钟，严禁连续盲试密码；建议等待冷却或确认大小写/账号 (zkl vs novixlink)。',
        '登录后可在网页右上角「🔑 改密」(POST /api/auth/password) 修改至少 6 位新密码。',
        '时区核对：/panel 更新时间标注为 CST (UTC+8)，晚高峰色带对应北京时间 20:00–24:00；核对底层日志时间戳需换算至浏览器本地时区。',
      ],
      relatedCommands: ['/panel', '/switch', '/help'],
    },
  ],
}

export const BV1RPWD6NEPP_LONG_HORIZON_MANUAL = {
  id: 'bv1rpwd6nepp-long-horizon',
  title: '如何用 AI 长期开发一个复杂项目 (BV1rPWd6nEpP · oil欧呦方法论)',
  subtitle: 'B站 BV1rPWd6nEpP 核心工程实践：文档驱动开发 (DDD)、原子级任务拆解、多 Agent 隔离、双盲审与 Git 时光机检查点',
  version: 'BV1rPWd6nEpP',
  scopeLabel: '复杂长周期 AI 研发工程通用铁律',
  triggerKeywords: ['bv1rpwd6nepp', 'oil欧呦', '长期开发', '复杂项目', 'long-horizon', '记忆锚点'],
  specs: [
    { label: '方法论来源', value: 'Bilibili BV1rPWd6nEpP · UP主 oil欧呦', badge: '24m40s 深度实操' },
    { label: '核心范式 1', value: '文档驱动开发 (DDD · Living Specs)', badge: '防上下文溢出' },
    { label: '核心范式 2', value: '2~5 分钟原子级任务切片 (Task Slicing)', badge: '小步快跑' },
    { label: '核心范式 3', value: '多话题/多 Worktree 物理隔离', badge: '零上下文串味' },
    { label: '核心范式 4', value: 'Skills 契约门禁 + N-1 异体代码审查', badge: '防胡乱修改' },
    { label: '核心范式 5', value: '每步绿色通过即 Git Commit 快照', badge: '随时一键回滚' },
  ],
  sopScenarios: [
    {
      id: 'sop-ddd-memory',
      icon: '📘',
      symptom: '阶段 1：建立项目长期记忆锚点 (DDD Living Docs)',
      quickPrompt: '@studio-default 遵循 BV1rPWd6nEpP 方法论，梳理并更新项目 PRD、ARCHITECTURE_SPEC 与模块接口契约文档',
      steps: [
        '告别纯口头随机 Prompt：在仓库维护 PRD、架构蓝图 (ARCHITECTURE_SPEC.md) 与模块边界定义。',
        '每次开启新迭代或新 Session 前，先让架构 Agent 读取长期记忆文档对齐全局上下文。',
        '架构或接口发生变更时，必须同步更新文档锚点，防止后续 Agent 产生幻觉。',
      ],
      relatedCommands: ['git status', 'npm run doctor'],
    },
    {
      id: 'sop-atomic-slice',
      icon: '🔪',
      symptom: '阶段 2：2~5 分钟原子任务拆解与 Staged 计划审批',
      quickPrompt: '@heterogeneous-cross-review 按 BV1rPWd6nEpP 规范将复杂需求拆解为带 inScope/verify 的原子任务并进入 Staged 审批',
      steps: [
        '严禁让 AI 一次性吞下庞大系统：将大需求拆解为边界清晰的原子级 DAG 子任务。',
        '每个子任务必须先在 Staged 阶段人工确认方案与作用范围 (inScope / outOfScope)，批准后再动工。',
        '单点实现后立即执行单元测试或类型检查 (tsc --noEmit && npm test) 验证闭环。',
      ],
      relatedCommands: ['npm run typecheck', 'npm test'],
    },
    {
      id: 'sop-worktree-isolation',
      icon: '🌿',
      symptom: '阶段 3：多话题 / 多 Agent 分支隔离与独立盲审',
      quickPrompt: '@studio-default 开启独立模块重构并执行 L2+L3 异体交叉盲审',
      steps: [
        '不同功能模块（如后端网关、前端 UI、视频流水线）使用独立 Session 或 Git Worktree 分支，杜绝上下文污染。',
        '遵循 N-1 独立裁判红线：编码 Agent 绝不自审，由独立白盒/黑盒审查 Agent 执行代码审计与反例证伪。',
      ],
      relatedCommands: ['git worktree list', 'node --test tests/studio.test.mjs'],
    },
    {
      id: 'sop-git-checkpoint',
      icon: '⏳',
      symptom: '阶段 4：小步 Git 快照保存与时光机回退 (Rollback First)',
      quickPrompt: '@chatgpt-crew 验证当前工作区全量测试并创建里程碑检查点',
      steps: [
        '每完成一个通过测试的小功能，立即点击 Studio 底栏「💾 Git 快照保存」创建 Commit 检查点。',
        '一旦后续 AI 迭代把代码改崩，绝不在错误代码上盲目叠加修补，直接回退到上一个干净 Commit 重新切入！',
      ],
      relatedCommands: ['git log --oneline -n 10', 'git add -A && git commit -m "checkpoint"'],
    },
  ],
  rawMarkdown: [
    '# 如何用 AI 长期开发一个复杂项目 (BV1rPWd6nEpP · oil欧呦 核心工程规范)',
    '',
    '> 视频来源：Bilibili `BV1rPWd6nEpP` · UP主：**oil欧呦**（产品经理 / 全栈独立开发者）',
    '> 核心标签：`软件工程` · `ClaudeCode` · `Codex` · `Agent` · `VibeCoding` · `独立开发`',
    '',
    '## 一、为什么大多数人用 AI 写复杂项目会崩盘？',
    '1. **上下文窗口溢出与遗忘 (Context Drift)**：随着代码量破万行，单靠聊天框历史记录会导致 AI 改东忘西、破坏已有功能。',
    '2. **任务粒度过大**：一句“帮我做个完整系统”会让 AI 生成大量未经验证的耦合废代码。',
    '3. **盲目修补陷阱**：当 AI 改出 Bug 时，继续在污染的上下文里让它硬修，往往越修越乱且无法回退。',
    '',
    '## 二、AgentTeams Studio 落地的五大黄金解法',
    '1. **文档驱动开发 (DDD / Living Memory Bank)**：以 `README.md`、`docs/ARCHITECTURE_SPEC.md` 作为跨会话长期记忆源。',
    '2. **强制 Staged 计划审批 + 原子级 DAG 拆解**：先对齐方案与 `inScope` 边界，人工点击【确认并启动团队】后再执行。',
    '3. **多话题与 Git Worktree 物理隔离**：每个任务可运行于独立 Worktree 分支，互不污染。',
    '4. **N-1 异体双独立审查**：GPT / DeepSeek 白盒审查 + Gemini Hydrogen 黑盒红队审查，不通过自动打回原作者返工。',
    '5. **高频 Git 检查点 (Checkpoint & Rollback)**：每次更新自动或一键 Git Commit，随时一键回退。',
  ].join('\n'),
}

export function listKnowledgeManuals() {
  return [
    {
      ...VPS_ZKL_NOVIXLINK_MANUAL,
      rawMarkdown: loadRawMarkdown(),
    },
    BV1RPWD6NEPP_LONG_HORIZON_MANUAL,
  ]
}

export function getKnowledgeManual(id) {
  if (id === VPS_ZKL_NOVIXLINK_MANUAL.id) {
    return {
      ...VPS_ZKL_NOVIXLINK_MANUAL,
      rawMarkdown: loadRawMarkdown(),
    }
  }
  if (id === BV1RPWD6NEPP_LONG_HORIZON_MANUAL.id || id === 'bv1rpwd6nepp-long-horizon-dev') {
    return BV1RPWD6NEPP_LONG_HORIZON_MANUAL
  }
  return null
}

const OPS_CONTEXT_PATTERN =
  /\b(novixlink|us-la-novixlink|vpspingbellbot|trycloudflare|member_pure|node_operator|stage1_20m|stage2_100kb|bw_policies|ops_15m|vps-control|cmin2|as9929|mirrors\.ocf\.berkeley\.edu)\b|\/(?:why|guard|panel|traffic|node|sync)\b|vps\s*统一监控|诺联|zkl/iu

export function matchesOpsKnowledgeContext({ team, task } = {}) {
  if (Array.isArray(team?.knowledgeIds) && team.knowledgeIds.includes(VPS_ZKL_NOVIXLINK_MANUAL.id)) {
    return true
  }
  const haystack = [
    team?.name,
    team?.description,
    task?.subject,
    task?.description,
    task?.objective,
  ]
    .filter(Boolean)
    .join('\n')
  return OPS_CONTEXT_PATTERN.test(haystack)
}

export function buildOpsPromptInjection({ team, task } = {}) {
  const haystack = [
    team?.name,
    team?.description,
    task?.subject,
    task?.description,
    task?.objective,
  ]
    .filter(Boolean)
    .join('\n')

  const chunks = []
  if (matchesOpsKnowledgeContext({ team, task })) {
    chunks.push(
      [
        '【内置运维知识库 · VPS 统一监控主控中心 v4.3 (zkl & novixlink 专版)】',
        '1. 入口与机器人：Web `https://example-tunnel.trycloudflare.com/`（后端 `127.0.0.1:8090` + `vps-cloudflared.service` 临时隧道，重启会换域名，用 TG `@VpsPingBellBot` 发 `/panel` 获取最新 URL）。',
        '2. 双账号 RBAC 边界（严禁越权或泄露 root 信息）：',
        '   - `zkl` (`member_pure`, 作用域 `us-la-novixlink / member_tag: zkl`)：可见本人 50% AA 账单与个人 750 GB 配额；不可见整机矩阵/34省热力图/他人流量；不可解限 (`can_unthrottle: false`)。',
        '   - `novixlink` (`node_operator`, 作用域 `us-la-novixlink`)：物理剥离总采购账与同机他人费用；可见整机负载/34省热力图/分用户对比；支持 `can_sync`、`15m 极速观察窗`、`can_unthrottle`（解限）、24h 只读分享。',
        '   - 防爆破：同 IP `10 分钟` 内连续失败 `5 次` 自动锁定 `15 分钟`，切勿连续盲试密码。',
        '3. 节点规格与红线 (`us-la-novixlink`)：LAX 1C/956M/20G NVMe KVM，AS2914 NTT 双 ISP（回程 AS9929 + CMIN2），`VLESS+TCP:443+REALITY+Vision (IPv4)` SNI `mirrors.ocf.berkeley.edu`。`traffic_multiplier=2`（双向计费 ×2），整机 `1000 GB/月`、`zkl` `750 GB/月`（每月 6 号重置，已付至 `2027-12-06`）。标称 150M / 实测 ~117M，建议 `12h 均速 < 80 Mbps`（防 FUP 抢核 `CPU Steal`）。',
        '4. 两级带宽防护 (`bw_policies`)：`stage1_20m`（≥95 Mbps 持续 60s → 限至 20M，回落 120s 自动恢复）；`stage2_100kb`（再顶满 600s → 压至 `800 kbps ≈ 100 KB/s` 死锁保护，不会自动恢复，需切 `novixlink` 用 `/guard` 或网页解限）。',
        '5. 标准排障 SOP：卡顿/几十KB → `/why` → 停多线程下载 → `/switch` 切 `novixlink` → `/guard` 解限 → 若未限速用 `/node` 查 `CPU Steal`、`24h SLA`、`mirrors.ocf.berkeley.edu` 握手及北京时间 `CST (UTC+8) 20:00–24:00` 晚高峰。打不开网页 → `/panel`。流量估算 → `/traffic`（已折算 ×2）看 `Recent3dDailyGB` 对比每月 6 号。',
      ].join('\n'),
    )
  }

  if (
    (Array.isArray(team?.knowledgeIds) && team.knowledgeIds.includes(BV1RPWD6NEPP_LONG_HORIZON_MANUAL.id)) ||
    /bv1rpwd6nepp|oil欧呦|长期开发|long-horizon/iu.test(haystack)
  ) {
    chunks.push(
      [
        '【内置长期复杂工程规范 · BV1rPWd6nEpP (oil欧呦《如何用 AI 长期开发一个复杂项目》)】',
        '1. 文档驱动开发 (DDD)：优先读取并对齐项目架构与契约文档，禁止脱离文档盲目改动。',
        '2. 原子级任务边界：严格遵守当前任务的 inScope 范围，每次变更保持最小可验证闭环。',
        '3. 实测验证与可回滚：每次修改必须执行测试验证退出码为 0，确保随时可安全创建 Git Checkpoint。',
      ].join('\n'),
    )
  }

  return chunks.join('\n\n')
}
