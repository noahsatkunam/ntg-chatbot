import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';

interface ROIMetrics {
  tenantId: string;
  period: string;
  totalInvestment: number;
  totalSavings: number;
  roi: number;
  paybackPeriod: number; // months
  breakdown: {
    automationCosts: number;
    infrastructureCosts: number;
    maintenanceCosts: number;
    laborSavings: number;
    efficiencySavings: number;
    errorReductionSavings: number;
  };
}

interface ProductivityMetrics {
  tenantId: string;
  period: string;
  workflowsAutomated: number;
  manualTasksEliminated: number;
  timesSaved: number; // hours
  errorReduction: number; // percentage
  userAdoption: number; // percentage
  processEfficiency: number; // percentage improvement
}

interface BusinessInsight {
  type: 'opportunity' | 'risk' | 'trend' | 'recommendation';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  confidence: number;
  actionItems: string[];
  metrics: Record<string, number>;
  category: 'cost' | 'performance' | 'adoption' | 'quality';
}

interface ForecastData {
  period: string;
  predictedExecutions: number;
  predictedCosts: number;
  predictedSavings: number;
  confidenceInterval: { lower: number; upper: number };
  assumptions: string[];
}

export class BusinessIntelligence extends EventEmitter {
  private prisma: PrismaClient;
  private roiCache: Map<string, ROIMetrics> = new Map();
  private insightsCache: Map<string, BusinessInsight[]> = new Map();

  constructor() {
    super();
    this.prisma = new PrismaClient();
    this.initializeBI();
  }

  private async initializeBI(): Promise<void> {
    // Start periodic analysis
    this.startPeriodicAnalysis();
  }

  async calculateROI(tenantId: string, period: string = '30d'): Promise<ROIMetrics> {
    try {
      const cacheKey = `${tenantId}-${period}`;
      
      // Check cache first
      if (this.roiCache.has(cacheKey)) {
        return this.roiCache.get(cacheKey)!;
      }

      const startDate = this.getPeriodStartDate(period);
      
      // Calculate automation costs
      const automationCosts = await this.calculateAutomationCosts(tenantId, startDate);
      
      // Calculate infrastructure costs
      const infrastructureCosts = await this.calculateInfrastructureCosts(tenantId, startDate);
      
      // Calculate maintenance costs
      const maintenanceCosts = await this.calculateMaintenanceCosts(tenantId, startDate);
      
      // Calculate labor savings
      const laborSavings = await this.calculateLaborSavings(tenantId, startDate);
      
      // Calculate efficiency savings
      const efficiencySavings = await this.calculateEfficiencySavings(tenantId, startDate);
      
      // Calculate error reduction savings
      const errorReductionSavings = await this.calculateErrorReductionSavings(tenantId, startDate);

      const totalInvestment = automationCosts + infrastructureCosts + maintenanceCosts;
      const totalSavings = laborSavings + efficiencySavings + errorReductionSavings;
      const roi = totalInvestment > 0 ? ((totalSavings - totalInvestment) / totalInvestment) * 100 : 0;
      const paybackPeriod = totalSavings > 0 ? (totalInvestment / (totalSavings / this.getPeriodMonths(period))) : 0;

      const roiMetrics: ROIMetrics = {
        tenantId,
        period,
        totalInvestment,
        totalSavings,
        roi,
        paybackPeriod,
        breakdown: {
          automationCosts,
          infrastructureCosts,
          maintenanceCosts,
          laborSavings,
          efficiencySavings,
          errorReductionSavings
        }
      };

      // Cache the result
      this.roiCache.set(cacheKey, roiMetrics);
      
      // Emit ROI calculated event
      this.emit('roi_calculated', roiMetrics);

      return roiMetrics;

    } catch (error) {
      console.error('Error calculating ROI:', error);
      throw error;
    }
  }

