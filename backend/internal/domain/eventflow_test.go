package domain_test

import (
	"reflect"
	"testing"

	"servicetopology/backend/internal/domain"
)

// Mirrors apps/web/src/domain/eventFlow.test.ts on the shared mock topology.
func TestResolveEventFlow(t *testing.T) {
	data, _ := loadMock(t)
	ix := domain.BuildIndex(data)
	event := func(id string) *domain.EventType {
		e := ix.EventTypes[id]
		if e == nil {
			t.Fatalf("event type %q missing from mock", id)
		}
		return e
	}

	t.Run("production producers and consumers", func(t *testing.T) {
		flow, ok := ix.ResolveEventFlow(event("event-order-placed"), "production")
		if !ok || flow.ChannelID != "topic-orders-events-prod" {
			t.Fatalf("channel = %q, ok = %v", flow.ChannelID, ok)
		}
		if got := instanceIDs(flow.Consumers); !reflect.DeepEqual(got, []string{"inventory-service.production", "notification-service.production"}) {
			t.Fatalf("consumers = %v", got)
		}
		if len(flow.Producers) != 1 || flow.Producers[0].InstanceID != "order-service.production" || len(flow.Producers[0].RelationshipIDs) != 1 {
			t.Fatalf("producers = %+v", flow.Producers)
		}
	})

	t.Run("staging channel and not-deployed consumer", func(t *testing.T) {
		flow, ok := ix.ResolveEventFlow(event("event-order-placed"), "staging")
		if !ok || flow.ChannelID != "topic-orders-events-staging" {
			t.Fatalf("channel = %q, ok = %v", flow.ChannelID, ok)
		}
		if got := instanceIDs(flow.Consumers); !reflect.DeepEqual(got, []string{"inventory-service.staging", ""}) {
			t.Fatalf("consumers = %v", got)
		}
		if _, ok := ix.ResolveEventFlow(event("event-payment-captured"), "staging"); ok {
			t.Fatal("PaymentCaptured has no staging channel")
		}
	})

	t.Run("exchange binding to a queue", func(t *testing.T) {
		flow, _ := ix.ResolveEventFlow(event("event-notification-requested"), "production")
		c := flow.Consumers[0]
		if c.InstanceID != "email-dispatcher.production" || c.ViaQueueID != "queue-notifications-email-prod" || len(c.RelationshipIDs) != 2 {
			t.Fatalf("consumer = %+v", c)
		}
	})
}

func instanceIDs(ps []domain.EventFlowParticipant) []string {
	out := []string{}
	for _, p := range ps {
		out = append(out, p.InstanceID)
	}
	return out
}
