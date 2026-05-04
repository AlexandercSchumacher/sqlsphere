import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Database,
  MessageSquare,
  BarChart3,
  User,
  Menu,
  LogOut,
  Upload,
  BookOpen,
  History,
  Clock,
  LayoutDashboard,
  Bell as BellIcon,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { Button } from '@/components/ui/button';
import { AuthDialog } from './AuthDialog';
import { useAuth } from '@/hooks/useAuth';
import { useConnection } from '@/hooks/useConnection';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import Footer from './Footer';
import { useTranslation } from 'react-i18next';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: React.ReactNode;
}

const APP_ROUTE_PREFIXES = [
  '/connections',
  '/chat',
  '/visualization',
  '/import',
  '/history',
  '/schedules',
  '/dashboards',
  '/alerts',
  '/docs',
  '/profile',
  '/subscription',
];

const Layout = ({ children }: LayoutProps) => {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const { user } = useAuth();
  const { connectionStatus } = useConnection();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleLogout = async () => {
    if (user) {
      await supabase
        .from('connections')
        .update({ status: 'disconnected' })
        .eq('user_id', user.id);
    }

    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('db_session_id_') || key.startsWith('db_params_') || key.startsWith('sqlsphere_')) {
        localStorage.removeItem(key);
      }
    });
    Object.keys(sessionStorage).forEach((key) => {
      if (key.startsWith('sqlsphere_')) {
        sessionStorage.removeItem(key);
      }
    });

    await supabase.auth.signOut();
    setMenuOpen(false);
    toast({
      title: t('layout.loggedOut'),
      description: t('layout.loggedOutDesc'),
    });
  };

  const navigation = [
    { name: 'navigation.connections', href: '/connections', icon: Database },
    { name: 'navigation.aiChat', href: '/chat', icon: MessageSquare },
    { name: 'navigation.visualization', href: '/visualization', icon: BarChart3 },
    { name: 'navigation.dataImport', href: '/import', icon: Upload },
    { name: 'navigation.history', href: '/history', icon: History },
    { name: 'navigation.schedules', href: '/schedules', icon: Clock },
    { name: 'navigation.dashboards', href: '/dashboards', icon: LayoutDashboard },
    { name: 'navigation.alerts', href: '/alerts', icon: BellIcon },
    { name: 'navigation.docs', href: '/docs', icon: BookOpen },
    { name: 'navigation.profile', href: '/profile', icon: User },
  ];

  const isActive = (path: string) => {
    if (path === '/profile' && location.pathname === '/subscription') {
      return true;
    }
    return location.pathname === path || (path !== '/' && location.pathname.startsWith(`${path}/`));
  };

  const isAppRoute = APP_ROUTE_PREFIXES.some((prefix) =>
    location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
  );

  const renderMobileMenu = () => (
    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="bg-card/80 backdrop-blur-lg border-border/50 shadow-soft">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Database className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <span className="font-semibold font-mono">SQLSphere</span>
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 mt-6">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setMenuOpen(false)}
              >
                <Button
                  variant={isActive(item.href) ? 'secondary' : 'ghost'}
                  className={cn(
                    'w-full justify-start gap-3',
                    isActive(item.href) && 'bg-primary/10 text-primary font-medium',
                  )}
                >
                  <Icon className="h-[18px] w-[18px]" />
                  {t(item.name)}
                </Button>
              </Link>
            );
          })}
          <div className="border-t border-border/50 my-2" />
          {user ? (
            <Button variant="outline" onClick={handleLogout} className="w-full justify-start gap-3">
              <LogOut className="h-[18px] w-[18px]" />
              {t('navigation.logout')}
            </Button>
          ) : (
            <Button onClick={() => { setAuthDialogOpen(true); setMenuOpen(false); }} className="w-full">
              {t('navigation.loginSignup')}
            </Button>
          )}
        </nav>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {isAppRoute ? (
        <>
          {/* Mobile Header (app routes) */}
          <header className="md:hidden sticky top-0 z-40 h-[48px] border-b border-border/50 bg-background/80 backdrop-blur-xl px-3 flex items-center justify-between">
            <Link to="/chat" className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-muted/60 transition-colors">
              <div className="relative">
                <Database className="h-5 w-5 text-foreground" />
                {user && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-background ${
                      connectionStatus === 'connected' ? 'bg-emerald-500' :
                      connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                      connectionStatus === 'error' ? 'bg-red-500' :
                      'bg-gray-400'
                    }`}
                    title={connectionStatus}
                  />
                )}
              </div>
              <span className="font-semibold font-mono text-foreground">SQLSphere</span>
            </Link>
            <div className="flex items-center gap-2">
              {user && <NotificationBell />}
              {renderMobileMenu()}
            </div>
          </header>

          {/* Desktop Icon Rail (app routes) */}
          <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-16 border-r border-border/50 bg-sidebar flex-col items-center py-3">
            <Link to="/chat" className="mb-5 p-2 rounded-xl hover:bg-muted/60 transition-colors">
              <div className="relative">
                <Database className="h-5 w-5 text-foreground" />
                {user && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-background ${
                      connectionStatus === 'connected' ? 'bg-emerald-500' :
                      connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                      connectionStatus === 'error' ? 'bg-red-500' :
                      'bg-gray-400'
                    }`}
                    title={connectionStatus}
                  />
                )}
              </div>
            </Link>

            <nav className="flex-1 w-full flex flex-col items-center gap-1.5">
              {navigation.map((item) => {
                const Icon = item.icon;
                return (
                  <Tooltip key={item.name}>
                    <TooltipTrigger asChild>
                      <Link to={item.href}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-10 w-10 rounded-lg text-muted-foreground hover:text-foreground transition-all duration-200 relative',
                            isActive(item.href) && 'text-primary hover:text-primary',
                          )}
                        >
                          <Icon className="h-[18px] w-[18px]" />
                          {isActive(item.href) && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[13px] w-[2px] h-5 bg-primary rounded-r" />
                          )}
                        </Button>
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="font-medium">{t(item.name)}</TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>

            <div className="w-full flex flex-col items-center gap-1.5 pt-2 border-t border-border/50">
              {user && <NotificationBell />}
              {user ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground" onClick={handleLogout}>
                      <LogOut className="h-[18px] w-[18px]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">{t('navigation.logout')}</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground" onClick={() => setAuthDialogOpen(true)}>
                      <User className="h-[18px] w-[18px]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">{t('navigation.loginSignup')}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </aside>
        </>
      ) : (
        <header className="fixed top-0 right-0 z-50 h-[41px] flex items-center px-4">
          <div className="flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-muted/60 transition-colors">
              <div className="relative">
                <Database className="h-5 w-5 text-foreground" />
                {user && (
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-background ${
                      connectionStatus === 'connected' ? 'bg-emerald-500' :
                      connectionStatus === 'connecting' ? 'bg-amber-500 animate-pulse' :
                      connectionStatus === 'error' ? 'bg-red-500' :
                      'bg-gray-400'
                    }`}
                    title={connectionStatus}
                  />
                )}
              </div>
              <span className="font-semibold font-mono text-foreground hidden sm:inline">SQLSphere</span>
            </Link>

            {user && <NotificationBell />}
            {renderMobileMenu()}
          </div>
        </header>
      )}

      <main className={cn('flex-1', isAppRoute && 'md:pl-16')}>
        {children}
      </main>

      {/* Footer - Hide in Electron Desktop IDE */}
      {typeof window === 'undefined' || !window.electronAPI ? <Footer /> : null}

      {/* Auth Dialog */}
      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
    </div>
  );
};

export default Layout;
