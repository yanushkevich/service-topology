import { describe, expect, it } from 'vitest';
import { indexBoard } from './board';
import { paymentServiceBoard } from './mock/paymentServiceBoard';
import { BUS_U, bundledPolyline, overlaps, bundleOffset, buildTrackGraph, computeMapGeometry, COLUMN_U, DISTANCE, edgeKey, fitProjection, GAP, placeStations, TILT, TRUNK_U } from './layout';
import type { TransitBoard } from './types';

const index = indexBoard(paymentServiceBoard('production'));
const positions = placeStations(index);
const graph = buildTrackGraph(index, positions);

describe('transit layout: columns and rows', () => {
  it('puts stations in fixed columns by kind', () => {
    for (const station of index.board.stations) expect(positions.get(station.id)!.u, station.id).toBe(COLUMN_U[station.kind]);
  });

  it('gives each client its own lane and puts its dependency on it', () => {
    const lanes = index.board.stations.filter((s) => s.kind === 'client').map((s) => positions.get(s.id)!.v);
    expect(new Set(lanes).size).toBe(lanes.length);
    expect(positions.get('dep:card')!.v).toBe(positions.get('cli:card')!.v);
    expect(positions.get('dep:kafka')!.v).toBe(positions.get('cli:producer')!.v);
  });

  it('keeps stations of one column apart', () => {
    const modules = index.board.stations.filter((s) => s.kind === 'module').map((s) => positions.get(s.id)!.v).sort((a, b) => a - b);
    for (let i = 1; i < modules.length; i++) expect(modules[i]! - modules[i - 1]!).toBeGreaterThanOrEqual(100 - 1e-9);
  });

  it('is deterministic', () => {
    expect(placeStations(indexBoard(paymentServiceBoard('production')))).toEqual(positions);
  });
});

describe('transit layout: track graph', () => {
  it('routes gate → module hops along the trunk and module → client hops over exit, bus, approach', () => {
    const [main] = graph.paths.get('A2')!;
    expect(main!.slice(0, 3)).toEqual(['caller:order-service', 'gate:grpc', `trunk:${positions.get('gate:grpc')!.v}`]);
    const fromModule = main!.slice(main!.indexOf('mod:capture'));
    expect(fromModule[1]).toBe('exit:mod:capture');
    expect(fromModule.filter((id) => id.startsWith('bus:')).length).toBeGreaterThan(0);
    expect(fromModule.slice(-3)).toEqual(['approach:cli:card', 'cli:card', 'dep:card']);
    expect(graph.nodes.get(`trunk:${positions.get('gate:grpc')!.v}`)!.u).toBe(TRUNK_U);
    expect(graph.nodes.get(fromModule.find((id) => id.startsWith('bus:'))!)!.u).toBe(BUS_U);
  });

  it('walks every intermediate trunk and bus row so shared code shares track', () => {
    // Authorize and Capture are both reached from the gRPC gate: their trunk paths share the first trunk edge.
    const trunk = (lineId: string) => graph.paths.get(lineId)![0]!.filter((id) => id.startsWith('trunk:'));
    const [a, b] = [trunk('A1'), trunk('A2')];
    expect(a[0]).toBe(b[0]);
    for (const path of graph.paths.values()) {
      for (const branch of path) {
        for (let i = 0; i < branch.length - 1; i++) {
          const p = graph.nodes.get(branch[i]!)!;
          const q = graph.nodes.get(branch[i + 1]!)!;
          // Vertical moves happen only on the trunk or the bus, one row at a time.
          if (p.u === q.u && p.v !== q.v) expect([TRUNK_U, BUS_U]).toContain(p.u);
        }
      }
    }
  });

  it('lists the lines of each edge in global order (by code)', () => {
    const users = graph.edgeLines.get(edgeKey('cli:card', 'dep:card'))!;
    expect(users).toEqual(['A1', 'A2', 'A3', 'A4', 'E1', 'J1', 'J2']);
  });
});

describe('transit layout: bundling', () => {
  it('offsets line i of n by (i − (n − 1) / 2) × GAP', () => {
    const users = graph.edgeLines.get(edgeKey('cli:card', 'dep:card'))!;
    expect(users.map((id) => bundleOffset(graph, 'cli:card', 'dep:card', id))).toEqual(users.map((_, i) => (i - (users.length - 1) / 2) * GAP));
    // Direction does not matter.
    expect(bundleOffset(graph, 'dep:card', 'cli:card', 'A1')).toBe(bundleOffset(graph, 'cli:card', 'dep:card', 'A1'));
  });

  it('keeps a line on the same side through a bundle and mitres its corners', () => {
    const [main] = graph.paths.get('A2')!;
    const points = bundledPolyline(graph, main!, 'A2');
    expect(points.length).toBeGreaterThanOrEqual(main!.length - 1);
    // The final lane segment is horizontal, offset from the lane row.
    const lane = positions.get('cli:card')!.v;
    const last = points.at(-1)!;
    expect(last.v).toBeCloseTo(points.at(-2)!.v);
    expect(Math.abs(last.v - lane)).toBeCloseTo(Math.abs(bundleOffset(graph, 'cli:card', 'dep:card', 'A2')));
  });

  it('draws a single-line edge on the centre of the track', () => {
    const [main] = graph.paths.get('A6')!;
    expect(bundleOffset(graph, main![0]!, main![1]!, 'A6')).toBe(0);
  });
});

