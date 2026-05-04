import Layout from "@/components/Layout";
import { useTranslation } from 'react-i18next';
import { Database, MessageSquare, BarChart3, Upload, Shield, Zap } from "lucide-react";
import ContactForm from "@/components/ContactForm";

const About = () => {
  const { t } = useTranslation();

  const features = [
    {
      icon: Database,
      titleKey: 'about.features.connections.title',
      descriptionKey: 'about.features.connections.description'
    },
    {
      icon: MessageSquare,
      titleKey: 'about.features.chat.title',
      descriptionKey: 'about.features.chat.description'
    },
    {
      icon: BarChart3,
      titleKey: 'about.features.visualization.title',
      descriptionKey: 'about.features.visualization.description'
    },
    {
      icon: Upload,
      titleKey: 'about.features.import.title',
      descriptionKey: 'about.features.import.description'
    },
    {
      icon: Shield,
      titleKey: 'about.features.security.title',
      descriptionKey: 'about.features.security.description'
    },
    {
      icon: Zap,
      titleKey: 'about.features.performance.title',
      descriptionKey: 'about.features.performance.description'
    }
  ];

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 max-w-4xl">
        <h1 className="text-4xl font-bold font-mono text-foreground mb-6">{t('about.title')}</h1>

        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('about.sections.whatIs.title')}</h2>
            <p className="mb-4">{t('about.sections.whatIs.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('about.sections.mission.title')}</h2>
            <p>{t('about.sections.mission.content')}</p>
          </section>

          <section className="relative">
            <div className="absolute inset-0 grid-pattern pointer-events-none rounded-lg -m-4 p-4" />
            <div className="relative">
              <h2 className="text-2xl font-semibold text-foreground mb-6">{t('about.sections.features.title')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-8">
                {features.map((feature, index) => (
                  <div key={index} className="flex items-start gap-0 group">
                    <div className="dock-rail bg-primary opacity-40 group-hover:opacity-100 transition-opacity mt-1" />
                    <div className="flex items-start gap-4 pl-3">
                      <div className="p-2 rounded-lg bg-primary/8 group-hover:bg-primary/15 transition-colors">
                        <feature.icon className="h-6 w-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground mb-1">{t(feature.titleKey)}</h3>
                        <p className="text-sm">{t(feature.descriptionKey)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('about.sections.supportedDatabases.title')}</h2>
            <p className="mb-4">{t('about.sections.supportedDatabases.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">PostgreSQL</strong> - {t('about.sections.supportedDatabases.postgresql')}</li>
              <li><strong className="text-foreground">MySQL</strong> - {t('about.sections.supportedDatabases.mysql')}</li>
              <li><strong className="text-foreground">SQL Server</strong> - {t('about.sections.supportedDatabases.sqlserver')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('about.sections.howItWorks.title')}</h2>
            <ol className="list-decimal pl-6 space-y-3">
              <li>
                <strong className="text-foreground">{t('about.sections.howItWorks.steps.connect.title')}</strong>
                <p className="text-sm mt-1">{t('about.sections.howItWorks.steps.connect.description')}</p>
              </li>
              <li>
                <strong className="text-foreground">{t('about.sections.howItWorks.steps.ask.title')}</strong>
                <p className="text-sm mt-1">{t('about.sections.howItWorks.steps.ask.description')}</p>
              </li>
              <li>
                <strong className="text-foreground">{t('about.sections.howItWorks.steps.visualize.title')}</strong>
                <p className="text-sm mt-1">{t('about.sections.howItWorks.steps.visualize.description')}</p>
              </li>
              <li>
                <strong className="text-foreground">{t('about.sections.howItWorks.steps.manage.title')}</strong>
                <p className="text-sm mt-1">{t('about.sections.howItWorks.steps.manage.description')}</p>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('about.sections.security.title')}</h2>
            <p className="mb-4">{t('about.sections.security.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('about.sections.security.items.encryption')}</li>
              <li>{t('about.sections.security.items.serverSide')}</li>
              <li>{t('about.sections.security.items.noStorage')}</li>
              <li>{t('about.sections.security.items.sessionTimeout')}</li>
              <li>{t('about.sections.security.items.confirmation')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-6">{t('about.sections.contact.title')}</h2>
            <ContactForm />
          </section>
        </div>
      </div>
    </Layout>
  );
};

export default About;
