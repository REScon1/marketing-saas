// Doménové typy. Každá entita kromě User nese agencyId = hranice tenanta (audit G4).

export type Id = string;
export type IsoDate = string; // ISO 8601 v UTC

export type Role = 'owner' | 'manager' | 'client';
export type Network = 'facebook' | 'instagram' | 'linkedin';
export const NETWORKS: readonly Network[] = ['facebook', 'instagram', 'linkedin'];

export type Language = 'cs' | 'sk' | 'en';

export interface Agency {
  id: Id;
  name: string;
  slug: string;
  plan: 'pilot' | 'starter' | 'pro';
  createdAt: IsoDate;
}

export interface User {
  id: Id;
  email: string;
  name: string;
  createdAt: IsoDate;
}

/** Členství uživatele v agentuře. Role `client` je vždy vázaná na jednoho klienta. */
export interface Membership {
  id: Id;
  agencyId: Id;
  userId: Id;
  role: Role;
  clientId: Id | null;
  createdAt: IsoDate;
}

export interface Client {
  id: Id;
  agencyId: Id;
  name: string;
  contactEmail: string | null;
  archived: boolean;
  createdAt: IsoDate;
}

export type PostFormat = 'image' | 'carousel' | 'reel' | 'story';
export const POST_FORMATS: readonly PostFormat[] = ['image', 'carousel', 'reel', 'story'];
export type AspectRatio = '1:1' | '4:5' | '9:16';
export type FontId =
  | 'Onest' | 'Manrope' | 'DM Sans' | 'Montserrat' | 'Bricolage Grotesque' | 'Unbounded' | 'Archivo'
  | 'Fraunces' | 'Playfair Display' | 'Lora';
export const FONTS: readonly FontId[] = ['Onest', 'Manrope', 'DM Sans', 'Montserrat', 'Bricolage Grotesque', 'Unbounded', 'Archivo', 'Fraunces', 'Playfair Display', 'Lora'];
export type TemplateId = 'editorial' | 'bold' | 'photo' | 'quote' | 'list' | 'minimal' | 'split' | 'gradient';
export const TEMPLATE_IDS: readonly TemplateId[] = ['editorial', 'bold', 'photo', 'quote', 'list', 'minimal', 'split', 'gradient'];

export interface DesignSlide {
  /** Malý nadtitulek, např. „NOVINKA“, „TIP #3“. */
  kicker?: string;
  /** Hlavní text, krátký (max ~70 znaků). */
  headline: string;
  /** Doplňující text (max ~160 znaků). */
  body?: string;
  /** Fotka nebo klip (data: nebo https:). */
  mediaUrl?: string | null;
}

/** Návrh vizuálu postu: šablona + obsah slidů/scén. Vykresluje se v prohlížeči (náhled, export PNG/videa). */
export interface DesignSpec {
  format: PostFormat;
  templateId: TemplateId;
  /** image/carousel: 1:1 | 4:5; reel/story: 9:16 */
  aspect: AspectRatio;
  /** image: 1; carousel: 2–10; reel/story: 1–8 scén */
  slides: DesignSlide[];
  cta?: string;
  /** reel/story: 6–60 s */
  durationSec?: number;
  music?: string | null;
  /** Variabilita pozadí. */
  seed: number;
}

export interface BrandProfile {
  /** Tón hlasu volným textem, např. „přátelský, věcný, bez superlativů“. */
  tone: string;
  audience: string;
  /** Slova a fráze, které značka nikdy nepoužívá. */
  bannedWords: string[];
  /** Ukázkové posty, které značce sedí. Slouží jako kontext pro AI. */
  examples: string[];
  defaultHashtags: string[];
  maxHashtags: number;
  languages: Language[];
  emoji: 'none' | 'few' | 'many';
  /** Hlavní barva značky. */
  color: string;
  secondaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  fontHeading: FontId;
  fontBody: FontId;
  /** Pilíře obsahu (témata, která se střídají), max 8. */
  pillars: string[];
  website: string | null;
}

