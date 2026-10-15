package dynatrace

import (
	"fmt"
	"sort"
	"strings"
)

// Field accessors for result records. Records are loosely typed JSON, so each accessor tolerates
// a missing or differently shaped field and returns the zero value.

func (r record) str(field string) string {
	switch v := r[field].(type) {
	case string:
		return v
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func (r record) num(field string) (float64, bool) {
	switch v := r[field].(type) {
	case float64:
		return v, true
	case []any:
		// An unreduced timeseries: average the non-null points.
		sum, n := 0.0, 0
		for _, p := range v {
			if f, ok := p.(float64); ok {
				sum += f
				n++
			}
		}
		return sum / float64(max(n, 1)), n > 0
	default:
		return 0, false
	}
}

func (r record) strs(field string) []string {
	switch v := r[field].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case string:
		if v != "" {
			return []string{v}
		}
	}
	return nil
}

// tags reads Smartscape tags as key → value. Documented as a map; the classic shapes (a list of
// "key:value" strings, or of {key, value} objects) are accepted too.
func (r record) tags() map[string]string {
	out := map[string]string{}
	switch v := r["tags"].(type) {
	case map[string]any:
		for key, value := range v {
			switch val := value.(type) {
			case string:
				out[key] = val
			case []any:
				if len(val) > 0 {
					out[key] = fmt.Sprint(val[0])
				}
			}
		}
	case []any:
		for _, item := range v {
			switch tag := item.(type) {
			case string:
				key, value, _ := strings.Cut(tag, ":")
				out[key] = value
			case map[string]any:
				key, _ := tag["key"].(string)
				value, _ := tag["value"].(string)
				if key != "" {
					out[key] = value
				}
			}
		}
	}
	return out
}

// sortedKeys returns a set's members in order (deterministic output).
func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
