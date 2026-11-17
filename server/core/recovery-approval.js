import { createHash, randomUUID } from 'node:crypto';
const grants = new WeakMap();
const bindingOf = (team) => createHash('sha256').update(JSON.stringify(team)).digest('hex');
/** Await outside team locks; the Host owns policy, audit and the actual decision. */
export async function requestRecoveryGrant(service, agent, team, toolName, reason, signal, taskId) {
    signal?.throwIfAborted();
    if (service === undefined)
        throw new Error('host approval service is unavailable; recovery requires a trusted grant');
    if (reason.trim() === '')
        throw new Error('a non-empty reason is required for recovery');
    const binding = bindingOf(team);
    const callId = randomUUID();
    const outcome = await service.request({ agent, toolName, callId, reason: `${reason.trim()}\nRecovery target: ${team.id}${taskId === undefined ? '' : `/${taskId}`} (state ${binding}).`, signal });
    signal?.throwIfAborted();
    if (outcome !== 'allowed-once')
        throw new Error(`recovery not authorized (host approval returned "${outcome}"); no change applied`);
    const grant = Object.freeze({});
    grants.set(grant, { binding, toolName, taskId, reason: reason.trim(), approvedAt: Date.now(), evidenceId: `host-approval:${agent.id}:${toolName}:${callId}`, authorizedBy: agent.id });
    return grant;
}
/** Consume exactly once, even on stale-target rejection. Never persist the capability. */
export function consumeRecoveryGrant(grant, team, toolName, taskId) {
    if (typeof grant !== 'object' || grant === null)
        return undefined;
    const receipt = grants.get(grant);
    grants.delete(grant);
    if (receipt === undefined || receipt.toolName !== toolName || receipt.taskId !== taskId || receipt.binding !== bindingOf(team) || Date.now() - receipt.approvedAt > 300000)
        return undefined;
    return receipt;
}
