package domain

import (
	"sort"
)

var environmentKindOrder = map[string]int{"production": 0, "staging": 1, "development": 2, "other": 3}

// SortEnvironments orders environments for display: production, staging, development, other, then
// by name (sortEnvironments in topologyIndex.ts, ADR-008).
func SortEnvironments(envs []Environment) []Environment {
	full := fullCollators.Get().(interface{ CompareString(a, b string) int })
	defer fullCollators.Put(full)
	rank := func(kind string) int {
		if r, ok := environmentKindOrder[kind]; ok {
			return r
		}
		return 3
	}
	out := make([]Environment, len(envs))
	copy(out, envs)
	sort.SliceStable(out, func(i, j int) bool {
		if ri, rj := rank(out[i].Kind), rank(out[j].Kind); ri != rj {
			return ri < rj
		}
		return full.CompareString(out[i].Name, out[j].Name) < 0
	})
	return out
}

// FilterEnvironment projects the topology onto one environment (GET /topology?environmentId=):
//   - environments: only that one;
//   - service definitions: all (they are logical and environment-independent);
//   - service instances: those in the environment;
//   - resources: those in the environment (own or inherited) plus environment-independent ones, so
//     containment chains stay complete (an ancestor is never in another environment, ADR-008);
//   - relationships: those whose endpoints are both kept;
//   - event types: those carried in the environment, with channels narrowed to the kept ones.
//
// The result passes Validate whenever the input does. ok=false if the environment does not exist.
func (ix *Index) FilterEnvironment(environmentID EntityID) (*TopologyData, bool) {
	env := ix.Environments[environmentID]
	if env == nil {
		return nil, false
	}
	out := &TopologyData{
		Environments:       []Environment{*env},
		ServiceDefinitions: append([]ServiceDefinition{}, ix.Data.ServiceDefinitions...),
		ServiceInstances:   []ServiceInstance{},
		Resources:          []InfrastructureResource{},
		Relationships:      []CommunicationRelationship{},
	}
	kept := map[EntityID]bool{}
	for _, inst := range ix.Data.ServiceInstances {
		if inst.EnvironmentID != nil && *inst.EnvironmentID == environmentID {
			out.ServiceInstances = append(out.ServiceInstances, inst)
			kept[inst.ID] = true
		}
	}
	for _, r := range ix.Data.Resources {
		if e, ok := ix.EnvironmentOf(r.ID); !ok || e == environmentID {
			out.Resources = append(out.Resources, r)
			kept[r.ID] = true
		}
	}
	for _, rel := range ix.Data.Relationships {
		if kept[rel.SourceEntityID] && kept[rel.TargetEntityID] {
			out.Relationships = append(out.Relationships, rel)
		}
	}
	if ix.Data.EventTypes != nil {
		out.EventTypes = []EventType{}
		for i := range ix.Data.EventTypes {
			e := ix.Data.EventTypes[i]
			if _, ok := ix.EventChannelIn(&e, environmentID); !ok {
				continue
			}
			var channels []EntityID
			for _, ch := range e.ChannelResourceIDs {
				if kept[ch] {
					channels = append(channels, ch)
				}
			}
			e.ChannelResourceIDs = channels
			out.EventTypes = append(out.EventTypes, e)
		}
	}
	return out, true
}
