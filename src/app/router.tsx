import { createBrowserRouter } from 'react-router';
import { RootLayout } from './RootLayout';
import { LandingPage } from './LandingPage';
import { NotFoundPage } from './NotFoundPage';
import { StudioRoot } from '@/features/studio/StudioRoot';
import { StudioLayout } from '@/features/studio/StudioLayout';
import { HomePage } from '@/features/studio/HomePage';
import { ServicesPage } from '@/features/studio/ServicesPage';
import { BookingPage } from '@/features/booking/BookingPage';
import { MyBookingsPage } from '@/features/my/MyBookingsPage';
import { BookingLinkPage } from '@/features/my/BookingLinkPage';
import { ClientAssistantPage } from '@/features/assistant/ClientAssistantPage';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <LandingPage /> },
      {
        path: '/s/:slug',
        element: <StudioRoot />,
        children: [
          {
            path: 'owner',
            // The owner cabinet is a separate chunk: clients never download it.
            lazy: async () => ({ Component: (await import('@/features/owner/OwnerRoot')).OwnerRoot }),
            children: [
              { index: true, lazy: async () => ({ Component: (await import('@/features/owner/schedule/SchedulePage')).SchedulePage }) },
              { path: 'stats', lazy: async () => ({ Component: (await import('@/features/owner/StatsPage')).StatsPage }) },
              { path: 'assistant', lazy: async () => ({ Component: (await import('@/features/owner/OwnerAssistantPage')).OwnerAssistantPage }) },
              { path: 'settings', lazy: async () => ({ Component: (await import('@/features/owner/settings/SettingsPage')).SettingsPage }) },
              { path: 'settings/:section', lazy: async () => ({ Component: (await import('@/features/owner/settings/SettingsSection')).SettingsSection }) },
            ],
          },
          {
            element: <StudioLayout />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'services', element: <ServicesPage /> },
              { path: 'book', element: <BookingPage /> },
              { path: 'me', element: <MyBookingsPage /> },
              { path: 'b/:token', element: <BookingLinkPage /> },
              { path: 'chat', element: <ClientAssistantPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
