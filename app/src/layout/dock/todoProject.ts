import {
    TODO_AI_DOCUMENTATION_CATEGORY,
    TODO_AI_FEATURE_CATEGORY,
    TODO_AI_OPTIMIZATION_CATEGORY,
    TODO_AI_PARENT_CATEGORY,
    TODO_AI_TEST_CATEGORY,
} from "./todoCategory";

export const TODO_SIYUAN_PARENT_PROJECT = "siyuan-note";

export interface ITodoProjectHierarchyItem {
    project: string;
    parentProject?: string;
    hasChildren: boolean;
}

export interface ITodoCodexProject {
    id: string;
    name: string;
    rootNames: string[];
}

export interface ITodoCodexProjectSync {
    projectLabels: Record<string, string>;
    projectCodexIDs: Record<string, string>;
}

export const isTodoSiyuanProject = (project: string) => /^siyuan(?:-|$)/i.test(project.trim());

const getSiyuanParentProject = (projects: string[]) =>
    projects.find(project => project.toLowerCase() === TODO_SIYUAN_PARENT_PROJECT) || "";

export const getTodoProjectParent = (project: string, projects: string[]) => {
    const normalizedProject = project.trim();
    if (normalizedProject.toLowerCase() === TODO_SIYUAN_PARENT_PROJECT || !isTodoSiyuanProject(normalizedProject)) {
        return undefined;
    }
    return getSiyuanParentProject(projects) || undefined;
};

export const getTodoProjectHierarchy = (projects: string[]): ITodoProjectHierarchyItem[] => {
    const uniqueProjects = projects.map(project => project.trim())
        .filter((project, index, list) => project && list.indexOf(project) === index);
    const childrenByParent = new Map<string, string[]>();
    const roots: string[] = [];
    uniqueProjects.forEach((project) => {
        const parentProject = getTodoProjectParent(project, uniqueProjects);
        if (parentProject) {
            const children = childrenByParent.get(parentProject) || [];
            children.push(project);
            childrenByParent.set(parentProject, children);
            return;
        }
        roots.push(project);
    });
    return roots.flatMap((project) => {
        const children = childrenByParent.get(project) || [];
        return [
            {project, hasChildren: children.length > 0},
            ...children.map(childProject => ({
                project: childProject,
                parentProject: project,
                hasChildren: false,
            })),
        ];
    });
};

export const isTodoProjectMatch = (itemProject: string, filterProject: string, projects: string[]) => {
    if (itemProject === filterProject) {
        return true;
    }
    return getTodoProjectHierarchy(projects).some(project =>
        project.project === itemProject && project.parentProject === filterProject);
};

const normalizeTodoCodexProjectName = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s_-]/g, "");

export const getTodoCodexProjectSync = (projects: string[], projectLabels: Record<string, string>,
                                         projectCodexIDs: Record<string, string>, codexProjects: ITodoCodexProject[]): ITodoCodexProjectSync => {
    const nextProjectLabels = {...projectLabels};
    const nextProjectCodexIDs = {...projectCodexIDs};
    const uniqueProjects = projects.map(project => project.trim()).filter((project, index, list) =>
        project && list.indexOf(project) === index);
    uniqueProjects.forEach((project) => {
        const normalizedProject = normalizeTodoCodexProjectName(project);
        const currentLabel = projectLabels[project] || "";
        const normalizedLabel = normalizeTodoCodexProjectName(currentLabel);
        const codexProject = codexProjects.find(candidate => candidate.id === projectCodexIDs[project]) ||
            codexProjects.find(candidate => candidate.rootNames.some(rootName =>
                normalizeTodoCodexProjectName(rootName) === normalizedProject)) ||
            codexProjects.find(candidate => normalizeTodoCodexProjectName(candidate.name) === normalizedProject ||
                normalizedLabel && normalizeTodoCodexProjectName(candidate.name) === normalizedLabel) ||
            codexProjects.find(candidate => normalizedProject.length >= 5 &&
                normalizeTodoCodexProjectName(candidate.name).startsWith(normalizedProject));
        if (!codexProject) {
            return;
        }
        nextProjectLabels[project] = codexProject.name;
        nextProjectCodexIDs[project] = codexProject.id;
    });
    return {projectLabels: nextProjectLabels, projectCodexIDs: nextProjectCodexIDs};
};

export const isTodoAIProject = (project: string, knownAIProjects: Iterable<string> = []) => {
    const normalizedProject = project.trim();
    if (!normalizedProject) {
        return false;
    }
    if (isTodoSiyuanProject(normalizedProject)) {
        return true;
    }
    return [...knownAIProjects].some(knownProject =>
        knownProject.trim().toLowerCase() === normalizedProject.toLowerCase());
};

export const getTodoAIProjectCategory = (project: string, title: string, knownAIProjects: Iterable<string> = []) => {
    if (!isTodoAIProject(project, knownAIProjects)) {
        return "";
    }
    const marker = title.match(/\[([^\]]+)]/)?.[1].toLowerCase() || "";
    if (/文档|配置|docs?|documentation|config/.test(marker)) {
        return TODO_AI_DOCUMENTATION_CATEGORY;
    }
    if (/开发|功能|develop|feature/.test(marker)) {
        return TODO_AI_FEATURE_CATEGORY;
    }
    if (/优化|修复|optimi[sz]e|fix/.test(marker)) {
        return TODO_AI_OPTIMIZATION_CATEGORY;
    }
    if (/测试|验证|test|verify/.test(marker)) {
        return TODO_AI_TEST_CATEGORY;
    }
    return TODO_AI_PARENT_CATEGORY;
};
