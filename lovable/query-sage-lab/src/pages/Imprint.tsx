import Layout from "@/components/Layout";
import { useTranslation } from 'react-i18next';

const Imprint = () => {
  const { t } = useTranslation();

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 max-w-4xl">
        <h1 className="text-4xl font-bold text-foreground mb-6">{t('imprint.title')}</h1>
        
        <div className="space-y-6 text-muted-foreground">
          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.companyInfo.title')}</h2>
            <div className="space-y-2">
              <p><strong className="text-foreground">{t('imprint.sections.companyInfo.fields.companyName')}:</strong> [Your Company Name]</p>
              <p><strong className="text-foreground">{t('imprint.sections.companyInfo.fields.legalForm')}:</strong> [GmbH / UG / Ltd / Inc.]</p>
              <p><strong className="text-foreground">{t('imprint.sections.companyInfo.fields.address')}:</strong></p>
              <p className="pl-4">
                [Street Address]<br />
                [Postal Code] [City]<br />
                [Country]
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.contact.title')}</h2>
            <div className="space-y-2">
              <p><strong className="text-foreground">{t('imprint.sections.contact.fields.phone')}:</strong> [+XX XXX XXXXXXXX]</p>
              <p><strong className="text-foreground">{t('imprint.sections.contact.fields.email')}:</strong> contact@sqlsphere.com</p>
              <p><strong className="text-foreground">{t('imprint.sections.contact.fields.website')}:</strong> www.sqlsphere.com</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.representatives.title')}</h2>
            <div className="space-y-2">
              <p><strong className="text-foreground">{t('imprint.sections.representatives.fields.managingDirector')}:</strong> [Name]</p>
              <p><strong className="text-foreground">{t('imprint.sections.representatives.fields.authorizedRep')}:</strong> [Name(s)]</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.registration.title')}</h2>
            <div className="space-y-2">
              <p><strong className="text-foreground">{t('imprint.sections.registration.fields.registerCourt')}:</strong> [Court Name]</p>
              <p><strong className="text-foreground">{t('imprint.sections.registration.fields.registerNumber')}:</strong> [HRB XXXXXX]</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.taxInfo.title')}</h2>
            <div className="space-y-2">
              <p><strong className="text-foreground">{t('imprint.sections.taxInfo.fields.vatId')}:</strong> [DE XXXXXXXXX]</p>
              <p><strong className="text-foreground">{t('imprint.sections.taxInfo.fields.taxNumber')}:</strong> [XX/XXX/XXXXX]</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.responsibleContent.title')}</h2>
            <p className="mb-2">{t('imprint.sections.responsibleContent.description')}</p>
            <div className="space-y-2">
              <p><strong className="text-foreground">{t('imprint.sections.responsibleContent.fields.name')}:</strong> [Name]</p>
              <p><strong className="text-foreground">{t('imprint.sections.responsibleContent.fields.address')}:</strong> [Same as company address or different]</p>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.disputeResolution.title')}</h2>
            <p className="mb-4">{t('imprint.sections.disputeResolution.euPlatform')}</p>
            <p className="mb-2">
              <a 
                href="https://ec.europa.eu/consumers/odr" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                https://ec.europa.eu/consumers/odr
              </a>
            </p>
            <p>{t('imprint.sections.disputeResolution.noParticipation')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.liability.title')}</h2>
            <p className="mb-4">{t('imprint.sections.liability.ownContent')}</p>
            <p>{t('imprint.sections.liability.externalLinks')}</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-foreground mb-3">{t('imprint.sections.copyright.title')}</h2>
            <p>{t('imprint.sections.copyright.content')}</p>
          </section>
        </div>
      </div>
    </Layout>
  );
};

export default Imprint;
