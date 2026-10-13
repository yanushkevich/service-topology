package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"

	"servicetopology/backend/internal/domain"
)

// bundleOf is a data bundle (ADR-032) of data plus the given boards.
func bundleOf(t *testing.T, data *domain.TopologyData, boards ...string) string {
	t.Helper()
	b := domain.Bundle{Format: domain.BundleFormat, Version: domain.BundleVersion, ExportedAt: "2026-10-13T09:30:00Z", Source: domain.BundleSource{Label: "test", IsMock: true}, TopologyData: *data}
	for _, raw := range boards {
		var def domain.BoardDefinition
		if err := json.Unmarshal([]byte(raw), &def); err != nil {
			t.Fatal(err)
		}
		b.TransitBoards = append(b.TransitBoards, def)
	}
	out, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func TestBundleImportReplacesTopologyAndBoards(t *testing.T) {
	h, store := apiHandler(t)
	before := call(h, "GET", "/api/v1/topology", "")
	data := *store.Data
	data.EventTypes, data.BusinessFlows = nil, nil // a smaller, still valid topology: no events or flows
	bundle := bundleOf(t, &data, orderBoard)

	if stale := callIfMatch(h, "POST", "/api/v1/imports/bundle", bundle, `"not-the-revision"`); stale.code != 412 {
		t.Fatalf("stale import must be 412: %d %s", stale.code, stale.body)
	}
	res := callIfMatch(h, "POST", "/api/v1/imports/bundle", bundle, before.hdr.Get("ETag"))
	if res.code != 200 || res.hdr.Get("ETag") == "" || res.hdr.Get("ETag") == before.hdr.Get("ETag") {
		t.Fatalf("import: %d %s %v", res.code, res.body, res.hdr)
	}
	var out struct {
		Documents map[string]int `json:"documents"`
		Boards    int            `json:"boards"`
	}
	res.json(t, &out)
	if out.Boards != 1 || out.Documents["serviceDefinitions"] != len(data.ServiceDefinitions) || out.Documents["eventTypes"] != 0 || out.Documents["businessFlows"] != 0 {
		t.Fatalf("import result: %+v", out)
	}
	if board := call(h, "GET", "/api/v1/transit-boards/order-service", ""); board.code != 200 || board.hdr.Get("ETag") != `"1"` {
		t.Fatalf("imported board: %d %v", board.code, board.hdr)
	}
	if events := call(h, "GET", "/api/v1/event-types?environmentId=production", ""); events.code != 200 || strings.Contains(string(events.body), `"id"`) {
		t.Fatalf("event types must be replaced: %d %s", events.code, events.body)
	}
}

func TestBundleImportRejectsInvalidBundlesAndWritesNothing(t *testing.T) {
	h, store := apiHandler(t)
	before := call(h, "GET", "/api/v1/topology", "").hdr.Get("ETag")
	dup := bundleOf(t, store.Data, orderBoard, orderBoard)
	res := callIfMatch(h, "POST", "/api/v1/imports/bundle", dup, "")
	var problem struct {
		Errors []struct {
			Code string `json:"code"`
			Path string `json:"path"`
		} `json:"errors"`
	}
	res.json(t, &problem)
	if res.code != 422 || len(problem.Errors) != 1 || problem.Errors[0].Code != domain.CodeBundleDuplicateBoard || problem.Errors[0].Path != "transitBoards[1].serviceDefinitionId" {
		t.Fatalf("duplicate board: %d %s", res.code, res.body)
	}
	blank := strings.Replace(bundleOf(t, store.Data), `"name":"Production"`, `"name":" "`, 1)
	if res := callIfMatch(h, "POST", "/api/v1/imports/bundle", blank, ""); res.code != 422 || !strings.Contains(string(res.body), domain.CodeInvalidField) {
		t.Fatalf("field checks: %d %s", res.code, res.body)
	}
	if res := callIfMatch(h, "POST", "/api/v1/imports/bundle", "{nope", ""); res.code != 400 {
		t.Fatalf("malformed: %d", res.code)
	}
	if after := call(h, "GET", "/api/v1/topology", "").hdr.Get("ETag"); after != before {
		t.Fatalf("a rejected import changed the revision: %s -> %s", before, after)
	}
}
