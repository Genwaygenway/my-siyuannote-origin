// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package sharedstorage

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestStoreKeepsDeviceShardsAndLegacyValue(t *testing.T) {
	dataDir := t.TempDir()
	legacyDir := filepath.Join(dataDir, "storage", "siyuan-custom")
	if err := os.MkdirAll(legacyDir, 0755); err != nil {
		t.Fatal(err)
	}
	legacyData := []byte(`{"items":[{"id":"legacy"}]}`)
	legacyPath := filepath.Join(legacyDir, TodoKey+".json")
	if err := os.WriteFile(legacyPath, legacyData, 0644); err != nil {
		t.Fatal(err)
	}

	first := New(dataDir, "desktop-device")
	second := New(dataDir, "mobile-device")
	firstSnapshot, err := first.Read(TodoKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, conflict, err := first.Write(TodoKey, firstSnapshot.Revision, map[string]any{"items": []any{map[string]any{"id": "desktop"}}}); err != nil || conflict {
		t.Fatalf("first write failed: conflict=%v err=%v", conflict, err)
	}
	secondSnapshot, err := second.Read(TodoKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, conflict, err := second.Write(TodoKey, secondSnapshot.Revision, map[string]any{"items": []any{map[string]any{"id": "mobile"}}}); err != nil || conflict {
		t.Fatalf("second write failed: conflict=%v err=%v", conflict, err)
	}

	result, err := first.Read(TodoKey)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Values) != 3 {
		t.Fatalf("expected legacy plus two device shards, got %d", len(result.Values))
	}
	if first.devicePath(TodoKey) == second.devicePath(TodoKey) {
		t.Fatal("different devices must not share a shard path")
	}
	afterWrite, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(afterWrite) != string(legacyData) {
		t.Fatalf("legacy file must remain read-only, got %s", afterWrite)
	}
}

func TestStoreRejectsStaleRevisionWithoutOverwriting(t *testing.T) {
	store := New(t.TempDir(), "same-device")
	initial, err := store.Read(KnowledgeKey)
	if err != nil {
		t.Fatal(err)
	}
	firstValue := map[string]any{"notebooks": []string{"first"}}
	written, conflict, err := store.Write(KnowledgeKey, initial.Revision, firstValue)
	if err != nil || conflict {
		t.Fatalf("initial write failed: conflict=%v err=%v", conflict, err)
	}

	conflictSnapshot, conflict, err := store.Write(KnowledgeKey, initial.Revision, map[string]any{"notebooks": []string{"stale"}})
	if err != nil {
		t.Fatal(err)
	}
	if !conflict {
		t.Fatal("expected stale revision conflict")
	}
	if conflictSnapshot.Revision != written.Revision {
		t.Fatalf("expected current revision %q, got %q", written.Revision, conflictSnapshot.Revision)
	}

	data, err := os.ReadFile(store.devicePath(KnowledgeKey))
	if err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err = json.Unmarshal(data, &stored); err != nil {
		t.Fatal(err)
	}
	if stored["notebooks"].([]any)[0] != "first" {
		t.Fatalf("stale write overwrote the current value: %s", data)
	}
}

func TestStoreSerializesConcurrentWritersForSameDevice(t *testing.T) {
	store := New(t.TempDir(), "same-device")
	initial, err := store.Read(TodoKey)
	if err != nil {
		t.Fatal(err)
	}

	type writeResult struct {
		conflict bool
		err      error
	}
	results := make(chan writeResult, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	start := make(chan struct{})
	for _, id := range []string{"first", "second"} {
		go func(id string) {
			ready.Done()
			<-start
			_, conflict, writeErr := store.Write(TodoKey, initial.Revision, map[string]any{"id": id})
			results <- writeResult{conflict: conflict, err: writeErr}
		}(id)
	}
	ready.Wait()
	close(start)

	successes := 0
	conflicts := 0
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.conflict {
			conflicts++
		} else {
			successes++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("expected one success and one conflict, got successes=%d conflicts=%d", successes, conflicts)
	}
}

func TestStoreRejectsUnknownKey(t *testing.T) {
	store := New(t.TempDir(), "device")
	if _, err := store.Read("../../conf"); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("expected ErrInvalidKey, got %v", err)
	}
	if _, _, err := store.Write("arbitrary", "", map[string]any{}); !errors.Is(err, ErrInvalidKey) {
		t.Fatalf("expected ErrInvalidKey, got %v", err)
	}
}

func TestStoreRejectsEmptyDeviceID(t *testing.T) {
	store := New(t.TempDir(), "")
	if _, err := store.Read(TodoKey); !errors.Is(err, ErrInvalidDeviceID) {
		t.Fatalf("expected ErrInvalidDeviceID, got %v", err)
	}
	if _, _, err := store.Write(TodoKey, "", map[string]any{}); !errors.Is(err, ErrInvalidDeviceID) {
		t.Fatalf("expected ErrInvalidDeviceID, got %v", err)
	}
}

func TestChangedRecognizesOnlySharedStoragePaths(t *testing.T) {
	if !Changed([]string{"/storage/siyuan-custom/local-todo/device.json"}) {
		t.Fatal("expected shared storage path to be recognized")
	}
	if Changed([]string{"/storage/local.json", "/storage/siyuan-customized/file.json"}) {
		t.Fatal("unrelated storage paths must not be recognized")
	}
}

func TestStoreSkipsCorruptedFilesAndRepairsCurrentShard(t *testing.T) {
	dataDir := t.TempDir()
	store := New(dataDir, "device")
	if err := os.MkdirAll(store.shardDir(TodoKey), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.legacyPath(TodoKey), []byte("broken legacy"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store.shardDir(TodoKey), "another.json"), []byte("broken shard"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.devicePath(TodoKey), []byte("broken current shard"), 0644); err != nil {
		t.Fatal(err)
	}

	snapshot, err := store.Read(TodoKey)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Values) != 0 {
		t.Fatalf("expected corrupted values to be skipped, got %d", len(snapshot.Values))
	}
	if snapshot.Revision == "" {
		t.Fatal("corrupted current shard must still have a revision for CAS repair")
	}

	repaired, conflict, err := store.Write(TodoKey, snapshot.Revision, map[string]any{"items": []any{}})
	if err != nil || conflict {
		t.Fatalf("repair write failed: conflict=%v err=%v", conflict, err)
	}
	if len(repaired.Values) != 1 {
		t.Fatalf("expected repaired current shard, got %d values", len(repaired.Values))
	}
}
