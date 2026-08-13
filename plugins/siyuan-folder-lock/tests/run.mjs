import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {webcrypto} from "node:crypto";
import {createRequire} from "node:module";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

if (!globalThis.crypto) {
    Object.defineProperty(globalThis, "crypto", {value: webcrypto});
}
const require = createRequire(import.meta.url);
const outputDirectory = mkdtempSync(path.join(tmpdir(), "siyuan-folder-lock-test-"));

try {
    execFileSync(
        path.resolve("node_modules/.bin/tsc"),
        [
            "src/crypto.ts",
            "src/document.ts",
            "src/password.ts",
            "src/snapshot.ts",
            "src/store.ts",
            "src/transaction.ts",
            "--target", "ES2022",
            "--module", "commonjs",
            "--moduleResolution", "node",
            "--lib", "ES2022,DOM",
            "--skipLibCheck",
            "--outDir", outputDirectory,
        ],
        {stdio: "inherit"},
    );

    const cryptoModule = require(path.join(outputDirectory, "crypto.js"));
    const documentModule = require(path.join(outputDirectory, "document.js"));
    const passwordModule = require(path.join(outputDirectory, "password.js"));
    const snapshotModule = require(path.join(outputDirectory, "snapshot.js"));
    const storeModule = require(path.join(outputDirectory, "store.js"));
    const transactionModule = require(path.join(outputDirectory, "transaction.js"));

    assert.equal(cryptoModule.PBKDF2_ITERATIONS, 600000);
    assert.equal(passwordModule.validateNewPassword("", ""), "required");
    assert.equal(passwordModule.validateNewPassword("1", "1"), null);
    assert.equal(passwordModule.validateNewPassword("1", "2"), "mismatch");
    const passwordKey = await cryptoModule.deriveKey("correct horse battery staple", cryptoModule.generateSalt());
    const masterKey = await cryptoModule.generateMasterKey();
    const wrapped = await cryptoModule.wrapKey(masterKey, passwordKey, "key-context");
    const unwrapped = await cryptoModule.unwrapKey(wrapped.wrappedKey, wrapped.iv, passwordKey, "key-context");
    assert.equal(unwrapped.extractable, false);

    const encryptedEmpty = await cryptoModule.encryptText("", unwrapped, "doc:empty");
    assert.equal(await cryptoModule.decryptText(encryptedEmpty.ciphertext, encryptedEmpty.iv, unwrapped, "doc:empty"), "");
    assert.equal(documentModule.toWritableKramdown(""), "\u200B");
    assert.equal(documentModule.toWritableKramdown("content"), "content");
    assert.equal(documentModule.documentTreesOverlap("/parent.sy", "/parent/child.sy"), true);
    assert.equal(documentModule.documentTreesOverlap("/parent/child.sy", "/parent.sy"), true);
    assert.equal(documentModule.documentTreesOverlap("/parent/a.sy", "/parent/ab.sy"), false);
    assert.equal(documentModule.documentPathWithinTree("/parent.sy", "/parent.sy"), true);
    assert.equal(documentModule.documentPathWithinTree("/parent/child.sy", "/parent.sy"), true);
    assert.equal(documentModule.documentPathWithinTree("/parent.sy", "/parent/child.sy"), false);
    assert.deepEqual(
        documentModule.mergeProtectedDocumentIds(
            ["current-root", "current-child"],
            ["current-root", "moved-protected-child"],
        ),
        ["current-root", "current-child", "moved-protected-child"],
    );
    const placeholder = "> 🔒 This document is locked.";
    const renderedPlaceholder = `${placeholder}\n{: id="block-id" updated="20260721220000"}\n\n` +
        "{: id=\"doc-id\" type=\"doc\"}";
    const renderedPlaceholderWithInvisibleLines = `${placeholder}\n{: id="block-id" updated="20260721220000"}\n` +
        "\u200B\n\u2060\n{: id=\"doc-id\" type=\"doc\"}";
    const renderedPlaceholderWithQuotedAttributes = `${placeholder}\n` +
        "> {: id=\"block-id\" updated=\"20260726201409\"}\n>\n" +
        "{: id=\"doc-id\" type=\"doc\" updated=\"20260726201409\"}";
    assert.equal(documentModule.isLockedPlaceholderKramdown(renderedPlaceholder, placeholder), true);
    assert.equal(documentModule.isLockedPlaceholderKramdown(renderedPlaceholderWithInvisibleLines, placeholder), true);
    assert.equal(documentModule.isLockedPlaceholderKramdown(renderedPlaceholderWithQuotedAttributes, placeholder), true);
    assert.equal(documentModule.isLockedPlaceholderKramdown("User content", placeholder), false);
    assert.equal(documentModule.isLockedPlaceholderKramdown("{: id=\"empty\"}", placeholder), false);
    assert.equal(documentModule.isLockedPlaceholderVisibleText("🔒 This document is locked.", placeholder), true);
    assert.equal(documentModule.isLockedPlaceholderVisibleText("\n🔒 This document is locked.\n", placeholder), true);
    assert.equal(documentModule.isLockedPlaceholderVisibleText("Recovered content", placeholder), false);
    assert.equal(documentModule.shouldReloadUnlockedProtyle("🔒 This document is locked.", placeholder), true);
    assert.equal(documentModule.shouldReloadUnlockedProtyle("", placeholder), false);
    assert.equal(documentModule.shouldReloadUnlockedProtyle("", placeholder, true), true);
    assert.equal(documentModule.shouldReloadUnlockedProtyle("Recovered content", placeholder, true), true);
    assert.equal(documentModule.containsLockedPlaceholder({locked: renderedPlaceholder}, placeholder), true);
    assert.equal(documentModule.containsLockedPlaceholder({plain: "User content"}, placeholder), false);
    const rawPlaceholder = JSON.stringify({
        Spec: 1,
        Type: "NodeDocument",
        ID: "20260722000500-eeeeeee",
        Properties: {title: "Locked"},
        Children: [{
            Type: "NodeBlockquote",
            ID: "20260722000501-fffffff",
            Children: [{
                Type: "NodeParagraph",
                ID: "20260722000502-ggggggg",
                Children: [{Type: "NodeText", Data: "🔒 This document is locked."}],
            }],
        }],
    });
    assert.equal(documentModule.isLockedPlaceholderContent(
        rawPlaceholder,
        placeholder,
        storeModule.RAW_SY_CONTENT_FORMAT,
    ), true);
    const structuredRaw = JSON.stringify({
        Spec: 1,
        Type: "NodeDocument",
        ID: "20260722000300-ccccccc",
        Properties: {title: "Table"},
        Children: [{
            Type: "NodeTable",
            ID: "20260722000600-hhhhhhh",
            Children: [{
                Type: "NodeTableRow",
                Children: [{
                    Type: "NodeTableCell",
                    Data: "1",
                    Children: [{Type: "NodeText", Data: "value"}],
                }],
            }],
        }],
    });
    const structuredRawReordered = JSON.stringify({
        Children: [{
            Children: [{
                Children: [{Children: [{Data: "value", Type: "NodeText"}], Data: "1", Type: "NodeTableCell"}],
                Type: "NodeTableRow",
            }],
            ID: "20260722000600-hhhhhhh",
            Type: "NodeTable",
        }],
        Properties: {title: "Table"},
        ID: "20260722000300-ccccccc",
        Type: "NodeDocument",
        Spec: 1,
    });
    assert.equal(documentModule.isSameSyJSON(structuredRaw, structuredRawReordered), true);
    assert.equal(documentModule.isSameSyJSON(structuredRaw, structuredRaw.replace("value", "changed")), false);
    const restorePlan = await documentModule.buildSafeRestorePlan(
        ["locked", "newer", "new-child"],
        {
            locked: renderedPlaceholder,
            newer: "Edited after unlock",
            "new-child": "Created while unlocked",
        },
        {
            locked: {ciphertext: "encrypted-old", iv: "iv"},
        },
        placeholder,
        async (id) => `Decrypted ${id}`,
    );
    assert.deepEqual(restorePlan.plaintextDocs, {
        locked: "Decrypted locked",
        newer: "Edited after unlock",
        "new-child": "Created while unlocked",
    });
    assert.deepEqual(restorePlan.restoreDocIds, ["locked"]);
    assert.equal(restorePlan.rollbackContents.locked, renderedPlaceholder);
    await assert.rejects(
        documentModule.buildSafeRestorePlan(
            ["missing"],
            {missing: renderedPlaceholder},
            {},
            placeholder,
            async () => "unused",
        ),
    );
    const candidateEncrypted = {locked: {ciphertext: "ciphertext", iv: "iv"}};
    const selectedRestore = await documentModule.selectSafeRestorePlan(
        ["locked"],
        {locked: renderedPlaceholderWithQuotedAttributes},
        [
            {generationId: "contaminated", placeholder, encryptedDocs: candidateEncrypted},
            {generationId: "broken", placeholder, encryptedDocs: candidateEncrypted},
            {generationId: "valid", placeholder, encryptedDocs: candidateEncrypted},
        ],
        async (candidate) => {
            if (candidate.generationId === "broken") {
                throw new Error("Injected snapshot corruption");
            }
            return {locked: candidate.generationId === "contaminated" ? renderedPlaceholder : "Recovered content"};
        },
    );
    assert.equal(selectedRestore.generationId, "valid");
    assert.equal(selectedRestore.plan.plaintextDocs.locked, "Recovered content");
    await assert.rejects(documentModule.selectSafeRestorePlan(
        ["locked"],
        {locked: renderedPlaceholderWithQuotedAttributes},
        [{generationId: "contaminated", placeholder, encryptedDocs: candidateEncrypted}],
        async () => ({locked: renderedPlaceholderWithInvisibleLines}),
    ));
    const rawSelectedRestore = await documentModule.selectSafeRestorePlan(
        ["locked"],
        () => ({locked: rawPlaceholder}),
        [{
            generationId: "raw-valid",
            placeholder,
            encryptedDocs: candidateEncrypted,
            storageVersion: storeModule.SNAPSHOT_STORAGE_VERSION,
            contentFormat: storeModule.RAW_SY_CONTENT_FORMAT,
        }],
        async () => ({locked: structuredRaw}),
    );
    assert.equal(rawSelectedRestore.contentFormat, storeModule.RAW_SY_CONTENT_FORMAT);
    assert.equal(rawSelectedRestore.plan.plaintextDocs.locked, structuredRaw);
    await assert.rejects(
        cryptoModule.decryptText(encryptedEmpty.ciphertext, encryptedEmpty.iv, unwrapped, "doc:other"),
    );
    assert.match(cryptoModule.generateRecoveryCode(), /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){4}$/);

    const testFolderId = "20260722000100-aaaaaaa";
    const testNotebookId = "20260722000200-bbbbbbb";
    const testDocA = "20260722000300-ccccccc";
    const testDocB = "20260722000400-ddddddd";
    const snapshotPlaintext = {
        [testDocA]: "first document",
        [testDocB]: "second document",
    };
    const snapshot = await snapshotModule.createEncryptedSnapshot({
        folderId: testFolderId,
        notebookId: testNotebookId,
        folderPath: `/${testFolderId}.sy`,
        docIds: Object.keys(snapshotPlaintext),
        plaintextDocs: snapshotPlaintext,
        placeholder,
        cryptoFormatVersion: 2,
        encrypt: (docId, plaintext) => cryptoModule.encryptText(plaintext, unwrapped, `doc:${docId}:v2`),
    });
    assert.equal(snapshot.storageVersion, 1);
    assert.equal(storeModule.getSnapshotContentFormat(snapshot), storeModule.KRAMDOWN_CONTENT_FORMAT);
    await snapshotModule.verifySnapshotRoundTrip(
        snapshot,
        snapshotPlaintext,
        (docId, encrypted) => cryptoModule.decryptText(
            encrypted.ciphertext,
            encrypted.iv,
            unwrapped,
            `doc:${docId}:v2`,
        ),
    );
    assert.deepEqual(
        await snapshotModule.decryptCompleteSnapshot(
            snapshot,
            (docId, encrypted) => cryptoModule.decryptText(
                encrypted.ciphertext,
                encrypted.iv,
                unwrapped,
                `doc:${docId}:v2`,
            ),
        ),
        snapshotPlaintext,
    );
    const tamperedSnapshot = structuredClone(snapshot);
    tamperedSnapshot.encryptedDocs[testDocA].ciphertext =
        `${tamperedSnapshot.encryptedDocs[testDocA].ciphertext.startsWith("A") ? "B" : "A"}` +
        tamperedSnapshot.encryptedDocs[testDocA].ciphertext.slice(1);
    await assert.rejects(
        snapshotModule.decryptCompleteSnapshot(
            tamperedSnapshot,
            (docId, encrypted) => cryptoModule.decryptText(
                encrypted.ciphertext,
                encrypted.iv,
                unwrapped,
                `doc:${docId}:v2`,
            ),
        ),
    );

    class MemoryPlugin {
        constructor(files = new Map()) {
            this.files = files;
            this.data = {};
            this.failSave = "";
            this.corruptSave = "";
        }

        async loadData(name) {
            const value = this.files.has(name) ? structuredClone(this.files.get(name)) : "";
            this.data[name] = value;
            return value;
        }

        async saveData(name, value) {
            if (this.failSave === name) {
                throw new Error(`Injected save failure: ${name}`);
            }
            this.files.set(name, this.corruptSave === name ? "{" : structuredClone(value));
            this.data[name] = value;
        }
    }

    const withMutedErrors = async (operation) => {
        const originalConsoleError = console.error;
        console.error = () => undefined;
        try {
            return await operation();
        } finally {
            console.error = originalConsoleError;
        }
    };

    const fakeEncrypted = {ciphertext: "Y2lwaGVydGV4dA==", iv: "aXY="};
    const fakeLock = {
        formatVersion: 1,
        salt: "salt",
        masterKeyWrapped: "wrapped",
        masterKeyIv: "iv",
        recoverySalt: "recovery-salt",
        recoveryKeyWrapped: "recovery-wrapped",
        recoveryKeyIv: "recovery-iv",
        lockedAt: Date.now(),
        notebookId: testNotebookId,
        folderPath: `/${testFolderId}.sy`,
        docIds: [testDocA],
        encryptedDocs: {[testDocA]: fakeEncrypted},
    };
    const memoryPlugin = new MemoryPlugin();
    const lockStore = new storeModule.LockStore(memoryPlugin);
    await lockStore.initialize();
    await lockStore.addLock(testFolderId, fakeLock);
    assert.equal(lockStore.getLock(testFolderId).folderPath, `/${testFolderId}.sy`);
    assert.equal(memoryPlugin.files.has("locks-v2-a"), true);
    assert.equal(memoryPlugin.files.has("locks-v2-b"), true);
    assert.deepEqual(memoryPlugin.files.get("locks-v2-a"), memoryPlugin.files.get("locks-v2-b"));
    memoryPlugin.failSave = "locks-v2-b";
    await withMutedErrors(() => assert.rejects(lockStore.addLock(testDocB, fakeLock)));
    assert.equal(lockStore.getLock(testDocB), null);
    memoryPlugin.failSave = "";
    memoryPlugin.corruptSave = "locks-v2-b";
    await withMutedErrors(() => assert.rejects(lockStore.addLock(testDocB, fakeLock)));
    assert.equal(lockStore.getLock(testDocB), null);
    memoryPlugin.corruptSave = "";
    await lockStore.addLock(testDocB, fakeLock);
    const restartedStore = new storeModule.LockStore(new MemoryPlugin(memoryPlugin.files));
    await restartedStore.initialize();
    assert.equal(restartedStore.getLock(testFolderId).folderPath, `/${testFolderId}.sy`);
    assert.equal(restartedStore.getLock(testDocB).folderPath, `/${testFolderId}.sy`);
    const fallbackFiles = new Map(memoryPlugin.files);
    fallbackFiles.set("locks-v2-b", "{");
    const fallbackStore = new storeModule.LockStore(new MemoryPlugin(fallbackFiles));
    await withMutedErrors(() => fallbackStore.initialize());
    assert.equal(fallbackStore.getLock(testFolderId).folderPath, `/${testFolderId}.sy`);
    assert.equal(fallbackStore.getLock(testDocB).folderPath, `/${testFolderId}.sy`);
    fallbackFiles.set("locks-v2-a", "{");
    await withMutedErrors(() => assert.rejects(
        new storeModule.LockStore(new MemoryPlugin(fallbackFiles)).initialize(),
    ));

    const degradedPlugin = new MemoryPlugin();
    degradedPlugin.failSave = "locks-v2-b";
    const degradedStore = new storeModule.LockStore(degradedPlugin);
    await degradedStore.initialize();
    await degradedStore.addLock(testFolderId, fakeLock);
    assert.equal(degradedStore.getLock(testFolderId).folderPath, `/${testFolderId}.sy`);
    assert.equal(degradedPlugin.files.has("locks-v2-a"), true);

    const snapshotReference = await lockStore.saveSnapshot(snapshot);
    assert.equal((await lockStore.loadSnapshot(snapshotReference)).generationId, snapshot.generationId);
    await assert.rejects(lockStore.saveSnapshot(snapshot));
    const secondSnapshot = await snapshotModule.createEncryptedSnapshot({
        folderId: testFolderId,
        notebookId: testNotebookId,
        folderPath: `/${testFolderId}.sy`,
        docIds: Object.keys(snapshotPlaintext),
        plaintextDocs: snapshotPlaintext,
        placeholder,
        cryptoFormatVersion: 2,
        encrypt: (docId, plaintext) => cryptoModule.encryptText(plaintext, unwrapped, `doc:${docId}:v2`),
    });
    memoryPlugin.corruptSave = `snapshots/${secondSnapshot.folderId}/${secondSnapshot.generationId}.json`;
    await assert.rejects(lockStore.saveSnapshot(secondSnapshot));
    const history = snapshotModule.prependSnapshotReference(snapshotReference, [snapshotReference]);
    assert.deepEqual(history, [snapshotReference]);
    const rawSnapshot = await snapshotModule.createEncryptedSnapshot({
        folderId: testFolderId,
        notebookId: testNotebookId,
        folderPath: `/${testFolderId}.sy`,
        docIds: [testDocA],
        plaintextDocs: {[testDocA]: structuredRaw},
        placeholder,
        cryptoFormatVersion: 2,
        contentFormat: storeModule.RAW_SY_CONTENT_FORMAT,
        encrypt: (docId, plaintext) => cryptoModule.encryptText(plaintext, unwrapped, `doc:${docId}:v2`),
    });
    assert.equal(rawSnapshot.storageVersion, storeModule.SNAPSHOT_STORAGE_VERSION);
    assert.equal(storeModule.getSnapshotContentFormat(rawSnapshot), storeModule.RAW_SY_CONTENT_FORMAT);
    const rawReference = await lockStore.saveSnapshot(rawSnapshot);
    assert.equal(
        storeModule.getSnapshotContentFormat(await lockStore.loadSnapshot(rawReference)),
        storeModule.RAW_SY_CONTENT_FORMAT,
    );

    const integrationPlugin = new MemoryPlugin();
    const integrationStore = new storeModule.LockStore(integrationPlugin);
    await integrationStore.initialize();
    const integrationDocs = structuredClone(snapshotPlaintext);
    const createIntegrationSnapshot = async (contents, previousGenerationId) => snapshotModule.createEncryptedSnapshot({
        folderId: testFolderId,
        notebookId: testNotebookId,
        folderPath: `/${testFolderId}.sy`,
        docIds: Object.keys(contents),
        plaintextDocs: contents,
        placeholder,
        cryptoFormatVersion: 2,
        previousGenerationId,
        encrypt: (docId, plaintext) => cryptoModule.encryptText(
            plaintext,
            unwrapped,
            `integration:${docId}`,
        ),
    });
    const decryptIntegrationSnapshot = (value) => snapshotModule.decryptCompleteSnapshot(
        value,
        (docId, encrypted) => cryptoModule.decryptText(
            encrypted.ciphertext,
            encrypted.iv,
            unwrapped,
            `integration:${docId}`,
        ),
    );
    const firstGeneration = await createIntegrationSnapshot(integrationDocs);
    const firstReference = await integrationStore.saveSnapshot(firstGeneration);
    await snapshotModule.verifySnapshotRoundTrip(firstGeneration, integrationDocs,
        (docId, encrypted) => cryptoModule.decryptText(
            encrypted.ciphertext,
            encrypted.iv,
            unwrapped,
            `integration:${docId}`,
        ));
    await integrationStore.addLock(testFolderId, {
        ...fakeLock,
        formatVersion: 2,
        docIds: Object.keys(integrationDocs),
        activeSnapshot: firstReference,
        snapshotHistory: [firstReference],
        encryptedDocs: undefined,
        placeholder,
    });
    await transactionModule.updateDocumentsTransactional(
        Object.keys(integrationDocs),
        {[testDocA]: placeholder, [testDocB]: placeholder},
        integrationDocs,
        async (id, value) => {
            integrationDocs[id] = value;
        },
    );
    const firstSelected = await documentModule.selectSafeRestorePlan(
        Object.keys(integrationDocs),
        integrationDocs,
        [await integrationStore.loadSnapshot(firstReference)],
        decryptIntegrationSnapshot,
    );
    await transactionModule.updateDocumentsTransactional(
        firstSelected.plan.restoreDocIds,
        firstSelected.plan.plaintextDocs,
        firstSelected.plan.rollbackContents,
        async (id, value) => {
            integrationDocs[id] = value;
        },
    );
    integrationDocs[testDocA] = "edited after unlock";
    const secondGeneration = await createIntegrationSnapshot(integrationDocs, firstReference.generationId);
    const secondReference = await integrationStore.saveSnapshot(secondGeneration);
    await transactionModule.updateDocumentsTransactional(
        Object.keys(integrationDocs),
        {[testDocA]: placeholder, [testDocB]: placeholder},
        integrationDocs,
        async (id, value) => {
            integrationDocs[id] = value;
        },
    );
    const contaminatedGeneration = await createIntegrationSnapshot(integrationDocs, secondReference.generationId);
    const contaminatedReference = await integrationStore.saveSnapshot(contaminatedGeneration);
    const fallbackCandidates = await Promise.all([contaminatedReference, secondReference, firstReference].map(
        (reference) => integrationStore.loadSnapshot(reference),
    ));
    const fallbackSelected = await documentModule.selectSafeRestorePlan(
        Object.keys(integrationDocs),
        integrationDocs,
        fallbackCandidates,
        decryptIntegrationSnapshot,
    );
    assert.equal(fallbackSelected.generationId, secondReference.generationId);
    assert.equal(fallbackSelected.plan.plaintextDocs[testDocA], "edited after unlock");

    const state = {a: "A", b: "B", c: "C"};
    await assert.rejects(
        transactionModule.updateDocumentsTransactional(
            ["a", "b", "c"],
            {a: "next-A", b: "next-B", c: "next-C"},
            {a: "A", b: "B", c: "C"},
            async (id, value) => {
                if (id === "b" && value === "next-B") {
                    throw new Error("injected write failure");
                }
                state[id] = value;
            },
        ),
        (error) => error instanceof transactionModule.DocumentTransactionError && error.rollbackFailures.length === 0,
    );
    assert.deepEqual(state, {a: "A", b: "B", c: "C"});

    const partialState = {a: "A", b: "B"};
    await assert.rejects(
        transactionModule.updateDocumentsTransactional(
            ["a", "b"],
            {a: "next-A", b: "next-B"},
            {a: "A", b: "B"},
            async (id, value) => {
                if (id === "b" || (id === "a" && value === "A")) {
                    throw new Error("injected persistent failure");
                }
                partialState[id] = value;
            },
        ),
        (error) => error instanceof transactionModule.DocumentTransactionError &&
            error.rollbackFailures.join(",") === "a",
    );
    assert.deepEqual(partialState, {a: "next-A", b: "B"});

    const formatState = {a: "raw-A", b: "raw-B"};
    const rollbackFormats = [];
    await assert.rejects(
        transactionModule.updateDocumentsTransactional(
            ["a", "b"],
            {a: "placeholder-A", b: "placeholder-B"},
            {a: "raw-A", b: "raw-B"},
            async (id, value) => {
                if (id === "b") {
                    throw new Error("injected placeholder failure");
                }
                formatState[id] = value;
            },
            async (id, value) => {
                rollbackFormats.push("raw");
                formatState[id] = value;
            },
        ),
    );
    assert.deepEqual(formatState, {a: "raw-A", b: "raw-B"});
    assert.deepEqual(rollbackFormats, ["raw"]);

    console.log("Security Lock tests passed: raw structure snapshots, authenticated crypto, safe restore, and rollback.");
} finally {
    rmSync(outputDirectory, {recursive: true, force: true});
}
