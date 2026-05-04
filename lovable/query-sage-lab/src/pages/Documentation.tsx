import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Layout from "@/components/Layout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Database,
  MessageSquare,
  BarChart3,
  Upload,
  Shield,
  Zap,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  BookOpen,
  Settings,
  HelpCircle,
  Sparkles,
  Terminal,
  Eye,
  Lock
} from 'lucide-react';

const Documentation = () => {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState('getting-started');
  const sshTunnelRef = useRef<HTMLDivElement>(null);

  // Handle navigation from Connections page
  useEffect(() => {
    const section = sessionStorage.getItem('docsSection');
    const scrollTo = sessionStorage.getItem('docsScrollTo');

    if (section === 'connections' && scrollTo === 'ssh-tunnel') {
      setActiveSection('connections');
      sessionStorage.removeItem('docsSection');
      sessionStorage.removeItem('docsScrollTo');

      // Scroll to SSH tunnel section after a short delay
      setTimeout(() => {
        sshTunnelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, []);

  return (
    <Layout>
      <div className="container mx-auto px-4 md:px-6 pt-16 pb-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-foreground">{t('docs.title')}</h1>
              <p className="text-muted-foreground text-lg">{t('docs.subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1 h-fit lg:sticky lg:top-24 border rounded-lg">
            <div className="p-4 pb-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Settings className="h-5 w-5" />
                {t('docs.navigation')}
              </h2>
            </div>
            <ScrollArea className="h-[400px]">
              <nav className="flex flex-col gap-1 p-4 pt-0">
                {[
                  { id: 'getting-started', icon: Sparkles, label: t('docs.gettingStarted') },
                  { id: 'connections', icon: Database, label: t('docs.connections') },
                  { id: 'ai-chat', icon: MessageSquare, label: t('docs.aiChat') },
                  { id: 'visualization', icon: BarChart3, label: t('docs.visualization') },
                  { id: 'data-import', icon: Upload, label: t('docs.dataImport') },
                  { id: 'security', icon: Shield, label: t('docs.security') },
                  { id: 'tips', icon: Lightbulb, label: t('docs.tipsAndTricks') },
                  { id: 'faq', icon: HelpCircle, label: t('docs.faq') },
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      activeSection === item.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </nav>
            </ScrollArea>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Getting Started */}
            {activeSection === 'getting-started' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-green-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-green-500/20 to-green-500/5">
                      <Sparkles className="h-6 w-6 text-green-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.gettingStarted')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.gettingStartedDesc')}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                      {t('docs.welcomeTitle')}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {t('docs.welcomeText')}
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="flex gap-0 border-2 border-dashed rounded-lg overflow-hidden dock-row-hover">
                        <div className="dock-rail bg-green-500/50 ml-0" />
                        <div className="flex-1 p-4">
                          <div className="flex items-start gap-3">
                            <Badge className="bg-primary/10 text-primary border-primary/20">{i}</Badge>
                            <div>
                              <h4 className="font-medium mb-1">{t(`docs.step${i}Title`)}</h4>
                              <p className="text-sm text-muted-foreground">{t(`docs.step${i}Desc`)}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Database Connections */}
            {activeSection === 'connections' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-blue-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/5">
                      <Database className="h-6 w-6 text-blue-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.connections')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.connectionsDesc')}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.supportedDatabases')}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {['PostgreSQL', 'MySQL', 'SQL Server'].map((db) => (
                        <div key={db} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                          <Database className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{db}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.connectionMethods')}</h3>
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="standard">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-yellow-500" />
                            {t('docs.standardConnection')}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{t('docs.standardConnectionDesc')}</p>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="socket">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-purple-500" />
                            {t('docs.localSocket')}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{t('docs.localSocketDesc')}</p>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="pipe">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Terminal className="h-4 w-4 text-orange-500" />
                            {t('docs.namedPipeConnection')}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{t('docs.namedPipeConnectionDesc')}</p>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="ssh">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Lock className="h-4 w-4 text-green-500" />
                            {t('docs.sshTunnelConnection')}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{t('docs.sshTunnelConnectionDesc')}</p>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="local-agent">
                        <AccordionTrigger>
                          <div className="flex items-center gap-2">
                            <Zap className="h-4 w-4 text-indigo-500" />
                            {t('docs.localAgentConnection')}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{t('docs.localAgentConnectionDesc')}</p>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>

                  {/* SSH Tunnel Section */}
                  <div ref={sshTunnelRef} id="ssh-tunnel" className="space-y-4 mt-6">
                    <h3 className="text-lg font-semibold">{t('docs.sshTunnelTitle')}</h3>
                    <p className="text-muted-foreground">{t('docs.sshTunnelDesc')}</p>

                    <div className="space-y-4 mt-6">
                      <h4 className="text-md font-semibold">{t('docs.sshTunnelSetupTitle')}</h4>
                      <p className="text-sm text-muted-foreground">{t('docs.sshTunnelSetupDesc')}</p>

                      <div className="space-y-3">
                        {['sshTunnelSetupMac', 'sshTunnelSetupWindows', 'sshTunnelSetupLinux', 'sshTunnelSetupCredentials', 'sshTunnelSetupIP', 'sshTunnelSetupDynDNS', 'sshTunnelSetupFirewall', 'sshTunnelSetupRouter'].map((key) => (
                          <div key={key} className="p-3 rounded-lg bg-muted/30 border text-sm">
                            <span dangerouslySetInnerHTML={{ __html: t(`docs.${key}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-4 mt-6">
                      <h4 className="text-md font-semibold">Verwendung in SQLSphere</h4>
                      <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                            <span dangerouslySetInnerHTML={{ __html: t(`docs.sshTunnelStep${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <div className="flex gap-3">
                        <AlertTriangle className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm text-muted-foreground">{t('docs.sshTunnelNote')}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-amber-500">{t('docs.connectionTip')}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{t('docs.connectionTipText')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.connectionUITitle')}</h3>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                          <span dangerouslySetInnerHTML={{ __html: t(`docs.connectionUI${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* AI Chat */}
            {activeSection === 'ai-chat' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-violet-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500/20 to-violet-500/5">
                      <MessageSquare className="h-6 w-6 text-violet-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.aiChat')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.aiChatDesc')}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.whatCanYouDo')}</h3>
                    <div className="grid gap-3">
                      {[
                        { icon: Eye, title: t('docs.aiFeature1'), desc: t('docs.aiFeature1Desc') },
                        { icon: Terminal, title: t('docs.aiFeature2'), desc: t('docs.aiFeature2Desc') },
                        { icon: Sparkles, title: t('docs.aiFeature3'), desc: t('docs.aiFeature3Desc') },
                        { icon: Settings, title: t('docs.aiFeature4'), desc: t('docs.aiFeature4Desc') },
                      ].map((feature, i) => (
                        <div key={i} className="flex gap-3 p-4 rounded-lg bg-muted/50 border">
                          <feature.icon className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                          <div>
                            <h4 className="font-medium">{feature.title}</h4>
                            <p className="text-sm text-muted-foreground">{feature.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.exampleQueries')}</h3>
                    <div className="space-y-2">
                      {[
                        t('docs.exampleQuery1'),
                        t('docs.exampleQuery2'),
                        t('docs.exampleQuery3'),
                        t('docs.exampleQuery4'),
                        t('docs.exampleQuery5'),
                      ].map((query, i) => (
                        <div key={i} className="p-3 rounded-lg bg-primary/5 border border-primary/10 font-mono text-sm">
                          "{query}"
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <div className="flex gap-3">
                      <Lightbulb className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-blue-500">{t('docs.aiTip')}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{t('docs.aiTipText')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.queryPanel')}</h3>
                    <p className="text-muted-foreground">{t('docs.queryPanelDesc')}</p>
                    <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                      <li>{t('docs.queryPanelFeature1')}</li>
                      <li>{t('docs.queryPanelFeature2')}</li>
                      <li>{t('docs.queryPanelFeature3')}</li>
                      <li>{t('docs.queryPanelFeature4')}</li>
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.chatUITitle')}</h3>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                          <span dangerouslySetInnerHTML={{ __html: t(`docs.chatUI${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.schemaBrowserTitle')}</h3>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                          <span dangerouslySetInnerHTML={{ __html: t(`docs.schemaBrowser${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.queryPanelTitle')}</h3>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                          <span dangerouslySetInnerHTML={{ __html: t(`docs.queryPanel${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Visualization */}
            {activeSection === 'visualization' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-orange-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500/20 to-orange-500/5">
                      <BarChart3 className="h-6 w-6 text-orange-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.visualization')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.visualizationDesc')}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.visualizationLevels')}</h3>
                    <div className="grid gap-4">
                      {[
                        { color: 'bg-blue-500', title: t('docs.schemaLevel'), desc: t('docs.schemaLevelDesc') },
                        { color: 'bg-green-500', title: t('docs.tableLevel'), desc: t('docs.tableLevelDesc') },
                        { color: 'bg-purple-500', title: t('docs.columnLevel'), desc: t('docs.columnLevelDesc') },
                      ].map((level, i) => (
                        <div key={i} className="flex gap-0 rounded-lg border overflow-hidden dock-row-hover">
                          <div className={`dock-rail ${level.color}`} />
                          <div className="flex-1 pl-3 py-3 pr-4">
                            <h4 className="font-medium mb-2">{level.title}</h4>
                            <p className="text-sm text-muted-foreground">{level.desc}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.interactionTips')}</h3>
                    <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                      <li>{t('docs.visTip1')}</li>
                      <li>{t('docs.visTip2')}</li>
                      <li>{t('docs.visTip3')}</li>
                      <li>{t('docs.visTip4')}</li>
                      <li>{t('docs.visTip5')}</li>
                      <li>{t('docs.visTip6')}</li>
                      <li>{t('docs.visTip7')}</li>
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.visUITitle')}</h3>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                          <span dangerouslySetInnerHTML={{ __html: t(`docs.visUI${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Data Import */}
            {activeSection === 'data-import' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-cyan-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500/20 to-cyan-500/5">
                      <Upload className="h-6 w-6 text-cyan-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.dataImport')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.dataImportDesc')}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.supportedFormats')}</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {['CSV', 'Excel (.xlsx, .xls)', 'SQL', 'JSON'].map((format) => (
                        <div key={format} className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border">
                          <Upload className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">{format}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.importSteps')}</h3>
                    <ol className="list-decimal list-inside text-muted-foreground space-y-3 ml-4">
                      <li>{t('docs.importStep1')}</li>
                      <li>{t('docs.importStep2')}</li>
                      <li>{t('docs.importStep3')}</li>
                      <li>{t('docs.importStep4')}</li>
                      <li>{t('docs.importStep5')}</li>
                    </ol>
                  </div>

                  <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <div className="flex gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-amber-500">{t('docs.importWarning')}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{t('docs.importWarningText')}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">{t('docs.importUITitle')}</h3>
                    <div className="space-y-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((i) => (
                        <div key={i} className="p-3 rounded-lg bg-muted/30 border text-sm">
                          <span dangerouslySetInnerHTML={{ __html: t(`docs.importUI${i}`).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Security */}
            {activeSection === 'security' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-red-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-red-500/20 to-red-500/5">
                      <Shield className="h-6 w-6 text-red-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.security')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.securityDesc')}</p>
                    </div>
                  </div>

                  <div className="grid gap-4">
                    {[
                      { icon: Lock, title: t('docs.securityFeature1'), desc: t('docs.securityFeature1Desc') },
                      { icon: Shield, title: t('docs.securityFeature2'), desc: t('docs.securityFeature2Desc') },
                      { icon: Eye, title: t('docs.securityFeature3'), desc: t('docs.securityFeature3Desc') },
                      { icon: AlertTriangle, title: t('docs.securityFeature4'), desc: t('docs.securityFeature4Desc') },
                    ].map((feature, i) => (
                      <div key={i} className="flex gap-3 p-4 rounded-lg bg-muted/50 border">
                        <feature.icon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-medium">{feature.title}</h4>
                          <p className="text-sm text-muted-foreground">{feature.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="flex gap-3">
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <h4 className="font-medium text-green-500">{t('docs.securityTip')}</h4>
                        <p className="text-sm text-muted-foreground mt-1">{t('docs.securityTipText')}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tips & Tricks */}
            {activeSection === 'tips' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-yellow-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-yellow-500/20 to-yellow-500/5">
                      <Lightbulb className="h-6 w-6 text-yellow-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.tipsAndTricks')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.tipsDesc')}</p>
                    </div>
                  </div>

                  <Accordion type="single" collapsible className="w-full">
                    {[
                      { title: t('docs.tip1Title'), content: t('docs.tip1Content') },
                      { title: t('docs.tip2Title'), content: t('docs.tip2Content') },
                      { title: t('docs.tip3Title'), content: t('docs.tip3Content') },
                      { title: t('docs.tip4Title'), content: t('docs.tip4Content') },
                      { title: t('docs.tip5Title'), content: t('docs.tip5Content') },
                      { title: t('docs.tip6Title'), content: t('docs.tip6Content') },
                      { title: t('docs.tip7Title'), content: t('docs.tip7Content') },
                      { title: t('docs.tip8Title'), content: t('docs.tip8Content') },
                      { title: t('docs.tip9Title'), content: t('docs.tip9Content') },
                      { title: t('docs.tip10Title'), content: t('docs.tip10Content') },
                      { title: t('docs.tip11Title'), content: t('docs.tip11Content') },
                    ].map((tip, i) => (
                      <AccordionItem key={i} value={`tip-${i}`}>
                        <AccordionTrigger className="text-left">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{i + 1}</Badge>
                            {tip.title}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{tip.content}</p>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              </div>
            )}

            {/* FAQ */}
            {activeSection === 'faq' && (
              <div className="flex gap-0">
                <div className="dock-rail bg-pink-500" />
                <div className="flex-1 pl-4 space-y-6">
                  <div className="flex items-center gap-3 py-3">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-pink-500/20 to-pink-500/5">
                      <HelpCircle className="h-6 w-6 text-pink-500" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold">{t('docs.faq')}</h2>
                      <p className="text-sm text-muted-foreground">{t('docs.faqDesc')}</p>
                    </div>
                  </div>

                  <Accordion type="single" collapsible className="w-full">
                    {[
                      { q: t('docs.faq1Q'), a: t('docs.faq1A') },
                      { q: t('docs.faq2Q'), a: t('docs.faq2A') },
                      { q: t('docs.faq3Q'), a: t('docs.faq3A') },
                      { q: t('docs.faq4Q'), a: t('docs.faq4A') },
                      { q: t('docs.faq5Q'), a: t('docs.faq5A') },
                      { q: t('docs.faq6Q'), a: t('docs.faq6A') },
                      { q: t('docs.faq7Q'), a: t('docs.faq7A') },
                    ].map((faq, i) => (
                      <AccordionItem key={i} value={`faq-${i}`}>
                        <AccordionTrigger className="text-left">{faq.q}</AccordionTrigger>
                        <AccordionContent>
                          <p className="text-muted-foreground">{faq.a}</p>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Documentation;
