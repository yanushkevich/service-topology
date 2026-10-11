package domain

import (
	"sort"
	"strings"
	"sync"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
)

// Registry rows, filters, and sorting: a port of apps/web/src/domain/registry.ts. The order must be
// identical to the client's (fixtures/conformance/registry), so text comparison uses CLDR collation
// like the client's localeCompare('en', …) instead of byte order.

// Entity groups for registry filtering.
var EntityGroups = []string{"service", "data", "messaging", "external", "other"}

var resourceGroup = map[string]string{
	"database": "data", "cache": "data", "search-index": "data",
	"broker": "messaging", "topic": "messaging", "queue": "messaging", "exchange": "messaging",
	"external-resource": "external",
}

// RegistryRow is one service instance or communicating resource (RegistryRow in openapi.json).
type RegistryRow struct {
	Ref           EntityRef `json:"ref"`
	Name          string    `json:"name"`
	Type          string    `json:"type"`
	Group         string    `json:"group"`
	Provider      string    `json:"provider"`
	EnvironmentID *string   `json:"environmentId"`
	Owner         *string   `json:"owner"`
	Team          *string   `json:"team"`
	Health        string    `json:"health"`
	OutgoingCount int       `json:"outgoingCount"`
	IncomingCount int       `json:"incomingCount"`
	UpdatedAt     *string   `json:"updatedAt"`
	searchText    string
}

// BuildRegistryRows returns every service instance plus every resource that can communicate.
func (ix *Index) BuildRegistryRows() []RegistryRow {
	var rows []RegistryRow
	for i := range ix.Data.ServiceInstances {
		inst := &ix.Data.ServiceInstances[i]
		def := ix.Definitions[inst.ServiceDefinitionID]
		name, category := inst.ServiceDefinitionID, "other"
		var owner, team *string
		if def != nil {
			name, category, owner, team = def.Name, def.Category, def.Owner, def.Team
		}
		updated := inst.UpdatedAt
		rows = append(rows, RegistryRow{
			Ref: EntityRef{Kind: KindServiceInstance, ID: inst.ID}, Name: name, Type: category, Group: "service",
			Provider: inst.Provider, EnvironmentID: inst.EnvironmentID, Owner: owner, Team: team, Health: inst.Health,
			OutgoingCount: len(ix.Outgoing[inst.ID]), IncomingCount: len(ix.Incoming[inst.ID]), UpdatedAt: &updated,
			searchText: strings.ToLower(joinText(name, inst.ID, owner, team)),
		})
	}
	for i := range ix.Data.Resources {
		r := &ix.Data.Resources[i]
		if containmentOnlyResourceTypes[r.Type] {
			continue
		}
		group, ok := resourceGroup[r.Type]
		if !ok {
			group = "other"
		}
		health := "unknown"
		if r.Health != nil {
			health = *r.Health
		}
		var env *string
		if e, ok := ix.EnvironmentOf(r.ID); ok {
			env = &e
		}
		typ := r.Type
		rows = append(rows, RegistryRow{
			Ref: EntityRef{Kind: KindResource, ID: r.ID}, Name: r.Name, Type: r.Type, Group: group,
			Provider: r.Provider, EnvironmentID: env, Owner: r.Owner, Team: r.Team, Health: health,
			OutgoingCount: len(ix.Outgoing[r.ID]), IncomingCount: len(ix.Incoming[r.ID]), UpdatedAt: r.UpdatedAt,
			searchText: strings.ToLower(joinText(r.Name, r.ID, &typ, r.Owner, r.Team)),
		})
	}
	return rows
}

// joinText mirrors [a, b, …].join(' ') in JavaScript, where undefined becomes an empty string.
func joinText(first string, rest ...any) string {
	parts := []string{first}
	for _, v := range rest {
		switch t := v.(type) {
		case string:
			parts = append(parts, t)
		case *string:
			if t != nil {
				parts = append(parts, *t)
			} else {
				parts = append(parts, "")
			}
		}
	}
	return strings.Join(parts, " ")
}

