/**
 * LOCAL_MODE subscription stub.
 *
 * In LOCAL_MODE there is no Stripe, no billing, no usage limits. All
 * gates return true and all counters return zero. The Provider keeps
 * its original shape so the rest of the app keeps working unchanged.
 */

import { ReactNode, createContext, useContext } from "react";

export const SUBSCRIPTION_TIERS = {
  free: {
    name: "Free",
    limits: {
      connections: Infinity,
      messagesPerMonth: Infinity,
      totalImports: Infinity,
      totalVisualizations: Infinity,
      queryHistoryDays: Infinity,
      scheduledQueries: 0,
      dashboards: 0,
      dataAlerts: 0,
      sharedLinks: 0,
      sharedLinkExpiryMaxDays: 0,
    },
  },
  pro: { name: "Pro", limits: {} as Record<string, number> },
  business: { name: "Business", limits: {} as Record<string, number> },
};

export function isPlaceholderStripePriceId(_priceId: string | null | undefined): boolean {
  return true;
}

interface SubscriptionState {
  subscribed: boolean;
  tier: "free" | "pro" | "business";
  productId: string | null;
  priceId: string | null;
  subscriptionEnd: string | null;
  loading: boolean;
}

interface UsageState {
  messagesUsedThisMonth: number;
  totalImports: number;
  totalVisualizations: number;
  connectionsCount: number;
}

interface SubscriptionContextType {
  subscription: SubscriptionState;
  usage: UsageState;
  checkSubscription: () => Promise<void>;
  canSendMessage: () => boolean;
  canCreateConnection: () => boolean;
  canImport: () => boolean;
  canVisualize: () => boolean;
  incrementMessageUsage: () => Promise<void>;
  incrementImportUsage: () => Promise<void>;
  incrementVisualizationUsage: () => Promise<void>;
  refreshUsage: () => Promise<void>;
}

const noop = async () => {};

const STUB: SubscriptionContextType = {
  subscription: {
    subscribed: true,
    tier: "business",
    productId: null,
    priceId: null,
    subscriptionEnd: null,
    loading: false,
  },
  usage: {
    messagesUsedThisMonth: 0,
    totalImports: 0,
    totalVisualizations: 0,
    connectionsCount: 0,
  },
  checkSubscription: noop,
  canSendMessage: () => true,
  canCreateConnection: () => true,
  canImport: () => true,
  canVisualize: () => true,
  incrementMessageUsage: noop,
  incrementImportUsage: noop,
  incrementVisualizationUsage: noop,
  refreshUsage: noop,
};

const SubscriptionContext = createContext<SubscriptionContextType>(STUB);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  return <SubscriptionContext.Provider value={STUB}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  return useContext(SubscriptionContext);
}
