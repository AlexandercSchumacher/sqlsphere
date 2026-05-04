import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { SubscriptionProvider } from "@/hooks/useSubscription";
import { UserSettingsProvider } from "@/hooks/useUserSettings";
import { ConnectionProvider } from "@/hooks/useConnection";

import Connections from "./pages/Connections";
import ChatCursor from "./pages/ChatCursor";
import Visualization from "./pages/Visualization";
import DataImport from "./pages/DataImport";
import Profile from "./pages/Profile";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import TermsOfService from "./pages/TermsOfService";
import Imprint from "./pages/Imprint";
import About from "./pages/About";
import Documentation from "./pages/Documentation";
import Download from "./pages/Download";
import QueryHistory from "./pages/QueryHistory";
import NotFound from "./pages/NotFound";
import Index from "./pages/Index";

const queryClient = new QueryClient();

// LOCAL_MODE: out-of-scope routes (login/signup/schedules/alerts/dashboards/
// subscription/share) are intentionally absent. The corresponding pages live
// only in the cloud version of SQLSphere.

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <UserSettingsProvider>
        <SubscriptionProvider>
          <ConnectionProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/connections" element={<Connections />} />
                <Route path="/chat" element={<ChatCursor />} />
                <Route path="/chat/:id" element={<ChatCursor />} />
                <Route path="/visualization" element={<Visualization />} />
                <Route path="/import" element={<DataImport />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/imprint" element={<Imprint />} />
                <Route path="/about" element={<About />} />
                <Route path="/docs" element={<Documentation />} />
                <Route path="/download" element={<Download />} />
                <Route path="/history" element={<QueryHistory />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </ConnectionProvider>
        </SubscriptionProvider>
      </UserSettingsProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
