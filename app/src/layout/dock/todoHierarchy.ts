export const getTodoReorderState = (sourceParentId?: string, targetParentId?: string) => {
    const sourceParent = sourceParentId || "";
    const targetParent = targetParentId || "";
    const promoted = Boolean(sourceParent && !targetParent);
    return {
        allowed: sourceParent === targetParent || promoted,
        promoted,
        parentId: targetParent || undefined,
    };
};
