package domain

import "time"

// Before reports whether RFC 3339 timestamp a is earlier than b, comparing instants (so offsets other
// than Z order correctly). Unparsable values compare as strings, after valid ones.
func Before(a, b string) bool {
	ta, errA := time.Parse(time.RFC3339Nano, a)
	tb, errB := time.Parse(time.RFC3339Nano, b)
	switch {
	case errA == nil && errB == nil:
		return ta.Before(tb)
	case errA == nil:
		return true
	case errB == nil:
		return false
	}
	return a < b
}