export interface Brand {
  id: Id;
  agencyId: Id;
  clientId: Id;
  name: string;
  profile: BrandProfile;
  /** Pokud true, post musí před naplánováním schválit klient. */
  requiresClientApproval: boolean;
  archived: boolean;
  createdAt: IsoDate;
}

export interface SocialAccount {
  id: Id;
  agencyId: Id;
  brandId: Id;
  network: Network;
  handle: string;
  /** Identifikátor profilu u poskytovatele publikace (unified API). */
  providerRef: string | null;
  status: 'connected' | 'expired' | 'disconnected';
  createdAt: IsoDate;
}

export type PostStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed';

export interface MediaRef {
  id: Id;
  kind: 'image' | 'video';
  url: string;
  alt: string;
}

export interface PostVersion {
  n: number;
  body: string;
  networks: Network[];
  createdAt: IsoDate;
  createdBy: Id;
}

export interface Post {
  id: Id;
  agencyId: Id;
  brandId: Id;
  clientId: Id;
  title: string;
  body: string;
  /** Volitelné úpravy textu pro konkrétní síť. Bez záznamu platí `body`. */
  overrides: Partial<Record<Network, string>>;
  networks: Network[];
  media: MediaRef[];
  /** Návrh vizuálu (grafika, karusel, reel). null = jen text + nahraná média. */
  design: DesignSpec | null;
  status: PostStatus;
  scheduledAt: IsoDate | null;
  publishedAt: IsoDate | null;
  version: number;
  versions: PostVersion[];
  aiAssisted: boolean;
  createdBy: Id;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface Comment {
  id: Id;
  agencyId: Id;
  postId: Id;
  authorId: Id | null;
  authorName: string;
  authorRole: Role | 'guest';
  body: string;
  /** Verze postu, ke které komentář patří. */
  postVersion: number;
  createdAt: IsoDate;
}

export type ApprovalStatus = 'pending' | 'approved' | 'changes_requested' | 'superseded';

/** Žádost o schválení konkrétní verze postu. Token umožňuje schválit bez registrace. */
export interface ApprovalRequest {
  id: Id;
  agencyId: Id;
  postId: Id;
  postVersion: number;
  token: string;
  status: ApprovalStatus;
  requestedBy: Id;
  requestedAt: IsoDate;
  expiresAt: IsoDate;
  decidedAt: IsoDate | null;
  decidedByName: string | null;
  decidedByUserId: Id | null;
  note: string | null;
}

export type PublishJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'cancelled';

/** Outbox záznam publikace. Jeden na (post, verze, síť). Klíč idempotence je unikátní. */
export interface PublishJob {
  id: Id;
  agencyId: Id;
  postId: Id;
  postVersion: number;
  network: Network;
  accountId: Id;
  idempotencyKey: string;
  status: PublishJobStatus;
  attempts: number;
  runAt: IsoDate;
  lockedUntil: IsoDate | null;
  externalId: string | null;
  externalUrl: string | null;
  lastError: string | null;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface PostMetrics {
  agencyId: Id;
  postId: Id;
  brandId: Id;
  network: Network;
  reach: number;
  impressions: number;
  engagements: number;
  clicks: number;
  collectedAt: IsoDate;
}

export interface AuditEvent {
  id: Id;
  agencyId: Id;
  actorId: Id | null;
  actorName: string;
  action: string;
  entity: 'agency' | 'client' | 'brand' | 'post' | 'account' | 'membership' | 'approval';
  entityId: Id;
  data: Record<string, unknown>;
  createdAt: IsoDate;
}

/** Kdo volá službu. Odvozuje se ze session a živého členství, nikdy z těla requestu. */
export interface Actor {
  userId: Id;
  name: string;
  agencyId: Id;
  role: Role;
  clientId: Id | null;
}

/** Host schvalující přes odkaz bez přihlášení. */
export interface GuestActor {
  kind: 'guest';
  name: string;
  token: string;
}

export const NETWORK_LIMITS: Record<Network, { maxChars: number; label: string }> = {
  facebook: { maxChars: 63206, label: 'Facebook' },
  instagram: { maxChars: 2200, label: 'Instagram' },
  linkedin: { maxChars: 3000, label: 'LinkedIn' },
};
