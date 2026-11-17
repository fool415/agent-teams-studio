// Migrated unchanged from the standalone guard bundle; local configuration.
export default {
  "enabled": true,
  "boundary": {
    "enabled": true,
    "promptOrder": 118,
    "sections": [
      "Autonomy scope (AgentTeams): pursue only the sub-goals the user named. Do not widen the goal, add adjacent work, or start a new cycle of work after a reasonable deliverable exists. Every extra round must be justified by a named, still-open requirement.",
      "Stop conditions (any one is sufficient to end the team's run): the user goal is satisfied and reported; a required gate passed; the remaining work needs user input, a credential, or a decision only the user can make; the turn budget is exhausted. When a stop condition holds, report the result instead of starting another review or repair cycle."
    ]
  },
  "tripwire": {
    "enabled": true,
    "identicalCallLimit": 3,
    "escalateAfterBlocks": 2,
    "reasoningRepeatRatio": 0.82,
    "reasoningWindowChars": 4000,
    "reasoningSubstrLen": 48,
    "reasoningMinBlocks": 40,
    "reasoningMaxChars": 120000,
    "exemptTools": [
      "agent_teams_status",
      "agent_teams_claim_task",
      "read",
      "grep",
      "glob"
    ]
  },
  "budget": {
    "enabled": true,
    "scope": "team",
    "teamStateDir": ".agent-teams",
    "teamCacheMs": 2000,
    "maxStepsPerTurn": 240,
    "maxToolCallsPerTurn": 400,
    "maxTurnSeconds": 1800
  },
  "auditLog": ".agent-teams/team-guard.jsonl"
};
