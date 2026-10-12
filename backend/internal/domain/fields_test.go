package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// The enums used by the write API must equal the TopologyData v1 schema (the frontend checks its
// own copies against the same file).
func TestFieldEnumsMatchTheSchema(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "schemas", "topology.v1.schema.json"))
	if err != nil {
		t.Fatal(err)
	}
	var schema struct {
		Defs map[string]struct {
			Enum []string `json:"enum"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &schema); err != nil {
		t.Fatal(err)
	}
	for def, got := range map[string][]string{
		"Provider": ProviderValues, "HealthStatus": HealthValues, "EnvironmentKind": EnvironmentKindValues,
		"ServiceCategory": ServiceCategoryValues, "ResourceType": ResourceTypeValues, "Protocol": ProtocolValues,
		"CommunicationPattern": CommunicationPatternValues, "RelationshipStatus": RelationshipStatusValues,
	} {
		if want := schema.Defs[def].Enum; !reflect.DeepEqual(got, want) {
			t.Errorf("%s: code %v, schema %v", def, got, want)
		}
	}
}

func TestValidateEntityFields(t *testing.T) {
	env := "production"
	bad := "ibm"
	cases := []struct {
		name   string
		kind   string
		entity any
		want   []string // substrings of messages; empty = valid
	}{
		{"valid environment", KindEnvironment, &Environment{ID: "qa", Name: "QA", Kind: "other"}, nil},
		{"blank name and bad kind", KindEnvironment, &Environment{ID: "qa", Name: "  ", Kind: "test"}, []string{"name: is required", `kind: "test"`}},
		{"id with slash", KindEnvironment, &Environment{ID: "a/b", Name: "A", Kind: "other"}, []string{"id: must not contain slashes"}},
		{"id too long", KindEnvironment, &Environment{ID: strings.Repeat("x", MaxIDLength+1), Name: "A", Kind: "other"}, []string{"at most"}},
		{"unknown protocol", KindServiceDefinition, &ServiceDefinition{ID: "d", Name: "D", Category: "api", Protocols: []string{"https", "smtp"}}, []string{`protocols: "smtp"`}},
		{"instance without environment", KindServiceInstance, &ServiceInstance{ID: "i", ServiceDefinitionID: "d", Provider: "aws", Health: "healthy"}, []string{"environmentId: is required"}},
		{"valid instance", KindServiceInstance, &ServiceInstance{ID: "i", ServiceDefinitionID: "d", EnvironmentID: &env, Provider: "aws", Health: "healthy"}, nil},
		{"resource optional health", KindResource, &InfrastructureResource{ID: "r", Name: "R", Type: "database", Provider: "aws", Health: &bad}, []string{`health: "ibm"`}},
		{"relationship enums", KindRelationship, &CommunicationRelationship{ID: "x", SourceEntityID: "a", TargetEntityID: "b", Protocol: "https", Pattern: "sync", Direction: "both", Status: "active"}, []string{`pattern: "sync"`, `direction: "both"`}},
		{"event type empty reference", KindEventType, &EventType{ID: "e", Name: "E", ProducerServiceIDs: []EntityID{""}}, []string{"producerServiceIds: is required"}},
	}
	for _, c := range cases {
		issues := ValidateEntityFields(c.kind, c.entity)
		if len(c.want) == 0 && len(issues) > 0 {
			t.Errorf("%s: unexpected %+v", c.name, issues)
		}
		for _, w := range c.want {
			found := false
			for _, i := range issues {
				found = found || (strings.Contains(i.Message, w) && i.Code == CodeInvalidField)
			}
			if !found {
				t.Errorf("%s: no issue containing %q in %+v", c.name, w, issues)
			}
		}
	}
}
