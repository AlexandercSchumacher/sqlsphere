import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useTranslation } from 'react-i18next';

const NotFound = () => {
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center animate-fade-up">
        <div className="text-8xl font-bold text-primary/15 mb-2 select-none">404</div>
        <h1 className="mb-3 text-2xl font-bold text-foreground">{t('notFound.title')}</h1>
        <p className="mb-6 text-muted-foreground">{t('notFound.description')}</p>
        <a href="/" className="text-primary hover:text-primary/80 transition-colors font-medium">
          {t('notFound.returnHome')}
        </a>
      </div>
    </div>
  );
};

export default NotFound;
