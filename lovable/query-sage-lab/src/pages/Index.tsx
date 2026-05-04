import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { useAuth } from "@/hooks/useAuth";
import { AuthDialog } from "@/components/AuthDialog";
import { Button } from "@/components/ui/button";
import {
  Database, MessageSquare, BarChart3, Upload, Shield,
  ArrowRight, Download, CheckCircle, Monitor,
} from "lucide-react";

const features = [
  {
    icon: MessageSquare,
    title: "ai_chat",
    description:
      "Ask questions about your data in plain English. Get instant SQL queries generated and executed automatically.",
  },
  {
    icon: Database,
    title: "multi_db",
    description:
      "Connect to PostgreSQL, MySQL, and SQL Server. Manage multiple connections from one central place.",
  },
  {
    icon: BarChart3,
    title: "visualization",
    description:
      "Transform your query results into beautiful charts and graphs with a single click.",
  },
  {
    icon: Upload,
    title: "data_import",
    description:
      "Import CSV, Excel, and JSON files directly into your database without writing any SQL.",
  },
  {
    icon: Monitor,
    title: "local_agent",
    description:
      "Run SQLSphere locally for maximum privacy. Your credentials never leave your machine.",
  },
  {
    icon: Shield,
    title: "security",
    description:
      "End-to-end encryption, session management, and no query result storage on our servers.",
  },
];

const steps = [
  {
    cmd: "connect",
    title: "Connect Your Database",
    description:
      "Add your database credentials securely. SQLSphere supports PostgreSQL, MySQL, and SQL Server.",
  },
  {
    cmd: "query",
    title: "Ask in Plain English",
    description:
      "Type your question naturally — no SQL knowledge required. Our AI understands your intent and generates the query.",
  },
  {
    cmd: "visualize",
    title: "Explore & Visualize",
    description:
      "Get instant results, beautiful charts, and schema insights. Export your findings anytime.",
  },
];

