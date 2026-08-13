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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/siyuan-note/filelock"
)

const (
	TodoKey      = "local-todo"
	KnowledgeKey = "local-knowledge"
)

var (
	ErrInvalidKey      = errors.New("invalid shared storage key")
	ErrInvalidDeviceID = errors.New("invalid shared storage device ID")
)

var storageLock sync.Mutex

// Snapshot 描述所有设备分片及当前设备分片的修订号。
type Snapshot struct {
	Values   []any  `json:"values"`
	Revision string `json:"revision"`
}

// Store 将共享数据按设备写入独立文件，避免数据同步时多个设备覆盖同一个文件。
type Store struct {
	dataDir  string
	deviceID string
}

func New(dataDir, deviceID string) *Store {
	return &Store{dataDir: dataDir, deviceID: deviceID}
}

// Changed 报告同步路径中是否包含共享存储分片。
func Changed(paths []string) bool {
	for _, path := range paths {
		path = filepath.ToSlash(path)
		if strings.HasPrefix(path, "/storage/siyuan-custom/") || strings.HasPrefix(path, "storage/siyuan-custom/") {
			return true
		}
	}
	return false
}

func (store *Store) Read(key string) (Snapshot, error) {
	storageLock.Lock()
	defer storageLock.Unlock()

	return store.readLocked(key)
}

// Write 在当前设备分片修订号未变化时写入，并返回包含最新分片的快照。
func (store *Store) Write(key, expectedRevision string, value any) (snapshot Snapshot, conflict bool, err error) {
	storageLock.Lock()
	defer storageLock.Unlock()

	if !isValidKey(key) {
		err = ErrInvalidKey
		return
	}
	if strings.TrimSpace(store.deviceID) == "" {
		err = ErrInvalidDeviceID
		return
	}

	currentData, readErr := readOptionalFile(store.devicePath(key))
	if readErr != nil {
		err = readErr
		return
	}
	if revision(currentData) != expectedRevision {
		conflict = true
		snapshot, err = store.readLocked(key)
		return
	}

	data, marshalErr := json.Marshal(value)
	if marshalErr != nil {
		err = marshalErr
		return
	}
	if err = os.MkdirAll(store.shardDir(key), 0755); err != nil {
		return
	}
	if err = filelock.WriteFile(store.devicePath(key), data); err != nil {
		return
	}

	snapshot, err = store.readLocked(key)
	return
}

func (store *Store) readLocked(key string) (snapshot Snapshot, err error) {
	if !isValidKey(key) {
		err = ErrInvalidKey
		return
	}
	if strings.TrimSpace(store.deviceID) == "" {
		err = ErrInvalidDeviceID
		return
	}

	legacyData, readErr := readOptionalFile(store.legacyPath(key))
	if readErr != nil {
		err = readErr
		return
	}
	if len(legacyData) > 0 {
		var value any
		if jsonErr := json.Unmarshal(legacyData, &value); jsonErr == nil {
			snapshot.Values = append(snapshot.Values, value)
		}
	}

	entries, readDirErr := os.ReadDir(store.shardDir(key))
	if readDirErr != nil && !os.IsNotExist(readDirErr) {
		err = readDirErr
		return
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, fileErr := readOptionalFile(filepath.Join(store.shardDir(key), entry.Name()))
		if os.IsNotExist(fileErr) {
			continue
		}
		if fileErr != nil {
			err = fileErr
			return
		}
		if len(data) == 0 {
			continue
		}
		var value any
		if jsonErr := json.Unmarshal(data, &value); jsonErr != nil {
			continue
		}
		snapshot.Values = append(snapshot.Values, value)
	}

	deviceData, readDeviceErr := readOptionalFile(store.devicePath(key))
	if readDeviceErr != nil {
		err = readDeviceErr
		return
	}
	snapshot.Revision = revision(deviceData)
	if snapshot.Values == nil {
		snapshot.Values = []any{}
	}
	return
}

func (store *Store) rootDir() string {
	return filepath.Join(store.dataDir, "storage", "siyuan-custom")
}

func (store *Store) legacyPath(key string) string {
	return filepath.Join(store.rootDir(), key+".json")
}

func (store *Store) shardDir(key string) string {
	return filepath.Join(store.rootDir(), key)
}

func (store *Store) devicePath(key string) string {
	digest := sha256.Sum256([]byte(store.deviceID))
	return filepath.Join(store.shardDir(key), hex.EncodeToString(digest[:])+".json")
}

func isValidKey(key string) bool {
	return key == TodoKey || key == KnowledgeKey
}

func readOptionalFile(path string) ([]byte, error) {
	data, err := filelock.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	return data, err
}

func revision(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
