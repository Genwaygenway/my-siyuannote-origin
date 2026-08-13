[简体中文](README.zh-CN.md)

# Security Lock

Security Lock is a SiYuan plugin for password-protecting one document and its current child-document tree. It encrypts a snapshot of each document with a random AES-256-GCM data key, protects that key with a password-derived key and an independent recovery-code-derived key, then replaces the visible documents with a lock notice.

## Scope

- Locks the selected document and every child document discovered when locking.
- Unlocks with either the password or the one-time displayed recovery code.
- Uses an opaque privacy backdrop during password and recovery-code unlock so note content cannot show through the dialog.
- Reloads protected editors after writing the lock notice so an open tab does not continue showing stale plaintext.
- Permanently removes a lock only after restoring every protected document and re-authenticating with the password or recovery code.
- Keeps the folder unlocked while related editor tabs are open. Closing the final tab relocks it, and a normal SiYuan shutdown waits for the latest encrypted snapshot to be persisted. A right-click unlock with no opened tab is relocked after 30 seconds.
- Appends a new immutable encrypted generation on every lock and relock. Visible content changes only after the snapshot is written, read back, fully decrypted, and compared with the source.
- New snapshots store the complete raw `.sy` structure without a Markdown or BlockDOM conversion, preserving tables, attribute-view references, block attributes, and block IDs.
- After a raw document is restored, the plugin reads it back and compares every JSON field. Any mismatch stops the operation and rolls back documents already written in that batch with their raw structures.
- Unlocking only reads snapshots and restores plaintext; it never overwrites recovery data. If the latest snapshot is damaged, older generations are tried from newest to oldest.
- Commits each lock manifest to one durable slot, verifies it, and mirrors the same generation to a second slot so either valid copy can recover the latest committed lock metadata.
- If an abnormal shutdown leaves plaintext newer than the encrypted snapshot, the next unlock preserves that plaintext instead of overwriting it with stale data.
- Rejects any new snapshot containing the lock placeholder so placeholder text cannot be committed as document content.
- Prevents overlapping parent and child locks.

## Use

1. Back up or snapshot your SiYuan workspace and verify that the backup opens correctly.
2. Right-click a document in the document tree and select **Add Security Lock**.
3. Enter and confirm a non-empty password of any length. Short passwords are easier to guess, so use a strong password when practical.
4. Copy the recovery code to a secure location outside the SiYuan workspace, verify the copy, and then confirm that it was saved.
5. To unlock, open the document or use its context menu, then enter the password or choose recovery-code unlock.
6. Close every related editor tab to trigger relocking, and verify that the lock notice has returned before closing SiYuan.
7. To stop using protection, right-click the locked root document, choose **Remove Security Lock**, authenticate, and verify the restored documents.

## Recovery and backups

The password and recovery code are not stored. Losing both makes the encrypted snapshot impractical to recover. Keep the recovery code offline or in a trusted password manager, never only inside the locked SiYuan workspace. Maintain tested backups of the entire workspace, including `data/storage/petal/siyuan-folder-lock/`. Its `locks-v2-a`, `locks-v2-b`, and `snapshots/` entries contain the dual manifests, immutable encrypted generations, and wrapped data keys needed for recovery.

Before disabling or uninstalling the plugin, use **Remove Security Lock** on every protected root, verify every document, and make a fresh backup. Do not uninstall while any document is showing the lock notice. Plugin unload and application shutdown only perform a best-effort relock and cannot guarantee completion if the process is terminated abruptly.

Historical encrypted snapshots are never deleted automatically because a cleanup defect could destroy the final recovery generation. Removing a lock restores plaintext and stops protection but leaves immutable encrypted history. Only after confirming that no lock remains, creating a verified workspace backup, and accepting that old generations are no longer needed should you close SiYuan and manually clean this plugin storage directory.

## Security design and privacy

- Document snapshots use AES-256-GCM with a fresh 96-bit IV per encryption and authenticated context binding to the document ID.
- Password and recovery-code keys use PBKDF2-HMAC-SHA-256 with a random 128-bit salt and 600,000 iterations.
- Every snapshot has a random generation ID and is written once. It is then read back, authenticated-decrypted document by document, and compared with the original plaintext.
- The dual manifest slots carry monotonically increasing sequence numbers and normally contain the same latest generation. Startup uses only the newest valid slot; if both are invalid, the plugin stops instead of silently resetting lock state.
- Relocking appends a generation and retains every older reference. Unlocking never writes or refreshes ciphertext.
- The recovery code carries 100 bits of randomness and is shown only during initial locking. Copying it places it on the operating-system clipboard; clear the clipboard after storing it.
- Passwords and recovery codes are held in application memory only while the corresponding dialog or operation needs them. The unwrapped document key remains in memory while the folder is unlocked.
- Encrypted snapshots and wrapped keys are stored in the SiYuan workspace plugin storage. They follow the workspace's backup and synchronization behavior.
- The plugin sends no document content, password, recovery code, or telemetry to a third-party service.

## Known limitations

This plugin is an application-level access barrier, not full-disk encryption and not a secure-erasure tool. Plaintext may remain in SiYuan history, search indexes, database pages, operating-system caches, backups, synchronized replicas, exports, screenshots, or other copies created before or while unlocked. Anyone who controls the running SiYuan process, workspace files, plugin code, browser developer tools, or operating system may be able to access plaintext while the folder is unlocked.

The protected document set is a snapshot. Documents added or moved into the tree while it is locked are not automatically protected. A protected document moved out while locked is still restored by its document ID on the next unlock; if a protected document is deleted or unavailable, unlocking stops instead of dropping its recovery reference. Documents moved out while unlocked leave the protected scope when it is relocked. Review the tree after structural changes. Concurrent edits, synchronization conflicts, forced shutdown, storage exhaustion, kernel errors, or third-party plugins can interrupt relocking. The plugin persists and verifies a new encrypted recovery generation before replacing visible content, preserves non-placeholder plaintext found during unlock, and rolls back partial batches with raw document structures. You must still keep tested workspace backups.

The cryptographic design has not received an independent security audit. No claim of zero knowledge, absolute security, or guaranteed recovery is made.

## Compatibility

- SiYuan 3.7.1 or later with the raw-document APIs required by Security Lock
- Desktop, desktop window, and desktop browser frontends
- Windows, macOS, Linux, and other backends that provide a supported desktop frontend and Web Crypto API

## License

[MIT](LICENSE)
