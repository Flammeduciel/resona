/**
 * Regroupement des « voix brutes » en personnes.
 *
 * L'analyse native découpe volontairement trop finement (une même personne peut donner 5 à 15 voix
 * brutes selon sa distance au micro, son volume, son débit…). Chaque voix brute a une empreinte
 * vocale moyenne. On les regroupe ici, côté interface, ce qui rend le changement du nombre de
 * participants instantané (pas besoin de relancer la transcription).
 *
 * Algorithme (validé sur des réunions de test de 2 à 4 personnes) :
 *  1. fusion des paires d'empreintes les plus proches tant que la similarité ≥ seuil ;
 *  2. rattachement des voix minuscules (< 4 s ou < 4 % du temps de parole) à la plus proche ;
 *  3. si le nombre de participants est connu, fusion jusqu'à atteindre ce nombre ;
 *  4. fusions manuelles demandées par l'utilisateur (« c'est la même personne »).
 */

export type Voice = { id: number; duration: number; embedding?: number[] };

export const SENSITIVITY_TAU = { fewer: 0.62, normal: 0.7, more: 0.78 } as const;

function dot(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function normalize(v: number[]) {
  const n = Math.sqrt(dot(v, v)) || 1;
  return v.map(x => x / n);
}

/** Renvoie, pour chaque voix brute, l'identifiant de la voix « ancre » de son groupe. */
export function groupVoices(
  voices: Voice[],
  opts: { target?: number; tau?: number; merges?: [number, number][]; auto?: boolean } = {},
): Map<number, number> {
  const tau = opts.tau ?? SENSITIVITY_TAU.normal;
  const target = opts.target ?? 0;
  const mapping = new Map<number, number>();
  for (const v of voices) mapping.set(v.id, v.id);
  if (voices.length <= 1) return mapping;

  const emb = new Map<number, number[]>();
  const dur = new Map<number, number>();
  for (const v of voices) if (v.embedding && v.embedding.length) {
    emb.set(v.id, normalize(v.embedding));
    dur.set(v.id, v.duration);
  }
  // voix sans empreinte : rattachées à la plus présente
  const main = [...voices].sort((a, b) => b.duration - a.duration)[0].id;
  for (const v of voices) if (!emb.has(v.id) && emb.has(main)) mapping.set(v.id, main);

  const merge = (x: number, y: number) => {
    const [a, b] = (dur.get(x) ?? 0) >= (dur.get(y) ?? 0) ? [x, y] : [y, x];
    const ea = emb.get(a)!;
    const eb = emb.get(b)!;
    const da = dur.get(a)!;
    const db = dur.get(b)!;
    emb.set(a, normalize(ea.map((v, i) => v * da + eb[i] * db)));
    dur.set(a, da + db);
    emb.delete(b);
    dur.delete(b);
    for (const [k, v] of mapping) if (v === b) mapping.set(k, a);
  };
  const bestPair = (): [number, number, number] | null => {
    const ks = [...emb.keys()];
    let best: [number, number, number] | null = null;
    for (let i = 0; i < ks.length; i++)
      for (let j = i + 1; j < ks.length; j++) {
        const s = dot(emb.get(ks[i])!, emb.get(ks[j])!);
        if (!best || s > best[0]) best = [s, ks[i], ks[j]];
      }
    return best;
  };
  const more = () => emb.size > 1 && (target <= 0 || emb.size > target);

  const auto = opts.auto ?? true;
  while (auto && more()) {
    const p = bestPair();
    if (!p || p[0] < tau) break;
    merge(p[1], p[2]);
  }
  const total = [...dur.values()].reduce((a, b) => a + b, 0);
  while (auto && more()) {
    const small = [...dur.entries()].sort((a, b) => a[1] - b[1])[0][0];
    if (dur.get(small)! >= Math.max(4, 0.04 * total)) break;
    let near = -1;
    let bestSim = -2;
    for (const k of emb.keys()) if (k !== small) {
      const s = dot(emb.get(small)!, emb.get(k)!);
      if (s > bestSim) { bestSim = s; near = k; }
    }
    merge(near, small);
  }
  while (target > 0 && emb.size > target) {
    const p = bestPair();
    if (!p) break;
    merge(p[1], p[2]);
  }
  for (const [a, b] of opts.merges ?? []) {
    const ga = mapping.get(a);
    const gb = mapping.get(b);
    if (ga == null || gb == null || ga === gb) continue;
    if (emb.has(ga) && emb.has(gb)) merge(ga, gb);
    else for (const [k, v] of mapping) if (v === gb) mapping.set(k, ga);
  }
  return mapping;
}
