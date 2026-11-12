import { groupVoices } from './grouping';
import { defaultVoiceName, formatTime, Recording, Segment } from './store';
import { speakerColor } from './theme';

/** Une personne de la réunion, telle qu'affichée. */
export type Person = {
  key: string; // clé stable (identifiant de la voix « ancre »), sert à mémoriser le nom
  anchor: number;
  index: number; // ordre d'apparition : 0 = première personne à parler
  name: string;
  named: boolean;
  color: string;
  duration: number;
  share: number; // part du temps de parole (0..1)
  turns: number; // nombre d'interventions
  ranges: [number, number][]; // passages, pour l'écoute et l'export audio
};

/** Une bulle de conversation (interventions consécutives d'une même personne fusionnées). */
export type Bubble = { start: number; end: number; person: number; text: string; parts: number };

export type MeetingView = { people: Person[]; bubbles: Bubble[]; segments: (Segment & { person: number })[] };

export function buildView(rec: Recording, dark: boolean): MeetingView {
  const segs = rec.segments ?? [];
  // 1. qui appartient à qui (fusions instantanées + fusions manuelles)
  let mapping: Map<number, number>;
  if (rec.voices && rec.voices.length) {
    mapping = groupVoices(rec.voices, { auto: false, target: rec.reduceTo ?? 0, merges: rec.merges ?? [] });
  } else {
    mapping = new Map();
    for (const s of segs) mapping.set(s.speaker, s.speaker);
    for (const [a, b] of rec.merges ?? []) {
      const ga = mapping.get(a);
      const gb = mapping.get(b);
      if (ga == null || gb == null) continue;
      for (const [k, v] of mapping) if (v === gb) mapping.set(k, ga);
    }
  }
  // 2. personnes dans l'ordre d'apparition
  const order: number[] = [];
  for (const s of segs) {
    const a = mapping.get(s.speaker) ?? s.speaker;
    if (!order.includes(a)) order.push(a);
  }
  const total = segs.reduce((acc, s) => acc + (s.end - s.start), 0) || 1;
  const people: Person[] = order.map((anchor, index) => {
    const key = String(anchor);
    const mine = segs.filter(s => (mapping.get(s.speaker) ?? s.speaker) === anchor);
    const duration = mine.reduce((acc, s) => acc + (s.end - s.start), 0);
    const named = !!rec.speakers[key];
    return {
      key,
      anchor,
      index,
      name: rec.speakers[key] || defaultVoiceName(index),
      named,
      color: speakerColor(index, dark),
      duration,
      share: duration / total,
      turns: 0,
      ranges: mine.map(s => [s.start, s.end] as [number, number]),
    };
  });
  const indexOf = new Map(order.map((a, i) => [a, i]));
  const segments = segs.map(s => ({ ...s, person: indexOf.get(mapping.get(s.speaker) ?? s.speaker) ?? 0 }));
  // 3. bulles : on regroupe les morceaux consécutifs d'une même personne
  const bubbles: Bubble[] = [];
  for (const s of segments) {
    const last = bubbles[bubbles.length - 1];
    if (last && last.person === s.person && s.start - last.end < 2.0) {
      last.end = Math.max(last.end, s.end);
      if (s.text) last.text = last.text ? `${last.text} ${s.text}` : s.text;
      last.parts++;
    } else {
      bubbles.push({ start: s.start, end: s.end, person: s.person, text: s.text, parts: 1 });
    }
  }
  for (const b of bubbles) people[b.person].turns++;
  return { people, bubbles, segments };
}

// ---------- Exports texte ----------

function pad(n: number, w = 2) {
  return String(n).padStart(w, '0');
}

function srtTime(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))},${pad(ms % 1000, 3)}`;
}

function dateLabel(ts: number) {
  return new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function exportText(rec: Recording, v: MeetingView) {
  const lines = [rec.title, `${dateLabel(rec.createdAt)} · ${formatTime(rec.duration)}`, ''];
  lines.push(`Participants : ${v.people.map(p => `${p.name} (${Math.round(p.share * 100)} %)`).join(', ')}`, '');
  for (const b of v.bubbles) {
    lines.push(`[${formatTime(b.start)}] ${v.people[b.person].name}`);
    lines.push(b.text || '…', '');
  }
  return lines.join('\n');
}

export function exportMarkdown(rec: Recording, v: MeetingView) {
  const lines = [`# ${rec.title}`, '', `*${dateLabel(rec.createdAt)} · durée ${formatTime(rec.duration)}*`, '', '## Participants', ''];
  for (const p of v.people) lines.push(`- **${p.name}** — ${Math.round(p.share * 100)} % du temps de parole, ${p.turns} interventions`);
  lines.push('', '## Conversation', '');
  for (const b of v.bubbles) lines.push(`**${v.people[b.person].name}** · \`${formatTime(b.start)}\`  `, b.text || '…', '');
  return lines.join('\n');
}

export function exportSrt(rec: Recording, v: MeetingView) {
  return v.bubbles
    .map((b, i) => `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${v.people[b.person].name} : ${b.text || '…'}\n`)
    .join('\n');
}

export function safeFileName(s: string) {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9-_ ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'reunion'
  );
}
