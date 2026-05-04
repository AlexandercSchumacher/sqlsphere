import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Check, Sparkles, Zap, Crown, Rocket } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useSubscription, SUBSCRIPTION_TIERS, isPlaceholderStripePriceId } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface SubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SubscriptionDialog = ({ open, onOpenChange }: SubscriptionDialogProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { subscription, usage, checkSubscription } = useSubscription();
  const { session } = useAuth();
  const [loadingCheckout, setLoadingCheckout] = useState<string | null>(null);
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast({
        title: t('subscription.subscriptionSuccess', 'Subscription successful!'),
        description: t('subscription.welcomeToPro', 'Welcome! Enjoy your new plan.'),
      });
      checkSubscription();
    } else if (searchParams.get('canceled') === 'true') {
      toast({
        title: t('subscription.subscriptionCanceled', 'Subscription canceled'),
        description: t('subscription.noChargesMade', 'No charges were made.'),
        variant: 'destructive',
      });
    }
  }, [searchParams, toast, checkSubscription, t]);

  const handleCheckout = async (priceId: string) => {
    if (!session) {
      toast({
        title: t('subscription.loginRequired', 'Login required'),
        description: t('subscription.pleaseLoginFirst', 'Please log in to subscribe.'),
        variant: 'destructive',
      });
      return;
    }

    if (isPlaceholderStripePriceId(priceId)) {
      toast({
        title: t('subscription.checkoutError', 'Checkout error'),
        description: t(
          'subscription.missingStripePriceId',
          'Stripe price IDs are not configured. Set the VITE_STRIPE_PRICE_* environment variables.'
        ),
        variant: 'destructive',
      });
      return;
    }

    setLoadingCheckout(priceId);
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { priceId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (err) {
      console.error('Checkout error:', err);
      toast({
        title: t('subscription.checkoutError', 'Checkout error'),
        description: t('subscription.failedToStartCheckout', 'Failed to start checkout. Please try again.'),
        variant: 'destructive',
      });
    } finally {
      setLoadingCheckout(null);
    }
  };

  const handleManageSubscription = async () => {
    if (!session) return;

    setLoadingPortal(true);
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, '_blank');
      }
    } catch (err) {
      console.error('Portal error:', err);
      toast({
        title: t('subscription.portalError', 'Portal error'),
        description: t('subscription.failedToOpenPortal', 'Failed to open billing portal. Please try again.'),
        variant: 'destructive',
      });
    } finally {
      setLoadingPortal(false);
    }
  };

  const freeLimits = SUBSCRIPTION_TIERS.free.limits;
  const proLimits = SUBSCRIPTION_TIERS.pro.limits;
  const currentPriceId = subscription.priceId;
  const isProMonthly = currentPriceId === SUBSCRIPTION_TIERS.pro.monthly.priceId;
  const isProAnnual = currentPriceId === SUBSCRIPTION_TIERS.pro.annual.priceId;
  const isBusinessMonthly = currentPriceId === SUBSCRIPTION_TIERS.business.monthly.priceId;
  const isBusinessAnnual = currentPriceId === SUBSCRIPTION_TIERS.business.annual.priceId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl text-center">{t('subscription.title', 'Choose Your Plan')}</DialogTitle>
        </DialogHeader>

        {/* Billing Cycle Toggle */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex items-center bg-muted rounded-full p-1">
            <button
              onClick={() => setBillingCycle('monthly')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                billingCycle === 'monthly'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('subscription.monthly', 'Monthly')}
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors flex items-center gap-1 ${
                billingCycle === 'annual'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t('subscription.annual', 'Annual')}
              <Badge variant="secondary" className="ml-1 text-xs">
                {t('subscription.save20', 'Save 20%')}
              </Badge>
            </button>
          </div>
        </div>

        {/* Current Usage (for Free tier) */}
        {subscription.tier === 'free' && (
          <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="mb-3">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                {t('subscription.currentUsage', 'Your Current Usage')}
              </h3>
            </div>
            <div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">{t('subscription.connections', 'Connections')}</div>
                  <div className="font-semibold">{usage.connectionsCount} / {freeLimits.connections}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('subscription.messagesThisMonth', 'Messages This Month')}</div>
                  <div className="font-semibold">{usage.messagesUsedThisMonth} / {freeLimits.messagesPerMonth}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('subscription.imports', 'Imports')}</div>
                  <div className="font-semibold">{usage.totalImports} / {freeLimits.totalImports}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">{t('subscription.visualizations', 'Visualizations')}</div>
                  <div className="font-semibold">{usage.totalVisualizations} / {freeLimits.totalVisualizations}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Free Plan */}
          <div className={`relative rounded-lg border overflow-hidden flex gap-0 ${subscription.tier === 'free' ? 'border-primary ring-2 ring-primary/20' : 'border-border/50'}`}>
            <div className={`dock-rail ${subscription.tier === 'free' ? 'w-1.5' : ''} bg-gray-400`} />
            <div className="flex-1 p-5">
            {subscription.tier === 'free' && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                {t('subscription.currentPlan', 'Current Plan')}
              </Badge>
            )}
            <div className="mb-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5" />
                {t('subscription.free', 'Free')}
              </h3>
              <p className="text-sm text-muted-foreground">{t('subscription.freeDescription', 'Get started with basic features')}</p>
              <div className="pt-2">
                <span className="text-3xl font-bold">$0</span>
                <span className="text-muted-foreground">/{t('subscription.forever', 'forever')}</span>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{freeLimits.connections} {t('subscription.databaseConnection', 'database connection')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{freeLimits.messagesPerMonth} {t('subscription.messagesPerMonth', 'messages per month')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{freeLimits.totalImports} {t('subscription.totalImports', 'total imports')}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Check className="h-4 w-4" />
                <span>{freeLimits.totalVisualizations} {t('subscription.visualizationsIncluded', 'visualizations included')}</span>
              </div>
            </div>
            <div className="pt-4">
              <Button variant="outline" className="w-full" disabled size="sm">
                {subscription.tier === 'free' 
                  ? t('subscription.yourCurrentPlan', 'Your Current Plan') 
                  : t('subscription.freePlan', 'Free Plan')}
              </Button>
            </div>
          </div>
          </div>

          {/* Pro Plan */}
          <div className={`relative rounded-lg border overflow-hidden flex gap-0 ${subscription.tier === 'pro' ? 'border-primary ring-2 ring-primary/20' : 'border-primary/50'}`}>
            <div className={`dock-rail ${subscription.tier === 'pro' ? 'w-1.5' : ''} bg-primary`} />
            <div className="flex-1 p-5">
            {subscription.tier === 'pro' && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                {t('subscription.currentPlan', 'Current Plan')}
              </Badge>
            )}
            {subscription.tier === 'free' && (
              <Badge variant="secondary" className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-primary/80">
                {t('subscription.recommended', 'Recommended')}
              </Badge>
            )}
            <div className="mb-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Crown className="h-5 w-5 text-primary" />
                {t('subscription.pro', 'Pro')}
              </h3>
              <p className="text-sm text-muted-foreground">{t('subscription.proDescription', 'For power users and small teams')}</p>
              <div className="pt-2">
                <span className="text-3xl font-bold">
                  ${billingCycle === 'monthly' ? SUBSCRIPTION_TIERS.pro.monthly.price : SUBSCRIPTION_TIERS.pro.annual.price}
                </span>
                <span className="text-muted-foreground">
                  /{billingCycle === 'monthly' ? t('subscription.month', 'month') : t('subscription.year', 'year')}
                </span>
                {billingCycle === 'annual' && (
                  <div className="text-sm text-primary mt-1">
                    {t('subscription.annualSavingsPro', 'Save $60/year')}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedConnections', 'Unlimited database connections')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{proLimits.messagesPerMonth} {t('subscription.messagesPerMonth', 'messages per month')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedImports', 'Unlimited data imports')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedVisualizations', 'Unlimited visualizations')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.prioritySupport', 'Priority support')}</span>
              </div>
            </div>
            <div className="pt-4">
              {subscription.tier === 'pro' ? (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleManageSubscription}
                  disabled={loadingPortal}
                  size="sm"
                >
                  {loadingPortal 
                    ? t('subscription.loading', 'Loading...') 
                    : t('subscription.manageSubscription', 'Manage Subscription')}
                </Button>
              ) : (
                <Button 
                  className="w-full" 
                  onClick={() => handleCheckout(
                    billingCycle === 'monthly' 
                      ? SUBSCRIPTION_TIERS.pro.monthly.priceId 
                      : SUBSCRIPTION_TIERS.pro.annual.priceId
                  )}
                  disabled={loadingCheckout !== null || subscription.tier === 'business'}
                  size="sm"
                >
                  {loadingCheckout 
                    ? t('subscription.loading', 'Loading...') 
                    : subscription.tier === 'business'
                      ? t('subscription.currentlyOnBusiness', 'On Business Plan')
                      : t('subscription.upgradeToPro', 'Upgrade to Pro')}
                </Button>
              )}
            </div>
          </div>
          </div>

          {/* Business Plan */}
          <div className={`relative rounded-lg border overflow-hidden flex gap-0 ${subscription.tier === 'business' ? 'border-primary ring-2 ring-primary/20' : 'border-border/50'}`}>
            <div className={`dock-rail ${subscription.tier === 'business' ? 'w-1.5' : ''} bg-accent`} />
            <div className="flex-1 p-5">
            {subscription.tier === 'business' && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                {t('subscription.currentPlan', 'Current Plan')}
              </Badge>
            )}
            <div className="mb-3">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <Rocket className="h-5 w-5 text-primary" />
                {t('subscription.business', 'Business')}
              </h3>
              <p className="text-sm text-muted-foreground">{t('subscription.businessDescription', 'Unlimited everything for professionals')}</p>
              <div className="pt-2">
                <span className="text-3xl font-bold">
                  ${billingCycle === 'monthly' ? SUBSCRIPTION_TIERS.business.monthly.price : SUBSCRIPTION_TIERS.business.annual.price}
                </span>
                <span className="text-muted-foreground">
                  /{billingCycle === 'monthly' ? t('subscription.month', 'month') : t('subscription.year', 'year')}
                </span>
                {billingCycle === 'annual' && (
                  <div className="text-sm text-primary mt-1">
                    {t('subscription.annualSavingsBusiness', 'Save $180/year')}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedConnections', 'Unlimited database connections')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedMessages', 'Unlimited messages')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedImports', 'Unlimited data imports')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.unlimitedVisualizations', 'Unlimited visualizations')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.prioritySupport', 'Priority support')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                <span>{t('subscription.dedicatedSupport', 'Dedicated support')}</span>
              </div>
            </div>
            <div className="pt-4">
              {subscription.tier === 'business' ? (
                <Button 
                  variant="outline" 
                  className="w-full" 
                  onClick={handleManageSubscription}
                  disabled={loadingPortal}
                  size="sm"
                >
                  {loadingPortal 
                    ? t('subscription.loading', 'Loading...') 
                    : t('subscription.manageSubscription', 'Manage Subscription')}
                </Button>
              ) : (
                <Button 
                  className="w-full" 
                  onClick={() => handleCheckout(
                    billingCycle === 'monthly' 
                      ? SUBSCRIPTION_TIERS.business.monthly.priceId 
                      : SUBSCRIPTION_TIERS.business.annual.priceId
                  )}
                  disabled={loadingCheckout !== null}
                  size="sm"
                >
                  {loadingCheckout 
                    ? t('subscription.loading', 'Loading...') 
                    : t('subscription.upgradeToBusiness', 'Upgrade to Business')}
                </Button>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Subscription Status */}
        {(subscription.tier === 'pro' || subscription.tier === 'business') && subscription.subscriptionEnd && (
          <div className="mt-4 rounded-lg border border-border/50 p-5">
            <div className="mb-3">
              <h3 className="text-base font-semibold">{t('subscription.subscriptionDetails', 'Subscription Details')}</h3>
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('subscription.plan', 'Plan')}</span>
                <span className="font-medium">
                  {isProMonthly ? t('subscription.proMonthly', 'Pro Monthly') : 
                   isProAnnual ? t('subscription.proAnnual', 'Pro Annual') :
                   isBusinessMonthly ? t('subscription.businessMonthly', 'Business Monthly') :
                   isBusinessAnnual ? t('subscription.businessAnnual', 'Business Annual') : 
                   t('subscription.unknown', 'Unknown')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('subscription.renewsOn', 'Renews on')}</span>
                <span className="font-medium">
                  {new Date(subscription.subscriptionEnd).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SubscriptionDialog;
