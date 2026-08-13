export class DocumentTransactionError extends Error {
    public readonly rollbackFailures: string[];

    constructor(message: string, rollbackFailures: string[]) {
        super(message);
        this.name = "DocumentTransactionError";
        this.rollbackFailures = rollbackFailures;
    }
}

/** 顺序写入文档；任一写入失败时，将已写入文档按相反顺序恢复。 */
export async function updateDocumentsTransactional(
    docIds: string[],
    nextContents: Record<string, string>,
    rollbackContents: Record<string, string>,
    update: (docId: string, content: string) => Promise<void>,
    rollbackUpdate: (docId: string, content: string) => Promise<void> = update,
): Promise<void> {
    const updatedDocIds: string[] = [];
    try {
        for (const docId of docIds) {
            await update(docId, nextContents[docId]);
            updatedDocIds.push(docId);
        }
    } catch (error) {
        const rollbackFailures: string[] = [];
        for (const docId of updatedDocIds.reverse()) {
            try {
                await rollbackUpdate(docId, rollbackContents[docId]);
            } catch {
                rollbackFailures.push(docId);
            }
        }
        const cause = error instanceof Error ? error.message : String(error);
        throw new DocumentTransactionError(cause, rollbackFailures);
    }
}
