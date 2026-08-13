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

package api

import (
	"reflect"
	"testing"
)

func TestParseCodexProjects(t *testing.T) {
	projects, err := parseCodexProjects([]byte(`{
        "local-projects": {
            "siyuan": {
                "name": "思源笔记",
                "rootPaths": ["/Users/example/ProjectSummary/siyuan-note"]
            },
            "meta": {
                "id": "meta-project",
                "name": "MetaHorizon 交付文档专用",
                "rootPaths": ["/Users/example/ProjectSummary/VersperAIPrompt"]
            }
        }
    }`))
	if err != nil {
		t.Fatalf("parse Codex projects failed: %s", err)
	}
	expected := []codexProject{
		{ID: "meta-project", Name: "MetaHorizon 交付文档专用", RootNames: []string{"VersperAIPrompt"}},
		{ID: "siyuan", Name: "思源笔记", RootNames: []string{"siyuan-note"}},
	}
	if !reflect.DeepEqual(expected, projects) {
		t.Fatalf("unexpected Codex projects: %#v", projects)
	}
}
