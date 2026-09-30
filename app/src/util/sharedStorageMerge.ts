const asObject = (value: any) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const mergeVersionMap = (left: Record<string, number> = {}, right: Record<string, number> = {}) => {
    const result: Record<string, number> = {};
    [...Object.entries(left || {}), ...Object.entries(right || {})].forEach(([key, value]) => {
        result[key] = Math.max(result[key] || 0, Number(value) || 0);
    });
    return result;
};

export const mergeKnowledgeStorage = (leftValue: any = {}, rightValue: any = {}) => {
    const left = asObject(leftValue);
    const right = asObject(rightValue);
    const updatedAt = mergeVersionMap(left.updatedAt, right.updatedAt);
    const removedAt = mergeVersionMap(left.removedAt, right.removedAt);
    const usedAt = mergeVersionMap(left.usedAt, right.usedAt);
    const docsUsedAt = mergeVersionMap(left.docsUsedAt, right.docsUsedAt);
    const explicitNotebooks = new Set<string>([
        ...(Array.isArray(left.notebooks) ? left.notebooks : []),
        ...(Array.isArray(right.notebooks) ? right.notebooks : []),
    ]);
    const ids = new Set<string>([...explicitNotebooks, ...Object.keys(updatedAt), ...Object.keys(removedAt)]);
    const notebooks = Array.from(ids).filter((id) => {
        const updated = updatedAt[id] || 0;
        const removed = removedAt[id] || 0;
        return id && (updated > removed || updated === 0 && removed === 0 && explicitNotebooks.has(id));
    });
    return {notebooks, updatedAt, removedAt, usedAt, docsUsedAt};
};

export const mergeTodoStorage = (leftValue: any = {}, rightValue: any = {}) => {
    const left = asObject(leftValue);
    const right = asObject(rightValue);
    const itemMap = new Map<string, any>();
    const getItemVersion = (item: any) => Math.max(
        Number(item?.updatedAt) || 0,
        Number(item?.completedAt) || 0,
        Number(item?.deletedAt) || 0,
        Number(item?.purgedAt) || 0,
        Number(item?.orderUpdatedAt) || 0,
    );
    [
        ...(Array.isArray(left.items) ? left.items : []),
        ...(Array.isArray(right.items) ? right.items : []),
    ].forEach((item) => {
        if (!item?.id) {
            return;
        }
        const existing = itemMap.get(item.id);
        if (!existing || getItemVersion(item) >= getItemVersion(existing)) {
            itemMap.set(item.id, item);
        }
    });
    const categoryUpdatedAt = mergeVersionMap(left.categoryUpdatedAt, right.categoryUpdatedAt);
    const deletedCategories = mergeVersionMap(left.deletedCategories, right.deletedCategories);
    const explicitCategories = new Set<string>([
        ...(Array.isArray(left.categories) ? left.categories : []),
        ...(Array.isArray(right.categories) ? right.categories : []),
    ]);
    const categories = Array.from(new Set<string>([
        ...explicitCategories,
        ...Object.keys(categoryUpdatedAt),
        ...Object.keys(deletedCategories),
    ])).filter(category => {
        const updated = categoryUpdatedAt[category] || 0;
        const removed = deletedCategories[category] || 0;
        return category && (updated > removed || updated === 0 && removed === 0 && explicitCategories.has(category));
    });
    const projectUpdatedAt = mergeVersionMap(left.projectUpdatedAt, right.projectUpdatedAt);
    const deletedProjects = mergeVersionMap(left.deletedProjects, right.deletedProjects);
    const explicitProjects = new Set<string>([
        ...(Array.isArray(left.projects) ? left.projects : []),
        ...(Array.isArray(right.projects) ? right.projects : []),
    ]);
    const projects = Array.from(new Set<string>([
        ...explicitProjects,
        ...Object.keys(projectUpdatedAt),
        ...Object.keys(deletedProjects),
    ])).filter(project => {
        const updated = projectUpdatedAt[project] || 0;
        const removed = deletedProjects[project] || 0;
        return project && (updated > removed || updated === 0 && removed === 0 && explicitProjects.has(project));
    });
    const calendarEntryMap = new Map<string, any>();
    [
        ...(Array.isArray(left.calendarEntries) ? left.calendarEntries : []),
        ...(Array.isArray(right.calendarEntries) ? right.calendarEntries : []),
    ].forEach((entry) => {
        if (!entry?.id) {
            return;
        }
        const existing = calendarEntryMap.get(entry.id);
        const version = Math.max(Number(entry.updatedAt) || 0, Number(entry.deletedAt) || 0,
            Number(entry.createdAt) || 0);
        const existingVersion = existing ? Math.max(Number(existing.updatedAt) || 0,
            Number(existing.deletedAt) || 0, Number(existing.createdAt) || 0) : -1;
        if (!existing || version >= existingVersion) {
            calendarEntryMap.set(entry.id, entry);
        }
    });
    return {
        ...left,
        ...right,
        items: Array.from(itemMap.values()),
        categories,
        categoryUpdatedAt,
        deletedCategories,
        projects,
        projectUpdatedAt,
        deletedProjects,
        projectLabels: {...(left.projectLabels || {}), ...(right.projectLabels || {})},
        projectLabelOverrides: {...(left.projectLabelOverrides || {}), ...(right.projectLabelOverrides || {})},
        projectCodexIDs: {...(left.projectCodexIDs || {}), ...(right.projectCodexIDs || {})},
        calendarEntries: Array.from(calendarEntryMap.values()),
    };
};
