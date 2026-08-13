import {
    getSnapshotContentFormat,
    KRAMDOWN_CONTENT_FORMAT,
    RAW_SY_CONTENT_FORMAT,
    SnapshotContentFormat,
} from "./store";

const EMPTY_DOCUMENT_MARKER = "\u200B";
const KRAMDOWN_IAL_LINE = /^\s*\{:\s.*}\s*$/;
const KRAMDOWN_INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g;

interface IEncryptedDocument {
    ciphertext: string;
    iv: string;
}

export interface IRestorePlan {
    plaintextDocs: Record<string, string>;
    restoreDocIds: string[];
    rollbackContents: Record<string, string>;
}

export interface IRestoreSnapshotCandidate {
    generationId: string;
    placeholder: string;
    encryptedDocs: Record<string, IEncryptedDocument>;
    storageVersion?: 1 | 2;
    contentFormat?: SnapshotContentFormat;
}

export interface ISelectedRestorePlan<T extends IRestoreSnapshotCandidate = IRestoreSnapshotCandidate> {
    generationId: string;
    contentFormat: SnapshotContentFormat;
    plan: IRestorePlan;
    snapshot: T;
}

/** 思源会忽略空字符串更新，使用不可见字符确保空文档能够覆盖锁定占位。 */
export function toWritableKramdown(kramdown: string): string {
    return kramdown === "" ? EMPTY_DOCUMENT_MARKER : kramdown;
}

/** 判断两个思源文档路径是否属于同一棵父子文档树。 */
export function documentTreesOverlap(firstPath: string, secondPath: string): boolean {
    if (firstPath === secondPath) {
        return true;
    }
    const firstTreePath = firstPath.endsWith(".sy") ? firstPath.slice(0, -3) : firstPath;
    const secondTreePath = secondPath.endsWith(".sy") ? secondPath.slice(0, -3) : secondPath;
    return firstPath.startsWith(`${secondTreePath}/`) || secondPath.startsWith(`${firstTreePath}/`);
}

/** 判断文档路径是否位于指定的父子文档树内。 */
export function documentPathWithinTree(documentPath: string, rootPath: string): boolean {
    if (documentPath === rootPath) {
        return true;
    }
    const rootTreePath = rootPath.endsWith(".sy") ? rootPath.slice(0, -3) : rootPath;
    return documentPath.startsWith(`${rootTreePath}/`);
}

/** 合并当前文档树与原受保护集合，避免已锁定文档移出树后失去恢复机会。 */
export function mergeProtectedDocumentIds(currentDocIds: string[], protectedDocIds: string[]): string[] {
    return [...new Set([...currentDocIds, ...protectedDocIds])];
}

/** 忽略思源自动生成的块属性后，判断当前内容是否仍是安全锁占位文案。 */
export function isLockedPlaceholderKramdown(kramdown: string, placeholder: string): boolean {
    return normalizeVisibleKramdown(kramdown) === normalizeVisibleKramdown(placeholder);
}

/** 判断编辑器当前显示的纯文本是否仍为安全锁占位内容。 */
export function isLockedPlaceholderVisibleText(visibleText: string, placeholder: string): boolean {
    return normalizeVisibleText(visibleText) === normalizeVisibleText(placeholder);
}

/** 解锁流程完成时强制刷新；其他加载场景仅在编辑器仍显示占位内容时刷新。 */
export function shouldReloadUnlockedProtyle(
    visibleText: string,
    placeholder: string,
    force = false,
): boolean {
    return force || isLockedPlaceholderVisibleText(visibleText, placeholder);
}

/** 判断一组待加密正文中是否混入锁定占位内容。 */
export function containsLockedPlaceholder(contents: Record<string, string>, placeholder: string): boolean {
    return Object.values(contents).some((content) => isLockedPlaceholderKramdown(content, placeholder));
}

/** 判断指定格式的文档是否只包含安全锁占位内容。 */
export function isLockedPlaceholderContent(
    content: string,
    placeholder: string,
    contentFormat: SnapshotContentFormat,
): boolean {
    if (contentFormat === KRAMDOWN_CONTENT_FORMAT) {
        return isLockedPlaceholderKramdown(content, placeholder);
    }
    if (contentFormat === RAW_SY_CONTENT_FORMAT) {
        return normalizeVisibleText(extractSyJSONVisibleText(content)) === normalizeVisibleText(placeholder);
    }
    return false;
}

/** 判断原始 .sy JSON 是否逐字段一致，忽略对象键的序列化顺序。 */
export function isSameSyJSON(first: string, second: string): boolean {
    try {
        return stableJSONStringify(JSON.parse(first)) === stableJSONStringify(JSON.parse(second));
    } catch {
        return false;
    }
}

