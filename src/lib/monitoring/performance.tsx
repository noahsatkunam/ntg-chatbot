import React from 'react';

// Simplified performance monitoring - no external dependencies
class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  recordMetric(name: string, value: number) {
    this.metrics.set(name, value);
    console.log(`Performance metric: ${name} = ${value}ms`);
  }

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

  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  clearMetrics() {
    this.metrics.clear();
  }
}

export default PerformanceMonitor;
