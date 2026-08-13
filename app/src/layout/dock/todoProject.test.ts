import {describe, it} from "node:test";
import * as assert from "node:assert/strict";
import {
    getTodoCodexProjectSync,
    getTodoAIProjectCategory,
    getTodoProjectHierarchy,
    isTodoProjectMatch,
    TODO_SIYUAN_PARENT_PROJECT,
} from "./todoProject";

describe("getTodoProjectHierarchy", () => {
    it("将思源子项目挂在 siyuan-note 父项目下", () => {
        assert.deepEqual(getTodoProjectHierarchy([
            "material-platform",
            TODO_SIYUAN_PARENT_PROJECT,
            "siyuan-calendar-plus",
            "siyuan-todo-plus",
        ]), [
            {project: "material-platform", hasChildren: false},
            {project: TODO_SIYUAN_PARENT_PROJECT, hasChildren: true},
            {project: "siyuan-calendar-plus", parentProject: TODO_SIYUAN_PARENT_PROJECT, hasChildren: false},
            {project: "siyuan-todo-plus", parentProject: TODO_SIYUAN_PARENT_PROJECT, hasChildren: false},
        ]);
    });
});

describe("isTodoProjectMatch", () => {
    it("父项目筛选包含其思源子项目", () => {
        const projects = [TODO_SIYUAN_PARENT_PROJECT, "siyuan-todo-plus"];
        assert.equal(isTodoProjectMatch("siyuan-todo-plus", TODO_SIYUAN_PARENT_PROJECT, projects), true);
        assert.equal(isTodoProjectMatch(TODO_SIYUAN_PARENT_PROJECT, "siyuan-todo-plus", projects), false);
    });
});

describe("getTodoCodexProjectSync", () => {
    it("按 Codex 工作目录和已关联 ID 同步项目标题", () => {
        const codexProjects = [{
            id: "siyuan",
            name: "思源笔记",
            rootNames: ["siyuan-note"],
        }, {
            id: "meta-horizon",
            name: "MetaHorizon 交付文档专用",
            rootNames: ["VersperAIPrompt"],
        }];
        assert.deepEqual(getTodoCodexProjectSync(["siyuan-note", "Meta Horizon"], {}, {}, codexProjects), {
            projectLabels: {
                "siyuan-note": "思源笔记",
                "Meta Horizon": "MetaHorizon 交付文档专用",
            },
            projectCodexIDs: {
                "siyuan-note": "siyuan",
                "Meta Horizon": "meta-horizon",
            },
        });
        assert.deepEqual(getTodoCodexProjectSync(["siyuan-note"], {
            "siyuan-note": "旧标题",
        }, {
            "siyuan-note": "siyuan",
        }, [{
            id: "siyuan",
            name: "思源笔记（新标题）",
            rootNames: ["siyuan-note"],
        }]), {
            projectLabels: {
                "siyuan-note": "思源笔记（新标题）",
            },
            projectCodexIDs: {
                "siyuan-note": "siyuan",
            },
        });
    });
});

describe("getTodoAIProjectCategory", () => {
    it("根据 AI 项目待办标题标记自动分类", () => {
        assert.equal(getTodoAIProjectCategory("siyuan-note", "[开发] 待办面板"), "AI 功能开发");
        assert.equal(getTodoAIProjectCategory("siyuan-todo-plus", "[优化] 拖拽体验"), "AI 优化与修复");
        assert.equal(getTodoAIProjectCategory("siyuan-note", "[测试] 继承规则"), "AI 测试");
        assert.equal(getTodoAIProjectCategory("siyuan-note", "[文档/配置] 发布说明"), "AI 文档与配置");
        assert.equal(getTodoAIProjectCategory("siyuan-note", "开发统计"), "AI 开发");
    });

    it("沿用已有 AI 项目识别其它项目", () => {
        assert.equal(getTodoAIProjectCategory("material-platform", "[修复] 生成失败", ["material-platform"]),
            "AI 优化与修复");
        assert.equal(getTodoAIProjectCategory("Meta Horizon", "[开发] 关卡", ["material-platform"]), "");
    });
});
