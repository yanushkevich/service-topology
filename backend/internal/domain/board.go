package domain

import (
	"fmt"
	"slices"
	"strings"
)

// Transit board definitions (ADR-031, docs/TRANSIT_BOARD.md Revision 2): the declared part of a
// service's transit board, stored per service. Observed data is never part of a definition. The
// rules and their order are a port of validateBoardDefinition in
// apps/web/src/transit/definition.ts; fixtures/conformance/boards checks the codes and paths.

// BoardDefinition is docs/schemas/transit-board-definition.v1.schema.json.
type BoardDefinition struct {
	ServiceDefinitionID EntityID       `json:"serviceDefinitionId"`
	Stations            []BoardStation `json:"stations"`
	Lines               []BoardLine    `json:"lines"`
	Policies            []BoardPolicy  `json:"policies"`
	Tables              []BoardTable   `json:"tables"`
}

type BoardStation struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Sub       *string   `json:"sub,omitempty"`
	Kind      string    `json:"kind"`
	EntityID  *EntityID `json:"entityId,omitempty"`
	LabelHint *string   `json:"labelHint,omitempty"`
}

type BoardBranch struct {
	Stations  []string `json:"stations"`
	Kind      string   `json:"kind"`
	Share     *float64 `json:"share,omitempty"`
	Condition *string  `json:"condition,omitempty"`
	Parallel  *bool    `json:"parallel,omitempty"`
}

type BoardTransaction struct {
	StationID string   `json:"stationId"`
	TableIDs  []string `json:"tableIds"`
}

type BoardLine struct {
	ID           string             `json:"id"`
	Code         string             `json:"code"`
	Name         string             `json:"name"`
	Group        string             `json:"group"`
	Signature    string             `json:"signature"`
	Caller       string             `json:"caller"`
	DeadlineMs   *float64           `json:"deadlineMs,omitempty"`
	Route        []BoardBranch      `json:"route"`
	Patterns     []string           `json:"patterns"`
	Repeat       *string            `json:"repeat,omitempty"`
	Transactions []BoardTransaction `json:"transactions,omitempty"`
}

type BoardPolicy struct {
	ID       string            `json:"id"`
	ClientID string            `json:"clientId"`
	Order    int               `json:"order"`
	Type     string            `json:"type"`
	Label    string            `json:"label"`
	Config   map[string]string `json:"config,omitempty"`
	Source   *string           `json:"source,omitempty"`
	Missing  *bool             `json:"missing,omitempty"`
}

type BoardTable struct {
	ID        string   `json:"id"`
	StationID string   `json:"stationId"`
	Name      string   `json:"name"`
	Pattern   *string  `json:"pattern,omitempty"`
	Writes    []string `json:"writes"`
	Reads     []string `json:"reads"`
}

// StoredBoard is a definition with its storage revision (the ETag of /transit-boards/{serviceId}).
type StoredBoard struct {
	Definition BoardDefinition `json:"definition"`
	Revision   string          `json:"revision"`
	UpdatedAt  string          `json:"updatedAt"`
}

// Board validation codes, identical to the TypeScript reference.
const (
	CodeBoardServiceNotFound = "board-service-not-found"
	CodeInvalidBoardStation  = "invalid-board-station"
	CodeBoardEntityNotFound  = "board-entity-not-found"
	CodeInvalidBoardLine     = "invalid-board-line"
	CodeInvalidBoardPolicy   = "invalid-board-policy"
	CodeInvalidBoardTable    = "invalid-board-table"
)

