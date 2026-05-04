import Layout from "@/components/Layout";
import { useTranslation } from 'react-i18next';

const PrivacyPolicy = () => {
  const { t } = useTranslation();

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 max-w-4xl">
        <h1 className="text-4xl font-bold text-foreground mb-2">{t('privacyPolicy.title')}</h1>
        <p className="text-muted-foreground mb-8">{t('privacyPolicy.lastUpdated')}: December 2024</p>
        
        <div className="space-y-8 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.introduction.title')}</h2>
            <p>{t('privacyPolicy.sections.introduction.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.dataCollected.title')}</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-4 mb-2">{t('privacyPolicy.sections.dataCollected.accountInfo.title')}</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('privacyPolicy.sections.dataCollected.accountInfo.items.email')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.accountInfo.items.name')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.accountInfo.items.password')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.accountInfo.items.oauth')}</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4 mb-2">{t('privacyPolicy.sections.dataCollected.connectionData.title')}</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('privacyPolicy.sections.dataCollected.connectionData.items.credentials')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.connectionData.items.metadata')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.connectionData.items.ssh')}</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4 mb-2">{t('privacyPolicy.sections.dataCollected.usageData.title')}</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('privacyPolicy.sections.dataCollected.usageData.items.chatHistory')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.usageData.items.queries')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.usageData.items.imports')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.usageData.items.visualizations')}</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-4 mb-2">{t('privacyPolicy.sections.dataCollected.technicalData.title')}</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>{t('privacyPolicy.sections.dataCollected.technicalData.items.ip')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.technicalData.items.browser')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.technicalData.items.device')}</li>
              <li>{t('privacyPolicy.sections.dataCollected.technicalData.items.logs')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.howWeUse.title')}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('privacyPolicy.sections.howWeUse.items.service')}</li>
              <li>{t('privacyPolicy.sections.howWeUse.items.connections')}</li>
              <li>{t('privacyPolicy.sections.howWeUse.items.queries')}</li>
              <li>{t('privacyPolicy.sections.howWeUse.items.improve')}</li>
              <li>{t('privacyPolicy.sections.howWeUse.items.communicate')}</li>
              <li>{t('privacyPolicy.sections.howWeUse.items.security')}</li>
              <li>{t('privacyPolicy.sections.howWeUse.items.legal')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.dataSecurity.title')}</h2>
            <p className="mb-4">{t('privacyPolicy.sections.dataSecurity.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('privacyPolicy.sections.dataSecurity.items.encryption')}</li>
              <li>{t('privacyPolicy.sections.dataSecurity.items.transit')}</li>
              <li>{t('privacyPolicy.sections.dataSecurity.items.serverSide')}</li>
              <li>{t('privacyPolicy.sections.dataSecurity.items.sessions')}</li>
              <li>{t('privacyPolicy.sections.dataSecurity.items.rls')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.dataSharing.title')}</h2>
            <p className="mb-4">{t('privacyPolicy.sections.dataSharing.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">{t('privacyPolicy.sections.dataSharing.providers.title')}:</strong> {t('privacyPolicy.sections.dataSharing.providers.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.dataSharing.payment.title')}:</strong> {t('privacyPolicy.sections.dataSharing.payment.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.dataSharing.legal.title')}:</strong> {t('privacyPolicy.sections.dataSharing.legal.content')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.dataRetention.title')}</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>{t('privacyPolicy.sections.dataRetention.items.account')}</li>
              <li>{t('privacyPolicy.sections.dataRetention.items.chat')}</li>
              <li>{t('privacyPolicy.sections.dataRetention.items.logs')}</li>
              <li>{t('privacyPolicy.sections.dataRetention.items.deletion')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.yourRights.title')}</h2>
            <p className="mb-4">{t('privacyPolicy.sections.yourRights.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">{t('privacyPolicy.sections.yourRights.rights.access.title')}:</strong> {t('privacyPolicy.sections.yourRights.rights.access.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.yourRights.rights.rectification.title')}:</strong> {t('privacyPolicy.sections.yourRights.rights.rectification.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.yourRights.rights.erasure.title')}:</strong> {t('privacyPolicy.sections.yourRights.rights.erasure.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.yourRights.rights.portability.title')}:</strong> {t('privacyPolicy.sections.yourRights.rights.portability.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.yourRights.rights.withdraw.title')}:</strong> {t('privacyPolicy.sections.yourRights.rights.withdraw.content')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.cookies.title')}</h2>
            <p className="mb-4">{t('privacyPolicy.sections.cookies.intro')}</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong className="text-foreground">{t('privacyPolicy.sections.cookies.types.essential.title')}:</strong> {t('privacyPolicy.sections.cookies.types.essential.content')}</li>
              <li><strong className="text-foreground">{t('privacyPolicy.sections.cookies.types.preferences.title')}:</strong> {t('privacyPolicy.sections.cookies.types.preferences.content')}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.international.title')}</h2>
            <p>{t('privacyPolicy.sections.international.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.children.title')}</h2>
            <p>{t('privacyPolicy.sections.children.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.changes.title')}</h2>
            <p>{t('privacyPolicy.sections.changes.content')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('privacyPolicy.sections.contact.title')}</h2>
            <p className="mb-4">{t('privacyPolicy.sections.contact.content')}</p>
            <div className="space-y-2">
              <p><strong className="text-foreground">Email:</strong> privacy@sqlsphere.com</p>
              <p><strong className="text-foreground">{t('privacyPolicy.sections.contact.dpo')}:</strong> dpo@sqlsphere.com</p>
            </div>
          </section>
        </div>
      </div>
    </Layout>
  );
};

export default PrivacyPolicy;
