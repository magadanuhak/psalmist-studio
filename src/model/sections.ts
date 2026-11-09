import type { Project, Section } from './types';

export type SectionRole = 'source' | 'copy' | 'placeholder';

/** Only the first strofa and the first refren are recorded; later ones are linked copies; the rest are placeholders. */
export function assignRoles(sections: Section[]): Section[] {
  const source: Partial<Record<string, string>> = {};
  return sections.map((s) => {
    if (s.type === 'strofa' || s.type === 'refren') {
      if (!source[s.type]) {
        source[s.type] = s.id;
        return { ...s, generated: false, sourceSectionId: undefined };
      }
      return { ...s, generated: true, sourceSectionId: source[s.type] };
    }
    return { ...s, generated: true, sourceSectionId: undefined };
  });
}

export function sectionRole(s: Section): SectionRole {
  if (!s.generated) return 'source';
  return s.sourceSectionId ? 'copy' : 'placeholder';
}

/** The section whose takes are used for this section (own override first, then the linked source). */
export function effectiveSection(p: Project, s: Section): Section {
  if (s.takes.length || !s.sourceSectionId) return s;
  return p.sections.find((x) => x.id === s.sourceSectionId) ?? s;
}

export function hasMaterial(p: Project, s: Section): boolean {
  return effectiveSection(p, s).takes.length > 0;
}
