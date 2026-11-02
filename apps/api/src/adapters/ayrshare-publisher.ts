import type { LookupResult, Network, PublishRequest, PublishResult, SocialPublisher } from '@ms/core';

/**
 * STUB – Ayrshare (unified social API) zatím NENÍ implementovaný.
 *
 * Záměr: publish = POST na Ayrshare s textem, médii a profilem (`providerRef` = profil
 * klienta u Ayrshare), klíč idempotence předat poskytovateli, aby šlo po ztracené
 * odpovědi dohledat, zda post vyšel (`lookup`). Detaily API (endpointy, hlavičky,
 * podpora idempotence, mapování chyb na retryable/fatal) je nutné ověřit v jejich
 * dokumentaci – tady je záměrně nehádáme.
 *
 * TODO(ayrshare): implementovat publish/lookup podle oficiální dokumentace + testy proti sandboxu.
 */
export class AyrsharePublisher implements SocialPublisher {
  readonly label = 'Ayrshare (neimplementováno)';

  constructor(private readonly apiKey: string | null) {
    if (!apiKey) throw new Error('Ayrshare není nakonfigurovaný: chybí AYRSHARE_API_KEY');
  }

  async publish(_req: PublishRequest): Promise<PublishResult> {
    // Záměrně nevyhazujeme výjimku: ta by znamenala „neznámý výsledek“ a úloha by visela v unknown.
    // Trvalá chyba úlohu viditelně označí jako failed.
    return { ok: false, retryable: false, error: 'Ayrshare adaptér zatím není implementovaný (TODO)' };
  }

  async lookup(_idempotencyKey: string, _network: Network): Promise<LookupResult> {
    throw new Error('Ayrshare adaptér zatím není implementovaný (TODO)');
  }
}
