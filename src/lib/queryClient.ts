import { QueryClient } from '@tanstack/react-query';
import { AppError } from './errors';

const NO_RETRY = ['forbidden', 'tenant_not_found', 'booking_not_found', 'config', 'rate_limited'];

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof AppError && NO_RETRY.includes(error.code)) && count < 2,
    },
    mutations: { retry: false },
  },
});
