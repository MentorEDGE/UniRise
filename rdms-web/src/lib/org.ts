import type { Settings } from './types';

/**
 * Schools and departments. A university can be organised in schools (each holding some departments); an institute or
 * college has departments only. Everywhere a list can be narrowed "by department", the same value may also name a
 * whole school, written as "school:<name>"; an empty value means the whole institution.
 */
export const SCHOOL = 'school:';

export const hasSchools = (s: Settings) => (s.schools?.length ?? 0) > 0;

/** The school a department belongs to ('' when the institution has no schools). */
export const schoolOf = (s: Settings, department: string) => s.schools?.find((x) => x.departments.includes(department))?.name ?? '';

/** Departments covered by a filter value: null for "all", one for a department, all of a school's for a school. */
export function departmentsIn(s: Settings, value: string): string[] | null {
  if (!value) return null;
  if (value.startsWith(SCHOOL)) return s.schools?.find((x) => x.name === value.slice(SCHOOL.length))?.departments ?? [];
  return [value];
}

/** Does a department fall under a filter value (a department, a school, or '' for all)? */
export function inUnit(s: Settings, value: string, department: string): boolean {
  if (!value) return true;
  if (!value.startsWith(SCHOOL)) return department === value;
  return departmentsIn(s, value)!.includes(department);
}

/** How a filter value reads on screen: the school or department name. */
export const unitLabel = (value: string) => (value.startsWith(SCHOOL) ? value.slice(SCHOOL.length) : value);

/** The filter field's label. */
export const unitFieldLabel = (s: Settings) => (hasSchools(s) ? 'School / Department' : 'Department');

/** Options for a department filter: plain departments, or grouped under schools with an "All of …" choice each. */
export function unitOptions(s: Settings): (string | { value: string; label: string; group?: string })[] {
  if (!hasSchools(s)) return s.departments;
  const placed = new Set(s.schools!.flatMap((x) => x.departments));
  return [
    ...s.schools!.flatMap((x) => [{ value: SCHOOL + x.name, label: `All of ${x.name}`, group: x.name }, ...x.departments.map((d) => ({ value: d, label: d, group: x.name }))]),
    ...s.departments.filter((d) => !placed.has(d)).map((d) => ({ value: d, label: d, group: 'Not in a school' })),
  ];
}
