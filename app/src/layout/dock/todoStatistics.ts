import {getTodoCategoryHierarchy} from "./todoCategory";
import {getMondayBasedWeekRange} from "./todoDate";
import {getTodoProjectHierarchy} from "./todoProject";

export interface ITodoStatisticsDateItem {
    completed: boolean;
    completedAt?: number;
    due: string;
    updatedAt: number;
}

export interface ITodoStatisticsCategory<T> {
    category: string;
    total: number;
    completed: number;
    inProgress: number;
    completionRate: number;
    completedItems: T[];
    itemIds?: string[];
    completedItemIds?: string[];
    parentCategory?: string;
    hasChildren: boolean;
}

export type TTodoStatisticsCategoryInput<T> = Omit<ITodoStatisticsCategory<T>, "parentCategory" | "hasChildren">;

export type TTodoStatisticsDatePreset = "all" | "week" | "lastWeek" | "custom";

type TTodoStatisticsExpansionItem = Pick<ITodoStatisticsCategory<unknown>, "category" | "hasChildren">;

export const isTodoStatisticsRowExpanded = (
    item: TTodoStatisticsExpansionItem, expandedRows: ReadonlySet<string>, expandedGroups: ReadonlySet<string>,
) => item.hasChildren ? expandedGroups.has(item.category) : expandedRows.has(item.category);

export const areTodoStatisticsRowsExpanded = (
    items: TTodoStatisticsExpansionItem[], expandedRows: ReadonlySet<string>, expandedGroups: ReadonlySet<string>,
) => items.length > 0 && items.every(item => isTodoStatisticsRowExpanded(item, expandedRows, expandedGroups));

const formatLocalDate = (date: Date) => {
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
};

export const getTodoStatisticsDate = (item: ITodoStatisticsDateItem) => {
    if (!item.completed) {
        return item.due;
    }
    return formatLocalDate(new Date(item.completedAt || item.updatedAt));
};

export const getTodoStatisticsPresetRange = (preset: Exclude<TTodoStatisticsDatePreset, "custom">, today: string) => {
    if (preset === "week" || preset === "lastWeek") {
        return getMondayBasedWeekRange(today, preset === "lastWeek" ? -1 : 0);
    }
    return {start: "", end: ""};
};

export const isTodoWithinStatisticsRange = (item: ITodoStatisticsDateItem, start: string, end: string) => {
    if (!start && !end) {
        return true;
    }
    const date = getTodoStatisticsDate(item);
    if (!date) {
        return false;
    }
    return (!start || date >= start) && (!end || date <= end);
};

interface ITodoStatisticsHierarchyItem {
    category: string;
    parentCategory?: string;
    hasChildren: boolean;
}

const getTodoStatisticsHierarchy = <T>(
    statistics: TTodoStatisticsCategoryInput<T>[], hierarchy: ITodoStatisticsHierarchyItem[],
): ITodoStatisticsCategory<T>[] => {
    const statisticsByCategory = new Map(statistics.map(category => [category.category, category]));
    return hierarchy.flatMap<ITodoStatisticsCategory<T>>((categoryItem) => {
        const directStatistics = statisticsByCategory.get(categoryItem.category);
        if (!categoryItem.hasChildren) {
            if (!directStatistics) {
                return [];
            }
            return [{
                ...directStatistics,
                ...(categoryItem.parentCategory ? {parentCategory: categoryItem.parentCategory} : {}),
                hasChildren: false,
            }];
        }
        const childStatistics = hierarchy.filter(item => item.parentCategory === categoryItem.category)
            .map(item => statisticsByCategory.get(item.category)).filter(Boolean) as TTodoStatisticsCategoryInput<T>[];
        const aggregatedStatistics = [directStatistics, ...childStatistics]
            .filter(Boolean) as TTodoStatisticsCategoryInput<T>[];
        if (aggregatedStatistics.length === 0) {
            return [];
        }
        const hasItemIds = aggregatedStatistics.every(category => Array.isArray(category.itemIds));
        const itemIds = hasItemIds ? [...new Set(aggregatedStatistics.flatMap(category => category.itemIds || []))] : undefined;
        const completedItemIds = hasItemIds
            ? [...new Set(aggregatedStatistics.flatMap(category => category.completedItemIds || []))] : undefined;
        const total = itemIds ? itemIds.length : aggregatedStatistics.reduce((sum, category) => sum + category.total, 0);
        const completed = completedItemIds
            ? completedItemIds.length : aggregatedStatistics.reduce((sum, category) => sum + category.completed, 0);
        const completedItemsById = new Map<string, T>();
        aggregatedStatistics.forEach((category) => {
            category.completedItemIds?.forEach((itemId, index) => {
                if (!completedItemsById.has(itemId)) {
                    completedItemsById.set(itemId, category.completedItems[index]);
                }
            });
        });
        const completedItems = completedItemIds
            ? completedItemIds.map(itemId => completedItemsById.get(itemId)).filter(Boolean) as T[]
            : aggregatedStatistics.flatMap(category => category.completedItems);
        return [{
            category: categoryItem.category,
            total,
            completed,
            inProgress: total - completed,
            completionRate: Math.round(completed / total * 100),
            completedItems,
            ...(itemIds ? {itemIds} : {}),
            ...(completedItemIds ? {completedItemIds} : {}),
            hasChildren: true,
        }];
    });
};

export const getTodoStatisticsCategoryHierarchy = <T>(
    statistics: TTodoStatisticsCategoryInput<T>[], categories: string[],
) => getTodoStatisticsHierarchy(statistics, getTodoCategoryHierarchy(categories));

export const getTodoStatisticsProjectHierarchy = <T>(
    statistics: TTodoStatisticsCategoryInput<T>[], projects: string[],
) => {
    const unassigned = statistics.filter(project => project.category === "").map(project => ({
        ...project,
        hasChildren: false,
    }));
    const assigned = statistics.filter(project => project.category !== "");
    return [...unassigned, ...getTodoStatisticsHierarchy(assigned, getTodoProjectHierarchy(projects).map(project => ({
        category: project.project,
        ...(project.parentProject ? {parentCategory: project.parentProject} : {}),
        hasChildren: project.hasChildren,
    })))];
};
