---
name: agent-teams-cleanup
description: 清理或归档 AgentTeams 遗留团队：定位工作区 .agent-teams 目录（含 DSH 与 Antigravity 多工作区），先做只读盘点与 zip 快照备份，再按 archive/<teamId> 语义通过 agent_teams_delete / agent_teams_delete_team_history 或安全目录归档处理，最后目录级核对。Use when 用户要求清理 agent teams、归档历史团队、检查 .agent-teams 残留目录或清理已归档历史。
---

# AgentTeams 团队清场与归档（Antigravity 版）

团队真实状态落在各个工作区的 `<workspace>/.agent-teams/` 目录中：
- 活跃团队为独立子目录 `<teamId>/`（内含 `team.json`、`inbox/<member>.jsonl`）；
- 归档团队在 `.agent-teams/archive/<teamId>-<ts>/`（及索引与 `.purge-log.jsonl`）；
- 根目录下的 `retired-members.json`、`profiles.json`、`team-guard.jsonl` 为非团队系统文件，清理时**必须保留**。

## 标准操作步骤

1. **先判口径，再动手**
   - 明确区分「**归档**（保留历史可查，移入 `archive/`）」还是「**永久删除**（连历史一起销毁）」；两者绝不能混淆。没有得到明确删除同意前，严禁执行任何破坏性 `Remove-Item`。

2. **优先尝试内置 MCP 工具盘点与归档**
   - 调用 `agent_teams_status`（传入目标 `workspace`）查看当前工作区的所有 `active_teams` 与 `archived_teams`。
   - 对当前工作区的活跃团队，优先使用 `agent_teams_delete` 规范归档；对需要销毁历史的**已归档**团队，仅在明确确认后调用 `agent_teams_delete_team_history`（传 `confirm: "<team_id>"` 或 `true`），自动生成不可篡改的 `.purge-log.jsonl` 审计日志。

3. **跨工作区全面盘点**
   当用户需要清理跨工作区（包括原 DSH 工作区与 Antigravity 工作区）的历史 `.agent-teams` 残留时，执行只读盘点：

   ```powershell
   $roots = @(
     "$HOME\.gemini\antigravity\scratch",
     "$HOME\Documents\deepseek-harness\default-workspace",
     "$HOME\Documents\deepseek-harness\target-workspace"
   )
   foreach ($r in $roots) {
     if (Test-Path $r) {
       Get-ChildItem $r -Directory -Recurse -Depth 2 -Filter ".agent-teams" -Force -ErrorAction SilentlyContinue |
         Select-Object FullName, LastWriteTime
     }
   }
   ```

4. **全量盘点前必须先打 ZIP 备份（可恢复防线）**
   涉及批量移动或清理多工作区磁盘目录时，先在对应工作区生成带时间戳的备份压缩包并校验证件数：

   ```powershell
   $ws    = "<workspace>"
   $state = Join-Path $ws ".agent-teams"
   $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
   $zip   = Join-Path $ws "_agent-teams-backup-$stamp.zip"
   Compress-Archive -Path (Join-Path $state "*") -DestinationPath $zip -Force
   Add-Type -AssemblyName System.IO.Compression.FileSystem
   [IO.Compression.ZipFile]::OpenRead($zip).Entries | Select-Object -ExpandProperty FullName
   ```

5. **规范归档目录（禁止 nested archive）**
   - 把活跃团队目录移入 `<state>/archive/<teamId>-<ts>/`，不要覆盖已有同名归档，也不要把 `archive` 嵌套进 `archive/archive`。
   - 保护 `retired-members.json`、`profiles.json` 和 `team-guard.jsonl` 不被误删。

6. **目录级最终核验**
   - 检查每个 `.agent-teams` 根下只剩 `archive/` 和非团队元数据文件。
   - 在回复中给出备份 `.zip` 完整路径（如有）、实测目录枚举统计，并提示用户可在右侧「智能体团队」面板点击刷新以同步视图。
