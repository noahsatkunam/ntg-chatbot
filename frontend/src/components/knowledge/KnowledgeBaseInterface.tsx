import React, { useState, useEffect } from 'react';
import { Upload, Search, FileText, Trash2, Download, Eye, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { LoadingSpinner, LoadingOverlay } from '../ui/LoadingSpinner';
import { knowledgeApi } from '../../lib/api/knowledge';
import { KnowledgeDocument, PaginatedResponse } from '../../types/api';
import { useApi } from '../../hooks/useApi';

interface KnowledgeBaseInterfaceProps {
  onDocumentSelect?: (document: KnowledgeDocument) => void;
  selectable?: boolean;
}

export const KnowledgeBaseInterface: React.FC<KnowledgeBaseInterfaceProps> = ({
  onDocumentSelect,
  selectable = false,
}) => {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number }>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const {
    execute: loadDocuments,
    loading: documentsLoading,
  } = useApi(knowledgeApi.getDocuments);

  const {
    execute: uploadDocument,
    loading: uploadLoading,
  } = useApi(knowledgeApi.uploadDocument);

  const {
    execute: deleteDocument,
    loading: deleteLoading,
  } = useApi(knowledgeApi.deleteDocument);

  const {
    execute: searchDocuments,
    loading: searchLoading,
  } = useApi(knowledgeApi.searchDocuments);

  // Load documents on component mount and page changes
  useEffect(() => {
    loadDocumentsData();
  }, [currentPage]);

  // Search documents when query changes
  useEffect(() => {
    if (searchQuery.trim()) {
      handleSearch();
    } else {
      loadDocumentsData();
    }
  }, [searchQuery]);

  const loadDocumentsData = async () => {
    try {
      const response = await loadDocuments({
        page: currentPage,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
      
      if (response) {
        setDocuments(response.items);
        setTotalPages(Math.ceil(response.total / response.limit));
      }
    } catch (error) {
      console.error('Failed to load documents:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      const results = await searchDocuments({
        query: searchQuery,
        limit: 10,
        threshold: 0.7,
      });
      
      if (results) {
        setDocuments(results.map(r => r.document));
        setTotalPages(1); // Search results are not paginated
      }
    } catch (error) {
      console.error('Failed to search documents:', error);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    setSelectedFiles(files);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    for (const file of selectedFiles) {
      try {
        setUploadProgress(prev => ({ ...prev, [file.name]: 0 }));
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('metadata', JSON.stringify({
          tags: [],
          category: 'general',
        }));

        await uploadDocument(formData);
        
        setUploadProgress(prev => ({ ...prev, [file.name]: 100 }));
      } catch (error) {
        console.error(`Failed to upload ${file.name}:`, error);
        setUploadProgress(prev => ({ ...prev, [file.name]: -1 }));
      }
    }

    // Refresh documents list
    setTimeout(() => {
      loadDocumentsData();
      setSelectedFiles([]);
      setUploadProgress({});
    }, 1000);
  };

  const handleDelete = async (documentId: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await deleteDocument(documentId);
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  };

  const handleReprocess = async (documentId: string) => {
    try {
      await knowledgeApi.reprocessDocument(documentId);
      // Refresh the document to show updated status
      loadDocumentsData();
    } catch (error) {
      console.error('Failed to reprocess document:', error);
    }
  };

  const getStatusColor = (status: KnowledgeDocument['status']) => {
    switch (status) {
      case 'processed': return 'text-green-600';
      case 'processing': return 'text-yellow-600';
      case 'failed': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <div className="border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Upload Documents</h3>
        
        <div className="space-y-4">
          <div>
            <input
              type="file"
              multiple
              accept=".pdf,.doc,.docx,.txt,.md"
              onChange={handleFileSelect}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Selected Files:</h4>
              {selectedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                  <div className="flex items-center space-x-2">
                    <FileText size={16} />
                    <span className="text-sm">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({formatFileSize(file.size)})
                    </span>
                  </div>
                  
                  {uploadProgress[file.name] !== undefined && (
                    <div className="flex items-center space-x-2">
                      {uploadProgress[file.name] === -1 ? (
                        <span className="text-red-600 text-xs">Failed</span>
                      ) : uploadProgress[file.name] === 100 ? (
                        <span className="text-green-600 text-xs">Complete</span>
                      ) : (
                        <span className="text-xs">{uploadProgress[file.name]}%</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
              
              <Button 
                onClick={handleUpload} 
                disabled={uploadLoading}
                className="w-full"
              >
                {uploadLoading ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={16} className="mr-2" />
                    Upload Documents
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Search Section */}
      <div className="flex space-x-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={16} />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={loadDocumentsData}>
          <RefreshCw size={16} />
        </Button>
      </div>

      {/* Documents List */}
      <LoadingOverlay isLoading={documentsLoading || searchLoading}>
        <div className="space-y-4">
          {documents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery ? 'No documents found matching your search.' : 'No documents uploaded yet.'}
            </div>
          ) : (
            documents.map((document) => (
              <div
                key={document.id}
                className={`border rounded-lg p-4 ${
                  selectable ? 'cursor-pointer hover:bg-muted/50' : ''
                }`}
                onClick={() => selectable && onDocumentSelect?.(document)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <FileText size={16} />
                      <h4 className="font-medium">{document.name}</h4>
                      <span className={`text-xs px-2 py-1 rounded ${getStatusColor(document.status)}`}>
                        {document.status}
                      </span>
                    </div>
                    
                    <p className="text-sm text-muted-foreground mt-1">
                      {formatFileSize(document.size)} • Uploaded {new Date(document.createdAt).toLocaleDateString()}
                    </p>
                    
                    {document.metadata?.description && (
                      <p className="text-sm mt-2">{document.metadata.description}</p>
                    )}
                    
                    {document.metadata?.tags && document.metadata.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {document.metadata.tags.map((tag, index) => (
                          <span
                            key={index}
                            className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex space-x-2">
                    {document.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReprocess(document.id);
                        }}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    )}
                    
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle document preview/view
                      }}
                    >
                      <Eye size={14} />
                    </Button>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Handle document download
                      }}
                    >
                      <Download size={14} />
                    </Button>
                    
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(document.id);
                      }}
                      disabled={deleteLoading}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </LoadingOverlay>

      {/* Pagination */}
      {totalPages > 1 && !searchQuery && (
        <div className="flex justify-center space-x-2">
          <Button
            variant="outline"
            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          
          <span className="flex items-center px-4">
            Page {currentPage} of {totalPages}
          </span>
          
          <Button
            variant="outline"
            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
};
