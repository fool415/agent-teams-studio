import { judgeConflictFor } from "./quality-gates.js";
/** Conservative evidence summary, not an attestation of what a model actually inspected. */
export function qualityBadgeStates(tasks, staleIds = new Set()) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const visiting = new Set(), visited = new Set();
    const acyclic = (id) => {
        if (visiting.has(id))
            return false;
        if (visited.has(id))
            return true;
        const task = byId.get(id);
        if (task === undefined)
            return false;
        visiting.add(id);
        if (!task.dependencies.every(acyclic))
            return false;
        visiting.delete(id);
        visited.add(id);
        return true;
    };
    const l0 = tasks.length > 0 && byId.size === tasks.length && tasks.every(task => task.id.trim() !== '' && acyclic(task.id));
    const current = (task) => task.status === 'completed' && !staleIds.has(task.id);
    const acceptance = (task) => (task.acceptance?.length ?? 0) > 0
        && task.acceptance.every(criterion => task.acceptanceResults?.some(result => result.criterion === criterion && result.status === 'passed') === true)
        && task.acceptanceResults?.every(result => result.status === 'passed') === true;
    const mechanical = (task) => current(task) && acceptance(task) && (task.verify?.length ?? 0) > 0
        && task.verify.every(command => task.commandsRun?.some(result => result.command === command && result.status === 'passed' && result.exitCode === 0) === true)
        && task.commandsRun?.every(result => result.status === 'passed' && result.exitCode === 0) === true;
    const writes = tasks.filter(task => task.kind === 'implementation' || task.kind === 'repair');
    const reviewsOf = (target) => tasks.filter(task => task.kind === 'review' && task.reviewedTaskId === target.id
        && current(task) && task.verdict === 'pass' && acceptance(task) && (task.assignee?.trim() ?? '') !== ''
        && target.assignee !== undefined && judgeConflictFor(tasks, task, task.assignee) === undefined);
    const l1 = l0 && writes.length > 0 && writes.every(mechanical);
    const l2 = l1 && writes.every(task => reviewsOf(task).length > 0);
    // The review contract judges implementation/repair, not another review or verification.
    const l3 = l2 && writes.every(write => new Set(reviewsOf(write).map(review => review.assignee)).size >= 2
        && tasks.some(verification => verification.kind === 'verification'
            && verification.coverageOf?.includes(write.id) && mechanical(verification)
            && (verification.assignee?.trim() ?? '') !== '' && verification.assignee !== write.assignee));
    return [
        { level: 'L0', passed: l0, reason: '非空任务图：任务 ID 唯一、依赖存在且无环；不代表全部 Schema 已审计' },
        { level: 'L1', passed: l1, reason: '全部实现/修复：验收逐项 passed，声明命令均 exitCode=0' },
        { level: 'L2', passed: l2, reason: '全部实现/修复：非作者独立 review=pass，验收通过且证据未过期' },
        { level: 'L3', passed: l3, reason: '独立 verification 命令及验收通过，同一产物至少两名非作者 review=pass；不从模型品牌推断审查方法' },
    ];
}
