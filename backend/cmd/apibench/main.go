// Command apibench measures API latency against ArcadeDB on a generated dataset
// (docs/backend/TESTING_AND_PERFORMANCE.md). It loads the dataset into a temporary database, serves
// the real HTTP handler in-process, times each endpoint class, prints query plans, and drops the
// database. Results go to docs/BENCHMARKS.md with machine and conditions.
//
//	go run ./cmd/apibench [-dataset inventory-1000] [-n 30]
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

func main() {
	dataset := flag.String("dataset", "inventory-1000", "fixtures/topology/<name>.v1.json")
	n := flag.Int("n", 30, "timed requests per scenario per client (after 3 warm-ups)")
	traversal := flag.String("traversal", "memory", "memory or database (TRAVERSAL_SOURCE)")
	c := flag.Int("c", 1, "concurrent clients")
	flag.Parse()
	if err := run(*dataset, *n, *c, *traversal == "database"); err != nil {
		fmt.Fprintln(os.Stderr, "apibench:", err)
		os.Exit(1)
	}
}

func run(dataset string, n, clients int, traversalInDB bool) error {
	ctx := context.Background()
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	if cfg.ArcadeDB == nil {
		return fmt.Errorf("ARCADEDB_BASE_URL not set (run via make bench)")
	}
	base, err := arcadedb.NewClient(cfg.ArcadeDB)
	if err != nil {
		return err
	}
	c := base.WithDatabase(fmt.Sprintf("topology_bench_%d", time.Now().UnixNano()))
	defer c.DropDatabase(context.Background())

	dir, err := fixtures.Dir()
	if err != nil {
		return err
	}
	data, err := fixtures.LoadTopology(filepath.Join(dir, "topology", dataset+".v1.json"))
	if err != nil {
		return err
	}
	if err := arcadedb.EnsureSchema(ctx, c); err != nil {
		return err
	}
	start := time.Now()
	if _, err := arcadedb.NewTopologyRepository(c).ReplaceTopology(ctx, data, "fixture"); err != nil {
		return err
	}
	loadTime := time.Since(start)

	svc := &application.Service{TopologyRepo: arcadedb.NewTopologyRepository(c), SnapshotRepo: arcadedb.NewSnapshotRepository(c),
		LayoutRepo: arcadedb.NewLayoutRepository(c), GraphRepo: arcadedb.NewGraphRepository(c), TraversalInDatabase: traversalInDB}
	srv := httptest.NewServer(httpapi.NewHandler(httpapi.Deps{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), API: svc}))
	defer srv.Close()

	ix := domain.BuildIndex(data)
	caller, callee, container, env := pick(ix)
	fmt.Printf("dataset %s: %d instances, %d resources, %d relationships, %d event types; import %v\n\n",
		dataset, len(data.ServiceInstances), len(data.Resources), len(data.Relationships), len(data.EventTypes), loadTime.Round(time.Millisecond))

	scenarios := []struct{ name, path string }{
		{"topology (all)", "/api/v1/topology"},
		{"topology (one environment)", "/api/v1/topology?environmentId=" + env},
		{"registry page (100, sort name)", "/api/v1/registry?environmentId=" + env + "&sort=name&limit=100"},
		{"registry search (q + filters)", "/api/v1/registry?environmentId=" + env + "&q=api&kind=service,messaging&health=healthy,degraded"},
		{"dependencies upstream, depth 10 (" + caller + ")", "/api/v1/topology/dependencies?direction=upstream&entityId=" + caller},
		{"dependencies downstream, depth 10 (" + callee + ")", "/api/v1/topology/dependencies?direction=downstream&entityId=" + callee},
		{"neighborhood depth 3 (" + caller + ")", "/api/v1/topology/neighborhood?depth=3&entityId=" + caller},
		{"impact, unavailable (" + container + ")", "/api/v1/topology/impact?entityId=" + container},
		{"event types (one environment)", "/api/v1/event-types?environmentId=" + env},
	}
	fmt.Printf("%d concurrent client(s), %d timed requests each per scenario; traversal in %s\n\n", clients, n, map[bool]string{true: "database", false: "memory"}[traversalInDB])
	fmt.Println("| Request | p50 | p95 | max | requests/s | response |")
	fmt.Println("|---|---|---|---|---|---|")
	httpClient := &http.Client{Transport: &http.Transport{MaxIdleConnsPerHost: clients * 2}}
	for _, sc := range scenarios {
		var mu sync.Mutex
		var times []time.Duration
		size := 0
		var firstErr error
		var wg sync.WaitGroup
		wall := time.Now()
		for w := 0; w < clients; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < n+3; i++ {
					t0 := time.Now()
					resp, err := httpClient.Get(srv.URL + sc.path)
					if err != nil {
						mu.Lock()
						firstErr = err
						mu.Unlock()
						return
					}
					body, _ := io.ReadAll(resp.Body)
					resp.Body.Close()
					d := time.Since(t0)
					mu.Lock()
					if resp.StatusCode != 200 && firstErr == nil {
						firstErr = fmt.Errorf("%s: HTTP %d %s", sc.path, resp.StatusCode, body)
					}
					if i >= 3 {
						times = append(times, d)
					}
					size = len(body)
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		elapsed := time.Since(wall)
		if firstErr != nil {
			return firstErr
		}
		sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
		q := func(p float64) time.Duration {
			return times[int(p*float64(len(times)-1))].Round(100 * time.Microsecond)
		}
		fmt.Printf("| %s | %v | %v | %v | %.0f | %d KB |\n", sc.name, q(0.5), q(0.95), times[len(times)-1].Round(100*time.Microsecond),
			float64(clients*(n+3))/elapsed.Seconds(), size/1024)
	}

	// Where the full-topology endpoints spend their time.
	repo := arcadedb.NewTopologyRepository(c)
	var reads, builds []time.Duration
	for i := 0; i < n+3; i++ {
		t0 := time.Now()
		got, err := repo.GetTopology(ctx, "")
		if err != nil {
			return err
		}
		t1 := time.Now()
		gix := domain.BuildIndex(got)
		_ = domain.SortRegistryRows(gix.BuildRegistryRows(), domain.RegistrySort{Key: "name"})
		if i >= 3 {
			reads, builds = append(reads, t1.Sub(t0)), append(builds, time.Since(t1))
		}
	}
	med := func(d []time.Duration) time.Duration {
		sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
		return d[len(d)/2].Round(100 * time.Microsecond)
	}
	fmt.Printf("\nBreakdown (median): read full topology from ArcadeDB %v; index + registry rows + sort in Go %v\n", med(reads), med(builds))

	fmt.Println("\nQuery plans (EXPLAIN):")
	for _, sql := range []string{
		"SELECT FROM ServiceInstance WHERE id = :id",
		"SELECT id FROM (TRAVERSE out(\"COMMUNICATES\") FROM (SELECT FROM ServiceInstance WHERE id = :id) MAXDEPTH 10 STRATEGY BREADTH_FIRST)",
		"SELECT FROM COMMUNICATES WHERE sourceEntityId IN :ids AND targetEntityId IN :ids ORDER BY ord",
		"SELECT FROM Resource ORDER BY ord",
	} {
		plan, err := explain(ctx, c, sql)
		if err != nil {
			return err
		}
		fmt.Printf("\n%s\n%s\n", sql, plan)
	}
	return nil
}

