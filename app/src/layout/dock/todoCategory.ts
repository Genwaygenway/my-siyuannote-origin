export const TODO_AI_PARENT_CATEGORY = "AI 开发";
export const TODO_AI_FEATURE_CATEGORY = "AI 功能开发";
export const TODO_AI_OPTIMIZATION_CATEGORY = "AI 优化与修复";
export const TODO_AI_TEST_CATEGORY = "AI 测试";
export const TODO_AI_DOCUMENTATION_CATEGORY = "AI 文档与配置";

export interface ITodoCategoryHierarchyItem {
    category: string;
    parentCategory?: string;
    hasChildren: boolean;
}

const isAISubcategory = (category: string) =>
    category !== TODO_AI_PARENT_CATEGORY && category.startsWith("AI");

export const isTodoAIProjectCategory = (category: string) =>
    category === TODO_AI_PARENT_CATEGORY || isAISubcategory(category);

export const getTodoCategoryHierarchy = (categories: string[]): ITodoCategoryHierarchyItem[] => {
    const hasAIParent = categories.includes(TODO_AI_PARENT_CATEGORY);
    const aiChildren = hasAIParent ? categories.filter(isAISubcategory) : [];
    const result: ITodoCategoryHierarchyItem[] = [];
    categories.forEach((category) => {
        if (hasAIParent && isAISubcategory(category)) {
            return;
        }
        result.push({
            category,
            hasChildren: category === TODO_AI_PARENT_CATEGORY && aiChildren.length > 0,
        });
        if (category === TODO_AI_PARENT_CATEGORY) {
            aiChildren.forEach((childCategory) => {
                result.push({
                    category: childCategory,
                    parentCategory: TODO_AI_PARENT_CATEGORY,
                    hasChildren: false,
                });
            });
        }
    });
    return result;
};

export const isTodoCategoryMatch = (itemCategories: string | string[], filterCategory: string, categories: string[]) => {
    const values = Array.isArray(itemCategories) ? itemCategories : [itemCategories];
    if (filterCategory === "") {
        return values.length === 0 || values.includes("");
    }
    if (values.includes(filterCategory)) {
        return true;
    }
    return filterCategory === TODO_AI_PARENT_CATEGORY && categories.includes(TODO_AI_PARENT_CATEGORY) &&
        values.some(isAISubcategory);
};
