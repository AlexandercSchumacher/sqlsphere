import Layout from "@/components/Layout";
import { useTranslation } from 'react-i18next';

const TermsOfService = () => {
  const { t } = useTranslation();

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 max-w-4xl">
        <h1 className="text-4xl font-bold text-foreground mb-2">{t('termsOfService.title')}</h1>
        <p className="text-muted-foreground mb-8">{t('termsOfService.lastUpdated')}: December 2024</p>
        
        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.introduction.title')}</h2>
            <p className="mb-4">
              {t('termsOfService.sections.introduction.content')}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.acceptance.title')}</h2>
            <p className="mb-4">
              {t('termsOfService.sections.acceptance.content')}
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.serviceDescription.title')}</h2>
            <p className="mb-4">{t('termsOfService.sections.serviceDescription.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('termsOfService.sections.serviceDescription.features.connections')}</li>
              <li>{t('termsOfService.sections.serviceDescription.features.chat')}</li>
              <li>{t('termsOfService.sections.serviceDescription.features.visualization')}</li>
              <li>{t('termsOfService.sections.serviceDescription.features.import')}</li>
              <li>{t('termsOfService.sections.serviceDescription.features.export')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.userAccounts.title')}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('termsOfService.sections.userAccounts.items.registration')}</li>
              <li>{t('termsOfService.sections.userAccounts.items.security')}</li>
              <li>{t('termsOfService.sections.userAccounts.items.notification')}</li>
              <li>{t('termsOfService.sections.userAccounts.items.responsibility')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.subscriptions.title')}</h2>
            <p className="mb-4">{t('termsOfService.sections.subscriptions.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">{t('termsOfService.sections.subscriptions.tiers.free.name')}:</strong> {t('termsOfService.sections.subscriptions.tiers.free.description')}</li>
              <li><strong className="text-foreground">{t('termsOfService.sections.subscriptions.tiers.pro.name')}:</strong> {t('termsOfService.sections.subscriptions.tiers.pro.description')}</li>
            </ul>
            <p className="mt-4">{t('termsOfService.sections.subscriptions.billing')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.acceptableUse.title')}</h2>
            <p className="mb-4">{t('termsOfService.sections.acceptableUse.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('termsOfService.sections.acceptableUse.prohibited.illegal')}</li>
              <li>{t('termsOfService.sections.acceptableUse.prohibited.unauthorized')}</li>
              <li>{t('termsOfService.sections.acceptableUse.prohibited.interfere')}</li>
              <li>{t('termsOfService.sections.acceptableUse.prohibited.reverseEngineer')}</li>
              <li>{t('termsOfService.sections.acceptableUse.prohibited.resell')}</li>
              <li>{t('termsOfService.sections.acceptableUse.prohibited.malicious')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.dataHandling.title')}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('termsOfService.sections.dataHandling.items.ownership')}</li>
              <li>{t('termsOfService.sections.dataHandling.items.credentials')}</li>
              <li>{t('termsOfService.sections.dataHandling.items.queries')}</li>
              <li>{t('termsOfService.sections.dataHandling.items.responsibility')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.intellectualProperty.title')}</h2>
            <p>{t('termsOfService.sections.intellectualProperty.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.disclaimer.title')}</h2>
            <p className="mb-4">{t('termsOfService.sections.disclaimer.content')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('termsOfService.sections.disclaimer.items.aiAccuracy')}</li>
              <li>{t('termsOfService.sections.disclaimer.items.databaseChanges')}</li>
              <li>{t('termsOfService.sections.disclaimer.items.availability')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.limitation.title')}</h2>
            <p>{t('termsOfService.sections.limitation.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.indemnification.title')}</h2>
            <p>{t('termsOfService.sections.indemnification.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.termination.title')}</h2>
            <p>{t('termsOfService.sections.termination.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.changes.title')}</h2>
            <p>{t('termsOfService.sections.changes.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.governingLaw.title')}</h2>
            <p>{t('termsOfService.sections.governingLaw.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('termsOfService.sections.contact.title')}</h2>
            <p>{t('termsOfService.sections.contact.content')}</p>
            <p className="mt-2">
              <strong className="text-foreground">Email:</strong> legal@sqlsphere.com
            </p>
          </section>
        </div>
      </div>
    </Layout>
  );
};

export default TermsOfService;
