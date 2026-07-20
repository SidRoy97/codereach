import { CodeGraph } from './CodeGraphTypes';

// One detected subsystem: its members and how many symbols it holds.
export interface Community {
  id:      number;
  size:    number;
  members: string[];
}

// I group symbols into subsystems by running Louvain modularity on the call graph.
export class CommunityDetector {
  constructor(private readonly getGraph: () => CodeGraph) {}

  // I return the detected subsystems, largest first.
  detect(): Community[] {
    const graph = this.getGraph();
    const ids = graph.nodes.map(n => n.id);
    if (ids.length === 0) return [];

    const neighbours = this.buildNeighbours(graph, ids);
    const community = this.optimize(ids, neighbours);
    return this.groupByCommunity(ids, community);
  }

  // I build an undirected neighbour list from the call edges.
  private buildNeighbours(graph: CodeGraph, ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const id of ids) map.set(id, []);
    for (const edge of graph.edges) {
      if (edge.relation !== 'calls') continue;
      if (!map.has(edge.from) || !map.has(edge.to)) continue;
      if (edge.from === edge.to) continue;
      map.get(edge.from)!.push(edge.to);
      map.get(edge.to)!.push(edge.from);
    }
    return map;
  }

  // I move each symbol to the neighbouring community that best improves modularity.
  private optimize(ids: string[], neighbours: Map<string, string[]>): Map<string, number> {
    const degree = new Map<string, number>();
    let m = 0;
    for (const id of ids) {
      const d = neighbours.get(id)!.length;
      degree.set(id, d);
      m += d;
    }
    m = m / 2;
    if (m === 0) return new Map(ids.map((id, i) => [id, i]));

    const community = new Map<string, number>(ids.map((id, i) => [id, i]));
    const communityDegree = new Map<number, number>(ids.map((id, i) => [i, degree.get(id)!]));

    let improved = true;
    let passes = 0;
    while (improved && passes < 20) {
      improved = false;
      passes++;
      for (const id of ids) {
        const current = community.get(id)!;
        communityDegree.set(current, communityDegree.get(current)! - degree.get(id)!);
        const best = this.bestCommunity(id, current, neighbours, community, communityDegree, degree, m);
        communityDegree.set(best, (communityDegree.get(best) ?? 0) + degree.get(id)!);
        if (best !== current) { community.set(id, best); improved = true; }
      }
    }
    return community;
  }

  // I pick the community with the highest modularity gain for one symbol.
  private bestCommunity(
    id: string, current: number, neighbours: Map<string, string[]>,
    community: Map<string, number>, communityDegree: Map<number, number>,
    degree: Map<string, number>, m: number,
  ): number {
    const linksTo = new Map<number, number>();
    for (const nb of neighbours.get(id)!) {
      const c = community.get(nb)!;
      linksTo.set(c, (linksTo.get(c) ?? 0) + 1);
    }
    let best = current;
    let bestGain = 0;
    const ki = degree.get(id)!;
    for (const [c, links] of linksTo) {
      const gain = links - (communityDegree.get(c) ?? 0) * ki / (2 * m);
      if (gain > bestGain) { bestGain = gain; best = c; }
    }
    return best;
  }

  // I collapse raw community labels into clean subsystems, largest first.
  private groupByCommunity(ids: string[], community: Map<string, number>): Community[] {
    const buckets = new Map<number, string[]>();
    for (const id of ids) {
      const c = community.get(id)!;
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c)!.push(id);
    }
    return Array.from(buckets.values())
      .sort((a, b) => b.length - a.length)
      .map((members, index) => ({ id: index, size: members.length, members }));
  }
}