  async calculateProductivityMetrics(tenantId: string, period: string = '30d'): Promise<ProductivityMetrics> {
    try {
      const startDate = this.getPeriodStartDate(period);
      
      // Get workflow execution data
      const executions = await this.prisma.workflowExecution.findMany({
        where: {
          tenantId,
          startTime: { gte: startDate }
        },
        include: { workflow: true }
      });

      // Calculate workflows automated
      const workflowsAutomated = new Set(executions.map(e => e.workflowId)).size;
      
      // Estimate manual tasks eliminated (based on execution frequency)
      const manualTasksEliminated = executions.length;
      
      // Calculate time saved (estimate based on workflow complexity and execution time)
      const timesSaved = executions.reduce((total, execution) => {
        const executionTime = execution.endTime ? 
          (new Date(execution.endTime).getTime() - new Date(execution.startTime).getTime()) / 1000 / 3600 : 0;
        // Assume manual process would take 3x longer
        const manualTime = executionTime * 3;
        return total + Math.max(0, manualTime - executionTime);
      }, 0);

      // Calculate error reduction
      const successfulExecutions = executions.filter(e => e.status === 'completed').length;
      const errorReduction = executions.length > 0 ? 
        ((successfulExecutions / executions.length) - 0.85) * 100 : 0; // Assume 85% manual accuracy

      // Calculate user adoption
      const activeUsers = await this.prisma.user.count({
        where: {
          tenantId,
          lastActiveAt: { gte: startDate }
        }
      });
      const totalUsers = await this.prisma.user.count({ where: { tenantId } });
      const userAdoption = totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0;

      // Calculate process efficiency improvement
      const avgExecutionTime = executions.length > 0 ? 
        executions.reduce((sum, e) => {
          const time = e.endTime ? 
            (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 1000 : 0;
          return sum + time;
        }, 0) / executions.length : 0;
      
      // Assume manual process baseline of 1800 seconds (30 minutes)
      const manualBaseline = 1800;
      const processEfficiency = manualBaseline > 0 ? 
        ((manualBaseline - avgExecutionTime) / manualBaseline) * 100 : 0;

      return {
        tenantId,
        period,
        workflowsAutomated,
        manualTasksEliminated,
        timesSaved,
        errorReduction: Math.max(0, errorReduction),
        userAdoption,
        processEfficiency: Math.max(0, processEfficiency)
      };

    } catch (error) {
      console.error('Error calculating productivity metrics:', error);
      throw error;
    }
  }

  async generateBusinessInsights(tenantId: string): Promise<BusinessInsight[]> {
    try {
      // Check cache first
      if (this.insightsCache.has(tenantId)) {
        return this.insightsCache.get(tenantId)!;
      }

      const insights: BusinessInsight[] = [];
      
      // Get recent data for analysis
      const roiMetrics = await this.calculateROI(tenantId, '30d');
      const productivityMetrics = await this.calculateProductivityMetrics(tenantId, '30d');
      
      // ROI-based insights
      if (roiMetrics.roi > 200) {
        insights.push({
          type: 'opportunity',
          title: 'Exceptional ROI Performance',
          description: `Your automation ROI of ${roiMetrics.roi.toFixed(1)}% significantly exceeds industry benchmarks. Consider expanding automation to additional processes.`,
          impact: 'high',
          confidence: 0.9,
          actionItems: [
            'Identify additional processes for automation',
            'Increase automation budget allocation',
            'Share success metrics with stakeholders'
          ],
          metrics: { roi: roiMetrics.roi, savings: roiMetrics.totalSavings },
          category: 'cost'
        });
      } else if (roiMetrics.roi < 50) {
        insights.push({
          type: 'risk',
          title: 'Low ROI Performance',
          description: `Current ROI of ${roiMetrics.roi.toFixed(1)}% is below optimal levels. Review automation strategy and optimize workflows.`,
          impact: 'high',
          confidence: 0.85,
          actionItems: [
            'Audit underperforming workflows',
            'Optimize resource allocation',
            'Review automation strategy'
          ],
          metrics: { roi: roiMetrics.roi, investment: roiMetrics.totalInvestment },
          category: 'cost'
        });
      }

      // Productivity-based insights
      if (productivityMetrics.userAdoption < 60) {
        insights.push({
          type: 'opportunity',
          title: 'Low User Adoption',
          description: `User adoption at ${productivityMetrics.userAdoption.toFixed(1)}% indicates potential for improvement through training and change management.`,
          impact: 'medium',
          confidence: 0.8,
          actionItems: [
            'Implement user training programs',
            'Improve workflow user experience',
            'Create adoption incentives'
          ],
          metrics: { adoption: productivityMetrics.userAdoption },
          category: 'adoption'
        });
      }

      if (productivityMetrics.errorReduction > 15) {
        insights.push({
          type: 'trend',
          title: 'Significant Error Reduction',
          description: `Automation has reduced errors by ${productivityMetrics.errorReduction.toFixed(1)}%, improving process quality and reducing rework costs.`,
          impact: 'high',
          confidence: 0.9,
          actionItems: [
            'Document quality improvements',
            'Expand automation to error-prone processes',
            'Quantify quality cost savings'
          ],
          metrics: { errorReduction: productivityMetrics.errorReduction },
          category: 'quality'
        });
      }

      // Performance-based insights
      const recentExecutions = await this.getRecentExecutionMetrics(tenantId);
      if (recentExecutions.avgExecutionTime > 300) { // 5 minutes
        insights.push({
          type: 'recommendation',
          title: 'Optimize Workflow Performance',
          description: `Average execution time of ${Math.round(recentExecutions.avgExecutionTime)} seconds suggests optimization opportunities.`,
          impact: 'medium',
          confidence: 0.75,
          actionItems: [
            'Profile slow-running workflows',
            'Optimize database queries',
            'Consider parallel processing'
          ],
          metrics: { avgExecutionTime: recentExecutions.avgExecutionTime },
          category: 'performance'
        });
      }

      // Cache insights
      this.insightsCache.set(tenantId, insights);
      
      // Emit insights generated event
      this.emit('insights_generated', { tenantId, insights });

      return insights;

    } catch (error) {
      console.error('Error generating business insights:', error);
      throw error;
    }
  }

  async generateForecast(tenantId: string, periods: number = 6): Promise<ForecastData[]> {
    try {
      const forecasts: ForecastData[] = [];
      
      // Get historical data for trend analysis
      const historicalData = await this.getHistoricalTrends(tenantId, 90); // 90 days
      
      // Simple linear regression for forecasting
      const executionTrend = this.calculateTrend(historicalData.executions);
      const costTrend = this.calculateTrend(historicalData.costs);
      const savingsTrend = this.calculateTrend(historicalData.savings);
      
      for (let i = 1; i <= periods; i++) {
        const period = `Month ${i}`;
        const predictedExecutions = Math.max(0, executionTrend.slope * i + executionTrend.intercept);
        const predictedCosts = Math.max(0, costTrend.slope * i + costTrend.intercept);
        const predictedSavings = Math.max(0, savingsTrend.slope * i + savingsTrend.intercept);
        
        // Calculate confidence interval (±20% for simplicity)
        const confidenceInterval = {
          lower: predictedSavings * 0.8,
          upper: predictedSavings * 1.2
        };

        forecasts.push({
          period,
          predictedExecutions: Math.round(predictedExecutions),
          predictedCosts: Math.round(predictedCosts),
          predictedSavings: Math.round(predictedSavings),
          confidenceInterval,
          assumptions: [
            'Current growth trends continue',
            'No major system changes',
            'Stable user adoption rates',
            'Consistent workflow complexity'
          ]
        });
      }

      return forecasts;

    } catch (error) {
      console.error('Error generating forecast:', error);
      throw error;
    }
  }

  private async calculateAutomationCosts(tenantId: string, startDate: Date): Promise<number> {
    // Simulate automation costs calculation
    const workflows = await this.prisma.workflow.count({ where: { tenantId } });
    const baseCostPerWorkflow = 50; // $50 per workflow per month
    return workflows * baseCostPerWorkflow;
  }

  private async calculateInfrastructureCosts(tenantId: string, startDate: Date): Promise<number> {
    // Simulate infrastructure costs
    const executions = await this.prisma.workflowExecution.count({
      where: { tenantId, startTime: { gte: startDate } }
    });
    const costPerExecution = 0.05; // $0.05 per execution
    return executions * costPerExecution;
  }

  private async calculateMaintenanceCosts(tenantId: string, startDate: Date): Promise<number> {
    // Simulate maintenance costs (10% of automation costs)
    const automationCosts = await this.calculateAutomationCosts(tenantId, startDate);
    return automationCosts * 0.1;
  }

  private async calculateLaborSavings(tenantId: string, startDate: Date): Promise<number> {
    const executions = await this.prisma.workflowExecution.count({
      where: { tenantId, startTime: { gte: startDate } }
    });
    const avgHourlySalary = 25; // $25/hour
    const hoursPerManualTask = 0.5; // 30 minutes per task
    return executions * hoursPerManualTask * avgHourlySalary;
  }

  private async calculateEfficiencySavings(tenantId: string, startDate: Date): Promise<number> {
    // Simulate efficiency savings from faster processing
    const laborSavings = await this.calculateLaborSavings(tenantId, startDate);
    return laborSavings * 0.3; // 30% additional efficiency gains
  }

  private async calculateErrorReductionSavings(tenantId: string, startDate: Date): Promise<number> {
    const executions = await this.prisma.workflowExecution.count({
      where: { tenantId, startTime: { gte: startDate } }
    });
    const costPerError = 100; // $100 cost per error
    const errorReductionRate = 0.15; // 15% error reduction
    return executions * costPerError * errorReductionRate;
  }

  private getPeriodStartDate(period: string): Date {
    const now = new Date();
    const days = parseInt(period.replace('d', ''));
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  }

  private getPeriodMonths(period: string): number {
    const days = parseInt(period.replace('d', ''));
    return days / 30; // Approximate months
  }

  private async getRecentExecutionMetrics(tenantId: string): Promise<{ avgExecutionTime: number; successRate: number }> {
    const executions = await this.prisma.workflowExecution.findMany({
      where: {
        tenantId,
        startTime: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
      }
    });

    const avgExecutionTime = executions.length > 0 ? 
      executions.reduce((sum, e) => {
        const time = e.endTime ? 
          (new Date(e.endTime).getTime() - new Date(e.startTime).getTime()) / 1000 : 0;
        return sum + time;
      }, 0) / executions.length : 0;

    const successRate = executions.length > 0 ? 
      executions.filter(e => e.status === 'completed').length / executions.length : 0;

    return { avgExecutionTime, successRate };
  }

  private async getHistoricalTrends(tenantId: string, days: number): Promise<{
    executions: number[];
    costs: number[];
    savings: number[];
  }> {
    const trends = { executions: [], costs: [], savings: [] };
    
    for (let i = days; i > 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const nextDate = new Date(date.getTime() + 24 * 60 * 60 * 1000);
      
      const dailyExecutions = await this.prisma.workflowExecution.count({
        where: {
          tenantId,
          startTime: { gte: date, lt: nextDate }
        }
      });
      
      trends.executions.push(dailyExecutions);
      trends.costs.push(dailyExecutions * 0.05); // Simulated cost
      trends.savings.push(dailyExecutions * 12.5); // Simulated savings
    }
    
    return trends;
  }

  private calculateTrend(data: number[]): { slope: number; intercept: number } {
    const n = data.length;
    const sumX = (n * (n + 1)) / 2;
    const sumY = data.reduce((sum, val) => sum + val, 0);
    const sumXY = data.reduce((sum, val, index) => sum + val * (index + 1), 0);
    const sumXX = (n * (n + 1) * (2 * n + 1)) / 6;
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }

  private startPeriodicAnalysis(): void {
    // Run daily analysis
    setInterval(async () => {
      await this.runDailyAnalysis();
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Clear caches every hour
    setInterval(() => {
      this.roiCache.clear();
      this.insightsCache.clear();
    }, 60 * 60 * 1000); // 1 hour
  }

  private async runDailyAnalysis(): Promise<void> {
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      });

      for (const tenant of tenants) {
        try {
          // Generate insights for each tenant
          await this.generateBusinessInsights(tenant.id);
          
          // Calculate ROI
          await this.calculateROI(tenant.id);
          
        } catch (error) {
          console.error(`Error in daily analysis for tenant ${tenant.id}:`, error);
        }
      }

    } catch (error) {
      console.error('Error in daily analysis:', error);
    }
  }