describe('transit layout: projection', () => {
  it('applies the spec formula: nearer rows (larger v) are larger and lower', () => {
    const projection = fitProjection(
      [
        { u: -100, v: -100 },
        { u: 100, v: 100 },
      ],
      { width: 1000, height: 600, flat: false },
    );
    const far = projection.at(0, -100);
    const near = projection.at(0, 100);
    expect(near.k).toBeGreaterThan(far.k);
    expect(near.y).toBeGreaterThan(far.y);
    // k ratio follows F / (D − z1) with z1 = v·cos t at h = 0.
    expect(near.k / far.k).toBeCloseTo((DISTANCE + 100 * Math.cos(TILT)) / (DISTANCE - 100 * Math.cos(TILT)), 6);
    // Height raises a point on screen.
    expect(projection.at(0, 0, 9).y).toBeLessThan(projection.at(0, 0, 0).y);
  });

  it('fits the content into the viewBox, and flat mode keeps the plane aspect', () => {
    const geometry = computeMapGeometry(index, { flat: false });
    for (const s of geometry.stations) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(geometry.width);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(geometry.height);
    }
    const flat = computeMapGeometry(index, { flat: true });
    expect(flat.flat).toBe(true);
    expect(flat.lines[0]!.branches[0]!.ribbons).toEqual([]);
    expect(flat.height).toBeGreaterThan(0);
  });
});

describe('transit layout: stations', () => {
  const geometry = computeMapGeometry(index, { flat: false });
  const station = (id: string) => geometry.stations.find((s) => s.id === id)!;

  it('turns gates and stations used by three or more lines into capsules', () => {
    expect(station('gate:scheduler').capsule).not.toBeNull(); // a gate, two lines
    expect(station('cli:card').capsule).not.toBeNull(); // seven lines
    expect(station('cli:fraud').capsule).toBeNull(); // one line
    expect(station('cli:card').capsule!).toBeGreaterThan(station('gate:consumer').capsule!);
  });

  it('places dependency labels to the right', () => {
    const dep = station('dep:ledger');
    expect(dep.label.anchor).toBe('start');
    expect(dep.label.x).toBeGreaterThan(dep.x);
  });

  it('handles a board with one line and no policies', () => {
    const board: TransitBoard = {
      ...paymentServiceBoard('production'),
      policies: [],
      lines: paymentServiceBoard('production').lines.filter((l) => l.id === 'A4'),
    };
    const g = computeMapGeometry(indexBoard(board), { flat: false });
    expect(g.lines).toHaveLength(1);
    expect(g.stops).toEqual([]);
  });
});

describe('transit layout at the spec scale target', () => {
  it('lays out 60 lines through 80 stations', async () => {
    const { generateBoard } = await import('./mock/generateBoard');
    const board = generateBoard({ lines: 60, stations: 80 });
    const geometry = computeMapGeometry(indexBoard(board), { flat: false });
    expect(geometry.lines).toHaveLength(60);
    expect(geometry.stations).toHaveLength(80);
    expect(geometry.lines.every((l) => l.branches.every((b) => !b.top.includes('NaN')))).toBe(true);
  });
});

describe('transit layout: labels', () => {
  it.each([false, true])('places labels without overlaps (flat: %s), hiding only what fits nowhere', (flat) => {
    const geometry = computeMapGeometry(index, { flat });
    const visible = geometry.stations.filter((s) => !s.label.hidden);
    for (const a of visible) for (const b of visible) if (a !== b) expect(overlaps(a.label.box, b.label.box), `${a.id} / ${b.id}`).toBe(false);
    // Most stations keep a label; every dependency does.
    expect(visible.length).toBeGreaterThanOrEqual(geometry.stations.length * 0.75);
    expect(geometry.stations.filter((s) => s.id.startsWith('dep:')).every((s) => !s.label.hidden)).toBe(true);
    // Labels stay inside the map: on a phone, dependency names used to run past its right edge.
    for (const { id, label } of visible) {
      expect(label.box.x0 >= 0 && label.box.y0 >= 0 && label.box.x1 <= geometry.width && label.box.y1 <= geometry.height, id).toBe(true);
    }
  });
});

