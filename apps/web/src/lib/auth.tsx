import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeResponse, Permission } from '@reformar/shared';
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { api, ApiError } from './api';
import { Spinner } from '../components/ui';
import { t } from './i18n';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<MeResponse>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useCan() {
  const { data } = useMe();
  return (p: Permission) => !!data?.activeTenant?.permissions.includes(p);
}

export function useLogout() {
  const qc = useQueryClient();
  return async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } finally {
      qc.clear();
      window.location.assign('/entrar');
    }
  };
}

// Página pública: só é baixada por quem chega sem sessão.
const LandingPage = lazy(() => import('../pages/landing/LandingPage').then((m) => ({ default: m.LandingPage })));

export function RequireAuth() {
  const { data, isLoading, isError } = useMe();
  const location = useLocation();
  if (isLoading) return <Spinner label={t('Carregando…')} />;
  if (isError) {
    return (
      <main className="page narrow">
        <p role="alert">{t('Não foi possível conectar ao servidor. Confira sua internet e recarregue a página.')}</p>
      </main>
    );
  }
  if (!data) {
    // Visitante na raiz vê a apresentação; qualquer outra rota protegida leva ao login.
    if (location.pathname === '/') {
      return (
        <Suspense fallback={null}>
          <LandingPage />
        </Suspense>
      );
    }
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function GuestOnly() {
  const { data, isLoading } = useMe();
  if (isLoading) return <Spinner label={t('Carregando…')} />;
  if (data) return <Navigate to="/" replace />;
  return <Outlet />;
}
