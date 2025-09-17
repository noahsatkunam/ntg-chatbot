import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Settings, Plus, Trash2, Copy, Eye } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LoadingSpinner, LoadingOverlay } from '../ui/LoadingSpinner';
import { workflowsApi, Workflow, WorkflowExecution, WorkflowTemplate } from '../../lib/api/workflows';
import { useApi } from '../../hooks/useApi';

interface WorkflowInterfaceProps {
  onWorkflowSelect?: (workflow: Workflow) => void;
}

export const WorkflowInterface: React.FC<WorkflowInterfaceProps> = ({
  onWorkflowSelect,
}) => {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [executions, setExecutions] = useState<{ [key: string]: WorkflowExecution[] }>({});
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  const {
    execute: loadWorkflows,
    loading: workflowsLoading,
  } = useApi(workflowsApi.getWorkflows);

  const {
    execute: loadTemplates,
    loading: templatesLoading,
  } = useApi(workflowsApi.getTemplates);

  const {
    execute: executeWorkflow,
    loading: executionLoading,
  } = useApi(workflowsApi.executeWorkflow);

  const {
    execute: createFromTemplate,
    loading: creatingFromTemplate,
  } = useApi(workflowsApi.createFromTemplate);

  useEffect(() => {
    loadWorkflowsData();
    loadTemplatesData();
  }, []);

  const loadWorkflowsData = async () => {
    try {
      const response = await loadWorkflows({
        page: 1,
        limit: 50,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      
      if (response) {
        setWorkflows(response.items);
      }
    } catch (error) {
      console.error('Failed to load workflows:', error);
    }
  };

  const loadTemplatesData = async () => {
    try {
      const templatesData = await loadTemplates();
      if (templatesData) {
        setTemplates(templatesData);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  const loadExecutions = async (workflowId: string) => {
    try {
      const response = await workflowsApi.getWorkflowExecutions(workflowId, {
        page: 1,
        limit: 10,
        sortBy: 'startedAt',
        sortOrder: 'desc',
      });
      
      setExecutions(prev => ({
        ...prev,
        [workflowId]: response.items,
      }));
    } catch (error) {
      console.error('Failed to load executions:', error);
    }
  };

  const handleExecuteWorkflow = async (workflowId: string) => {
    try {
      const execution = await executeWorkflow(workflowId, {});
      
      // Refresh executions for this workflow
      loadExecutions(workflowId);
      
      // Update workflow execution count
      setWorkflows(prev => 
        prev.map(w => 
          w.id === workflowId 
            ? { ...w, executionCount: w.executionCount + 1, lastExecuted: new Date().toISOString() }
            : w
        )
      );
    } catch (error) {
      console.error('Failed to execute workflow:', error);
    }
  };

  const handleCreateFromTemplate = async (templateId: string, name: string) => {
    try {
      const workflow = await createFromTemplate(templateId, name);
      setWorkflows(prev => [workflow, ...prev]);
    } catch (error) {
      console.error('Failed to create workflow from template:', error);
    }
  };

  const handleDeleteWorkflow = async (workflowId: string) => {
    if (!confirm('Are you sure you want to delete this workflow?')) return;

    try {
      await workflowsApi.deleteWorkflow(workflowId);
      setWorkflows(prev => prev.filter(w => w.id !== workflowId));
    } catch (error) {
      console.error('Failed to delete workflow:', error);
    }
  };

  const getStatusColor = (status: Workflow['status']) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'inactive': return 'text-gray-600 bg-gray-100';
      case 'draft': return 'text-yellow-600 bg-yellow-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getExecutionStatusColor = (status: WorkflowExecution['status']) => {
    switch (status) {
      case 'completed': return 'text-green-600';
      case 'running': return 'text-blue-600';
      case 'failed': return 'text-red-600';
      case 'cancelled': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Workflows</h2>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            onClick={() => setShowTemplates(!showTemplates)}
          >
            {showTemplates ? 'Show Workflows' : 'Browse Templates'}
          </Button>
          <Button>
            <Plus size={16} className="mr-2" />
            Create Workflow
          </Button>
        </div>
      </div>

      {showTemplates ? (
        /* Templates Section */
        <LoadingOverlay isLoading={templatesLoading}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <div key={template.id} className="border rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold">{template.name}</h3>
                  <span className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded">
                    {template.category}
                  </span>
                </div>
                
                <p className="text-sm text-muted-foreground mb-3">
                  {template.description}
                </p>
                
                <div className="flex flex-wrap gap-1 mb-3">
                  {template.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    const name = prompt('Enter workflow name:');
                    if (name) {
                      handleCreateFromTemplate(template.id, name);
                    }
                  }}
                  disabled={creatingFromTemplate}
                >
                  {creatingFromTemplate ? (
                    <LoadingSpinner size="sm" className="mr-2" />
                  ) : (
                    <Copy size={14} className="mr-2" />
                  )}
                  Use Template
                </Button>
              </div>
            ))}
          </div>
        </LoadingOverlay>
      ) : (
        /* Workflows Section */
        <LoadingOverlay isLoading={workflowsLoading}>
          <div className="space-y-4">
            {workflows.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No workflows created yet. Create one from a template or start from scratch.
              </div>
            ) : (
              workflows.map((workflow) => (
                <div key={workflow.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="font-semibold">{workflow.name}</h3>
                        <span className={`text-xs px-2 py-1 rounded ${getStatusColor(workflow.status)}`}>
                          {workflow.status}
                        </span>
                      </div>
                      
                      <p className="text-sm text-muted-foreground mb-2">
                        {workflow.description}
                      </p>
                      
                      <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                        <span>Executions: {workflow.executionCount}</span>
                        {workflow.lastExecuted && (
                          <span>
                            Last run: {new Date(workflow.lastExecuted).toLocaleDateString()}
                          </span>
                        )}
                        <span>
                          Trigger: {workflow.trigger.type}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleExecuteWorkflow(workflow.id)}
                        disabled={executionLoading || workflow.status !== 'active'}
                      >
                        {executionLoading ? (
                          <LoadingSpinner size="sm" />
                        ) : (
                          <Play size={14} />
                        )}
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedWorkflow(
                            selectedWorkflow === workflow.id ? null : workflow.id
                          );
                          if (selectedWorkflow !== workflow.id) {
                            loadExecutions(workflow.id);
                          }
                        }}
                      >
                        <Eye size={14} />
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onWorkflowSelect?.(workflow)}
                      >
                        <Settings size={14} />
                      </Button>
                      
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteWorkflow(workflow.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  
                  {/* Execution History */}
                  {selectedWorkflow === workflow.id && (
                    <div className="mt-4 pt-4 border-t">
                      <h4 className="font-medium mb-2">Recent Executions</h4>
                      {executions[workflow.id]?.length > 0 ? (
                        <div className="space-y-2">
                          {executions[workflow.id].map((execution) => (
                            <div
                              key={execution.id}
                              className="flex items-center justify-between p-2 bg-muted rounded text-sm"
                            >
                              <div className="flex items-center space-x-2">
                                <span className={getExecutionStatusColor(execution.status)}>
                                  {execution.status}
                                </span>
                                <span>
                                  {new Date(execution.startedAt).toLocaleString()}
                                </span>
                                {execution.duration && (
                                  <span className="text-muted-foreground">
                                    ({execution.duration}ms)
                                  </span>
                                )}
                              </div>
                              
                              {execution.error && (
                                <span className="text-red-600 text-xs truncate max-w-48">
                                  {execution.error}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">No executions yet</p>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </LoadingOverlay>
      )}
    </div>
  );
};
