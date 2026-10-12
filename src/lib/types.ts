export interface InfoCard {
  icon: string;
  title: string;
  text: string;
}

export interface Tenant {
  id: string;
  slug: string;
  status: 'preview' | 'live' | 'archived';
  niche: string;
  name: string;
  tagline: string;
  about: string;
  timezone: string;
  currency: string;
  locale: string;
  accent: string;
  phone: string;
  whatsapp: string;
  telegram: string;
  instagram: string;
  address: string;
  address_note: string;
  map_url: string;
  info_cards: InfoCard[];
  cancel_hours: number;
  horizon_days: number;
  hero_url: string;
  logo_url: string;
}

export interface Service {
  id: string;
  category: string;
  name: string;
  description: string;
  duration_min: number;
  price: number;
  price_is_from: boolean;
  popular: boolean;
  resource_ids: string[];
}

export interface Master {
  id: string;
  kind: string;
  name: string;
  role_title: string;
  bio: string;
  photo_url: string;
  experience_years: number | null;
}

export interface GalleryItem {
  id: string;
  image_url: string;
  caption: string;
}

export interface Storefront {
  tenant: Tenant;
  hours: { weekday: number; opens: string; closes: string }[];
  exceptions: { day: string; opens: string | null; closes: string | null; note: string }[];
  services: Service[];
  resources: Master[];
  gallery: GalleryItem[];
}

export interface Slot {
  start: string;
  free: boolean;
  resource_ids: string[];
}

export interface AvailabilityDay {
  date: string;
  is_open: boolean;
  slots: Slot[];
}

export interface Availability {
  timezone: string;
  from: string;
  to: string;
  days: AvailabilityDay[];
}

export interface BookingResult {
  booking_id: string;
  token: string | null;
  replayed: boolean;
  status: string;
  starts_at: string;
  ends_at: string;
  service_name: string;
  price: number;
  resource_id: string;
  resource_name: string;
  is_demo: boolean;
}

export type BookingStatus = 'confirmed' | 'arrived' | 'done' | 'cancelled' | 'no_show';

export interface PublicBooking {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  service_name: string;
  price: number;
  duration_min: number;
  notes: string;
  is_demo: boolean;
  client_name: string;
  resource: { id: string; name: string; role_title: string; photo_url: string };
  tenant: { slug: string; name: string; status: string; timezone: string; address: string; phone: string; currency: string; cancel_hours: number; map_url: string };
  cancel_deadline: string;
  can_cancel: boolean;
  push_subscribed: boolean;
  reminders_enabled: boolean;
}

export interface OwnerBooking {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  service_id: string;
  service_name: string;
  price: number;
  duration_min: number;
  resource_id: string;
  resource_name: string;
  client_name: string;
  client_phone: string;
  notes: string;
  source: 'client' | 'owner';
  is_demo: boolean;
  cancel_reason: string;
  cancelled_by: string | null;
  paid: number;
  refunded: number;
}

export interface OwnerBlock {
  id: string;
  resource_id: string;
  resource_name: string;
  starts_at: string;
  ends_at: string;
  note: string;
}

export interface OwnerSchedule {
  timezone: string;
  bookings: OwnerBooking[];
  blocks: OwnerBlock[];
}

export interface OwnerStats {
  from: string;
  to: string;
  timezone: string;
  visits: number;
  completed: number;
  booked: number;
  cancelled: number;
  no_show: number;
  payments_total: number;
  refunds_total: number;
  received: number;
  expected: number;
  by_day: { date: string; visits: number; received: number }[];
  top_services: { name: string; count: number }[];
}

export interface Payment {
  id: string;
  kind: 'payment' | 'refund';
  amount: number;
  method: 'cash' | 'card' | 'transfer' | 'other';
  note: string;
  created_at: string;
}

export interface AssistantAction {
  label: string;
  href: string;
}

export interface AssistantReply {
  text: string;
  mode: 'llm-native' | 'llm-json' | 'offline';
  tools: string[];
  actions: AssistantAction[];
  budget_exhausted?: boolean;
}
