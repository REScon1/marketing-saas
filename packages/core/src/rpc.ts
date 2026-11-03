import { DomainError } from './errors.js';
import type { Services } from './services.js';
import type { Actor } from './types.js';

// Jediné místo, které určuje, co je z klienta volatelné. Server i demo v prohlížeči
// volají služby přes `invoke`, takže demo ukazuje přesně stejnou logiku a oprávnění.

type Fn = (...args: never[]) => unknown;
type DropActor<F> = F extends (actor: Actor, ...rest: infer A) => infer R ? (...args: A) => R : never;

type S = Services;

export const ACTOR_METHODS = {
  'tenancy.getAgency': (s: S) => s.tenancy.getAgency,
  'tenancy.listMembers': (s: S) => s.tenancy.listMembers,
  'tenancy.inviteMember': (s: S) => s.tenancy.inviteMember,
  'tenancy.removeMember': (s: S) => s.tenancy.removeMember,
  'catalog.listClients': (s: S) => s.catalog.listClients,
  'catalog.createClient': (s: S) => s.catalog.createClient,
  'catalog.updateClient': (s: S) => s.catalog.updateClient,
  'catalog.listBrands': (s: S) => s.catalog.listBrands,
  'catalog.getBrand': (s: S) => s.catalog.getBrand,
  'catalog.createBrand': (s: S) => s.catalog.createBrand,
  'catalog.updateBrand': (s: S) => s.catalog.updateBrand,
  'catalog.connectAccount': (s: S) => s.catalog.connectAccount,
  'catalog.disconnectAccount': (s: S) => s.catalog.disconnectAccount,
  'content.listPosts': (s: S) => s.content.listPosts,
  'content.getPost': (s: S) => s.content.getPost,
  'content.createPost': (s: S) => s.content.createPost,
  'content.updatePost': (s: S) => s.content.updatePost,
  'content.createFromConcept': (s: S) => s.content.createFromConcept,
  'content.bulkCreateFromPlan': (s: S) => s.content.bulkCreateFromPlan,
  'content.submitForApproval': (s: S) => s.content.submitForApproval,
  'content.decide': (s: S) => s.content.decide,
  'content.addComment': (s: S) => s.content.addComment,
  'content.schedule': (s: S) => s.content.schedule,
  'content.unschedule': (s: S) => s.content.unschedule,
  'content.retryFailed': (s: S) => s.content.retryFailed,
  'content.pendingApprovals': (s: S) => s.content.pendingApprovals,
  'content.activity': (s: S) => s.content.activity,
  'reports.monthly': (s: S) => s.reports.monthly,
  'reports.overview': (s: S) => s.reports.overview,
  'ai.info': (s: S) => s.ai.info,
  'ai.draft': (s: S) => s.ai.draft,
  'ai.rewrite': (s: S) => s.ai.rewrite,
  'ai.concepts': (s: S) => s.ai.concepts,
  'ai.planMonth': (s: S) => s.ai.planMonth,
} as const;

export const PUBLIC_METHODS = {
  'public.getApproval': (s: S) => s.content.getPublicApproval,
  'public.decide': (s: S) => s.content.decideByToken,
  'public.comment': (s: S) => s.content.addCommentByToken,
} as const;

export type ActorMethod = keyof typeof ACTOR_METHODS;
export type PublicMethod = keyof typeof PUBLIC_METHODS;

export type ActorApi = { [K in ActorMethod]: DropActor<ReturnType<(typeof ACTOR_METHODS)[K]>> };
export type PublicApi = { [K in PublicMethod]: ReturnType<(typeof PUBLIC_METHODS)[K]> };

/** Typ, který implementuje HTTP klient i demo backend. */
export interface Backend {
  call<K extends ActorMethod>(method: K, ...args: Parameters<ActorApi[K]>): Promise<Awaited<ReturnType<ActorApi[K]>>>;
  callPublic<K extends PublicMethod>(method: K, ...args: Parameters<PublicApi[K]>): Promise<Awaited<ReturnType<PublicApi[K]>>>;
}

export const isActorMethod = (m: string): m is ActorMethod => Object.prototype.hasOwnProperty.call(ACTOR_METHODS, m);
export const isPublicMethod = (m: string): m is PublicMethod => Object.prototype.hasOwnProperty.call(PUBLIC_METHODS, m);

export async function invoke(services: S, actor: Actor, method: string, args: unknown[]): Promise<unknown> {
  if (!isActorMethod(method)) throw new DomainError('not_found', `Neznámá metoda ${method}`);
  if (!Array.isArray(args)) throw new DomainError('invalid', 'Argumenty musí být pole');
  const fn = ACTOR_METHODS[method](services) as unknown as Fn;
  return (fn as (...a: unknown[]) => unknown)(actor, ...args);
}

export async function invokePublic(services: S, method: string, args: unknown[]): Promise<unknown> {
  if (!isPublicMethod(method)) throw new DomainError('not_found', `Neznámá metoda ${method}`);
  if (!Array.isArray(args)) throw new DomainError('invalid', 'Argumenty musí být pole');
  const fn = PUBLIC_METHODS[method](services) as unknown as Fn;
  return (fn as (...a: unknown[]) => unknown)(...args);
}

/** HTTP status pro doménovou chybu. */
export function httpStatus(e: DomainError): number {
  return { not_found: 404, forbidden: 403, invalid: 422, conflict: 409, invalid_transition: 409, expired: 410 }[e.code];
}