// pick chooses worst-case start entities: the instance with the most outgoing relationships, the
// resource with the most incoming ones, the resource containing the most entities, and the
// environment with the most instances.
func pick(ix *domain.Index) (caller, callee, container, env string) {
	best := func(score func(id string) int, ids []string) string {
		top, topScore := "", -1
		for _, id := range ids {
			if s := score(id); s > topScore {
				top, topScore = id, s
			}
		}
		return top
	}
	var insts, ress []string
	for _, i := range ix.Data.ServiceInstances {
		insts = append(insts, i.ID)
	}
	for _, r := range ix.Data.Resources {
		ress = append(ress, r.ID)
	}
	caller = best(func(id string) int { return len(ix.Outgoing[id]) }, insts)
	callee = best(func(id string) int { return len(ix.Incoming[id]) }, ress)
	container = best(func(id string) int { return len(ix.ChildResources[id]) + len(ix.InstancesByResource[id]) }, ress)
	count := map[string]int{}
	for _, i := range ix.Data.ServiceInstances {
		count[*i.EnvironmentID]++
	}
	envs := []string{}
	for e := range count {
		envs = append(envs, e)
	}
	sort.Strings(envs)
	env = best(func(id string) int { return count[id] }, envs)
	return
}

func explain(ctx context.Context, c *arcadedb.Client, sql string) (string, error) {
	rows, err := c.Explain(ctx, "EXPLAIN "+sql, map[string]any{"id": "x", "ids": []string{"x"}})
	if err != nil {
		return "", err
	}
	return rows, nil
}
