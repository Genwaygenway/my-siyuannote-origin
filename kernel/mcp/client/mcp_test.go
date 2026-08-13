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

package client

import (
	"errors"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestIsReconnectableError(t *testing.T) {
	sseErr := errors.New(`connection closed: standalone SSE stream: exceeded 5 retries without progress`)
	if !isReconnectableError(sseErr) {
		t.Fatal("expected SSE disconnect to be reconnectable")
	}

	authErr := errors.New("401 Unauthorized: invalid_token")
	if isReconnectableError(authErr) {
		t.Fatal("expected auth error not to trigger reconnect")
	}
}

func TestBuildCodexResumeArgs(t *testing.T) {
	args, err := buildCodexResumeArgs(
		[]string{"mcp-server", "-c", "feature=true"},
		CodexResumeOptions{
			ThreadID:        "019fad36-85af-78b3-ab0d-d1d686bd5c22",
			Prompt:          "continue",
			Model:           "gpt-5.6-sol",
			ReasoningEffort: "xhigh",
			Permission:      "siyuan-write",
		},
		"/tmp/codex-output.txt",
		"/tmp/workspace/temp",
		"workspace-write",
	)
	if err != nil {
		t.Fatalf("build args failed: %s", err)
	}
	expected := []string{
		"exec", "-c", "feature=true",
		"--sandbox", "workspace-write",
		"--cd", "/tmp/workspace/temp",
		"--skip-git-repo-check",
		"--color", "never",
		"--output-last-message", "/tmp/codex-output.txt",
		"-c", `approval_policy="never"`,
		"--model", "gpt-5.6-sol",
		"-c", `model_reasoning_effort="xhigh"`,
		"-c", "sandbox_workspace_write.network_access=true",
		"resume", "019fad36-85af-78b3-ab0d-d1d686bd5c22", "continue",
	}
	if !reflect.DeepEqual(args, expected) {
		t.Fatalf("unexpected args:\n%v\nwant:\n%v", args, expected)
	}
}

func TestFindCodexServer(t *testing.T) {
	servers := []conf.MCPServer{
		{Name: "Other", Enabled: true, Type: "stdio", Command: "other", Args: []string{"mcp-server"}},
		{Name: "Codex", Enabled: true, Type: "stdio", Command: "codex", Args: []string{"mcp-server"}},
	}
	server, err := findCodexServer(servers)
	if err != nil {
		t.Fatalf("find server failed: %s", err)
	}
	if server.Command != "codex" {
		t.Fatalf("unexpected server command: %s", server.Command)
	}
}
