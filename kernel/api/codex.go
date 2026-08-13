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
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sort"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/logging"
)

type codexProject struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	RootNames []string `json:"rootNames"`
}

type codexProjectState struct {
	LocalProjects map[string]struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		RootPaths []string `json:"rootPaths"`
	} `json:"local-projects"`
}

func getCodexProjects(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	projects, err := loadCodexProjects()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logging.LogWarnf("read Codex projects failed: %s", err)
		}
		ret.Data = []codexProject{}
		return
	}
	ret.Data = projects
}

func loadCodexProjects() ([]codexProject, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(home, ".codex", ".codex-global-state.json"))
	if err != nil {
		return nil, err
	}
	return parseCodexProjects(data)
}

func parseCodexProjects(data []byte) ([]codexProject, error) {
	state := &codexProjectState{}
	if err := json.Unmarshal(data, state); err != nil {
		return nil, err
	}
	projects := make([]codexProject, 0, len(state.LocalProjects))
	for projectID, project := range state.LocalProjects {
		if project.ID == "" {
			project.ID = projectID
		}
		if project.ID == "" || project.Name == "" {
			continue
		}
		rootNames := make([]string, 0, len(project.RootPaths))
		for _, rootPath := range project.RootPaths {
			rootName := filepath.Base(filepath.Clean(rootPath))
			if rootName != "." && rootName != string(filepath.Separator) {
				rootNames = append(rootNames, rootName)
			}
		}
		sort.Strings(rootNames)
		projects = append(projects, codexProject{
			ID:        project.ID,
			Name:      project.Name,
			RootNames: rootNames,
		})
	}
	sort.Slice(projects, func(i, j int) bool {
		return projects[i].ID < projects[j].ID
	})
	return projects, nil
}
