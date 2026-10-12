import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { toAppError } from '@/lib/errors';
import { ownerKey } from './OwnerRoot';

export interface OwnerService {
  id: string;
  config_key: string | null;
  category: string;
  name: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  price: number;
  price_is_from: boolean;
  popular: boolean;
  active: boolean;
  sort: number;
}
export interface OwnerResource {
  id: string;
  config_key: string | null;
  kind: string;
  name: string;
  role_title: string;
  bio: string;
  photo_url: string;
  photo_source: string;
  experience_years: number | null;
  active: boolean;
  sort: number;
}

/** Full catalogue (including inactive rows) through RLS: only the owner's tenant is visible. */
export function useCatalog(tenantId: string) {
  return useQuery({
    queryKey: ownerKey(tenantId, 'catalog'),
    queryFn: async () => {
      const [s, r, rs] = await Promise.all([
        supabase.from('services').select('*').eq('tenant_id', tenantId).order('sort').order('name'),
        supabase.from('resources').select('*').eq('tenant_id', tenantId).order('sort').order('name'),
        supabase.from('resource_services').select('resource_id, service_id').eq('tenant_id', tenantId),
      ]);
      for (const res of [s, r, rs]) if (res.error) throw toAppError(res.error);
      const services = (s.data as OwnerService[]).map((x) => ({ ...x, price: Number(x.price) }));
      const resources = r.data as OwnerResource[];
      const links = rs.data as { resource_id: string; service_id: string }[];
      const mastersOf = (serviceId: string) => links.filter((l) => l.service_id === serviceId).map((l) => l.resource_id);
      return { services, resources, links, mastersOf };
    },
  });
}
