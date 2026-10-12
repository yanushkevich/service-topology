package domain

import (
	"fmt"
	"slices"
	"strings"
	"unicode"
)

// Enumerations of docs/schemas/topology.v1.schema.json ($defs). fields_test.go checks they equal the
// schema, as the frontend's contract test does for apps/web/src/domain/types.ts.
var (
	ProviderValues             = []string{"aws", "azure", "gcp", "on-prem", "saas", "internal", "unknown"}
	HealthValues               = []string{"healthy", "degraded", "unavailable", "unknown"}
	EnvironmentKindValues      = []string{"development", "staging", "production", "other"}
	ServiceCategoryValues      = []string{"api", "gateway", "application", "worker", "scheduled-job", "other"}
	ResourceTypeValues         = []string{"account", "subscription", "project", "region", "datacenter", "cluster", "namespace", "workload", "database", "cache", "search-index", "broker", "topic", "queue", "exchange", "external-resource", "other"}
	ProtocolValues             = []string{"http", "https", "graphql", "grpc", "websocket", "kafka", "rabbitmq", "tcp", "tls", "postgresql", "mysql", "mongodb", "redis", "other"}
	CommunicationPatternValues = []string{"synchronous", "asynchronous", "streaming", "scheduled", "database", "unknown"}
	DirectionValues            = []string{"unidirectional", "bidirectional"}
	RelationshipStatusValues   = []string{"active", "degraded", "inactive", "unknown"}
)

// KindEventType names event types in write requests (ADR-020). Selection and deep links use the
// other kinds only.
const KindEventType = "event-type"

// WritableKinds are the entity kinds the write API accepts (ADR-020).
var WritableKinds = []string{KindEnvironment, KindServiceDefinition, KindServiceInstance, KindResource, KindRelationship, KindEventType}

// CodeInvalidField reports a field that breaks the TopologyData v1 schema (enum value, required
// field, ID format). Used by the write API before domain validation.
const CodeInvalidField = "invalid-field"

// MaxIDLength bounds stable IDs accepted by the write API (they appear in URLs and logs).
const MaxIDLength = 200

// ValidateEntityFields checks one entity against the schema rules that domain.Validate does not
// cover: required fields, enum values, and ID shape. Names must not be blank (stricter than the
// schema, which only requires a string): an entity without a name cannot be found or displayed.
func ValidateEntityFields(kind string, entity any) []Issue {
	var issues []Issue
	id := ""
	bad := func(field, format string, args ...any) {
		issues = append(issues, Issue{Severity: SeverityError, Code: CodeInvalidField, EntityID: id,
			Message: field + ": " + fmt.Sprintf(format, args...)})
	}
	checkID := func(field, v string) {
		switch {
		case v == "":
			bad(field, "is required")
		case len(v) > MaxIDLength:
			bad(field, "must be at most %d characters", MaxIDLength)
		case strings.TrimSpace(v) != v || strings.ContainsFunc(v, func(r rune) bool { return unicode.IsControl(r) || r == '/' }):
			bad(field, "must not contain slashes, control characters, or surrounding spaces")
		}
	}
	name := func(v string) {
		if strings.TrimSpace(v) == "" {
			bad("name", "is required")
		}
	}
	enum := func(field, v string, allowed []string) {
		if !slices.Contains(allowed, v) {
			bad(field, "%q is not one of %s", v, strings.Join(allowed, ", "))
		}
	}
	optEnum := func(field string, v *string, allowed []string) {
		if v != nil {
			enum(field, *v, allowed)
		}
	}
	optRef := func(field string, v *EntityID) {
		if v != nil {
			checkID(field, *v)
		}
	}
	switch e := entity.(type) {
	case *Environment:
		id = e.ID
		checkID("id", e.ID)
		name(e.Name)
		enum("kind", e.Kind, EnvironmentKindValues)
	case *ServiceDefinition:
		id = e.ID
		checkID("id", e.ID)
		name(e.Name)
		enum("category", e.Category, ServiceCategoryValues)
		for _, p := range e.Protocols {
			enum("protocols", p, ProtocolValues)
		}
	case *ServiceInstance:
		id = e.ID
		checkID("id", e.ID)
		checkID("serviceDefinitionId", e.ServiceDefinitionID)
		if e.EnvironmentID == nil {
			bad("environmentId", "is required")
		} else {
			checkID("environmentId", *e.EnvironmentID)
		}
		enum("provider", e.Provider, ProviderValues)
		enum("health", e.Health, HealthValues)
		optRef("resourceId", e.ResourceID)
	case *InfrastructureResource:
		id = e.ID
		checkID("id", e.ID)
		name(e.Name)
		enum("type", e.Type, ResourceTypeValues)
		enum("provider", e.Provider, ProviderValues)
		optEnum("health", e.Health, HealthValues)
		optRef("parentResourceId", e.ParentResourceID)
		optRef("environmentId", e.EnvironmentID)
	case *CommunicationRelationship:
		id = e.ID
		checkID("id", e.ID)
		checkID("sourceEntityId", e.SourceEntityID)
		checkID("targetEntityId", e.TargetEntityID)
		enum("protocol", e.Protocol, ProtocolValues)
		enum("pattern", e.Pattern, CommunicationPatternValues)
		enum("direction", e.Direction, DirectionValues)
		enum("status", e.Status, RelationshipStatusValues)
	case *EventType:
		id = e.ID
		checkID("id", e.ID)
		name(e.Name)
		for field, ids := range map[string][]EntityID{"channelResourceIds": e.ChannelResourceIDs, "producerServiceIds": e.ProducerServiceIDs, "consumerServiceIds": e.ConsumerServiceIDs} {
			for _, v := range ids {
				checkID(field, v)
			}
		}
	default:
		bad("kind", "%s is not writable", kind)
	}
	return issues
}
