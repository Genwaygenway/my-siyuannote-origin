package model

import (
	"testing"

	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseRawDocumentPreservesStructuredTree(t *testing.T) {
	tree := treenode.NewTree("20260726000000-aaaaaaa", "/20260726000001-bbbbbbb.sy", "/Raw", "Raw")
	childID := tree.Root.FirstChild.ID

	luteEngine := util.NewLute()
	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	parsed, err := parseRawDocument(tree.ID, tree.Box, tree.Path, data)
	if nil != err {
		t.Fatalf("parse raw document failed: %s", err)
	}
	if parsed.Root.FirstChild == nil || parsed.Root.FirstChild.ID != childID {
		t.Fatalf("block identity was not preserved")
	}

	if _, err = parseRawDocument("20260726000003-ddddddd", tree.Box, tree.Path, data); nil == err {
		t.Fatalf("expected identity mismatch")
	}
}
