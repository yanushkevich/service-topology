package mongodb

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"go.mongodb.org/mongo-driver/v2/bson"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

// roundTrip stores v the way the adapter does (JSON → BSON bytes) and reads it back as JSON.
func roundTrip(t *testing.T, v any) []byte {
	t.Helper()
	d, err := toDocument(v)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := bson.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	out, err := toJSON(raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func sameJSON(t *testing.T, a, b []byte) {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(x, y) {
		t.Fatalf("round trip changed the value\nwant: %.500s\n got: %.500s", a, b)
	}
}

// User-controlled keys and values (metadata, layout positions, event payloads) must round-trip
// literally: no Extended JSON interpretation, no lost precision, no reordered arrays.
func TestDocumentsRoundTripLiterally(t *testing.T) {
	in := map[string]any{
		"extended":  map[string]any{"$date": "2026-10-11", "$oid": "x", "$numberLong": "5", "$regex": ".*"},
		"dotted":    map[string]any{"app.kubernetes.io/name": "orders", "a.b.c": 1},
		"numbers":   []any{0, -1, 9007199254740993, 0.1, -2.5, 1e21, 1.7976931348623157e308, 5e-324, 123456789.123},
		"strings":   []any{"", "ünïcødé ✓", "line\nbreak", `quote"and\backslash`, "<script>"},
		"nested":    map[string]any{"empty": map[string]any{}, "list": []any{[]any{}, nil, true, false}},
		"nullValue": nil,
	}
	want, _ := json.Marshal(in)
	sameJSON(t, want, roundTrip(t, in))

	// Large integers keep every digit (they are int64, not float64).
	var got map[string]json.RawMessage
	_ = json.Unmarshal(roundTrip(t, map[string]any{"n": json.Number("9007199254740993")}), &got)
	if string(got["n"]) != "9007199254740993" {
		t.Fatalf("large integer: %s", got["n"])
	}
}

func TestFixturesRoundTripExactly(t *testing.T) {
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"topology/mock.v1.json", "topology/inventory-1000.v1.json"} {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		var data domain.TopologyData
		if err := fixtures.DecodeStrict(raw, &data); err != nil {
			t.Fatal(err)
		}
		sameJSON(t, raw, roundTrip(t, &data))
	}
	snaps, _ := filepath.Glob(filepath.Join(dir, "snapshots", "*.json"))
	for _, file := range snaps {
		raw, _ := os.ReadFile(file)
		var s domain.Snapshot
		if err := fixtures.DecodeStrict(raw, &s); err != nil {
			t.Fatal(err)
		}
		var back domain.Snapshot
		if err := decodeStrict(roundTrip(t, &s), &back); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		a, _ := json.Marshal(&s)
		b, _ := json.Marshal(&back)
		if string(a) != string(b) {
			t.Fatalf("%s changed after a round trip", file)
		}
	}
}

func TestReadsStripBookkeepingAndRejectUnknownFields(t *testing.T) {
	env := domain.Environment{ID: "production", Name: "Production"}
	d, err := canonicalDoc(env.ID, env, bson.D{{Key: "ord", Value: 0}})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := bson.Marshal(d)
	var back domain.Environment
	if err := fromDocument(raw, stripped, &back); err != nil || !reflect.DeepEqual(back, env) {
		t.Fatalf("got %+v, %v", back, err)
	}
	extra, _ := bson.Marshal(append(d, bson.E{Key: "unexpected", Value: 1}))
	if err := fromDocument(extra, stripped, &back); err == nil {
		t.Fatal("a stored field outside the domain model must be an error")
	}
	odd, _ := bson.Marshal(bson.D{{Key: "id", Value: bson.NewObjectID()}})
	if err := fromDocument(odd, nil, &back); err == nil {
		t.Fatal("BSON types the adapter never writes must be an error")
	}
}
