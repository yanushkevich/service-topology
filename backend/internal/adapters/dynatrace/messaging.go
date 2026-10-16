package dynatrace

import (
	"strings"

	"servicetopology/backend/internal/domain"
)

// Topics and queues from the messaging metrics (Milestone 15.1, docs/DYNATRACE_CONNECTOR.md §1):
// Smartscape has no channel nodes, so a channel is a (system, destination) a service published to
// or received from in the discovery window, one per environment. Relationships follow the domain's
// convention: producer → channel → consumer.

// topicSystems publish to topics; other systems' destinations are queues. RabbitMQ is special:
// a publish goes to an exchange and a receive comes from a queue.
var topicSystems = map[string]bool{"kafka": true, "aws_sns": true, "eventhubs": true, "gcp_pubsub": true, "pulsar": true, "rocketmq": true}

// messagingProtocols are the protocols the domain knows; other systems are "other".
var messagingProtocols = map[string]string{"kafka": "kafka", "rabbitmq": "rabbitmq"}

// addMessaging maps publish (or receive) records of mapped services to channels and relationships.
func (m *discoveryMapper) addMessaging(tenant string, records []record, publish bool, instanceOf map[string]domain.EntityID) {
	for _, r := range records {
		service := r.str("dt.smartscape.service")
		if service == "" {
			service = r.str("dt.entity.service")
		}
		instance, mapped := instanceOf[service]
		destination := strings.TrimSpace(r.str("messaging.destination.name"))
		count, _ := r.num("n")
		if !mapped || destination == "" || count <= 0 {
			continue
		}
		system := strings.ToLower(strings.TrimSpace(r.str("messaging.system")))
		env := *m.instances[instance].EnvironmentID
		channel := m.addChannel(tenant, system, destination, channelType(system, publish), env)
		protocol, ok := messagingProtocols[system]
		if !ok {
			protocol = "other"
		}
		if publish {
			m.addRelationship(tenant, instance, channel, protocol, "asynchronous", "")
		} else {
			m.addRelationship(tenant, channel, instance, protocol, "asynchronous", "")
		}
	}
}

// addChannel adds (or reuses) the channel of a destination in one environment.
func (m *discoveryMapper) addChannel(tenant, system, destination, channelType string, env domain.EntityID) domain.EntityID {
	name := slug(destination)
	if name == "" {
		name = "unnamed"
	}
	systemSlug := slug(system)
	if systemSlug == "" {
		systemSlug = "messaging"
	}
	id := "dt-" + tenant + "-" + systemSlug + "-" + name + "-" + env
	if channelType == "exchange" {
		id += "-exchange"
	}
	if _, ok := m.resources[id]; !ok {
		envID := env
		m.resources[id] = &domain.InfrastructureResource{
			ID: id, Name: destination, Type: channelType, Provider: "unknown", EnvironmentID: &envID, UpdatedAt: &m.now,
			Metadata: map[string]any{"dynatrace": map[string]any{"tenant": tenant, "system": system, "destination": destination}},
		}
	}
	return id
}

// channelType is a destination's resource type for its system and direction.
func channelType(system string, publish bool) string {
	switch {
	case system == "rabbitmq" && publish:
		return "exchange"
	case topicSystems[system]:
		return "topic"
	default:
		return "queue"
	}
}
