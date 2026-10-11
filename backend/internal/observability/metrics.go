package observability

import (
	"fmt"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// Metrics is a small Prometheus text-format registry (no dependencies): labelled counters,
// fixed-bucket histograms, and gauge callbacks. Label values must be low-cardinality (route
// patterns, status codes), never IDs or user input.
type Metrics struct {
	mu         sync.Mutex
	counters   map[string]map[string]float64
	histograms map[string]map[string]*histogram
	gauges     map[string]func() float64
	help       map[string]string
}

var buckets = []float64{0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5}

type histogram struct {
	counts []uint64
	sum    float64
	n      uint64
}

// NewMetrics returns an empty registry.
func NewMetrics() *Metrics {
	return &Metrics{counters: map[string]map[string]float64{}, histograms: map[string]map[string]*histogram{}, gauges: map[string]func() float64{}, help: map[string]string{}}
}

func labels(kv ...string) string {
	if len(kv) == 0 {
		return ""
	}
	parts := make([]string, 0, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		v := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(kv[i+1])
		parts = append(parts, kv[i]+`="`+v+`"`)
	}
	return "{" + strings.Join(parts, ",") + "}"
}

// Inc adds 1 to a counter.
func (m *Metrics) Inc(name, help string, kv ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.help[name] = help
	if m.counters[name] == nil {
		m.counters[name] = map[string]float64{}
	}
	m.counters[name][labels(kv...)]++
}

// Observe records a duration in a histogram (seconds).
func (m *Metrics) Observe(name, help string, d time.Duration, kv ...string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.help[name] = help
	if m.histograms[name] == nil {
		m.histograms[name] = map[string]*histogram{}
	}
	key := labels(kv...)
	h := m.histograms[name][key]
	if h == nil {
		h = &histogram{counts: make([]uint64, len(buckets))}
		m.histograms[name][key] = h
	}
	s := d.Seconds()
	for i, b := range buckets {
		if s <= b {
			h.counts[i]++
		}
	}
	h.sum += s
	h.n++
}

// Gauge registers a value read at scrape time.
func (m *Metrics) Gauge(name, help string, fn func() float64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.help[name] = help
	m.gauges[name] = fn
}

// Write writes the Prometheus text exposition format.
func (m *Metrics) Write(w io.Writer) {
	m.mu.Lock()
	defer m.mu.Unlock()
	names := func(keys []string) []string { sort.Strings(keys); return keys }
	var cn, hn, gn []string
	for k := range m.counters {
		cn = append(cn, k)
	}
	for k := range m.histograms {
		hn = append(hn, k)
	}
	for k := range m.gauges {
		gn = append(gn, k)
	}
	for _, n := range names(cn) {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n", n, m.help[n], n)
		var ls []string
		for l := range m.counters[n] {
			ls = append(ls, l)
		}
		for _, l := range names(ls) {
			fmt.Fprintf(w, "%s%s %g\n", n, l, m.counters[n][l])
		}
	}
	for _, n := range names(hn) {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s histogram\n", n, m.help[n], n)
		var ls []string
		for l := range m.histograms[n] {
			ls = append(ls, l)
		}
		for _, l := range names(ls) {
			h := m.histograms[n][l]
			inner := strings.TrimSuffix(strings.TrimPrefix(l, "{"), "}")
			sep := ""
			if inner != "" {
				sep = ","
			}
			for i, b := range buckets {
				fmt.Fprintf(w, "%s_bucket{%s%sle=\"%g\"} %d\n", n, inner, sep, b, h.counts[i])
			}
			fmt.Fprintf(w, "%s_bucket{%s%sle=\"+Inf\"} %d\n%s_sum%s %g\n%s_count%s %d\n", n, inner, sep, h.n, n, l, h.sum, n, l, h.n)
		}
	}
	for _, n := range names(gn) {
		v := m.gauges[n]()
		if math.IsNaN(v) {
			continue
		}
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s gauge\n%s %g\n", n, m.help[n], n, n, v)
	}
}

// Handler serves the registry at /metrics.
func (m *Metrics) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		m.Write(w)
	})
}
