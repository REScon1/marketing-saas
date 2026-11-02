import type { Brand, Client } from '@ms/core';
import { useMemo } from 'react';
import { useApi, useData } from './app';

export function useCatalog() {
  const api = useApi();
  const brands = useData(() => api.call('catalog.listBrands'), []);
  const clients = useData(() => api.call('catalog.listClients'), []);
  const brandById = useMemo(() => new Map<string, Brand>((brands.data ?? []).map((b) => [b.id, b])), [brands.data]);
  const clientById = useMemo(() => new Map<string, Client>((clients.data ?? []).map((c) => [c.id, c])), [clients.data]);
  return { brands: brands.data ?? [], clients: clients.data ?? [], brandById, clientById, loading: brands.loading || clients.loading };
}
