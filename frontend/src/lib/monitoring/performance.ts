import React from 'react';
import { getCLS, getFCP, getFID, getLCP, getTTFB } from 'web-vitals';

// Performance monitoring singleton
class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, number> = new Map();
  private observers: PerformanceObserver[] = [];

  private constructor() {
    this.initializeObservers();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  private initializeObservers() {
    // Navigation timing observer
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      const navObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'navigation') {
            const navEntry = entry as PerformanceNavigationTiming;
            this.recordMetric('page_load_time', navEntry.loadEventEnd - navEntry.loadEventStart);
            this.recordMetric('dom_content_loaded', navEntry.domContentLoadedEventEnd - navEntry.domContentLoadedEventStart);
            this.recordMetric('first_byte', navEntry.responseStart - navEntry.requestStart);
          }
        });
      });
      
      navObserver.observe({ entryTypes: ['navigation'] });
      this.observers.push(navObserver);
    }

    // Resource timing observer
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      const resourceObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach((entry) => {
          if (entry.entryType === 'resource') {
            const resourceEntry = entry as PerformanceResourceTiming;
            this.recordMetric(`resource_${resourceEntry.name}`, resourceEntry.duration);
          }
        });
      });
      
      resourceObserver.observe({ entryTypes: ['resource'] });
      this.observers.push(resourceObserver);
    }
  }

  // Record custom metrics
  recordMetric(name: string, value: number) {
    this.metrics.set(name, value);
    
    // Send to analytics if available
    if (typeof window !== 'undefined' && 'gtag' in window) {
      (window as any).gtag('event', 'performance_metric', {
        metric_name: name,
        metric_value: value,
      });
    }
  }

  // API call timing
  async measureApiCall<T>(apiCall: () => Promise<T>, endpoint: string): Promise<T> {
    const startTime = performance.now();
    
    try {
      const result = await apiCall();
      const duration = performance.now() - startTime;
      this.recordMetric(`api_${endpoint}`, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.recordMetric(`api_${endpoint}_error`, duration);
      throw error;
    }
  }

  // Component render timing
  measureComponentRender(componentName: string, renderFn: () => void) {
    const startTime = performance.now();
    renderFn();
    const duration = performance.now() - startTime;
    this.recordMetric(`component_${componentName}`, duration);
  }

  // Get all metrics
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  // Clear metrics
  clearMetrics() {
    this.metrics.clear();
  }

  // Cleanup observers
  cleanup() {
    this.observers.forEach(observer => observer.disconnect());
    this.observers = [];
  }
}

// Core Web Vitals tracking
export const trackWebVitals = () => {
  const monitor = PerformanceMonitor.getInstance();

  getCLS((metric) => {
    monitor.recordMetric('cls', metric.value);
  });

  getFCP((metric) => {
    monitor.recordMetric('fcp', metric.value);
  });

  getFID((metric) => {
    monitor.recordMetric('fid', metric.value);
  });

  getLCP((metric) => {
    monitor.recordMetric('lcp', metric.value);
  });

  getTTFB((metric) => {
    monitor.recordMetric('ttfb', metric.value);
  });
};

// Bundle size analysis
export const analyzeBundleSize = () => {
  if (typeof window !== 'undefined' && 'performance' in window && 'getEntriesByType' in performance) {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const jsResources = resources.filter(resource => 
      resource.name.includes('.js') && !resource.name.includes('node_modules')
    );
    
    const totalJSSize = jsResources.reduce((total, resource) => {
      return total + (resource.transferSize || 0);
    }, 0);
    
    const monitor = PerformanceMonitor.getInstance();
    monitor.recordMetric('bundle_size_js', totalJSSize);
    
    return {
      totalJSSize,
      jsResources: jsResources.map(resource => ({
        name: resource.name,
        size: resource.transferSize,
        duration: resource.duration
      }))
    };
  }
  
  return null;
};

// React performance hooks
export const usePerformanceMonitor = () => {
  const monitor = PerformanceMonitor.getInstance();
  
  const measureRender = React.useCallback((componentName: string, renderFn: () => void) => {
    monitor.measureComponentRender(componentName, renderFn);
  }, [monitor]);
  
  const measureApi = React.useCallback(async <T>(apiCall: () => Promise<T>, endpoint: string): Promise<T> => {
    return monitor.measureApiCall(apiCall, endpoint);
  }, [monitor]);
  
  return { measureRender, measureApi, getMetrics: () => monitor.getMetrics() };
};

// HOC for performance monitoring
export const withPerformanceMonitoring = <P extends object>(
  WrappedComponent: React.ComponentType<P>,
  componentName: string
) => {
  return React.forwardRef<any, P>((props, ref) => {
    const monitor = PerformanceMonitor.getInstance();
    
    React.useEffect(() => {
      const startTime = performance.now();
      
      return () => {
        const duration = performance.now() - startTime;
        monitor.recordMetric(`component_${componentName}_lifecycle`, duration);
      };
    }, [monitor]);
    
    return (
      <React.Suspense fallback={<div>Loading...</div>}>
        <WrappedComponent {...props} ref={ref} />
      </React.Suspense>
    );
  });
};

// Lazy loading utility with performance tracking
export const createLazyComponent = <T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  componentName: string
) => {
  const monitor = PerformanceMonitor.getInstance();
  
  return React.lazy(async () => {
    const startTime = performance.now();
    
    try {
      const component = await importFn();
      const duration = performance.now() - startTime;
      monitor.recordMetric(`lazy_load_${componentName}`, duration);
      return component;
    } catch (error) {
      const duration = performance.now() - startTime;
      monitor.recordMetric(`lazy_load_${componentName}_error`, duration);
      throw error;
    }
  });
};

export default PerformanceMonitor;
