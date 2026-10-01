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

package model

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var updateDocRawLock sync.Mutex

// GetDocRaw 返回当前文档的原始 .sy JSON，不经过 Markdown 或 BlockDOM 转换。
func GetDocRaw(id string) (content, box, path string, err error) {
	bt := treenode.GetBlockTree(id)
	if nil == bt || "d" != bt.Type || bt.RootID != id {
		err = errors.New("document not found")
		return
	}

	data, readErr := filelock.ReadFile(filepath.Join(util.DataDir, bt.BoxID, bt.Path))
	if nil != readErr {
		err = fmt.Errorf("read document failed: %w", readErr)
		return
	}
	content = string(data)
	box = bt.BoxID
	path = bt.Path
	return
}

// UpdateDocRaw 使用原始 .sy JSON 替换同一文档，并在失败时恢复原树。
func UpdateDocRaw(id string, data []byte) (err error) {
	updateDocRawLock.Lock()
	defer updateDocRawLock.Unlock()

	bt := treenode.GetBlockTree(id)
	if nil == bt || "d" != bt.Type || bt.RootID != id {
		return errors.New("document not found")
	}

	luteEngine := util.NewLute()
	currentTree, err := filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	if nil != err {
		return fmt.Errorf("load current document failed: %w", err)
	}
	replacementTree, err := parseRawDocument(id, bt.BoxID, bt.Path, data)
	if nil != err {
		return err
	}
	if err = ensureRawDocumentIDsAvailable(id, replacementTree); nil != err {
		return err
	}

	CreateDocHistory(id)
	treenode.RemoveBlockTreesByRootID(bt.BoxID, id)
	sql.RemoveTreeQueue(bt.BoxID, id)
	if err = indexWriteTreeIndexQueue(replacementTree); nil != err {
		treenode.RemoveBlockTreesByRootID(bt.BoxID, id)
		sql.RemoveTreeQueue(bt.BoxID, id)
		if rollbackErr := indexWriteTreeIndexQueue(currentTree); nil != rollbackErr {
			return fmt.Errorf("replace document failed: %w; rollback failed: %v", err, rollbackErr)
		}
		return fmt.Errorf("replace document failed: %w", err)
	}

	ReloadFiletree()
	ReloadProtyle(id)
	for _, avNode := range replacementTree.Root.ChildrenByType(ast.NodeAttributeView) {
		ReloadAttrView(avNode.AttributeViewID)
	}
	IncSync()
	return nil
}

func parseRawDocument(id, box, path string, data []byte) (tree *parse.Tree, err error) {
	if 0 == len(data) {
		return nil, errors.New("document content is empty")
	}
	tree, err = filesys.LoadTreeByData(data, box, path, util.NewLute())
	if nil != err {
		return nil, fmt.Errorf("parse document failed: %w", err)
	}
	if nil == tree.Root || ast.NodeDocument != tree.Root.Type || tree.ID != id || tree.Root.ID != id {
		return nil, errors.New("document identity mismatch")
	}
	return tree, nil
}

func ensureRawDocumentIDsAvailable(rootID string, tree *parse.Tree) error {
	seen := map[string]struct{}{}
	var ids []string
	var invalidID string
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() {
			return ast.WalkContinue
		}
		if "" == node.ID {
			invalidID = "empty"
			return ast.WalkStop
		}
		if _, exists := seen[node.ID]; exists {
			invalidID = node.ID
			return ast.WalkStop
		}
		seen[node.ID] = struct{}{}
		ids = append(ids, node.ID)
		return ast.WalkContinue
	})
	if "" != invalidID {
		return fmt.Errorf("duplicate or empty block ID: %s", invalidID)
	}

	for id, bt := range treenode.GetBlockTrees(ids) {
		if bt.RootID != rootID {
			return fmt.Errorf("block ID belongs to another document: %s", id)
		}
	}
	return nil
}
