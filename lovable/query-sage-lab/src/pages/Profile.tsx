import { useState, useEffect } from 'react';
import { Moon, Sun, Languages, Crown, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { useSubscription, SUBSCRIPTION_TIERS } from '@/hooks/useSubscription';
import { useUserSettings } from '@/hooks/useUserSettings';

import Layout from '@/components/Layout';
import { useToast } from '@/hooks/use-toast';
import { SubscriptionDialog } from '@/components/SubscriptionDialog';

const Profile = () => {
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const { settings, saveSettings } = useUserSettings();
  
  const [darkMode, setDarkMode] = useState(settings.darkMode);
  const [selectedLanguage, setSelectedLanguage] = useState(settings.language);
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);
  const { subscription } = useSubscription();
  
  // Track initial values to detect changes
  const [initialDarkMode, setInitialDarkMode] = useState(settings.darkMode);
  const [initialLanguage, setInitialLanguage] = useState(settings.language);
  const [isSaving, setIsSaving] = useState(false);
  
  // Sync with global settings when they change
  useEffect(() => {
    setDarkMode(settings.darkMode);
    setSelectedLanguage(settings.language);
    setInitialDarkMode(settings.darkMode);
    setInitialLanguage(settings.language);
  }, [settings]);
  
  const hasChanges = darkMode !== initialDarkMode || selectedLanguage !== initialLanguage;

  const handleToggleDarkMode = (checked: boolean) => {
    setDarkMode(checked);
    // Apply immediately for preview
    document.documentElement.classList.toggle('dark', checked);
    localStorage.setItem('darkMode', String(checked));
    window.dispatchEvent(new CustomEvent('themeChange', { detail: { dark: checked } }));
  };

  const handleLanguageChange = (language: string) => {
    setSelectedLanguage(language);
    // Apply immediately for preview
    i18n.changeLanguage(language);
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await saveSettings({ darkMode, language: selectedLanguage });

      // Update initial values after successful save
      setInitialDarkMode(darkMode);
      setInitialLanguage(selectedLanguage);

      toast({
        title: t('settings.saved', 'Settings saved'),
        description: t('settings.savedDescription', 'Your appearance settings have been saved'),
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: t('common.error', 'Error'),
        description: t('settings.saveError', 'Failed to save settings'),
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const currentPriceId = subscription.priceId;
  const isMonthlyActive = currentPriceId === SUBSCRIPTION_TIERS.pro.monthly.priceId;

  const nativeLanguageNames: { [key: string]: string } = {
    'en': 'English',
    'de': 'Deutsch',
    'es': 'Español',
    'it': 'Italiano',
    'fr': 'Français',
    'pt': 'Português',
    'nl': 'Nederlands',
    'ja': '日本語',
    'zh': '中文'
  };

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('profile.title', 'Profile')}</h1>
          <p className="text-muted-foreground">
            {t('profile.description', 'Manage your account settings and subscription')}
          </p>
        </div>

        <div className="grid gap-6">
          {/* Subscription */}
          <section className="flex gap-0 pb-6 border-b border-border/50">
            <div className="dock-rail bg-primary" />
            <div className="flex-1 pl-3">
            <div className="mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Crown className="h-5 w-5" />
                {t('profile.subscription', 'Subscription')}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t('profile.subscriptionDescription', 'Manage your subscription plan')}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{t('profile.currentPlan', 'Current Plan')}:</span>
                  <Badge variant={subscription.tier === 'pro' ? 'default' : 'secondary'}>
                    {subscription.tier === 'pro'
                      ? (isMonthlyActive ? t('subscription.proMonthly', 'Pro Monthly') : t('subscription.proAnnual', 'Pro Annual'))
                      : t('subscription.free', 'Free')}
                  </Badge>
                </div>
                {subscription.tier === 'pro' && subscription.subscriptionEnd && (
                  <p className="text-sm text-muted-foreground">
                    {t('subscription.renewsOn', 'Renews on')} {new Date(subscription.subscriptionEnd).toLocaleDateString()}
                  </p>
                )}
              </div>
              <Button onClick={() => setSubscriptionDialogOpen(true)}>
                {subscription.tier === 'pro'
                  ? t('profile.managePlan', 'Manage Plan')
                  : t('profile.upgradePlan', 'Upgrade Plan')}
              </Button>
            </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="flex gap-0 py-6 border-b border-border/50">
            <div className="dock-rail bg-accent" />
            <div className="flex-1 pl-3">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{t('settings.appearance')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.appearanceDescription')}
              </p>
            </div>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {darkMode ? (
                    <Moon className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <Sun className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div>
                    <p className="font-medium">{t('settings.darkMode')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.darkModeDescription')}
                    </p>
                  </div>
                </div>
                <Switch checked={darkMode} onCheckedChange={handleToggleDarkMode} />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Languages className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{t('settings.language')}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('settings.languageDescription')}
                    </p>
                  </div>
                </div>
                <Select value={selectedLanguage} onValueChange={handleLanguageChange}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(nativeLanguageNames).map(([code, name]) => (
                      <SelectItem key={code} value={code}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end pt-4 border-t border-border/30">
                <Button
                  onClick={handleSaveSettings}
                  disabled={!hasChanges || isSaving}
                  className="gap-2"
                >
                  <Save className="h-4 w-4" />
                  {isSaving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
                </Button>
              </div>
            </div>
          </div>
          </section>

          {/* Danger Zone */}
          <section className="flex gap-0 pt-6">
            <div className="dock-rail bg-destructive" />
            <div className="flex-1 pl-3">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-destructive">{t('settings.dangerZone')}</h2>
              <p className="text-sm text-muted-foreground">
                {t('settings.dangerZoneDescription')}
              </p>
            </div>
            <Button variant="destructive">
              {t('settings.deleteAccount')}
            </Button>
            </div>
          </section>
        </div>
      </div>

      <SubscriptionDialog 
        open={subscriptionDialogOpen} 
        onOpenChange={setSubscriptionDialogOpen} 
      />
    </Layout>
  );
};

export default Profile;