// Enumerations of the board schema; fields_test.go checks them against it.
var (
	BoardStationKindValues = []string{"caller", "gate", "module", "client", "dependency"}
	BoardLineGroupValues   = []string{"grpc", "http", "webhook", "event", "scheduled", "background"}
	BoardPolicyTypeValues  = []string{"bulkhead", "timeout", "retry", "breaker", "fallback", "cache", "idempotency"}
	// PatternIDs is the pattern catalog (apps/web/src/domain/patterns.ts, ADR-024).
	PatternIDs = []string{"timeout", "retry", "breaker", "bulkhead", "fallback", "cache", "idempotency", "async-request-reply", "redelivery", "dead-letter", "idempotent-consumer", "inbox", "outbox", "polling-publisher", "step-deadline", "compensation", "manual-intervention", "transaction", "mtls", "rate-limit", "hmac-signature", "idempotent-producer", "read-replica", "pagination", "saga", "scheduled-job", "leader-lock"}
)

// ValidateBoard checks a definition against the topology. Issues carry the field path in Path.
func ValidateBoard(def *BoardDefinition, data *TopologyData) []Issue {
	out := []Issue{}
	add := func(code, path, format string, args ...any) {
		out = append(out, Issue{Severity: SeverityError, Code: code, EntityID: def.ServiceDefinitionID, Path: path, Message: fmt.Sprintf(format, args...)})
	}
	services := map[EntityID]bool{}
	for _, d := range data.ServiceDefinitions {
		services[d.ID] = true
	}
	resources := map[EntityID]bool{}
	for _, r := range data.Resources {
		resources[r.ID] = true
	}
	if !services[def.ServiceDefinitionID] {
		add(CodeBoardServiceNotFound, "serviceDefinitionId", "No service definition %q.", def.ServiceDefinitionID)
	}

	stations := map[string]BoardStation{}
	for i, s := range def.Stations {
		at := fmt.Sprintf("stations[%d]", i)
		if _, dup := stations[s.ID]; strings.TrimSpace(s.ID) == "" || dup {
			add(CodeInvalidBoardStation, at+".id", "Station ID %q is empty or used twice.", s.ID)
		}
		if strings.TrimSpace(s.Name) == "" {
			add(CodeInvalidBoardStation, at+".name", "Station %q needs a name.", s.ID)
		}
		if !slices.Contains(BoardStationKindValues, s.Kind) {
			add(CodeInvalidBoardStation, at+".kind", "Station %q has an unknown kind %q.", s.ID, s.Kind)
		}
		if s.EntityID != nil {
			switch {
			case s.Kind != "dependency":
				add(CodeInvalidBoardStation, at+".entityId", "Only dependencies link to topology entities; %q is a %s.", s.ID, s.Kind)
			case !services[*s.EntityID] && !resources[*s.EntityID]:
				add(CodeBoardEntityNotFound, at+".entityId", "%q links to %q, which is not in the topology.", s.Name, *s.EntityID)
			}
		}
		stations[s.ID] = s
	}

	lineIDs := map[string]bool{}
	codes := map[string]bool{}
	for i, l := range def.Lines {
		validateBoardLine(fmt.Sprintf("lines[%d]", i), l, stations, lineIDs, codes, add)
		lineIDs[l.ID] = true
		codes[l.Code] = true
	}

	policyIDs := map[string]bool{}
	for i, p := range def.Policies {
		at := fmt.Sprintf("policies[%d]", i)
		if strings.TrimSpace(p.ID) == "" || policyIDs[p.ID] {
			add(CodeInvalidBoardPolicy, at+".id", "Policy ID %q is empty or used twice.", p.ID)
		}
		if stations[p.ClientID].Kind != "client" {
			add(CodeInvalidBoardPolicy, at+".clientId", "Policy %q must sit on a client station; %q is not one.", p.ID, p.ClientID)
		}
		if !slices.Contains(BoardPolicyTypeValues, p.Type) {
			add(CodeInvalidBoardPolicy, at+".type", "Policy %q has an unknown type %q.", p.ID, p.Type)
		}
		policyIDs[p.ID] = true
	}

	lines := map[string]BoardLine{}
	for _, l := range def.Lines {
		lines[l.ID] = l
	}
	for i, t := range def.Tables {
		at := fmt.Sprintf("tables[%d]", i)
		if stations[t.StationID].Kind != "dependency" {
			add(CodeInvalidBoardTable, at+".stationId", "Table %q must belong to a dependency station; %q is not one.", t.Name, t.StationID)
		}
		for _, role := range []struct {
			name string
			ids  []string
		}{{"writes", t.Writes}, {"reads", t.Reads}} {
			for k, lineID := range role.ids {
				path := fmt.Sprintf("%s.%s[%d]", at, role.name, k)
				line, ok := lines[lineID]
				switch {
				case !ok:
					add(CodeInvalidBoardTable, path, "Table %q: unknown line %q.", t.Name, lineID)
				case !slices.Contains(boardLineStations(line), t.StationID):
					add(CodeInvalidBoardTable, path, "Table %q: line %s does not reach %q.", t.Name, line.Code, t.StationID)
				}
			}
		}
	}
	return out
}

