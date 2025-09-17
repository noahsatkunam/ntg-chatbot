import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ChatProvider } from './contexts/ChatContext';
import { TenantProvider } from './contexts/TenantContext';
import { NotificationProvider } from './components/ui/GlobalErrorHandler';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import Index from './pages/Index';
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function App() {
  return (
    <ErrorBoundary>
      <NotificationProvider>
        <QueryClientProvider client={queryClient}>
          <Router>
            <AuthProvider>
              <TenantProvider>
                <ChatProvider>
                  <TooltipProvider>
                    <div className="min-h-screen bg-background">
                      <Routes>
                        <Route path="/" element={<Index />} />
                        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </div>
                    <Toaster />
                    <Sonner />
                  </TooltipProvider>
                </ChatProvider>
              </TenantProvider>
            </AuthProvider>
          </Router>
        </QueryClientProvider>
      </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;
