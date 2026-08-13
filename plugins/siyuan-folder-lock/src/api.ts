// SiYuan kernel API 封装
// 使用 fetchSyncPost 进行同步 API 调用

import { fetchSyncPost } from "siyuan";
import {toWritableKramdown} from "./document";

/** 获取当前文档及其所有子文档 ID */
export async function getDocIDs(notebookId: string, rootPath: string, rootDocId: string): Promise<string[]> {
    const result = [rootDocId];
    await collectDocs(notebookId, rootPath, result);
    return result;
}

/** 递归收集文档信息 */
async function collectDocs(notebookId: string, path: string, result: string[]): Promise<void> {
    const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
        notebook: notebookId,
        path: path,
    });
    if (response.code !== 0 || !response.data) {
        throw new Error(`获取子文档列表失败: ${response.msg || path}`);
    }
    const files = response.data.files || [];
    for (const file of files) {
        result.push(file.id);
        if (file.subFileCount > 0) {
            // 当前文档仍需保留，再继续收集其子文档
            await collectDocs(notebookId, file.path, result);
        }
    }
}

/** 获取文档的 kramdown 内容 */
export async function getDocKramdown(docId: string): Promise<string> {
    const response = await fetchSyncPost("/api/block/getBlockKramdown", {
        id: docId,
    });
    if (response.code !== 0) {
        throw new Error(`获取文档内容失败: ${response.msg}`);
    }
    return response.data.kramdown;
}

/** 获取文档未经 Markdown 或 BlockDOM 转换的原始 .sy JSON。 */
export async function getDocRaw(docId: string): Promise<string> {
    const response = await fetchSyncPost("/api/block/getDocRaw", {id: docId});
    if (response.code !== 0 || typeof response.data?.content !== "string") {
        throw new Error(`获取原始文档失败: ${response.msg || docId}`);
    }
    return response.data.content;
}

/** 更新文档的 kramdown 内容 */
export async function updateDocKramdown(docId: string, kramdown: string): Promise<void> {
    const response = await fetchSyncPost("/api/block/updateBlock", {
        id: docId,
        dataType: "markdown",
        data: toWritableKramdown(kramdown),
    });
    if (response.code !== 0) {
        throw new Error(`更新文档内容失败: ${response.msg}`);
    }
}

/** 使用原始 .sy JSON 恢复文档，并逐字段读回校验。 */
export async function updateDocRaw(docId: string, content: string): Promise<void> {
    const response = await fetchSyncPost("/api/block/updateDocRaw", {
        id: docId,
        content,
    });
    if (response.code !== 0) {
        throw new Error(`恢复原始文档失败: ${response.msg}`);
    }
}

/** 获取块信息 */
export async function getBlockInfo(blockId: string): Promise<{ box: string; path: string; rootID: string } | null> {
    const response = await fetchSyncPost("/api/block/getBlockInfo", {
        id: blockId,
    });
    if (response.code !== 0) {
        return null;
    }
    return {
        box: response.data.box,
        path: response.data.path,
        rootID: response.data.rootID,
    };
}
