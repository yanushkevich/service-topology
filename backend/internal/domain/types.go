// Package domain holds the canonical topology model and its integrity rules. It mirrors
// apps/web/src/domain (types.ts, validation.ts, eventFlow.ts) and docs/schemas/topology.v1.schema.json,
// and must not import HTTP, database, or other adapter packages (enforced by boundaries_test.go).
package domain

// EntityID is a stable, opaque identifier, unique across all collections of one topology.
type EntityID = string

// Containment-only resource types can never be communication endpoints (ADR-008).
var containmentOnlyResourceTypes = map[string]bool{
	"account": true, "subscription": true, "project": true, "region": true,
	"datacenter": true, "cluster": true, "namespace": true,
}

// Resource types that can carry event types (ADR-014).
var eventChannelTypes = map[string]bool{"topic": true, "queue": true, "exchange": true}

// Metrics is telemetry on an entity or relationship. IsSimulated is required by the contract.
type Metrics struct {
	LatencyMs           *float64 `json:"latencyMs,omitempty"`
	ThroughputPerSecond *float64 `json:"throughputPerSecond,omitempty"`
	ErrorRatePercent    *float64 `json:"errorRatePercent,omitempty"`
	IsSimulated         bool     `json:"isSimulated"`
	ObservedAt          *string  `json:"observedAt,omitempty"`
}

// Environment is an isolated deployment context (production, staging, …).
type Environment struct {
	ID   EntityID `json:"id"`
	Name string   `json:"name"`
	Kind string   `json:"kind"`
}

// ServiceDefinition is a logical capability with no environment.
type ServiceDefinition struct {
	ID          EntityID       `json:"id"`
	Name        string         `json:"name"`
	Description *string        `json:"description,omitempty"`
	Owner       *string        `json:"owner,omitempty"`
	Team        *string        `json:"team,omitempty"`
	Category    string         `json:"category"`
	Protocols   []string       `json:"protocols"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// ServiceInstance is one deployment of a definition in exactly one environment. EnvironmentID is a
// pointer only so untyped adapter data with a missing or null value can be reported, as the TypeScript
// validator does.
type ServiceInstance struct {
	ID                  EntityID       `json:"id"`
	ServiceDefinitionID EntityID       `json:"serviceDefinitionId"`
	EnvironmentID       *EntityID      `json:"environmentId"`
	Provider            string         `json:"provider"`
	Health              string         `json:"health"`
	Version             *string        `json:"version,omitempty"`
	Endpoint            *string        `json:"endpoint,omitempty"`
	ResourceID          *EntityID      `json:"resourceId,omitempty"`
	Metrics             *Metrics       `json:"metrics,omitempty"`
	UpdatedAt           string         `json:"updatedAt"`
	Metadata            map[string]any `json:"metadata,omitempty"`
}

// InfrastructureResource covers infrastructure, containment levels, and messaging channels.
type InfrastructureResource struct {
	ID               EntityID       `json:"id"`
	Name             string         `json:"name"`
	Type             string         `json:"type"`
	Provider         string         `json:"provider"`
	ParentResourceID *EntityID      `json:"parentResourceId,omitempty"`
	EnvironmentID    *EntityID      `json:"environmentId,omitempty"`
	Health           *string        `json:"health,omitempty"`
	Owner            *string        `json:"owner,omitempty"`
	Team             *string        `json:"team,omitempty"`
	Metrics          *Metrics       `json:"metrics,omitempty"`
	UpdatedAt        *string        `json:"updatedAt,omitempty"`
	Metadata         map[string]any `json:"metadata,omitempty"`
}

// CommunicationRelationship is runtime communication ("what talks to what"), never containment.
type CommunicationRelationship struct {
	ID                 EntityID       `json:"id"`
	SourceEntityID     EntityID       `json:"sourceEntityId"`
	TargetEntityID     EntityID       `json:"targetEntityId"`
	Protocol           string         `json:"protocol"`
	Pattern            string         `json:"pattern"`
	Direction          string         `json:"direction"`
	Status             string         `json:"status"`
	AuthenticationType *string        `json:"authenticationType,omitempty"`
	Endpoint           *string        `json:"endpoint,omitempty"`
	Metrics            *Metrics       `json:"metrics,omitempty"`
	Metadata           map[string]any `json:"metadata,omitempty"`
	UpdatedAt          string         `json:"updatedAt"`
}

// EventType is a logical message contract carried on a topic, queue, or exchange (ADR-014).
type EventType struct {
	ID                 EntityID       `json:"id"`
	Name               string         `json:"name"`
	Description        *string        `json:"description,omitempty"`
	SchemaVersion      *string        `json:"schemaVersion,omitempty"`
	Owner              *string        `json:"owner,omitempty"`
	Team               *string        `json:"team,omitempty"`
	ChannelResourceIDs []EntityID     `json:"channelResourceIds"`
	ProducerServiceIDs []EntityID     `json:"producerServiceIds"`
	ConsumerServiceIDs []EntityID     `json:"consumerServiceIds"`
	Metadata           map[string]any `json:"metadata,omitempty"`
}

// TopologyData is the canonical payload (TopologyData v1). EventTypes and BusinessFlows are optional (nil = absent).
type TopologyData struct {
	Environments       []Environment               `json:"environments"`
	ServiceDefinitions []ServiceDefinition         `json:"serviceDefinitions"`
	ServiceInstances   []ServiceInstance           `json:"serviceInstances"`
	Resources          []InfrastructureResource    `json:"resources"`
	Relationships      []CommunicationRelationship `json:"relationships"`
	EventTypes         []EventType                 `json:"eventTypes,omitempty"`
	BusinessFlows      []BusinessFlow              `json:"businessFlows,omitempty"`
}

// Entity kinds used by selection and deep links ({kind, id}).
const (
	KindEnvironment       = "environment"
	KindServiceDefinition = "service-definition"
	KindServiceInstance   = "service-instance"
	KindResource          = "resource"
	KindRelationship      = "relationship"
)

// EntityRef is how every view refers to an entity: canonical kind + ID.
type EntityRef struct {
	Kind string   `json:"kind"`
	ID   EntityID `json:"id"`
}