func validateBoardLine(at string, l BoardLine, stations map[string]BoardStation, lineIDs, codes map[string]bool, add func(code, path, format string, args ...any)) {
	if strings.TrimSpace(l.ID) == "" || lineIDs[l.ID] {
		add(CodeInvalidBoardLine, at+".id", "Line ID %q is empty or used twice.", l.ID)
	}
	if strings.TrimSpace(l.Code) == "" || codes[l.Code] {
		add(CodeInvalidBoardLine, at+".code", "Line code %q is empty or used twice.", l.Code)
	}
	if strings.TrimSpace(l.Name) == "" {
		add(CodeInvalidBoardLine, at+".name", "Line %q needs a name.", l.ID)
	}
	if !slices.Contains(BoardLineGroupValues, l.Group) {
		add(CodeInvalidBoardLine, at+".group", "Line %q has an unknown group %q.", l.ID, l.Group)
	}
	if l.DeadlineMs != nil && !(*l.DeadlineMs > 0) {
		add(CodeInvalidBoardLine, at+".deadlineMs", "Line %q: the deadline must be positive.", l.ID)
	}
	for k, p := range l.Patterns {
		if !slices.Contains(PatternIDs, p) {
			add(CodeInvalidBoardLine, fmt.Sprintf("%s.patterns[%d]", at, k), "Line %q: unknown pattern %q.", l.ID, p)
		}
	}
	if len(l.Route) == 0 || len(l.Route[0].Stations) < 2 {
		add(CodeInvalidBoardLine, at+".route", "Line %q needs a route of at least two stations.", l.ID)
		return
	}
	reached := map[string]bool{}
	for j, b := range l.Route {
		bAt := fmt.Sprintf("%s.route[%d]", at, j)
		if len(b.Stations) < 2 {
			add(CodeInvalidBoardLine, bAt+".stations", "Line %q, branch %d: a branch needs at least two stations.", l.ID, j+1)
		}
		for k, id := range b.Stations {
			if _, ok := stations[id]; !ok {
				add(CodeInvalidBoardLine, fmt.Sprintf("%s.stations[%d]", bAt, k), "Line %q goes through an unknown station %q.", l.ID, id)
			}
		}
		if j > 0 && (len(b.Stations) == 0 || !reached[b.Stations[0]]) {
			add(CodeInvalidBoardLine, bAt+".stations[0]", "Line %q, branch %d must start at a station of an earlier branch.", l.ID, j+1)
		}
		if b.Share != nil && !(*b.Share >= 0 && *b.Share <= 1) {
			add(CodeInvalidBoardLine, bAt+".share", "Line %q, branch %d: the share must be between 0 and 1.", l.ID, j+1)
		}
		for _, id := range b.Stations {
			reached[id] = true
		}
	}
}

// boardLineStations is every station a line passes through, in route order.
func boardLineStations(l BoardLine) []string {
	out := []string{}
	for _, b := range l.Route {
		for _, id := range b.Stations {
			if !slices.Contains(out, id) {
				out = append(out, id)
			}
		}
	}
	return out
}
