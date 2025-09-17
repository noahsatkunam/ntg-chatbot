import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, X, File, FileText, Image, Loader2, Check, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

interface UploadedDocument {
  id: string;
  title: string;
  file_name: string;
  file_type: string;
  file_size: number;
  status: 'uploading' | 'processing' | 'ready' | 'error';
  progress: number;
}

interface DocumentUploadProps {
  onDocumentUploaded?: (document: UploadedDocument) => void;
  maxFiles?: number;
  maxSize?: number; // in bytes
  className?: string;
}

export const DocumentUpload = ({ 
  onDocumentUploaded, 
  maxFiles = 10, 
  maxSize = 50 * 1024 * 1024, // 50MB
  className = ''
}: DocumentUploadProps) => {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newDocuments: UploadedDocument[] = acceptedFiles.map(file => ({
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
      file_name: file.name,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      status: 'uploading' as const,
      progress: 0,
    }));

    setDocuments(prev => [...prev, ...newDocuments]);

    // Process each file
    for (const [index, file] of acceptedFiles.entries()) {
      const document = newDocuments[index];
      await processDocument(file, document);
    }
  }, []);

  const processDocument = async (file: File, document: UploadedDocument) => {
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error('User not authenticated');
      }

      // Update status to uploading
      setDocuments(prev => prev.map(doc => 
        doc.id === document.id 
          ? { ...doc, status: 'uploading', progress: 10 }
          : doc
      ));

      // Read file content
      const content = await readFileContent(file);
      
      // Update progress
      setDocuments(prev => prev.map(doc => 
        doc.id === document.id 
          ? { ...doc, progress: 30 }
          : doc
      ));

      // Insert document into database
      const { data: insertedDoc, error: insertError } = await supabase
        .from('documents')
        .insert({
          user_id: user.id,
          title: document.title,
          file_name: document.file_name,
          file_type: document.file_type,
          file_size: document.file_size,
          content: content,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      // Update progress
      setDocuments(prev => prev.map(doc => 
        doc.id === document.id 
          ? { ...doc, progress: 60, status: 'processing' }
          : doc
      ));

      // Skip edge function processing for now since we haven't created it yet
      // In a real implementation, you would call a document processing function here
      
      // Update to ready
      setDocuments(prev => prev.map(doc => 
        doc.id === document.id 
          ? { ...doc, progress: 100, status: 'ready' }
          : doc
      ));

      onDocumentUploaded?.({
        ...document,
        id: insertedDoc.id,
        status: 'ready',
        progress: 100,
      });

    } catch (error) {
      console.error('Document processing error:', error);
      setDocuments(prev => prev.map(doc => 
        doc.id === document.id 
          ? { ...doc, status: 'error', progress: 0 }
          : doc
      ));
    }
  };

  const readFileContent = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        resolve(content);
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      
      if (file.type.includes('text') || file.name.endsWith('.md') || file.name.endsWith('.txt')) {
        reader.readAsText(file);
      } else {
        // For other files, we might need different processing
        reader.readAsText(file); // Fallback to text for now
      }
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: maxFiles - documents.filter(d => d.status !== 'error').length,
    maxSize,
    multiple: true,
    accept: {
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
    }
  });

  const removeDocument = (id: string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== id));
  };

  const getFileIcon = (type: string) => {
    if (type.includes('text') || type.includes('markdown')) return FileText;
    if (type.includes('pdf') || type.includes('document')) return FileText;
    if (type.includes('image')) return Image;
    return File;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'uploading':
      case 'processing':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'ready':
        return <Check className="w-4 h-4 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'uploading':
      case 'processing':
        return 'text-blue-600 bg-blue-50';
      case 'ready':
        return 'text-green-600 bg-green-50';
      case 'error':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-gray-600 bg-gray-50';
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Upload Zone */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload Documents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive
                ? 'border-chat-primary bg-chat-primary/10'
                : 'border-border hover:border-chat-primary/50 hover:bg-chat-hover/50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-chat-primary font-medium">Drop documents here...</p>
            ) : (
              <div>
                <p className="text-foreground font-medium mb-1">
                  Drag & drop documents here, or click to select
                </p>
                <p className="text-sm text-muted-foreground">
                  Supports: PDF, DOC, DOCX, TXT, MD, CSV, JSON
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Max {maxFiles} files, {formatFileSize(maxSize)} each
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Uploaded Documents */}
      {documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Processing Documents ({documents.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {documents.map((document) => {
              const IconComponent = getFileIcon(document.file_type);
              return (
                <div
                  key={document.id}
                  className="flex items-center gap-3 p-3 bg-card border border-border/50 rounded-lg"
                >
                  <IconComponent className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium truncate">{document.title}</p>
                      <div className="flex items-center gap-2">
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${getStatusColor(document.status)}`}
                        >
                          {getStatusIcon(document.status)}
                          <span className="ml-1 capitalize">{document.status}</span>
                        </Badge>
                        {document.status !== 'processing' && document.status !== 'uploading' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-destructive/20 hover:text-destructive"
                            onClick={() => removeDocument(document.id)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{document.file_name}</span>
                      <span>{formatFileSize(document.file_size)}</span>
                    </div>
                    {(document.status === 'uploading' || document.status === 'processing') && (
                      <Progress value={document.progress} className="h-1 mt-2" />
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
};