/**
 * 为解锁生成无损恢复计划：占位文档使用密文，非占位文档视为异常退出后遗留的较新明文并原样保留。
 */
export async function buildSafeRestorePlan(
    docIds: string[],
    currentContents: Record<string, string>,
    encryptedDocs: Record<string, IEncryptedDocument>,
    placeholder: string,
    decrypt: (docId: string, encrypted: IEncryptedDocument) => Promise<string>,
    contentFormat: SnapshotContentFormat = KRAMDOWN_CONTENT_FORMAT,
): Promise<IRestorePlan> {
    const plaintextDocs: Record<string, string> = {};
    const restoreDocIds: string[] = [];
    const rollbackContents: Record<string, string> = {};
    for (const docId of docIds) {
        const currentContent = currentContents[docId];
        if (!isLockedPlaceholderContent(currentContent, placeholder, contentFormat)) {
            plaintextDocs[docId] = currentContent;
            continue;
        }

        const encrypted = encryptedDocs[docId];
        if (!encrypted) {
            throw new Error(`Missing encrypted document: ${docId}`);
        }
        plaintextDocs[docId] = await decrypt(docId, encrypted);
        restoreDocIds.push(docId);
        rollbackContents[docId] = currentContent;
    }
    return {plaintextDocs, restoreDocIds, rollbackContents};
}

/** 从新到旧选择第一份完整且未被占位内容污染的快照。 */
export async function selectSafeRestorePlan<T extends IRestoreSnapshotCandidate>(
    docIds: string[],
    currentContents: Record<string, string> | ((snapshot: T) => Record<string, string>),
    snapshots: T[],
    decryptComplete: (snapshot: T) => Promise<Record<string, string>>,
): Promise<ISelectedRestorePlan<T>> {
    for (const snapshot of snapshots) {
        try {
            const contentFormat = getSnapshotContentFormat(snapshot);
            const candidateCurrentContents = typeof currentContents === "function" ?
                currentContents(snapshot) : currentContents;
            const decryptedDocs = await decryptComplete(snapshot);
            const contaminated = docIds.some((docId) =>
                isLockedPlaceholderContent(candidateCurrentContents[docId], snapshot.placeholder, contentFormat) &&
                isLockedPlaceholderContent(decryptedDocs[docId] || "", snapshot.placeholder, contentFormat));
            if (contaminated) {
                continue;
            }
            const plan = await buildSafeRestorePlan(
                docIds,
                candidateCurrentContents,
                snapshot.encryptedDocs,
                snapshot.placeholder,
                async (docId) => {
                    if (!(docId in decryptedDocs)) {
                        throw new Error(`Missing decrypted document: ${docId}`);
                    }
                    return decryptedDocs[docId];
                },
                contentFormat,
            );
            return {generationId: snapshot.generationId, contentFormat, plan, snapshot};
        } catch {
            // 当前代不可恢复时继续尝试更早的不可变快照
        }
    }
    throw new Error("No complete recovery snapshot");
}

function extractSyJSONVisibleText(content: string): string {
    const value = JSON.parse(content) as unknown;
    const text: string[] = [];
    walkJSON(value, (item) => {
        if (item.Type === "NodeText" && typeof item.Data === "string") {
            text.push(item.Data);
        }
    });
    return text.join("\n");
}

function walkJSON(value: unknown, visitor: (item: Record<string, unknown>) => void): void {
    if (Array.isArray(value)) {
        value.forEach((item) => walkJSON(item, visitor));
        return;
    }
    if (typeof value !== "object" || value === null) {
        return;
    }
    const item = value as Record<string, unknown>;
    visitor(item);
    Object.values(item).forEach((child) => walkJSON(child, visitor));
}

function stableJSONStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableJSONStringify).join(",")}]`;
    }
    if (typeof value === "object" && value !== null) {
        const item = value as Record<string, unknown>;
        return `{${Object.keys(item).sort().map((key) =>
            `${JSON.stringify(key)}:${stableJSONStringify(item[key])}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

function normalizeVisibleKramdown(kramdown: string): string {
    return kramdown
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line
            .replace(KRAMDOWN_INVISIBLE_CHARACTERS, "")
            .trim()
            .replace(/^(?:>\s*)+/, "")
            .trim())
        .filter((line) => line !== "" && !KRAMDOWN_IAL_LINE.test(line))
        .join("\n");
}

function normalizeVisibleText(text: string): string {
    return text
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line
            .replace(KRAMDOWN_INVISIBLE_CHARACTERS, "")
            .replace(/^\s*>\s*/, "")
            .trim())
        .filter((line) => line !== "")
        .join("\n");
}
