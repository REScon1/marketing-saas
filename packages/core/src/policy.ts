import { forbidden } from './errors.js';
import type { Actor, Brand, Client, Post, Role } from './types.js';

// Oprávnění: default deny. Každá funkce buď projde, nebo vyhodí forbidden.
// Agentura se nikdy nebere z requestu, ale z Actor (živé členství).

const STAFF: Role[] = ['owner', 'manager'];

export const isStaff = (a: Actor) => STAFF.includes(a.role);

export function assertStaff(a: Actor) {
  if (!isStaff(a)) throw forbidden('Akce je dostupná jen týmu agentury');
}

export function assertOwner(a: Actor) {
  if (a.role !== 'owner') throw forbidden('Akce je dostupná jen majiteli agentury');
}

function assertSameAgency(a: Actor, entity: { agencyId: string }) {
  // Úložiště filtruje podle agencyId; tohle je druhá pojistka proti chybě v dotazu.
  if (entity.agencyId !== a.agencyId) throw forbidden('Záznam patří jiné agentuře');
}

export function canSeeClient(a: Actor, c: Client): boolean {
  if (c.agencyId !== a.agencyId) return false;
  return isStaff(a) || (a.role === 'client' && a.clientId === c.id);
}

export function assertCanSeeClient(a: Actor, c: Client) {
  assertSameAgency(a, c);
  if (!canSeeClient(a, c)) throw forbidden();
}

export function canSeeBrand(a: Actor, b: Brand): boolean {
  if (b.agencyId !== a.agencyId) return false;
  return isStaff(a) || (a.role === 'client' && a.clientId === b.clientId);
}

export function assertCanSeeBrand(a: Actor, b: Brand) {
  assertSameAgency(a, b);
  if (!canSeeBrand(a, b)) throw forbidden();
}

/** Klient vidí jen posty svého klienta, které už mu agentura poslala (ne rozpracované koncepty). */
export function canSeePost(a: Actor, p: Post): boolean {
  if (p.agencyId !== a.agencyId) return false;
  if (isStaff(a)) return true;
  return a.role === 'client' && a.clientId === p.clientId && p.status !== 'draft';
}

export function assertCanSeePost(a: Actor, p: Post) {
  assertSameAgency(a, p);
  if (!canSeePost(a, p)) throw forbidden();
}

export function assertCanDecide(a: Actor, p: Post) {
  assertSameAgency(a, p);
  if (a.role !== 'client' || a.clientId !== p.clientId) {
    throw forbidden('Schvalovat může jen klient, kterému post patří');
  }
}