const Index = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <Layout>
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-28 pb-24 md:pt-40 md:pb-36">
        {/* Grid pattern background */}
        <div className="absolute inset-0 grid-pattern pointer-events-none" />

        <div className="container mx-auto px-4 md:px-6 max-w-5xl relative text-center">
          <div className="inline-flex items-center gap-2 mb-6 font-mono text-sm text-primary bg-primary/5 border border-primary/20 rounded-md px-4 py-2 animate-fade-up">
            <span className="text-muted-foreground">$</span> sqlsphere --connect
          </div>
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-foreground mb-6 leading-[1.08] animate-fade-up delay-75">
            Talk to Your Database
            <br className="hidden md:block" />
            <span className="text-gradient">in Plain English</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-6 max-w-2xl mx-auto leading-relaxed animate-fade-up delay-150">
            SQLSphere lets you query, visualize, and manage your databases using natural language —
            no SQL expertise needed. Powered by AI.
          </p>
          <div className="code-block max-w-lg mx-auto mb-10 animate-fade-up delay-200 text-left">
            <span className="text-muted-foreground">SELECT</span> insights <span className="text-muted-foreground">FROM</span> your_data <span className="text-muted-foreground">WHERE</span> language = <span className="text-accent">'english'</span>;
          </div>
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-up delay-300">
            {user ? (
              <Button size="lg" onClick={() => navigate("/chat")} className="gap-2 h-12 px-8 text-base glow-primary">
                Go to App <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button size="lg" onClick={() => setAuthOpen(true)} className="gap-2 h-12 px-8 text-base glow-primary">
                  Get Started Free <ArrowRight className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base">
                  <Link to="/about">Learn More</Link>
                </Button>
              </>
            )}
          </div>
          <p className="mt-8 text-sm text-muted-foreground font-mono animate-fade-up delay-400">
            // free plan · no credit card · open source friendly
          </p>
        </div>
      </section>

      {/* Supported Databases - terminal style */}
      <section className="border-y bg-muted/30 py-6">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="flex flex-wrap justify-center gap-8 md:gap-14">
            {[
              { name: "PostgreSQL", flag: "postgresql" },
              { name: "MySQL", flag: "mysql" },
              { name: "SQL Server", flag: "mssql" },
            ].map((db) => (
              <div key={db.name} className="flex items-center gap-2.5 opacity-70 hover:opacity-100 transition-opacity font-mono text-sm">
                <span className="text-muted-foreground">$</span>
                <span className="text-primary">connect</span>
                <span className="text-muted-foreground">--driver</span>
                <span className="text-foreground">{db.flag}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 md:py-32">
        <div className="container mx-auto px-4 md:px-6 max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              Everything You Need
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">
              From simple queries to complex analytics — SQLSphere handles it all with an intuitive AI interface.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-10">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div key={feature.title} className="group flex gap-0">
                  <div className="dock-rail bg-primary opacity-40 group-hover:opacity-100 transition-opacity" />
                  <div className="flex-1 pl-3">
                    <div className="p-2.5 rounded-lg bg-primary/8 w-fit mb-4 group-hover:bg-primary/15 transition-colors">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold font-mono text-foreground mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works - terminal steps with vertical line */}
      <section className="py-24 md:py-32 relative">
        <div className="absolute inset-0 bg-muted/20 pointer-events-none" />
        <div className="container mx-auto px-4 md:px-6 max-w-3xl relative">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg">
              Get up and running in minutes. No complex setup required.
            </p>
          </div>
          <div className="relative">
            {/* Vertical connecting line */}
            <div className="absolute left-[15px] top-6 bottom-6 w-px bg-border hidden md:block" />
            <div className="space-y-10">
              {steps.map((step, i) => (
                <div key={step.cmd} className="flex gap-6 items-start">
                  <div className="flex-shrink-0 relative z-10">
                    <div className="w-[31px] h-[31px] rounded-lg border border-primary/40 bg-card flex items-center justify-center">
                      <span className="text-primary font-mono text-xs font-bold">{i + 1}</span>
                    </div>
                  </div>
                  <div>
                    <div className="font-mono text-xs text-primary mb-1">$ sqlsphere {step.cmd}</div>
                    <h3 className="text-lg font-semibold text-foreground mb-1">{step.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Local Agent Card - terminal window chrome */}
      <section className="py-20">
        <div className="container mx-auto px-4 md:px-6 max-w-4xl">
          <div className="rounded-xl border border-border/60 overflow-hidden bg-card/40">
            {/* Terminal title bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border/40">
              <div className="flex gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500/80" />
                <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <span className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <span className="font-mono text-xs text-muted-foreground ml-2">sqlsphere-agent</span>
            </div>
            <div className="p-8 md:p-10 flex flex-col md:flex-row items-center gap-8">
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="p-2 rounded-lg bg-primary/8">
                    <Download className="h-5 w-5 text-primary" />
                  </div>
                  <span className="font-semibold font-mono text-foreground text-lg">Local Agent — Coming Soon</span>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  For maximum privacy, run SQLSphere locally. Your database credentials stay on your
                  machine — we never see them. The Local Agent is currently under development.
                </p>
                <ul className="mt-4 space-y-1.5">
                  {["macOS", "Windows", "Linux"].map((os) => (
                    <li key={os} className="flex items-center gap-2.5 text-sm text-muted-foreground font-mono">
                      <CheckCircle className="h-3.5 w-3.5 text-muted-foreground/50" />
                      {os}
                    </li>
                  ))}
                </ul>
              </div>
              <Button variant="outline" asChild className="h-11 px-6 opacity-70">
                <Link to="/download" className="gap-2 flex items-center">
                  <Download className="h-4 w-4" />
                  Learn More
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 md:py-32 relative">
        <div className="absolute inset-0 grid-pattern pointer-events-none" />
        <div className="container mx-auto px-4 text-center max-w-2xl relative">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Ready to Get Started?
          </h2>
          <p className="text-muted-foreground mb-10 text-lg">
            Join developers and analysts who use SQLSphere to work with their databases faster and smarter.
          </p>
          {user ? (
            <Button size="lg" onClick={() => navigate("/chat")} className="gap-2 h-12 px-8 text-base glow-primary">
              Go to App <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="lg" onClick={() => setAuthOpen(true)} className="gap-2 h-12 px-8 text-base glow-primary">
              Create Free Account <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </section>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </Layout>
  );
};

export default Index;