  // Public API methods
  async getBusinessDashboard(tenantId: string): Promise<{
    roi: ROIMetrics;
    productivity: ProductivityMetrics;
    insights: BusinessInsight[];
    forecast: ForecastData[];
  }> {
    const [roi, productivity, insights, forecast] = await Promise.all([
      this.calculateROI(tenantId),
      this.calculateProductivityMetrics(tenantId),
      this.generateBusinessInsights(tenantId),
      this.generateForecast(tenantId)
    ]);

    return { roi, productivity, insights, forecast };
  }

  async exportBusinessReport(tenantId: string, format: 'json' | 'csv' = 'json'): Promise<any> {
    const dashboard = await this.getBusinessDashboard(tenantId);
    
    if (format === 'csv') {
      // Convert to CSV format
      return this.convertToCSV(dashboard);
    }
    
    return dashboard;
  }

  private convertToCSV(data: any): string {
    // Simple CSV conversion for business metrics
    const lines = [
      'Metric,Value,Period',
      `ROI,${data.roi.roi}%,${data.roi.period}`,
      `Total Investment,$${data.roi.totalInvestment},${data.roi.period}`,
      `Total Savings,$${data.roi.totalSavings},${data.roi.period}`,
      `Workflows Automated,${data.productivity.workflowsAutomated},${data.productivity.period}`,
      `Time Saved,${data.productivity.timesSaved} hours,${data.productivity.period}`,
      `User Adoption,${data.productivity.userAdoption}%,${data.productivity.period}`
    ];
    
    return lines.join('\n');
  }

  async cleanup(): Promise<void> {
    this.roiCache.clear();
    this.insightsCache.clear();
    await this.prisma.$disconnect();
  }
}
