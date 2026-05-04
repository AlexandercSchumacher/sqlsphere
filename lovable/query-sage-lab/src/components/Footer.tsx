import { Link } from "react-router-dom";
import { useTranslation } from 'react-i18next';

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border/50 bg-muted/20 mt-auto">
      <div className="container mx-auto px-4 py-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 font-mono text-xs text-muted-foreground">
          <span className="text-foreground/70">&gt; SQLSphere v1.0</span>
          <nav className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
            <Link to="/about" className="hover:text-primary transition-colors">{t('footer.aboutUs')}</Link>
            <span className="text-border">|</span>
            <Link to="/docs" className="hover:text-primary transition-colors">{t('footer.documentation')}</Link>
            <span className="text-border">|</span>
            <Link to="/privacy" className="hover:text-primary transition-colors">{t('footer.privacyPolicy')}</Link>
            <span className="text-border">|</span>
            <Link to="/terms" className="hover:text-primary transition-colors">{t('footer.termsOfService')}</Link>
            <span className="text-border">|</span>
            <Link to="/download" className="hover:text-primary transition-colors">Local Agent (Coming Soon)</Link>
            <span className="text-border">|</span>
            <a href="mailto:contact@sqlsphere.com" className="hover:text-primary transition-colors">{t('footer.contact')}</a>
          </nav>
          <span>&copy; {new Date().getFullYear()} SQLSphere</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
