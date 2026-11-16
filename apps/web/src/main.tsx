import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Link, RouterProvider } from 'react-router';
import { Layout } from './components/Layout';
import { ApiError } from './lib/api';
import { GuestOnly, RequireAuth } from './lib/auth';
import { I18nRoot, initI18n, t } from './lib/i18n';
import { ToastProvider } from './lib/toast';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage, SignupPage } from './pages/AuthPages';
import { CustomerPage, CustomersListPage } from './pages/customers/CustomerPages';
import { HomePage } from './pages/HomePage';
import { QuotesListPage } from './pages/quotes/QuotesListPage';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/archivo/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Conexão instável: tenta de novo, mas não em erros de permissão/validação.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Sem isto, o TanStack Query PAUSA ações quando o aparelho está offline e o botão fica
      // carregando para sempre. Assim a ação roda: ou vai para a fila offline, ou mostra erro claro.
      networkMode: 'always',
    },
  },
});

function NotFound() {
  return (
    <div className="empty">
      <h1>{t('Página não encontrada')}</h1>
      <Link to="/" className="btn btn-primary">
        {t('Ir para o início')}
      </Link>
    </div>
  );
}

// Telas maiores são carregadas sob demanda (bundle inicial menor em conexões lentas).
const router = createBrowserRouter([
  {
    element: <GuestOnly />,
    children: [
      { path: '/entrar', element: <LoginPage /> },
      { path: '/criar-conta', element: <SignupPage /> },
      { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
    ],
  },
  { path: '/redefinir-senha', element: <ResetPasswordPage /> },
  // Página pública aberta para todos (logado ou não), já na vista 3D. Mantém o link antigo da versão de teste.
  {
    path: '/apresentacao-3d',
    lazy: () => import('./pages/landing/LandingPage').then((m) => ({ Component: () => <m.LandingPage prefer="3d" /> })),
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <HomePage /> },
          { path: '/orcamentos', element: <QuotesListPage /> },
          {
            path: '/orcamentos/novo',
            lazy: () => import('./pages/quotes/QuoteEditorPage').then((m) => ({ Component: m.QuoteEditorPage })),
          },
          { path: '/orcamentos/:id', lazy: () => import('./pages/quotes/QuoteDetailPage').then((m) => ({ Component: m.QuoteDetailPage })) },
          {
            path: '/orcamentos/:id/editar',
            lazy: () => import('./pages/quotes/QuoteEditorPage').then((m) => ({ Component: m.QuoteEditorPage })),
          },
          { path: '/clientes', element: <CustomersListPage /> },
          { path: '/clientes/novo', element: <CustomerPage /> },
          { path: '/clientes/:id', element: <CustomerPage /> },
          { path: '/empresa', lazy: () => import('./pages/company/CompanyPages').then((m) => ({ Component: m.CompanyPage })) },
          { path: '/empresa/servicos', lazy: () => import('./pages/company/CompanyPages').then((m) => ({ Component: m.ServicesPage })) },
          { path: '/obras', lazy: () => import('./pages/projects/ProjectsPages').then((m) => ({ Component: m.ProjectsListPage })) },
          { path: '/obras/nova', lazy: () => import('./pages/projects/MeasurementPage').then((m) => ({ Component: m.ConvertQuotePage })) },
          { path: '/obras/:id', lazy: () => import('./pages/projects/ProjectsPages').then((m) => ({ Component: m.ProjectDetailPage })) },
          {
            path: '/obras/:id/medicoes/nova',
            lazy: () => import('./pages/projects/MeasurementPage').then((m) => ({ Component: m.MeasurementPage })),
          },
          {
            path: '/obras/:id/medicoes/:mid',
            lazy: () => import('./pages/projects/MeasurementPage').then((m) => ({ Component: m.MeasurementPage })),
          },
          { path: '/financeiro', lazy: () => import('./pages/finance/FinancePages').then((m) => ({ Component: m.FinancePage })) },
          {
            path: '/financeiro/gasto/novo',
            lazy: () => import('./pages/finance/FinancePages').then((m) => ({ Component: m.ExpenseFormPage })),
          },
          { path: '/estoque', lazy: () => import('./pages/stock/StockPage').then((m) => ({ Component: m.StockPage })) },
          { path: '/mais', lazy: () => import('./pages/MorePage').then((m) => ({ Component: m.MorePage })) },
          { path: '/assistente', lazy: () => import('./pages/ai/AssistantPage').then((m) => ({ Component: m.AssistantPage })) },
          { path: '/assinatura', lazy: () => import('./pages/billing/BillingPages').then((m) => ({ Component: m.BillingPage })) },
          { path: '/plataforma', lazy: () => import('./pages/billing/BillingPages').then((m) => ({ Component: m.PlatformAdminPage })) },
          { path: '/conta', lazy: () => import('./pages/AccountPage').then((m) => ({ Component: m.AccountPage })) },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

// PWA: em produção, registra o service worker (abre o app sem internet; nunca guarda dados da API).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

// O dicionário do idioma escolhido carrega antes da primeira pintura (sem piscar em português).
void initI18n().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nRoot>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </I18nRoot>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