// Filters are the shared registry filters. Empty lists mean no restriction.
type Filters struct {
	Query     string   `json:"query"`
	Providers []string `json:"providers"`
	Health    []string `json:"health"`
	Groups    []string `json:"groups"`
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// InEnvironment reports whether the row belongs to the environment (environment-independent rows
// belong to all). An empty environmentID means no restriction.
func (r RegistryRow) InEnvironment(environmentID string) bool {
	return environmentID == "" || r.EnvironmentID == nil || *r.EnvironmentID == environmentID
}

// Matches applies the filters: all whitespace-separated query terms must occur in the row's search
// text (name, ID, type for resources, owner, team; case-insensitive).
func (r RegistryRow) Matches(f Filters) bool {
	query := strings.ToLower(strings.TrimSpace(f.Query))
	if query != "" {
		for _, term := range strings.Fields(query) {
			if !strings.Contains(r.searchText, term) {
				return false
			}
		}
	}
	if len(f.Providers) > 0 && !contains(f.Providers, r.Provider) {
		return false
	}
	if len(f.Health) > 0 && !contains(f.Health, r.Health) {
		return false
	}
	if len(f.Groups) > 0 && !contains(f.Groups, r.Group) {
		return false
	}
	return true
}

// FilterRegistryRows keeps rows in the environment that match the filters, preserving order.
func FilterRegistryRows(rows []RegistryRow, f Filters, environmentID string) []RegistryRow {
	out := make([]RegistryRow, 0, len(rows))
	for _, r := range rows {
		if r.InEnvironment(environmentID) && r.Matches(f) {
			out = append(out, r)
		}
	}
	return out
}

// RegistrySortKeys are the sortable columns.
var RegistrySortKeys = []string{"name", "type", "provider", "owner", "health", "relationships", "updated"}

// RegistrySort is a column and direction.
type RegistrySort struct {
	Key        string
	Descending bool
}

// ParseRegistrySort parses "name" / "-name" etc.; ok=false for unknown keys.
func ParseRegistrySort(s string) (RegistrySort, bool) {
	desc := strings.HasPrefix(s, "-")
	key := strings.TrimPrefix(s, "-")
	if !contains(RegistrySortKeys, key) {
		return RegistrySort{}, false
	}
	return RegistrySort{Key: key, Descending: desc}, true
}

var healthRank = map[string]int{"unavailable": 0, "degraded": 1, "unknown": 2, "healthy": 3}

// Collators are not safe for concurrent use; a pool keeps sorting allocation-light.
var (
	baseCollators = sync.Pool{New: func() any { return collate.New(language.English, collate.Loose) }}
	fullCollators = sync.Pool{New: func() any { return collate.New(language.English) }}
)

// SortRegistryRows sorts like the client: by key (missing text last when ascending), then by ID.
func SortRegistryRows(rows []RegistryRow, s RegistrySort) []RegistryRow {
	base := baseCollators.Get().(*collate.Collator)
	full := fullCollators.Get().(*collate.Collator)
	defer baseCollators.Put(base)
	defer fullCollators.Put(full)

	text := func(a, b *string) int {
		switch {
		case a == nil && b == nil:
			return 0
		case a == nil:
			return 1
		case b == nil:
			return -1
		case *a == *b:
			return 0
		}
		return base.CompareString(*a, *b)
	}
	ownerOf := func(r RegistryRow) *string {
		if r.Owner != nil {
			return r.Owner
		}
		return r.Team
	}
	compare := func(a, b RegistryRow) int {
		switch s.Key {
		case "name":
			return text(&a.Name, &b.Name)
		case "type":
			return text(&a.Type, &b.Type)
		case "provider":
			return text(&a.Provider, &b.Provider)
		case "owner":
			return text(ownerOf(a), ownerOf(b))
		case "health":
			return healthRank[a.Health] - healthRank[b.Health]
		case "relationships":
			return a.OutgoingCount + a.IncomingCount - (b.OutgoingCount + b.IncomingCount)
		case "updated":
			return text(a.UpdatedAt, b.UpdatedAt)
		}
		return 0
	}
	sign := 1
	if s.Descending {
		sign = -1
	}
	out := make([]RegistryRow, len(rows))
	copy(out, rows)
	sort.SliceStable(out, func(i, j int) bool {
		if c := sign * compare(out[i], out[j]); c != 0 {
			return c < 0
		}
		return full.CompareString(out[i].Ref.ID, out[j].Ref.ID) < 0
	})
	return out
}
