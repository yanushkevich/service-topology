package httpapi_test

import (
	"encoding/json"
	"strings"
	"testing"
)

// A small board for Order Service: an HTTP endpoint writing to orders-db (ADR-031).
const orderBoard = `{"serviceDefinitionId":"order-service",
 "stations":[{"id":"caller:gw","name":"API Gateway","kind":"caller"},{"id":"gate:http","name":"HTTP ingress","kind":"gate"},
  {"id":"mod:orders","name":"Orders","kind":"module"},{"id":"cli:pg","name":"pg pool","kind":"client"},
  {"id":"dep:db","name":"orders-db","kind":"dependency","entityId":"rds-orders-prod"}],
 "lines":[{"id":"H1","code":"H1","name":"POST /v1/orders","group":"http","signature":"POST /v1/orders","caller":"API Gateway",
  "route":[{"stations":["caller:gw","gate:http","mod:orders","cli:pg","dep:db"],"kind":"sequential"}],"patterns":["idempotency"]}],
 "policies":[{"id":"p1","clientId":"cli:pg","order":0,"type":"timeout","label":"2 s","config":{"timeoutMs":"2000"}}],
 "tables":[{"id":"orders","stationId":"dep:db","name":"orders","writes":["H1"],"reads":[]}]}`

func TestBoardLifecycle(t *testing.T) {
	h, _ := apiHandler(t)
	if res := call(h, "GET", "/api/v1/transit-boards/order-service", ""); res.code != 404 {
		t.Fatalf("no board yet: %d", res.code)
	}

	res := callIfMatch(h, "POST", "/api/v1/transit-boards", orderBoard, "")
	if res.code != 201 || res.hdr.Get("Location") != "/api/v1/transit-boards/order-service" || res.hdr.Get("ETag") != `"1"` {
		t.Fatalf("create: %d %s %v", res.code, res.body, res.hdr)
	}
	if again := callIfMatch(h, "POST", "/api/v1/transit-boards", orderBoard, ""); again.code != 409 {
		t.Fatalf("second create must conflict: %d", again.code)
	}

	got := call(h, "GET", "/api/v1/transit-boards/order-service", "")
	if got.code != 200 || got.hdr.Get("ETag") != `"1"` || !strings.Contains(string(got.body), `"entityId":"rds-orders-prod"`) {
		t.Fatalf("read: %d %s", got.code, got.body)
	}

	renamed := strings.Replace(orderBoard, `"name":"Orders"`, `"name":"Order handling"`, 1)
	res = callIfMatch(h, "PUT", "/api/v1/transit-boards/order-service", renamed, `"1"`)
	if res.code != 200 || res.hdr.Get("ETag") != `"2"` {
		t.Fatalf("replace: %d %s", res.code, res.body)
	}
	if stale := callIfMatch(h, "PUT", "/api/v1/transit-boards/order-service", orderBoard, `"1"`); stale.code != 412 {
		t.Fatalf("stale replace must be 412: %d %s", stale.code, stale.body)
	}

	list := call(h, "GET", "/api/v1/transit-boards", "")
	var page struct {
		Items []struct {
			ServiceDefinitionID string `json:"serviceDefinitionId"`
			Revision            string `json:"revision"`
			Lines               int    `json:"lines"`
		} `json:"items"`
	}
	list.json(t, &page)
	if len(page.Items) != 1 || page.Items[0].Revision != "2" || page.Items[0].Lines != 1 {
		t.Fatalf("list: %+v", page.Items)
	}

	if stale := callIfMatch(h, "DELETE", "/api/v1/transit-boards/order-service", "", `"1"`); stale.code != 412 {
		t.Fatalf("stale delete must be 412: %d", stale.code)
	}
	if res := callIfMatch(h, "DELETE", "/api/v1/transit-boards/order-service", "", `"2"`); res.code != 204 {
		t.Fatalf("delete: %d %s", res.code, res.body)
	}
	if res := call(h, "GET", "/api/v1/transit-boards/order-service", ""); res.code != 404 {
		t.Fatalf("deleted board must be gone: %d", res.code)
	}
}

func TestBoardValidationProblems(t *testing.T) {
	h, _ := apiHandler(t)
	broken := strings.Replace(orderBoard, `"entityId":"rds-orders-prod"`, `"entityId":"no-such-db"`, 1)
	broken = strings.Replace(broken, `"clientId":"cli:pg"`, `"clientId":"mod:orders"`, 1)
	res := callIfMatch(h, "POST", "/api/v1/transit-boards", broken, "")
	if res.code != 422 {
		t.Fatalf("invalid board: %d %s", res.code, res.body)
	}
	var problem struct {
		Errors []struct {
			Code string `json:"code"`
			Path string `json:"path"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(res.body, &problem); err != nil {
		t.Fatal(err)
	}
	want := []string{"board-entity-not-found stations[4].entityId", "invalid-board-policy policies[0].clientId"}
	got := []string{}
	for _, e := range problem.Errors {
		got = append(got, e.Code+" "+e.Path)
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("errors: %v, want %v", got, want)
	}

	// The body's service must be the path's; unknown fields are rejected like everywhere else.
	if res := callIfMatch(h, "PUT", "/api/v1/transit-boards/payment-service", orderBoard, ""); res.code != 422 {
		t.Fatalf("path mismatch: %d", res.code)
	}
	if res := callIfMatch(h, "POST", "/api/v1/transit-boards", strings.Replace(orderBoard, `"tables"`, `"stats":{},"tables"`, 1), ""); res.code != 400 {
		t.Fatalf("observed data must be rejected: %d %s", res.code, res.body)
	}
}
