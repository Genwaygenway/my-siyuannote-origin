import {
    IEncryptedDocument,
    KRAMDOWN_CONTENT_FORMAT,
    ILockSnapshot,
    ILockSnapshotReference,
    RAW_SY_CONTENT_FORMAT,
    SNAPSHOT_STORAGE_VERSION,
    SnapshotContentFormat,
} from "./store";

export interface ICreateSnapshotOptions {
    folderId: string;
    notebookId: string;
    folderPath: string;
    docIds: string[];
    plaintextDocs: Record<string, string>;
    placeholder: string;
    cryptoFormatVersion: number;
    contentFormat?: SnapshotContentFormat;
    previousGenerationId?: string;
    encrypt: (docId: string, plaintext: string) => Promise<IEncryptedDocument>;
}

/** 在内存中创建完整加密快照，任何文档加密失败时都不会返回半成品。 */
export async function createEncryptedSnapshot(options: ICreateSnapshotOptions): Promise<ILockSnapshot> {
    const encryptedDocs: Record<string, IEncryptedDocument> = {};
    for (const docId of options.docIds) {
        if (!(docId in options.plaintextDocs)) {
            throw new Error(`Missing plaintext document: ${docId}`);
        }
        encryptedDocs[docId] = await options.encrypt(docId, options.plaintextDocs[docId]);
    }
    const contentFormat = options.contentFormat || KRAMDOWN_CONTENT_FORMAT;
    return {
        storageVersion: contentFormat === RAW_SY_CONTENT_FORMAT ? SNAPSHOT_STORAGE_VERSION : 1,
        generationId: createGenerationId(),
        folderId: options.folderId,
        createdAt: Date.now(),
        notebookId: options.notebookId,
        folderPath: options.folderPath,
        docIds: [...options.docIds],
        encryptedDocs,
        placeholder: options.placeholder,
        cryptoFormatVersion: options.cryptoFormatVersion,
        contentFormat: contentFormat === KRAMDOWN_CONTENT_FORMAT ? undefined : contentFormat,
        previousGenerationId: options.previousGenerationId,
    };
}

/** 解密并验证快照覆盖的全部文档，调用方只能在本函数成功后修改可见正文。 */
export async function decryptCompleteSnapshot(
    snapshot: ILockSnapshot,
    decrypt: (docId: string, encrypted: IEncryptedDocument) => Promise<string>,
): Promise<Record<string, string>> {
    const plaintextDocs: Record<string, string> = {};
    for (const docId of snapshot.docIds) {
        const encrypted = snapshot.encryptedDocs[docId];
        if (!encrypted) {
            throw new Error(`Missing encrypted document: ${docId}`);
        }
        plaintextDocs[docId] = await decrypt(docId, encrypted);
    }
    return plaintextDocs;
}

/** 持久化后必须完整解密并与原文逐字节一致，避免带病快照进入清单。 */
export async function verifySnapshotRoundTrip(
    snapshot: ILockSnapshot,
    expectedPlaintextDocs: Record<string, string>,
    decrypt: (docId: string, encrypted: IEncryptedDocument) => Promise<string>,
): Promise<void> {
    const decrypted = await decryptCompleteSnapshot(snapshot, decrypt);
    for (const docId of snapshot.docIds) {
        if (decrypted[docId] !== expectedPlaintextDocs[docId]) {
            throw new Error(`Snapshot verification failed: ${docId}`);
        }
    }
}

/** 最新引用排在最前，旧引用永久保留且不重复。 */
export function prependSnapshotReference(
    reference: ILockSnapshotReference,
    history: ILockSnapshotReference[],
): ILockSnapshotReference[] {
    const seen = new Set<string>();
    return [reference, ...history].filter((item) => {
        if (seen.has(item.storageName)) {
            return false;
        }
        seen.add(item.storageName);
        return true;
    });
}

function createGenerationId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${Date.now().toString(36)}-${random}`;
}
